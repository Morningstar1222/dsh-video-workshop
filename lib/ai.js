/**
 * AI 能力：台本 → 分镜初稿；单场景改写/翻译。
 *
 * 走宿主已配置的模型（ctx.llm），不要求用户另外填 API Key。
 * 模型输出的是「简化分镜 JSON」，这里负责校验、纠错与本地兜底切分——
 * 任何情况下都要能出初稿，不能因为模型抽风让用户卡住。
 */

import { computeTimeline } from './util.js'

/** 供前端展示的模型目录。 */
export async function listModels(llm) {
  if (!llm) return { providers: [], error: '宿主未提供 llm 服务' }
  let list = []
  try {
    if (typeof llm.listProviders === 'function') {
      const registered = await llm.listProviders()
      list = Array.isArray(registered) ? registered : []
    }
  } catch {
    list = []
  }
  if (list.length === 0) {
    try {
      if (typeof llm.listConfigurableProviders === 'function') {
        const declared = await llm.listConfigurableProviders()
        list = Array.isArray(declared) ? declared : []
      }
    } catch {
      list = []
    }
  }
  const providers = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const provider = String(entry.provider ?? entry.id ?? entry.key ?? entry.name ?? '')
    if (provider === '') continue
    let models = entry.models ?? entry.modelIds ?? []
    if ((!Array.isArray(models) || models.length === 0) && typeof llm.listModels === 'function') {
      try {
        const fetched = await llm.listModels(provider)
        if (Array.isArray(fetched) && fetched.length > 0) models = fetched
      } catch {
        // 这个 provider 的模型目录不可用，跳过。
      }
    }
    if (!Array.isArray(models)) models = []
    const mapped = models
      .map((model) => {
        if (typeof model === 'string') return { id: model, label: model }
        if (!model || typeof model !== 'object') return null
        const id = String(model.id ?? model.model ?? model.name ?? '')
        if (id === '') return null
        return { id, label: String(model.label ?? model.displayName ?? id) }
      })
      .filter(Boolean)
    if (mapped.length === 0) continue
    providers.push({
      provider,
      label: String(entry.label ?? entry.displayName ?? entry.name ?? provider),
      models: mapped,
    })
  }
  return { providers }
}

/** 从模型输出里抠出 JSON（去围栏、找首个平衡的对象）。 */
export function extractJson(text) {
  const source = String(text ?? '')
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(source)
  const body = fence ? fence[1] : source
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // 落到平衡括号扫描。
    }
  }
  const start = body.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 从流里收集文本。 */
async function collectStream(llm, options, { onDelta } = {}) {
  let text = ''
  for await (const chunk of llm.stream(options)) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
      if (onDelta) onDelta(chunk.text)
    }
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? '模型调用失败')
    }
  }
  return text
}

/** 分镜系统的输出契约（同时用于生成与改写）。 */
const DRAFT_SYSTEM = `你是一位短视频分镜编剧，专门把教学台本拆成"代码讲解类"竖屏/横屏视频的分镜。
你必须只输出一个 JSON 对象，不要任何解释、不要 Markdown 围栏。

JSON 结构：
{
  "title": "视频标题（不超过 20 字）",
  "scenes": [
    {
      "name": "场景名（不超过 12 字）",
      "layout": "title | text | code | split",
      "durationSec": 6,
      "text": { "title": "场景大标题（可空）", "body": "正文要点，2-4 行，每行一句" },
      "code": { "language": "python", "content": "代码原文（仅 layout=code 或 split 时给）" },
      "subtitleLines": ["口播字幕第 1 句", "第 2 句"]
    }
  ]
}

硬性规则：
1. layout=title 用于开场/收尾；text 用于纯文字讲解；code 用于整屏代码；split 用于左侧文字右侧代码。
2. durationSec 依据口播字数估算：中文字数 × 0.16 秒，最少 3 秒，最多 12 秒。
3. code.content 必须是可直接运行的完整片段，不要省略号，不要解释性注释占位。
4. subtitleLines 是按口播逐句拆分的字幕，每条不超过 30 字。
5. 场景总数控制在 6-20 个，总时长不超过 180 秒。
6. 不要输出 JSON 以外的任何字符。`

/** 把模型返回的简化分镜转成工程场景 + 字幕。 */
export function adaptDraft(parsed, { fallbackTitle = '未命名视频' } = {}) {
  const rawScenes = Array.isArray(parsed?.scenes) ? parsed.scenes : []
  const scenes = []
  const subtitles = []
  let cursor = 0
  for (let index = 0; index < rawScenes.length; index += 1) {
    const raw = rawScenes[index] ?? {}
    const layout = ['title', 'text', 'code', 'split'].includes(raw.layout) ? raw.layout : 'text'
    const bodyText = String(raw?.text?.body ?? '')
    const codeText = String(raw?.code?.content ?? '')
    const lines = Array.isArray(raw.subtitleLines)
      ? raw.subtitleLines.map((line) => String(line ?? '').trim()).filter((line) => line !== '')
      : []
    const charCount = bodyText.replace(/\s/g, '').length + lines.join('').replace(/\s/g, '').length
    const estimate = Math.min(12, Math.max(3, charCount * 0.16 + 1.2))
    const duration = Math.min(12, Math.max(2, Number(raw.durationSec) > 0 ? Number(raw.durationSec) : estimate))
    const sceneId = `s${index + 1}`
    scenes.push({
      id: sceneId,
      name: String(raw.name ?? `场景 ${index + 1}`).slice(0, 24),
      durationSec: Math.round(duration * 1000) / 1000,
      transitionOut: { type: index === rawScenes.length - 1 ? 'none' : 'fade', durationSec: 0.3 },
      layout,
      text: { title: String(raw?.text?.title ?? ''), body: bodyText, style: {} },
      code: codeText !== ''
        ? {
          language: String(raw?.code?.language ?? 'text') || 'text',
          content: codeText,
          showLineNumbers: true,
          highlightLines: [],
          highlightTheme: 'dark-plus',
        }
        : null,
      subtitle: { burnIn: true, style: {} },
      overlays: [],
    })
    // 字幕按口播句均分本场时长。
    if (lines.length > 0) {
      const slice = duration / lines.length
      for (let i = 0; i < lines.length; i += 1) {
        subtitles.push({
          id: `c${subtitles.length + 1}`,
          startSec: Math.round((cursor + i * slice) * 1000) / 1000,
          endSec: Math.round((cursor + (i + 1) * slice) * 1000) / 1000,
          text: lines[i].slice(0, 120),
        })
      }
    }
    cursor += duration
  }
  return {
    title: String(parsed?.title ?? fallbackTitle).slice(0, 60) || fallbackTitle,
    scenes,
    subtitles,
  }
}

/** 本地兜底切分：模型不可用时也要出初稿。 */
export function fallbackDraft(scriptText, { title = '未命名视频' } = {}) {
  const clean = String(scriptText ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  const sentences = clean
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const chunks = []
  let buffer = ''
  for (const sentence of sentences) {
    if (buffer !== '' && buffer.length + sentence.length > 60) {
      chunks.push(buffer)
      buffer = sentence
    } else {
      buffer = buffer === '' ? sentence : `${buffer} ${sentence}`
    }
  }
  if (buffer !== '') chunks.push(buffer)
  const limited = chunks.slice(0, 18)
  const scenes = []
  const subtitles = []
  let cursor = 0
  for (let i = 0; i < limited.length; i += 1) {
    const text = limited[i]
    const isFirst = i === 0
    const duration = Math.min(12, Math.max(3, text.replace(/\s/g, '').length * 0.16 + 1.2))
    scenes.push({
      id: `s${i + 1}`,
      name: isFirst ? '开场' : `第 ${i + 1} 段`,
      durationSec: Math.round(duration * 1000) / 1000,
      transitionOut: { type: i === limited.length - 1 ? 'none' : 'fade', durationSec: 0.3 },
      layout: isFirst ? 'title' : 'text',
      text: { title: isFirst ? title : '', body: isFirst ? text : text, style: {} },
      code: null,
      subtitle: { burnIn: true, style: {} },
      overlays: [],
    })
    subtitles.push({
      id: `c${i + 1}`,
      startSec: Math.round(cursor * 1000) / 1000,
      endSec: Math.round((cursor + duration) * 1000) / 1000,
      text: text.slice(0, 120),
    })
    cursor += duration
  }
  if (scenes.length === 0) {
    scenes.push({
      id: 's1',
      name: '开场',
      durationSec: 5,
      transitionOut: { type: 'none', durationSec: 0 },
      layout: 'title',
      text: { title, body: '', style: {} },
      code: null,
      subtitle: { burnIn: true, style: {} },
      overlays: [],
    })
  }
  return { title, scenes, subtitles }
}

/** 台本 → 分镜初稿。 */
export async function draftFromScript(llm, {
  provider,
  model,
  scriptText,
  title,
  maxScenes = 16,
  targetSeconds = 180,
  temperature = 0.5,
  onProgress,
} = {}) {
  const text = String(scriptText ?? '').trim()
  if (text === '') throw new Error('台本为空，先粘贴或导入台本')
  if (!llm) throw new Error('宿主未提供 llm 服务')
  if (!provider || !model) throw new Error('先选择模型')
  const userPrompt = [
    `视频标题建议：${title ?? '（由你决定）'}`,
    `目标时长：不超过 ${targetSeconds} 秒；场景数 6-${maxScenes} 个。`,
    '台本如下（可能来自 Word/Excel/PDF，仅供参考，不要逐字照搬）：',
    '---',
    text.slice(0, 24000),
    '---',
    '请输出 JSON。',
  ].join('\n')
  const options = {
    provider,
    model,
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: userPrompt }] }],
    temperature,
    maxTokens: 8192,
  }
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (onProgress) onProgress({ stage: attempt === 0 ? 'generating' : 'retrying', attempt })
      const output = await collectStream(llm, options)
      const parsed = extractJson(output)
      if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
        const adapted = adaptDraft(parsed, { fallbackTitle: title ?? '未命名视频' })
        return {
          ...adapted,
          timeline: computeTimeline(adapted.scenes),
          source: 'model',
          raw: undefined,
        }
      }
      lastError = new Error('模型没有返回可用的分镜 JSON')
      // 第二次尝试：把错误与格式要求回灌。
      options.messages = [
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: userPrompt }] },
        { role: 'assistant', source: { kind: 'model', provider, model }, content: [{ type: 'text', text: output.slice(0, 4000) }] },
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '上一条输出不是合法 JSON。请只输出 JSON 对象，结构必须包含 title 与 scenes 数组，不要任何多余字符。' }] },
      ]
    } catch (error) {
      lastError = error
    }
  }
  // 兜底：本地切分，保证一定能出初稿。
  const fallback = fallbackDraft(text, { title: title ?? '未命名视频' })
  return {
    ...fallback,
    timeline: computeTimeline(fallback.scenes),
    source: 'fallback',
    warning: lastError ? `模型生成失败，已按本地规则切分：${lastError.message}` : '模型生成失败，已按本地规则切分',
  }
}

const REWRITE_SYSTEM = `你是一位教学视频文案编辑。只输出改写后的正文，不要 JSON、不要引号、不要解释、不要 Markdown。`

/** 单场景/单条字幕改写或翻译。 */
export async function rewriteText(llm, {
  provider,
  model,
  text,
  mode = 'rewrite',
  targetLang = 'en',
  temperature = 0.6,
} = {}) {
  const source = String(text ?? '').trim()
  if (source === '') throw new Error('没有可改写的内容')
  if (!llm) throw new Error('宿主未提供 llm 服务')
  if (!provider || !model) throw new Error('先选择模型')
  const instruction = {
    rewrite: '在不改变事实的前提下改写得更口语、更适合讲解。',
    shorten: '删减到原长度的 60% 左右，保留核心信息。',
    expand: '扩写到原长度的 1.6 倍左右，补充解释与例子。',
    translate: `翻译成${targetLang === 'en' ? '英文' : targetLang === 'ja' ? '日文' : '中文'}，保持教学口吻。`,
  }[mode] ?? '改写得更口语、更适合讲解。'
  const output = await collectStream(llm, {
    provider,
    model,
    system: REWRITE_SYSTEM,
    messages: [{
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: `${instruction}\n\n原文：\n${source}` }],
    }],
    temperature,
    maxTokens: 2048,
  })
  return { text: output.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim() }
}
