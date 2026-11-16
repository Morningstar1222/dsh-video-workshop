/**
 * HTTP API：客户端（canvas UI）与宿主之间唯一的通道。
 *
 * 所有端点挂在 /video-workshop/api 下，全部同源 fetch，无需 CORS。
 * 请求里若带 root 参数，就按它定位工作区；否则用配置/部署默认值。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  API_PREFIX,
  HttpError,
  assertAssetName,
  assertProjectId,
  isInside,
  nowIso,
  readBinary,
  readJson,
  sendJson,
  sendText,
  slugify,
} from './util.js'
import {
  assetPath,
  assetsDir,
  createProject,
  listAssets,
  listProjects,
  projectDir,
  readProject,
  removeAsset,
  trashProject,
  writeAsset,
  writeProject,
} from './store.js'
import { parseScript, PDF_PYTHON_SCRIPT } from './script-parse.js'
import { contentTypeFor, streamFile, runCapture, probeMedia } from './media.js'
import {
  buildSrt,
  cancelJob,
  createJob,
  ffmpegVersion,
  finishJob,
  getJob,
  publicJob,
  receiveFrame,
  sweepJobs,
} from './render.js'
import { draftFromScript, listModels, rewriteText } from './ai.js'

const MAX_FRAME_BYTES = 32 * 1024 * 1024
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** 解析工作区根目录。 */
function resolveRoot(ctx, requested) {
  if (typeof requested === 'string' && requested.trim() !== '') {
    const candidate = path.resolve(requested.trim())
    if (!path.isAbsolute(candidate)) throw new HttpError(400, 'root 必须是绝对路径')
    return candidate
  }
  try {
    const fallback = ctx.get('workingDirectory')?.defaultDirectory
    if (typeof fallback === 'string' && fallback !== '') return path.resolve(fallback)
  } catch {
    // 没有该服务时退回进程目录。
  }
  return process.cwd()
}

/** 项目根（<root>/video-projects）。 */
async function projectsRootOf(ctx, url) {
  const root = resolveRoot(ctx, url.searchParams.get('root'))
  const projectsRoot = path.join(root, 'video-projects')
  await fs.mkdir(projectsRoot, { recursive: true })
  return projectsRoot
}

/** 找可用 pymupdf 的 python。 */
let pdfPythonCache = null
async function findPdfPython() {
  if (pdfPythonCache) return pdfPythonCache
  const candidates = [
    process.env.VIDEO_WORKSHOP_PYTHON,
    'python',
    'py',
    'python3',
  ].filter((item) => typeof item === 'string' && item !== '')
  for (const exe of candidates) {
    try {
      const result = await runCapture([exe, '-c', 'import pymupdf'], { timeoutMs: 15000 })
      if (result.ok) {
        pdfPythonCache = exe
        return exe
      }
    } catch {
      // 试下一个。
    }
  }
  throw new HttpError(400, '没有可用的 PDF 解析环境（需要 python + pymupdf）。可先用 Word/文本另存为 .docx/.txt')
}

/** 从 URL 末尾取文件名。 */
function safeFilename(raw, fallback = 'upload') {
  try {
    return assertAssetName(path.basename(decodeURIComponent(String(raw ?? ''))))
  } catch {
    return fallback
  }
}

/** 解码路径段（容忍畸形编码，不抛出）。 */
function decodeSegment(raw) {
  try {
    return decodeURIComponent(String(raw ?? ''))
  } catch {
    return String(raw ?? '')
  }
}

/** 统一错误响应。 */
function fail(res, error) {
  if (res.writableEnded) return
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message, code: error.code ?? null })
    return
  }
  if (error?.code === 'REV_CONFLICT') {
    sendJson(res, 409, { error: '项目已被修改，请刷新后重试', code: 'REV_CONFLICT', currentRev: error.currentRev })
    return
  }
  if (error?.code === 'NOT_FOUND') {
    sendJson(res, 404, { error: error.message, code: 'NOT_FOUND' })
    return
  }
  sendJson(res, 500, { error: String(error?.message ?? error), code: error?.code ?? null })
}

/** 安装 HTTP 路由，返回 disposer。 */
export function installApi(ctx) {
  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '')
    if (!pathname.startsWith(API_PREFIX)) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const segments = pathname.slice(API_PREFIX.length).split('/').filter((part) => part !== '')
    const method = (req.method ?? 'GET').toUpperCase()
    try {
      await dispatch(ctx, req, res, url, segments, method)
    } catch (error) {
      fail(res, error)
    }
  }
  return ctx.webServer.register({ kind: 'prefix', path: '/video-workshop', handler })
}

/* ------------------------------------------------------------------ 路由 */

async function dispatch(ctx, req, res, url, seg, method) {
  const [head = '', a = '', b = '', c = ''] = seg

  // GET /health
  if (head === 'health' && method === 'GET') {
    const projectsRoot = await projectsRootOf(ctx, url)
    const encoder = await ffmpegVersion()
    sendJson(res, 200, {
      ok: true,
      version: 1,
      ffmpeg: encoder,
      ffmpegReady: encoder !== null,
      projectsRoot,
      now: nowIso(),
    })
    return
  }

  // GET /models
  if (head === 'models' && method === 'GET') {
    const llm = ctx.get('llm')
    const models = await listModels(llm)
    sendJson(res, 200, { ...models, llmReady: Boolean(llm) })
    return
  }

  // 诊断：provider 与模型目录的真实状态（只读）。
  if (head === 'diag' && method === 'GET') {
    const llm = ctx.get('llm')
    const probes = []
    let registered = []
    let declared = []
    try {
      registered = typeof llm?.listProviders === 'function' ? await llm.listProviders() : []
    } catch (error) {
      probes.push({ step: 'listProviders', error: String(error?.message ?? error) })
    }
    try {
      declared = typeof llm?.listConfigurableProviders === 'function' ? await llm.listConfigurableProviders() : []
    } catch (error) {
      probes.push({ step: 'listConfigurableProviders', error: String(error?.message ?? error) })
    }
    const ids = new Set()
    for (const item of [...registered, ...declared]) {
      const id = String(item?.provider ?? item?.id ?? '')
      if (id !== '') ids.add(id)
    }
    for (const id of ids) {
      try {
        const listed = await llm.listModels(id)
        probes.push({ provider: id, ok: true, count: Array.isArray(listed) ? listed.length : 0, sample: (Array.isArray(listed) ? listed : []).slice(0, 3) })
      } catch (error) {
        probes.push({ provider: id, ok: false, error: String(error?.message ?? error), code: error?.code })
      }
    }
    sendJson(res, 200, { llmReady: Boolean(llm), registered, declared: declared.map((item) => ({ provider: item?.provider, displayName: item?.displayName, settingsNs: item?.settingsNs, declared: item?.declared })), probes })
    return
  }

  // /projects
  if (head === 'projects') {
    const projectsRoot = await projectsRootOf(ctx, url)
    if (a === '' && method === 'GET') {
      const projects = await listProjects(projectsRoot)
      sendJson(res, 200, { projects, projectsRoot })
      return
    }
    if (a === '' && method === 'POST') {
      const body = await readJson(req)
      const title = String(body?.title ?? '').trim() || '未命名视频'
      const id = slugify(body?.id ?? title)
      const project = await createProject(projectsRoot, { id, title })
      sendJson(res, 201, { project })
      return
    }
    const projectId = assertProjectId(decodeSegment(a))
    // POST /projects/:id/duplicate
    if (b === 'duplicate' && method === 'POST') {
      const source = await readProject(projectsRoot, projectId)
      const copy = await createProject(projectsRoot, { id: `${projectId}-copy`, title: `${source.title} 副本` })
      const saved = await writeProject(projectsRoot, copy.id, { ...source, id: copy.id, title: copy.title, rev: copy.rev })
      sendJson(res, 200, { project: saved })
      return
    }
    if (b === '' && method === 'GET') {
      const project = await readProject(projectsRoot, projectId)
      sendJson(res, 200, { project })
      return
    }
    if (b === '' && method === 'PUT') {
      const body = await readJson(req)
      const project = await writeProject(projectsRoot, projectId, body?.project ?? body, {
        expectedRev: body?.expectedRev,
      })
      sendJson(res, 200, { project })
      return
    }
    if (b === '' && method === 'DELETE') {
      await trashProject(projectsRoot, projectId)
      sendJson(res, 200, { ok: true })
      return
    }
    // /projects/:id/assets
    if (b === 'assets' && c === '' && method === 'GET') {
      sendJson(res, 200, { assets: await listAssets(projectsRoot, projectId) })
      return
    }
    if (b === 'assets' && c === '' && method === 'POST') {
      const name = safeFilename(url.searchParams.get('name'))
      const buffer = await readBinary(req, MAX_UPLOAD_BYTES)
      const saved = await writeAsset(projectsRoot, projectId, name, buffer)
      const probe = /\.(mp4|mov|webm|mkv|mp3|wav|m4a)$/i.test(name) ? await probeMedia(assetPath(projectsRoot, projectId, name)) : null
      sendJson(res, 201, { asset: saved, probe })
      return
    }
    if (b === 'assets' && c !== '' && method === 'DELETE') {
      await removeAsset(projectsRoot, projectId, assertAssetName(decodeSegment(c)))
      sendJson(res, 200, { ok: true })
      return
    }
    // /projects/:id/export-srt
    if (b === 'export-srt' && method === 'GET') {
      const project = await readProject(projectsRoot, projectId)
      const srt = buildSrt(project.subtitles ?? [])
      res.statusCode = 200
      res.setHeader('content-type', 'application/x-subrip; charset=utf-8')
      res.setHeader('content-disposition', `attachment; filename="${projectId}.srt"`)
      res.end(srt)
      return
    }
    throw new HttpError(404, `未知的项目端点：/${seg.join('/')}`)
  }

  // /assets/:id/:name —— 流式（支持 Range，播放器可拖动）
  if (head === 'assets' && method === 'GET') {
    const projectsRoot = await projectsRootOf(ctx, url)
    const projectId = assertProjectId(decodeSegment(a))
    const name = assertAssetName(decodeSegment(b))
    const abs = assetPath(projectsRoot, projectId, name)
    await streamFile(req, res, abs, { cache: 'private, max-age=60' })
    return
  }

  // /exports/:id/:name —— 成片下载
  if (head === 'exports' && method === 'GET') {
    const projectsRoot = await projectsRootOf(ctx, url)
    const projectId = assertProjectId(decodeSegment(a))
    const name = assertAssetName(decodeSegment(b))
    const abs = path.join(projectDir(projectsRoot, projectId), 'exports', name)
    if (!isInside(path.join(projectDir(projectsRoot, projectId), 'exports'), abs)) throw new HttpError(400, '非法路径')
    await streamFile(req, res, abs, { cache: 'no-store' })
    return
  }

  // POST /parse?filename=xxx —— 台本解析（docx/xlsx/md/txt/csv）
  if (head === 'parse' && method === 'POST') {
    const filename = safeFilename(url.searchParams.get('filename'), 'script.txt')
    const buffer = await readBinary(req, MAX_UPLOAD_BYTES)
    const parsed = await parseScript(buffer, filename)
    sendJson(res, 200, { ...parsed, filename })
    return
  }

  // POST /parse-pdf?filename=xxx —— PDF 走 python pymupdf
  if (head === 'parse-pdf' && method === 'POST') {
    const filename = safeFilename(url.searchParams.get('filename'), 'script.pdf')
    const buffer = await readBinary(req, MAX_UPLOAD_BYTES)
    if (buffer.length === 0) throw new HttpError(400, 'PDF 内容为空')
    const python = await findPdfPython()
    const tmpDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', 'video-workshop')
    await fs.mkdir(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
    await fs.writeFile(tmpFile, buffer)
    try {
      const result = await runCapture([python, '-c', PDF_PYTHON_SCRIPT, tmpFile], { timeoutMs: 120000 })
      if (!result.ok) {
        throw new HttpError(400, `PDF 解析失败：${(result.stderr || result.stdout || '').slice(-500)}`)
      }
      let data = null
      try {
        data = JSON.parse(result.stdout.trim())
      } catch {
        throw new HttpError(400, 'PDF 解析输出格式异常')
      }
      if (!data?.ok) throw new HttpError(400, data?.error ?? 'PDF 解析失败')
      sendJson(res, 200, { text: String(data.text ?? ''), pages: Number(data.pages) || 0, filename, format: 'pdf' })
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => {})
    }
    return
  }

  // POST /draft —— 台本 → 分镜初稿
  if (head === 'draft' && method === 'POST') {
    const body = await readJson(req)
    const llm = ctx.get('llm')
    const result = await draftFromScript(llm, {
      provider: body?.provider,
      model: body?.model,
      scriptText: body?.scriptText,
      title: body?.title,
      maxScenes: Number(body?.maxScenes) || 16,
      targetSeconds: Number(body?.targetSeconds) || 180,
      temperature: Number(body?.temperature) || 0.5,
    })
    sendJson(res, 200, result)
    return
  }

  // POST /rewrite —— 单条文本改写/翻译
  if (head === 'rewrite' && method === 'POST') {
    const body = await readJson(req)
    const llm = ctx.get('llm')
    const result = await rewriteText(llm, {
      provider: body?.provider,
      model: body?.model,
      text: body?.text,
      mode: body?.mode,
      targetLang: body?.targetLang,
    })
    sendJson(res, 200, result)
    return
  }

  // /render/*
  if (head === 'render') {
    if (a === 'start' && method === 'POST') {
      const projectsRoot = await projectsRootOf(ctx, url)
      const body = await readJson(req)
      const projectId = assertProjectId(body?.projectId)
      const project = body?.project ?? (await readProject(projectsRoot, projectId))
      sweepJobs()
      const job = await createJob({
        projectsRoot,
        projectId,
        project,
        audio: body?.audio,
        outName: body?.outName ? safeFilename(String(body.outName).replace(/\.mp4$/i, '') + '.mp4', 'final.mp4').replace(/\.mp4$/i, '') : 'final',
      })
      sendJson(res, 201, { job })
      return
    }
    if (a === 'frame' && method === 'POST') {
      const job = getJob(url.searchParams.get('job'))
      if (!job) throw new HttpError(404, '渲染作业不存在或已结束')
      const buffer = await readBinary(req, MAX_FRAME_BYTES)
      let received = 0
      try {
        received = await receiveFrame(job, url.searchParams.get('index'), buffer)
      } catch (error) {
        throw new HttpError(400, String(error?.message ?? error))
      }
      sendJson(res, 200, { received, totalFrames: job.totalFrames })
      return
    }
    if (a === 'finish' && method === 'POST') {
      const projectsRoot = await projectsRootOf(ctx, url)
      const body = await readJson(req)
      const job = getJob(body?.job)
      if (!job) throw new HttpError(404, '渲染作业不存在或已结束')
      if (job.stage !== 'receiving') throw new HttpError(409, `作业状态不允许编码（当前 ${job.stage}）`)
      const output = await finishJob(job, {
        projectsRoot,
        narrationRef: body?.narrationRef,
        bgmRef: body?.bgmRef,
      })
      sendJson(res, 200, { job: publicJob(job), output })
      return
    }
    if (a === 'cancel' && method === 'POST') {
      const body = await readJson(req)
      const job = getJob(body?.job)
      if (!job) throw new HttpError(404, '渲染作业不存在')
      await cancelJob(job)
      sendJson(res, 200, { ok: true })
      return
    }
    if (a !== '' && method === 'GET') {
      const job = getJob(a)
      if (!job) throw new HttpError(404, '渲染作业不存在或已结束')
      sendJson(res, 200, { job: publicJob(job) })
      return
    }
    throw new HttpError(404, `未知的渲染端点：/${seg.join('/')}`)
  }

  throw new HttpError(404, `未知端点：${API_PREFIX}/${seg.join('/')}`)
}
