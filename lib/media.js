/**
 * 媒体能力：HTTP Range 流式播放、ffprobe 探测、子进程工具。
 *
 * 子进程走 Node 原生 child_process（与 dsh-memory-evolve 一致的做法）：
 * 宿主进程直接 spawn ffmpeg/ffprobe/python，超时与取消由这里接管，
 * 不依赖 subprocess 服务的具体形态。
 */

import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 按扩展名给 Content-Type。 */
export function contentTypeFor(file) {
  const ext = path.extname(String(file)).toLowerCase()
  const map = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.srt': 'text/plain; charset=utf-8',
    '.ass': 'text/plain; charset=utf-8',
    '.vtt': 'text/vtt; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** 流式发送文件，支持 Range（视频预览拖动进度条必需）。 */
export async function streamFile(req, res, absPath, { cache = 'no-store' } = {}) {
  let stat
  try {
    stat = await fs.stat(absPath)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not a file')
    return
  }
  const total = stat.size
  const type = contentTypeFor(absPath)
  const range = req.headers.range
  if (typeof range === 'string' && range !== '') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (match) {
      const startRaw = match[1]
      const endRaw = match[2]
      let start
      let end
      if (startRaw === '' && endRaw !== '') {
        // 后缀范围：最后 N 字节
        const suffix = Number(endRaw)
        start = Math.max(0, total - suffix)
        end = total - 1
      } else {
        start = Number(startRaw)
        end = endRaw === '' ? total - 1 : Number(endRaw)
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
        const safeEnd = Math.min(end, total - 1)
        const length = safeEnd - start + 1
        res.writeHead(206, {
          'content-type': type,
          'content-length': String(length),
          'content-range': `bytes ${start}-${safeEnd}/${total}`,
          'accept-ranges': 'bytes',
          'cache-control': cache,
        })
        const stream = createReadStream(absPath, { start, end: safeEnd })
        stream.pipe(res)
        stream.on('error', () => res.destroy())
        return
      }
      res.writeHead(416, { 'content-range': `bytes */${total}` })
      res.end()
      return
    }
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(total),
    'accept-ranges': 'bytes',
    'cache-control': cache,
  })
  const stream = createReadStream(absPath)
  stream.pipe(res)
  stream.on('error', () => res.destroy())
}

/**
 * 运行一个子进程并收集输出。
 * @param {string[]} argv 完整命令（argv[0] 为可执行文件名）
 * @param {{cwd?: string, timeoutMs?: number, input?: Buffer|string, maxBytes?: number}} options
 * @returns {Promise<{ok: boolean, code: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export function runCapture(argv, options = {}) {
  const { cwd = process.cwd(), timeoutMs = 120000, input = null, maxBytes = 8 * 1024 * 1024 } = options
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const chunks = []
    const errChunks = []
    let total = 0
    let child
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        windowsHide: true,
        stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ ok: false, code: null, stdout: '', stderr: String(error?.message ?? error), timedOut: false })
      return
    }
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        timedOut,
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // 进程可能已退出。
      }
      finish(null)
    }, timeoutMs)
    timer.unref?.()
    if (input != null && child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
    child.stdout?.on('data', (chunk) => {
      total += chunk.length
      if (total <= maxBytes) chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      if (errChunks.reduce((sum, part) => sum + part.length, 0) < 64 * 1024) errChunks.push(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout: '', stderr: String(error?.message ?? error), timedOut })
    })
    child.on('close', (code) => finish(code))
  })
}

/** 探测可执行文件是否可用（跑一次 --version 之类）。 */
export async function hasExecutable(name, args = ['-version']) {
  const result = await runCapture([name, ...args], { timeoutMs: 8000 })
  return { ok: result.ok, code: result.code, stderr: result.stderr.slice(0, 400) }
}

/** ffprobe 探测媒体元数据。 */
export async function probeMedia(absPath) {
  const result = await runCapture(
    ['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absPath],
    { timeoutMs: 30000 },
  )
  if (!result.ok) {
    return { ok: false, error: (result.stderr || 'ffprobe 执行失败').slice(0, 800) }
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { ok: false, error: 'ffprobe 输出不是合法 JSON' }
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const durationRaw = Number(parsed.format?.duration ?? video?.duration ?? 0)
  return {
    ok: true,
    durationSec: Number.isFinite(durationRaw) ? Math.round(durationRaw * 1000) / 1000 : 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: video?.r_frame_rate ? parseFraction(video.r_frame_rate) : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    bitrate: Number(parsed.format?.bit_rate ?? 0) || null,
  }
}

/** "30000/1001" → 29.97。 */
export function parseFraction(text) {
  const match = /^(\d+)\/(\d+)$/.exec(String(text))
  if (!match) return null
  const den = Number(match[2])
  if (den === 0) return null
  return Math.round((Number(match[1]) / den) * 1000) / 1000
}

/** 递归列出目录下的文件（相对路径）。 */
export async function listFilesRecursive(dir, base = dir, acc = []) {
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) await listFilesRecursive(abs, base, acc)
    else if (entry.isFile()) acc.push(path.relative(base, abs))
  }
  return acc
}
