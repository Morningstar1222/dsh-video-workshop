/**
 * 项目存储层：工程目录解析、project.json 读写（带 rev 乐观锁与 .bak）、
 * 结构归一化（任何写坏的 JSON 都能打开而不是白屏）。
 *
 * 目录约定（已与用户确认）：
 *   <根目录>/video-projects/<projectId>/
 *     project.json  project.json.bak  assets/  thumbs/  exports/  .frames/
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  ID_RE,
  PROJECTS_DIRNAME,
  assertProjectId,
  assertAssetName,
  computeTimeline,
  isInside,
  nowIso,
  slugify,
  stringifyJson,
} from './util.js'

export const SCHEMA_VERSION = 1

/**
 * 工程默认外观。
 *
 * 外观统一放在 `look` 容器下——客户端的 drawFrame()、StyleInspector、SubtitleInspector
 * 全部读写 `project.look.*`，这里必须是同一份 schema，否则用户在「外观」里改的东西
 * 保存后会被归一化丢掉，界面上看起来就是「改了没反应」。
 *
 * 字体存的是字体 id（yahei/consolas…），由客户端 fontStack() 映射到 CSS 栈。
 */
export function defaultLook() {
  return {
    canvas: { width: 1920, height: 1080, fps: 30 },
    look: {
      background: { type: 'gradient', color: '#0f172a', from: '#0f172a', to: '#1e293b', angle: 135 },
      theme: {
        fontFamily: 'yahei',
        fontSize: 64,
        lineHeight: 1.35,
        align: 'center',
        color: '#f8fafc',
        muted: 'rgba(248,250,252,.72)',
        accent: '#38bdf8',
      },
      code: {
        fontFamily: 'consolas',
        fontSize: 30,
        lineHeight: 1.55,
        bg: '#111827',
        border: 'rgba(148,163,184,.25)',
        highlightBg: 'rgba(56,189,248,.16)',
        gutterColor: 'rgba(148,163,184,.55)',
      },
      subtitle: {
        enabled: true,
        fontFamily: 'yahei',
        fontSize: 44,
        color: '#ffffff',
        background: 'rgba(0,0,0,.55)',
        bottom: 0.06,
        maxWidth: 0.78,
      },
    },
    audio: { narration: null, bgm: null, bgmGainDb: -18, narrationGainDb: 0 },
  }
}

/** 新建工程骨架。 */
export function newProject(id, title) {
  const look = defaultLook()
  return normalizeProject({
    schemaVersion: SCHEMA_VERSION,
    rev: 1,
    id,
    title: title || '未命名视频',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...look,
    scenes: [
      {
        id: 's1',
        name: '开场',
        durationSec: 4,
        transitionOut: { type: 'none', durationSec: 0 },
        layout: 'title',
        text: { title: title || '未命名视频', body: '', style: {} },
        code: null,
        subtitle: { burnIn: true, style: {} },
        overlays: [],
      },
    ],
    subtitles: [],
  })
}

/** 取数字或兜底。 */
function num(value, fallback, min = -Infinity, max = Infinity) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** 取字符串或兜底。 */
function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/** 取颜色（#rgb/#rrggbb/rgba(...)）或兜底。 */
function color(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return text
  if (/^rgba?\([\d\s.,%]+\)$/i.test(text)) return text
  return fallback
}

/** 归一化字幕条目。 */
function normalizeCue(cue, index) {
  const start = num(cue?.startSec, index * 2, 0)
  const end = num(cue?.endSec, start + 2, start + 0.1)
  return {
    id: str(cue?.id, `c${index + 1}`),
    startSec: Math.round(start * 1000) / 1000,
    endSec: Math.round(end * 1000) / 1000,
    text: str(cue?.text, ''),
  }
}

/** 归一化单个场景。 */
function normalizeScene(scene, index) {
  const layout = ['title', 'text', 'code', 'split'].includes(scene?.layout) ? scene.layout : 'text'
  const code = scene?.code && typeof scene.code === 'object'
    ? {
      language: str(scene.code.language, 'text'),
      content: str(scene.code.content, ''),
      showLineNumbers: scene.code.showLineNumbers !== false,
      highlightLines: Array.isArray(scene.code.highlightLines)
        ? scene.code.highlightLines.map((n) => Math.trunc(num(n, 0, 0))).filter((n) => n > 0)
        : [],
      highlightTheme: str(scene.code.highlightTheme, 'dark-plus'),
    }
    : null
  const overlays = Array.isArray(scene?.overlays)
    ? scene.overlays
      .filter((item) => item && typeof item === 'object' && str(item.src, '') !== '')
      .map((item, i) => ({
        id: str(item.id, `o${i + 1}`),
        type: item.type === 'video' ? 'video' : 'image',
        src: str(item.src, ''),
        x: num(item.x, 0),
        y: num(item.y, 0),
        w: num(item.w, 1920, 1),
        h: num(item.h, 1080, 1),
        opacity: num(item.opacity, 1, 0, 1),
      }))
    : []
  const transitionType = ['none', 'fade', 'slide'].includes(scene?.transitionOut?.type)
    ? scene.transitionOut.type
    : 'none'
  return {
    id: str(scene?.id, `s${index + 1}`),
    name: str(scene?.name, `场景 ${index + 1}`),
    durationSec: Math.round(num(scene?.durationSec, 4, 0.1, 600) * 1000) / 1000,
    transitionOut: { type: transitionType, durationSec: num(scene?.transitionOut?.durationSec, 0, 0, 3) },
    layout,
    text: {
      title: str(scene?.text?.title, ''),
      body: str(scene?.text?.body, ''),
      style: {
        fontSizePx: num(scene?.text?.style?.fontSizePx, 0, 0, 400),
        color: scene?.text?.style?.color ? color(scene.text.style.color, '') : '',
        align: ['left', 'center', 'right'].includes(scene?.text?.style?.align) ? scene.text.style.align : '',
      },
    },
    code,
    subtitle: {
      burnIn: scene?.subtitle?.burnIn !== false,
      style: {
        fontSizePx: num(scene?.subtitle?.style?.fontSizePx, 0, 0, 200),
        color: scene?.subtitle?.style?.color ? color(scene.subtitle.style.color, '') : '',
        bgColor: scene?.subtitle?.style?.bgColor ? color(scene.subtitle.style.bgColor, '') : '',
        strokeColor: scene?.subtitle?.style?.strokeColor ? color(scene.subtitle.style.strokeColor, '') : '',
        position: ['bottom', 'center', 'top'].includes(scene?.subtitle?.style?.position)
          ? scene.subtitle.style.position
          : '',
        marginPx: num(scene?.subtitle?.style?.marginPx, 0, 0, 600),
      },
    },
    overlays,
  }
}

/** 归一化整个工程（幂等：对已归一化的对象再跑一次结果不变）。 */
export function normalizeProject(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const base = defaultLook()
  const lookBase = base.look
  const canvas = source.canvas && typeof source.canvas === 'object' ? source.canvas : {}
  const width = Math.round(num(canvas.width, 1920, 320, 7680))
  const height = Math.round(num(canvas.height, 1080, 180, 4320))
  const fps = Math.round(num(canvas.fps, 30, 1, 120))
  // look 是唯一真相；顶层 background/theme 只作为旧工程的迁移来源。
  const lookSource = source.look && typeof source.look === 'object' ? source.look : {}
  const background = { ...(source.background ?? {}), ...(lookSource.background ?? {}) }
  const theme = { ...(source.theme ?? {}), ...(lookSource.theme ?? {}) }
  const code = lookSource.code && typeof lookSource.code === 'object' ? lookSource.code : {}
  const subtitle = lookSource.subtitle && typeof lookSource.subtitle === 'object' ? lookSource.subtitle : {}
  const audio = source.audio && typeof source.audio === 'object' ? source.audio : {}
  const scenes = Array.isArray(source.scenes) ? source.scenes.map(normalizeScene) : []
  const subtitles = Array.isArray(source.subtitles) ? source.subtitles.map(normalizeCue) : []
  const normalizedScenes = scenes.length > 0 ? scenes : newProject('placeholder', '未命名视频').scenes
  const project = {
    schemaVersion: SCHEMA_VERSION,
    rev: Math.max(1, Math.trunc(num(source.rev, 1, 1))),
    id: str(source.id, 'untitled'),
    title: str(source.title, '未命名视频'),
    createdAt: str(source.createdAt, nowIso()),
    updatedAt: str(source.updatedAt, nowIso()),
    canvas: { width, height, fps },
    look: {
      background: {
        type: background.type === 'solid' ? 'solid' : 'gradient',
        color: color(background.color, lookBase.background.color),
        from: color(background.from, lookBase.background.from),
        to: color(background.to, lookBase.background.to),
        angle: num(background.angle, lookBase.background.angle, 0, 360),
      },
      theme: {
        fontFamily: str(theme.fontFamily, lookBase.theme.fontFamily) || lookBase.theme.fontFamily,
        // fontSizePx/textColor/accentColor 是旧字段名，一并接住。
        fontSize: num(theme.fontSize ?? theme.fontSizePx, lookBase.theme.fontSize, 8, 400),
        lineHeight: num(theme.lineHeight, lookBase.theme.lineHeight, 0.8, 3),
        align: ['left', 'center', 'right'].includes(theme.align) ? theme.align : lookBase.theme.align,
        color: color(theme.color ?? theme.textColor, lookBase.theme.color),
        muted: color(theme.muted ?? theme.colorMuted, lookBase.theme.muted),
        accent: color(theme.accent ?? theme.accentColor, lookBase.theme.accent),
      },
      code: {
        fontFamily: str(code.fontFamily, lookBase.code.fontFamily) || lookBase.code.fontFamily,
        fontSize: num(code.fontSize, lookBase.code.fontSize, 8, 160),
        lineHeight: num(code.lineHeight, lookBase.code.lineHeight, 1, 3),
        bg: color(code.bg, lookBase.code.bg),
        border: color(code.border, lookBase.code.border),
        highlightBg: color(code.highlightBg, lookBase.code.highlightBg),
        gutterColor: color(code.gutterColor, lookBase.code.gutterColor),
      },
      subtitle: {
        enabled: subtitle.enabled !== false,
        fontFamily: str(subtitle.fontFamily, lookBase.subtitle.fontFamily) || lookBase.subtitle.fontFamily,
        fontSize: num(subtitle.fontSize, lookBase.subtitle.fontSize, 8, 200),
        color: color(subtitle.color, lookBase.subtitle.color),
        background: color(subtitle.background, lookBase.subtitle.background),
        bottom: num(subtitle.bottom, lookBase.subtitle.bottom, 0, 0.5),
        maxWidth: num(subtitle.maxWidth, lookBase.subtitle.maxWidth, 0.2, 1),
      },
    },
    audio: {
      narration: str(audio.narration, '') || null,
      bgm: str(audio.bgm, '') || null,
      bgmGainDb: num(audio.bgmGainDb, base.audio.bgmGainDb, -60, 12),
      narrationGainDb: num(audio.narrationGainDb, base.audio.narrationGainDb, -60, 12),
    },
    scenes: normalizedScenes,
    subtitles,
  }
  // 场景 id 去重：重复时补序号，保证客户端以 id 做 key 时不互相覆盖。
  const seen = new Set()
  for (const scene of project.scenes) {
    let id = scene.id
    let n = 2
    while (seen.has(id)) {
      id = `${scene.id}-${n}`
      n += 1
    }
    scene.id = id
    seen.add(id)
  }
  project.timeline = computeTimeline(project.scenes)
  return project
}

/** 收集工程引用的所有资源相对路径。 */
export function collectAssets(project) {
  const found = new Set()
  const add = (value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text !== '' && !text.startsWith('http://') && !text.startsWith('https://') && !text.startsWith('data:')) {
      found.add(text.replace(/^assets\//, ''))
    }
  }
  add(project?.audio?.narration)
  add(project?.audio?.bgm)
  for (const scene of project?.scenes ?? []) {
    for (const overlay of scene?.overlays ?? []) add(overlay?.src)
    if (scene?.background?.image) add(scene.background.image)
  }
  return [...found]
}

/** 项目目录（含安全校验）。 */
export function projectDir(projectsRoot, id) {
  assertProjectId(id)
  const dir = path.join(projectsRoot, id)
  if (!isInside(projectsRoot, dir)) throw new Error('项目路径越界')
  return dir
}

/** 资源目录。 */
export function assetsDir(projectsRoot, id) {
  return path.join(projectDir(projectsRoot, id), 'assets')
}

/** 解析某个资源引用的绝对路径（强制落在 assets/ 内）。 */
export function assetPath(projectsRoot, id, name) {
  const safe = assertAssetName(name)
  const dir = assetsDir(projectsRoot, id)
  const abs = path.join(dir, safe)
  if (!isInside(dir, abs)) throw new Error('资源路径越界')
  return abs
}

/** 确保工程子目录存在。 */
async function ensureProjectLayout(dir) {
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await fs.mkdir(path.join(dir, 'thumbs'), { recursive: true })
  await fs.mkdir(path.join(dir, 'exports'), { recursive: true })
}

/** 列出全部工程（按修改时间倒序）。 */
export async function listProjects(projectsRoot) {
  let entries = []
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!ID_RE.test(entry.name)) continue
    const file = path.join(projectsRoot, entry.name, 'project.json')
    try {
      const stat = await fs.stat(file)
      const text = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(text)
      const timeline = computeTimeline(parsed.scenes)
      rows.push({
        id: entry.name,
        title: typeof parsed.title === 'string' ? parsed.title : entry.name,
        updatedAt: parsed.updatedAt ?? stat.mtime.toISOString(),
        totalSec: timeline.totalSec,
        sceneCount: Array.isArray(parsed.scenes) ? parsed.scenes.length : 0,
        width: parsed.canvas?.width ?? 1920,
        height: parsed.canvas?.height ?? 1080,
        fps: parsed.canvas?.fps ?? 30,
      })
    } catch {
      // 坏工程不阻断列表：标记为 broken，让用户能在界面上删除。
      rows.push({
        id: entry.name,
        title: `${entry.name}（损坏）`,
        updatedAt: new Date().toISOString(),
        totalSec: 0,
        sceneCount: 0,
        width: 1920,
        height: 1080,
        fps: 30,
        broken: true,
      })
    }
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return rows
}

/** 读取工程。 */
export async function readProject(projectsRoot, id) {
  const dir = projectDir(projectsRoot, id)
  const file = path.join(dir, 'project.json')
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const backup = path.join(dir, 'project.json.bak')
    try {
      parsed = JSON.parse(await fs.readFile(backup, 'utf8'))
    } catch {
      throw new Error(`工程 ${id} 的 project.json 已损坏，且没有可用的备份`)
    }
  }
  const project = normalizeProject({ ...parsed, id })
  return project
}

/** 创建工程。 */
export async function createProject(projectsRoot, { id, title } = {}) {
  await fs.mkdir(projectsRoot, { recursive: true })
  let finalId = id ? assertProjectId(id) : slugify(title, 'video')
  let attempt = 0
  while (true) {
    const dir = projectDir(projectsRoot, finalId)
    try {
      await fs.mkdir(dir, { recursive: false })
      await ensureProjectLayout(dir)
      const project = newProject(finalId, title)
      // 首个写入不带 expectedRev（目录刚建好，磁盘上还没有 project.json）。
      return await writeProject(projectsRoot, finalId, project, { expectedRev: null })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      attempt += 1
      if (attempt > 50) throw new Error('无法生成唯一的项目 ID')
      finalId = `${slugify(title, 'video')}-${attempt + 1}`
    }
  }
}

/** 写工程（rev 乐观锁；写前把旧版留成 .bak）。 */
export async function writeProject(projectsRoot, id, incoming, { expectedRev } = {}) {
  const dir = projectDir(projectsRoot, id)
  await ensureProjectLayout(dir)
  const file = path.join(dir, 'project.json')
  const backup = path.join(dir, 'project.json.bak')
  let currentRev = 0
  try {
    const existing = JSON.parse(await fs.readFile(file, 'utf8'))
    currentRev = Number(existing.rev) || 0
    if (expectedRev !== undefined && expectedRev !== null && expectedRev !== currentRev) {
      const error = new Error('工程已被其他窗口修改')
      error.code = 'REV_CONFLICT'
      error.currentRev = currentRev
      throw error
    }
  } catch (error) {
    if (error.code === 'REV_CONFLICT') throw error
    if (error.code !== 'ENOENT') throw error
  }
  const project = normalizeProject({
    ...incoming,
    id,
    rev: currentRev + 1,
    updatedAt: nowIso(),
  })
  if (currentRev > 0) {
    try {
      await fs.copyFile(file, backup)
    } catch {
      // 备份失败不阻断保存。
    }
  }
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, stringifyJson(project), 'utf8')
  await fs.rename(tmp, file)
  return project
}

/** 把工程移到 .trash/（不真删，可手动恢复）。 */
export async function trashProject(projectsRoot, id) {
  const dir = projectDir(projectsRoot, id)
  try {
    await fs.access(dir)
  } catch {
    const error = new Error(`工程不存在：${id}`)
    error.code = 'NOT_FOUND'
    throw error
  }
  const trashRoot = path.join(projectsRoot, '.trash')
  await fs.mkdir(trashRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(trashRoot, `${id}-${stamp}`)
  await fs.rename(dir, dest)
  return dest
}

/** 列出 assets/ 下的文件。 */
export async function listAssets(projectsRoot, id) {
  const dir = assetsDir(projectsRoot, id)
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.')) continue
    try {
      const stat = await fs.stat(path.join(dir, entry.name))
      rows.push({ name: entry.name, bytes: stat.size, mtime: stat.mtime.toISOString() })
    } catch {
      // 跳过读不到的文件。
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

/** 写入资源文件（流式落盘）。 */
export async function writeAsset(projectsRoot, id, name, buffer) {
  const abs = assetPath(projectsRoot, id, name)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, buffer)
  return { name, size: buffer.length, bytes: buffer.length }
}

/** 删除资源文件。 */
export async function removeAsset(projectsRoot, id, name) {
  const abs = assetPath(projectsRoot, id, name)
  try {
    await fs.unlink(abs)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** 供 api.js 复用：项目根下的 video-projects 目录。 */
export function projectsRootOf(root) {
  return path.join(root, PROJECTS_DIRNAME)
}
