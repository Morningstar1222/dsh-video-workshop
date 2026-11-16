/**
 * 导出管线：客户端逐帧渲染 JPEG → 这里落盘 → ffmpeg 编码 + 混音。
 *
 * 为什么是帧序列而不是 WebCodecs：预览与导出共用同一个 canvas 渲染函数，
 * 帧序列是唯一能保证「所见即所得」而无需引入 MP4 muxer 的做法；
 * 画质优先（crf 16 + preset slow）符合用户「慢点可以接受」的要求。
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assetPath, projectDir } from './store.js'
import { probeMedia, runCapture } from './media.js'

/** 活跃作业（进程内）。 */
const jobs = new Map()

/** 单个作业的帧目录。 */
function framesDir(projectsRoot, id, jobId) {
  return path.join(projectDir(projectsRoot, id), '.frames', jobId)
}

/** 秒 → SRT 时间。 */
function srtTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(ms, 3)}`
}

/** 生成 SRT 文本。 */
export function buildSrt(cues) {
  const list = Array.isArray(cues) ? cues : []
  return list
    .map((cue, index) => {
      const start = srtTime(cue.startSec)
      const end = srtTime(Math.max(Number(cue.endSec) || 0, (Number(cue.startSec) || 0) + 0.2))
      return `${index + 1}\n${start} --> ${end}\n${String(cue.text ?? '').trim()}\n`
    })
    .join('\n')
}

/** 创建渲染作业。 */
export async function createJob({ projectsRoot, projectId, project, audio, outName }) {
  const jobId = randomUUID()
  const canvas = project?.canvas ?? {}
  const fps = Math.max(1, Math.round(Number(canvas.fps) || 30))
  // 以时间轴总长为准（转场会重叠，逐场相加会多出几帧）。
  let totalSec = Number(project?.timeline?.totalSec) || 0
  if (!(totalSec > 0)) {
    for (const scene of project?.scenes ?? []) totalSec += Math.max(0.1, Number(scene.durationSec) || 0)
  }
  const totalFrames = Math.max(1, Math.round(totalSec * fps))
  const dir = framesDir(projectsRoot, projectId, jobId)
  await fs.mkdir(dir, { recursive: true })
  const job = {
    jobId,
    projectId,
    fps,
    width: Math.max(2, Math.round(Number(canvas.width) || 1920)),
    height: Math.max(2, Math.round(Number(canvas.height) || 1080)),
    totalFrames,
    totalSec: Math.round(totalSec * 1000) / 1000,
    outName: String(outName ?? 'final').replace(/[^\w.-]+/g, '-') || 'final',
    audio: audio && typeof audio === 'object' ? audio : {},
    received: new Set(),
    stage: 'receiving',
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    output: null,
    child: null,
    cancelled: false,
    dir,
  }
  jobs.set(jobId, job)
  return publicJob(job)
}

/** 对外可见的作业状态。 */
export function publicJob(job) {
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    fps: job.fps,
    width: job.width,
    height: job.height,
    totalFrames: job.totalFrames,
    totalSec: job.totalSec,
    received: job.received.size,
    stage: job.stage,
    error: job.error,
    output: job.output,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
  }
}

/** 取作业，不存在返回 null。 */
export function getJob(jobId) {
  return jobs.get(String(jobId ?? '')) ?? null
}

/** 接收一帧（幂等：重复上传同一序号会覆盖）。 */
export async function receiveFrame(job, index, buffer) {
  const idx = Math.trunc(Number(index))
  if (!Number.isFinite(idx) || idx < 0 || idx >= job.totalFrames) {
    throw new Error(`帧序号越界：${index}（应为 0..${job.totalFrames - 1}）`)
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('帧数据为空')
  if (buffer.length > 32 * 1024 * 1024) throw new Error('单帧超过 32MB，画布尺寸可能异常')
  const name = `${String(idx + 1).padStart(6, '0')}.jpg`
  await fs.writeFile(path.join(job.dir, name), buffer)
  job.received.add(idx)
  return job.received.size
}

/** 构造 ffmpeg 参数（导出逻辑集中在这里，便于测试）。 */
export function buildFfmpegArgs(job, { narrationPath, bgmPath, outPath }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(job.fps), '-start_number', '1', '-i', path.join(job.dir, '%06d.jpg')]
  const filters = []
  const inputs = []
  let audioMaps = []
  if (narrationPath) {
    args.push('-i', narrationPath)
    inputs.push({ kind: 'narration', inputIndex: 1 })
  }
  if (bgmPath) {
    args.push('-stream_loop', '-1', '-i', bgmPath)
    inputs.push({ kind: 'bgm', inputIndex: narrationPath ? 2 : 1 })
  }
  if (inputs.length === 2) {
    const [narration, bgm] = inputs
    const nGain = Number(job.audio?.narrationGainDb) || 0
    const bGain = Number(job.audio?.bgmGainDb) || 0
    filters.push(`[${narration.inputIndex}:a]volume=${nGain}dB[narr]`)
    filters.push(`[${bgm.inputIndex}:a]volume=${bGain}dB[bgm]`)
    filters.push('[narr][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]')
    audioMaps = ['-map', '[vout]', '-map', '[aout]']
  } else if (inputs.length === 1) {
    audioMaps = ['-map', '[vout]', '-map', `${inputs[0].inputIndex}:a:0`]
  } else {
    audioMaps = ['-map', '[vout]', '-an']
  }
  // 浏览器 canvas 出的 JPEG 是 full range，先显式转到 tv range + bt709 再编码，
  // 否则 ffmpeg 会保留 yuvj420p（pc 范围）标记，部分播放器与平台会偏色。
  filters.unshift('[0:v:0]scale=in_range=full:out_range=tv:out_color_matrix=bt709[vout]')
  args.push('-filter_complex', filters.join(';'))
  args.push(...audioMaps)
  args.push(
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-r', String(job.fps),
  )
  if (inputs.length > 0) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest')
  args.push('-movflags', '+faststart', outPath)
  return args
}

/** 编码并混音，返回输出信息。 */
export async function finishJob(job, { projectsRoot, narrationRef, bgmRef }) {
  if (job.stage !== 'receiving') throw new Error(`作业状态不允许编码（当前 ${job.stage}）`)
  if (job.received.size < job.totalFrames) {
    throw new Error(`帧不完整：已收到 ${job.received.size}/${job.totalFrames}`)
  }
  job.stage = 'encoding'
  const narrationPath = narrationRef ? assetPath(projectsRoot, job.projectId, narrationRef) : null
  const bgmPath = bgmRef ? assetPath(projectsRoot, job.projectId, bgmRef) : null
  const exportsDir = path.join(projectDir(projectsRoot, job.projectId), 'exports')
  await fs.mkdir(exportsDir, { recursive: true })
  const outPath = path.join(exportsDir, `${job.outName}.mp4`)
  const args = buildFfmpegArgs(job, { narrationPath, bgmPath, outPath })
  const result = await new Promise((resolve) => {
    let settled = false
    const stderrChunks = []
    let child
    try {
      child = spawn('ffmpeg', args, { cwd: job.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, error: String(error?.message ?? error) })
      return
    }
    job.child = child
    child.stderr?.on('data', (chunk) => {
      if (stderrChunks.length < 200) stderrChunks.push(chunk)
    })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 已退出。
      }
    }, 1000 * 60 * 45)
    timer.unref?.()
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, error: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !job.cancelled,
        code,
        error: Buffer.concat(stderrChunks).toString('utf8').slice(-4000),
      })
    })
  })
  job.child = null
  if (!result.ok) {
    job.stage = 'failed'
    job.error = job.cancelled ? '已取消' : (result.error || 'ffmpeg 编码失败')
    job.finishedAt = Date.now()
    throw new Error(job.error)
  }
  // 同时导出字幕文件（即便字幕已烧进画面，也方便二次剪辑）。
  let srtPath = null
  try {
    const projectFile = path.join(projectDir(projectsRoot, job.projectId), 'project.json')
    const parsed = JSON.parse(await fs.readFile(projectFile, 'utf8'))
    const cues = Array.isArray(parsed.subtitles) ? parsed.subtitles : []
    if (cues.length > 0) {
      srtPath = path.join(exportsDir, `${job.outName}.srt`)
      await fs.writeFile(srtPath, buildSrt(cues), 'utf8')
    }
  } catch {
    // 字幕导出失败不影响成片。
  }
  const probe = await probeMedia(outPath)
  const stat = await fs.stat(outPath)
  job.stage = 'done'
  job.finishedAt = Date.now()
  job.output = {
    mp4: outPath,
    srt: srtPath,
    bytes: stat.size,
    probe,
  }
  // 清理帧目录，释放磁盘（失败时保留以便排查）。
  try {
    await fs.rm(job.dir, { recursive: true, force: true })
  } catch {
    // 清理失败留待用户手动处理。
  }
  return job.output
}

/** 取消作业：kill 子进程并删帧目录。 */
export async function cancelJob(job) {
  job.cancelled = true
  job.stage = 'cancelled'
  job.finishedAt = Date.now()
  if (job.child) {
    try {
      job.child.kill('SIGKILL')
    } catch {
      // 已退出。
    }
  }
  try {
    await fs.rm(job.dir, { recursive: true, force: true })
  } catch {
    // 忽略。
  }
  jobs.delete(job.jobId)
  return true
}

/** 清理过期作业（超过 6 小时的失败/完成作业）。 */
export function sweepJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null && now - job.finishedAt > 6 * 3600 * 1000) jobs.delete(id)
  }
}

/** ffmpeg 版本（用于 /health 展示）。 */
export async function ffmpegVersion() {
  const result = await runCapture(['ffmpeg', '-version'], { timeoutMs: 8000 })
  if (!result.ok) return null
  const first = result.stdout.split('\n')[0] ?? ''
  return first.replace(/^ffmpeg version\s*/i, '').slice(0, 120) || 'unknown'
}
