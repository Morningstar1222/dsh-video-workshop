/**
 * 共享小工具：HTTP 响应、请求体读取、路径安全、ID 规范化、时间轴计算。
 *
 * 这些函数在 Host 侧被 api.js / store.js / render.js 复用；不要在客户端引用。
 */

import path from 'node:path'

/** 前缀路由下所有端点的基址。 */
export const API_PREFIX = '/video-workshop/api'
/** 用户数据目录名（相对项目根）。 */
export const PROJECTS_DIRNAME = 'video-projects'
/** 项目 id 白名单：小写字母数字与连字符。 */
export const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}\-_]{0,63}$/u
/** Windows 保留设备名。 */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 写 JSON 响应。 */
export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** 写纯文本响应。 */
export function sendText(res, status, text) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** 读取 JSON 请求体，超过 maxBytes 抛错。 */
export async function readJson(req, maxBytes = 4 * 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new HttpError(413, '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

/** 读取原始二进制请求体。 */
export async function readBinary(req, maxBytes = 2 * 1024 * 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new HttpError(413, '上传文件超过上限')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** 带 HTTP 状态码的错误。 */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** 断言项目 id 合法。 */
export function assertProjectId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new HttpError(400, '项目 ID 非法（只允许小写字母、数字与连字符）', 'BAD_PROJECT_ID')
  }
  return id
}

/** 断言资源文件名合法（无路径分隔、无上跳、非保留名）。 */
export function assertAssetName(name) {
  const base = typeof name === 'string' ? name : ''
  if (base === '' || base.length > 200) throw new HttpError(400, '文件名非法', 'BAD_ASSET_NAME')
  if (base.includes('/') || base.includes('\\') || base.includes('\0')) {
    throw new HttpError(400, '文件名不能包含路径分隔符', 'BAD_ASSET_NAME')
  }
  if (base === '.' || base === '..' || WIN_RESERVED.test(base)) {
    throw new HttpError(400, '文件名非法', 'BAD_ASSET_NAME')
  }
  if (/[<>:"|?*]/.test(base)) throw new HttpError(400, '文件名包含非法字符', 'BAD_ASSET_NAME')
  return base
}

/** 把名字转成合法 slug（用于由标题生成项目 id）。允许中文，便于一眼认出目录。 */
export function slugify(input, fallback = 'project') {
  const base = String(input ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (base.length >= 1) return base
  return `${fallback}-${Date.now().toString(36)}`
}

/** 判断 child 是否在 parent 之内（大小写不敏感，兼容 Windows）。 */
export function isInside(parent, child) {
  const p = path.resolve(parent).toLowerCase()
  const c = path.resolve(child).toLowerCase()
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

/** 四舍五入到毫秒，避免浮点累加误差。 */
export function roundMs(value) {
  return Math.round(Number(value) * 1000) / 1000
}

/** 根据场景数组计算全局时间轴（含转场重叠）。 */
export function computeTimeline(scenes) {
  const list = Array.isArray(scenes) ? scenes : []
  let cursor = 0
  const rows = []
  for (let i = 0; i < list.length; i += 1) {
    const scene = list[i] ?? {}
    const duration = Math.max(0.1, Number(scene.durationSec) || 3)
    const start = cursor
    const end = start + duration
    rows.push({ id: scene.id, index: i, startSec: roundMs(start), endSec: roundMs(end), durationSec: roundMs(duration) })
    const transition = Number(scene.transitionOut?.durationSec) || 0
    // 转场与下一场重叠，最长不超过本场的一半，避免时间轴倒退。
    cursor = end - Math.min(transition, duration / 2)
  }
  const totalSec = rows.length === 0 ? 0 : rows[rows.length - 1].endSec
  return { rows, totalSec: roundMs(totalSec) }
}

/** 在时间轴上定位某时刻所属的场景索引。 */
export function sceneIndexAt(timeline, timeSec) {
  const rows = timeline.rows
  if (rows.length === 0) return -1
  const t = Number(timeSec) || 0
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (t >= rows[i].startSec) return i
  }
  return 0
}

/** 安全的 JSON 序列化（缩进两格，末尾换行）。 */
export function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** 现在的时间戳（ISO）。 */
export function nowIso() {
  return new Date().toISOString()
}
