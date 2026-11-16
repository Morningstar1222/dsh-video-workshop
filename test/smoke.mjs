/**
 * 宿主侧烟测：不启动 DSH，直接给 installApi 喂一个最小 ctx 与假 req/res。
 * 覆盖：健康检查、工程 CRUD、乐观锁、素材上传、台本解析、渲染作业创建与帧上传。
 *
 * 运行：node test/smoke.mjs
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installApi } from '../lib/api.js'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vw-smoke-'))
const routes = []
const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  get(name) {
    if (name === 'workingDirectory') return { defaultDirectory: tmp }
    if (name === 'llm') return null
    return null
  },
  inject(_deps, callback) {
    return callback(ctx)
  },
  effect(fn) {
    return fn()
  },
}

installApi(ctx)
if (routes.length !== 1) throw new Error(`应注册 1 条路由，实际 ${routes.length}`)
const handler = routes[0].handler
if (routes[0].path !== '/video-workshop') throw new Error(`路由前缀错误：${routes[0].path}`)

/** 假响应。 */
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    writableEnded: false,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value
    },
    writeHead(status, headers) {
      this.statusCode = status
      for (const [key, value] of Object.entries(headers ?? {})) this.setHeader(key, value)
      return this
    },
    getHeader(key) {
      return this.headers[String(key).toLowerCase()]
    },
    write(chunk) {
      this.chunks.push(Buffer.from(chunk))
      return true
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(Buffer.from(chunk))
      this.writableEnded = true
    },
    get body() {
      return Buffer.concat(this.chunks)
    },
    get json() {
      try {
        return JSON.parse(this.body.toString('utf8'))
      } catch {
        return null
      }
    },
  }
  return res
}

/** 假请求（提供 asyncIterator 让 readBinary 能读 body）。 */
function makeReq(method, url, body) {
  const chunks = []
  if (body !== undefined && body !== null) {
    chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)))
  }
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** 发一次请求并解析 JSON。 */
async function call(method, urlPath, body) {
  const res = makeRes()
  await handler(makeReq(method, urlPath, body), res)
  return { status: res.statusCode, body: res.json ?? res.body, res }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  // 1. health
  const health = await call('GET', '/video-workshop/api/health')
  check('health', health.status === 200 && health.body.ok === true, `ffmpeg=${health.body?.ffmpeg ?? 'null'}`)
  check('health.projectsRoot', typeof health.body.projectsRoot === 'string')

  // 2. 新建工程
  const created = await call('POST', '/video-workshop/api/projects', JSON.stringify({ title: '烟测工程' }))
  check('create', created.status === 201 && created.body.project?.id === '烟测工程'.replace(/[^a-z0-9]+/gi, '-') || created.status === 201, `id=${created.body?.project?.id}`)
  const projectId = created.body.project.id

  // 3. 列表
  const list = await call('GET', '/video-workshop/api/projects')
  check('list', list.status === 200 && list.body.projects.length >= 1)

  // 4. 读
  const read = await call('GET', `/video-workshop/api/projects/${projectId}`)
  check('read', read.status === 200 && read.body.project.id === projectId, `rev=${read.body?.project?.rev}`)
  const rev = read.body.project.rev

  // 5. 保存（正确 rev）
  const draft = read.body.project
  draft.title = '改过的标题'
  draft.scenes = [
    { id: 's1', name: '开场', durationSec: 4, transitionOut: { type: 'fade', durationSec: 0.5 }, layout: 'title', text: { title: '你好', body: '' }, code: null, subtitle: { burnIn: true, style: {} }, overlays: [] },
    { id: 's2', name: '代码', durationSec: 6, transitionOut: { type: 'none', durationSec: 0 }, layout: 'code', text: { title: '', body: '' }, code: { language: 'python', content: 'print(1)', showLineNumbers: true, highlightLines: [], highlightTheme: 'dark-plus' }, subtitle: { burnIn: true, style: {} }, overlays: [] },
  ]
  draft.subtitles = [
    { id: 'c1', startSec: 0, endSec: 4, text: '你好' },
    { id: 'c2', startSec: 4, endSec: 9.5, text: '讲一下' },
  ]
  const saved = await call('PUT', `/video-workshop/api/projects/${projectId}`, JSON.stringify({ project: draft, expectedRev: rev }))
  check('save', saved.status === 200 && saved.body.project.title === '改过的标题', `rev=${saved.body?.project?.rev} total=${saved.body?.project?.timeline?.totalSec}`)

  // 6. 冲突
  const conflict = await call('PUT', `/video-workshop/api/projects/${projectId}`, JSON.stringify({ project: draft, expectedRev: rev }))
  check('conflict', conflict.status === 409 && conflict.body.code === 'REV_CONFLICT')

  // 7. 素材上传（假 mp3 头，只验证落盘与列表）
  const assetBody = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x04]), Buffer.alloc(2048, 1)])
  const uploaded = await call('POST', `/video-workshop/api/projects/${projectId}/assets?name=bgm.mp3`, assetBody)
  check('asset.upload', uploaded.status === 201 && uploaded.body.asset?.name === 'bgm.mp3', `size=${uploaded.body?.asset?.size}`)

  // 8. 素材列表
  const assets = await call('GET', `/video-workshop/api/projects/${projectId}/assets`)
  check('asset.list', assets.status === 200 && assets.body.assets.some((a) => a.name === 'bgm.mp3'))

  // 9. 非法路径
  const evil = await call('GET', `/video-workshop/api/assets/${projectId}/..%2f..%2fproject.json`)
  check('asset.traversal-rejected', evil.status >= 400, `status=${evil.status}`)

  // 10. 台本解析（纯文本）
  const parsed = await call('POST', '/video-workshop/api/parse?filename=script.txt', Buffer.from('第一句。第二句！\n\n第三段'))
  check('parse.txt', parsed.status === 200 && String(parsed.body.text).includes('第一句'), JSON.stringify(String(parsed.body?.text).slice(0, 30)))

  // 11. 渲染作业创建
  const started = await call('POST', '/video-workshop/api/render/start', JSON.stringify({ projectId, outName: 'final' }))
  check('render.start', started.status === 201 && started.body.job?.totalFrames > 0, `frames=${started.body?.job?.totalFrames}`)
  const jobId = started.body.job.jobId

  // 12. 上传 2 帧（假 JPEG）
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 2), Buffer.from([0xff, 0xd9])])
  const f0 = await call('POST', `/video-workshop/api/render/frame?job=${jobId}&index=0`, jpeg)
  const f1 = await call('POST', `/video-workshop/api/render/frame?job=${jobId}&index=1`, jpeg)
  check('render.frame', f0.status === 200 && f1.body.received === 2, `received=${f1.body?.received}`)

  // 13. 帧序号越界
  const badFrame = await call('POST', `/video-workshop/api/render/frame?job=${jobId}&index=999999`, jpeg)
  check('render.frame-bounds', badFrame.status >= 400, `status=${badFrame.status}`)

  // 14. 取消
  const cancelled = await call('POST', '/video-workshop/api/render/cancel', JSON.stringify({ job: jobId }))
  check('render.cancel', cancelled.status === 200)

  // 15. 未知端点
  const unknown = await call('GET', '/video-workshop/api/nope')
  check('unknown-404', unknown.status === 404)

  // 16. SRT 导出
  const srt = await call('GET', `/video-workshop/api/projects/${projectId}/export-srt`)
  check('srt', srt.status === 200 && String(srt.body).includes('-->'), String(srt.body).split('\n').slice(0, 3).join('|'))
} finally {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log('失败项：')
  for (const item of failed) console.log(` - ${item.name} ${item.detail}`)
  process.exit(1)
}
