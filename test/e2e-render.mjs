/**
 * 端到端渲染测试：真跑 ffmpeg。
 * 用小画布（320×180@10fps，1 秒）验证「建作业 → 逐帧上传 → 编码 → 探测成片」全链路，
 * 再跑一遍带 BGM 的混音路径。
 *
 * 运行：node test/e2e-render.mjs
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { installApi } from '../lib/api.js'
import { probeMedia, runCapture } from '../lib/media.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vw-e2e-'))
const routes = []
const ctx = {
  webServer: { register(route) { routes.push(route); return () => {} } },
  get(name) {
    if (name === 'workingDirectory') return { defaultDirectory: tmp }
    return null
  },
}
installApi(ctx)
const handler = routes[0].handler

function makeRes() {
  // 需要是 Writable 形状（EventEmitter + write/end），streamFile 用 pipe 写字。
  const res = new EventEmitter()
  res.statusCode = 200
  res.headers = {}
  res.chunks = []
  res.writableEnded = false
  res.finished = false
  res.writable = true
  res.setHeader = function (k, v) { this.headers[String(k).toLowerCase()] = v }
  res.getHeader = function (k) { return this.headers[String(k).toLowerCase()] }
  res.writeHead = function (s, hh) {
    this.statusCode = s
    for (const [k, v] of Object.entries(hh ?? {})) this.setHeader(k, v)
    return this
  }
  res.write = function (c) { this.chunks.push(Buffer.from(c)); return true }
  res.end = function (c) {
    if (c !== undefined && typeof c !== 'function') this.chunks.push(Buffer.from(c))
    this.writableEnded = true
    this.finished = true
    this.emit('finish')
  }
  Object.defineProperty(res, 'body', { get() { return Buffer.concat(this.chunks) } })
  Object.defineProperty(res, 'json', {
    get() {
      try { return JSON.parse(this.body.toString('utf8')) } catch { return null }
    },
  })
  return res
}

function makeReq(method, url, body) {
  const chunks = body === undefined || body === null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(String(body))]
  return { method, url, headers: {}, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c } }
}

async function call(method, urlPath, body) {
  const res = makeRes()
  await handler(makeReq(method, urlPath, body), res)
  // pipe 写文件是异步的：等 finish（或超时兜底）再读 body。
  if (!res.finished) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 800)
      res.once('finish', () => { clearTimeout(timer); resolve() })
    })
  }
  return { status: res.statusCode, body: res.json ?? res.body, res }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 用 ffmpeg 生成 n 张测试 JPEG。 */
async function makeFrames(dir, count, width, height) {
  await fs.mkdir(dir, { recursive: true })
  const result = await runCapture([
    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=#1e293b:s=${width}x${height}:d=${count}`,
    '-frames:v', String(count), '-q:v', '3',
    path.join(dir, '%06d.jpg'),
  ], { timeoutMs: 60000 })
  if (!result.ok) throw new Error(`生成测试帧失败：${result.stderr}`)
  const files = await fs.readdir(dir)
  return files.filter((f) => f.endsWith('.jpg')).sort()
}

/** 用 ffmpeg 生成测试音频。 */
async function makeAudio(absPath, seconds, freq = 440) {
  const result = await runCapture([
    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`,
    '-c:a', 'libmp3lame', '-b:a', '128k', absPath,
  ], { timeoutMs: 60000 })
  if (!result.ok) throw new Error(`生成测试音频失败：${result.stderr}`)
}

try {
  // 建一个小画布工程：320×180 @10fps，1 秒
  const created = await call('POST', '/video-workshop/api/projects', JSON.stringify({ title: 'e2e' }))
  const projectId = created.body.project.id
  const read = await call('GET', `/video-workshop/api/projects/${projectId}`)
  const project = read.body.project
  project.canvas = { width: 320, height: 180, fps: 10 }
  project.scenes = [{
    id: 's1', name: '测试', durationSec: 1, transitionOut: { type: 'none', durationSec: 0 },
    layout: 'title', text: { title: '测试', body: '' }, code: null,
    subtitle: { burnIn: true, style: {} }, overlays: [],
  }]
  project.subtitles = [{ id: 'c1', startSec: 0, endSec: 1, text: '测试字幕' }]
  project.timeline = { rows: [{ id: 's1', index: 0, startSec: 0, endSec: 1, durationSec: 1 }], totalSec: 1 }
  const savedRes = await call('PUT', `/video-workshop/api/projects/${projectId}`, JSON.stringify({ project, expectedRev: project.rev }))
  check('setup', savedRes.status === 200, `totalSec=${savedRes.body?.project?.timeline?.totalSec}`)

  // ---- 第一轮：无音频 ----
  const frames = await makeFrames(path.join(tmp, 'gen'), 10, 320, 180)
  check('frames.generated', frames.length === 10, `${frames.length} 张`)

  const started = await call('POST', '/video-workshop/api/render/start', JSON.stringify({ projectId, outName: 'silent' }))
  check('job.created', started.status === 201 && started.body.job.totalFrames === 10, `frames=${started.body?.job?.totalFrames}`)
  const jobId = started.body.job.jobId

  for (let i = 0; i < 10; i += 1) {
    const buffer = await fs.readFile(path.join(tmp, 'gen', frames[i]))
    const res = await call('POST', `/video-workshop/api/render/frame?job=${jobId}&index=${i}`, buffer)
    if (res.status !== 200) throw new Error(`上传第 ${i} 帧失败：${res.status} ${JSON.stringify(res.body)}`)
  }
  const finished = await call('POST', '/video-workshop/api/render/finish', JSON.stringify({ job: jobId }))
  check('encode.silent', finished.status === 200, finished.status === 200 ? `${(finished.body.output.bytes / 1024).toFixed(0)} KB` : JSON.stringify(finished.body))
  if (finished.status === 200) {
    const probe = finished.body.output.probe
    check('probe.silent', probe?.ok === true && probe.width === 320 && probe.height === 180 && probe.hasAudio === false,
      `${probe?.width}x${probe?.height} ${probe?.videoCodec} audio=${probe?.hasAudio}`)
    check('srt.written', Boolean(finished.body.output.srt), String(finished.body.output.srt ?? ''))
    const srtText = finished.body.output.srt ? await fs.readFile(finished.body.output.srt, 'utf8') : ''
    check('srt.content', srtText.includes('测试字幕') && srtText.includes('-->'))
    // 帧目录应已清理
    const leftovers = await fs.readdir(path.join(tmp, 'video-projects', projectId, '.frames')).catch(() => [])
    check('frames.cleaned', leftovers.length === 0, JSON.stringify(leftovers))
  }

  // ---- 第二轮：旁白 + BGM 混音 ----
  await makeAudio(path.join(tmp, 'nar.mp3'), 1.2, 440)
  await makeAudio(path.join(tmp, 'bgm.mp3'), 0.8, 220)
  const upNar = await call('POST', `/video-workshop/api/projects/${projectId}/assets?name=nar.mp3`, await fs.readFile(path.join(tmp, 'nar.mp3')))
  const upBgm = await call('POST', `/video-workshop/api/projects/${projectId}/assets?name=bgm.mp3`, await fs.readFile(path.join(tmp, 'bgm.mp3')))
  check('audio.uploaded', upNar.status === 201 && upBgm.status === 201)

  const started2 = await call('POST', '/video-workshop/api/render/start', JSON.stringify({ projectId, outName: 'mixed', audio: { narrationGainDb: 0, bgmGainDb: -18 } }))
  const jobId2 = started2.body.job.jobId
  for (let i = 0; i < 10; i += 1) {
    const buffer = await fs.readFile(path.join(tmp, 'gen', frames[i]))
    await call('POST', `/video-workshop/api/render/frame?job=${jobId2}&index=${i}`, buffer)
  }
  const finished2 = await call('POST', '/video-workshop/api/render/finish', JSON.stringify({ job: jobId2, narrationRef: 'nar.mp3', bgmRef: 'bgm.mp3' }))
  check('encode.mixed', finished2.status === 200, finished2.status === 200 ? `${(finished2.body.output.bytes / 1024).toFixed(0)} KB` : JSON.stringify(finished2.body))
  if (finished2.status === 200) {
    const probe = finished2.body.output.probe
    check('probe.mixed', probe?.ok === true && probe.hasAudio === true && probe.audioCodec === 'aac', `audio=${probe?.audioCodec} dur=${probe?.durationSec}`)
    const duration = Number(probe?.durationSec) || 0
    check('duration.match', Math.abs(duration - 1) < 0.25, `${duration}s（目标 1s）`)
  }

  // ---- 下载成片（Range 支持）----
  const dl = await call('GET', `/video-workshop/api/exports/${projectId}/silent.mp4`)
  check('export.download', dl.status === 200 && dl.res.body.length > 1000, `${dl.res.body.length} bytes ${dl.res.body.toString('utf8').slice(0, 120)}`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  for (const r of failed) console.log(` - ${r.name} ${r.detail}`)
  process.exit(1)
}
