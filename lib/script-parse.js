/**
 * 台本解析：把 .md/.txt/.docx/.xlsx/.pdf 变成纯文本（零 npm 依赖）。
 *
 * docx / xlsx 是 ZIP 容器，这里用极简 ZIP 中央目录解析 + zlib.inflateRawSync
 * 直接读内部 XML，避免为了「读个文档」引入依赖树。
 * PDF 交给本机 Python（pymupdf）——探测失败时由 /health 标记，前端提示另存。
 *
 * 不使用 office_* 工具：这些是用户拖进插件的文件，不是要在 Office 窗口里编辑的文档。
 */

import { inflateRawSync } from 'node:zlib'

/** XML 实体反转义。 */
function unescapeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

/** 读 ZIP 中央目录。 */
function readZip(buffer) {
  let eocd = -1
  const floor = Math.max(0, buffer.length - 22 - 65535)
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 Office 文件（ZIP 头缺失）')
  const total = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  let p = cdOffset
  for (let i = 0; i < total; i += 1) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) break
    const method = buffer.readUInt16LE(p + 10)
    const compSize = buffer.readUInt32LE(p + 20)
    const nameLen = buffer.readUInt16LE(p + 28)
    const extraLen = buffer.readUInt16LE(p + 30)
    const commentLen = buffer.readUInt16LE(p + 32)
    const localOffset = buffer.readUInt32LE(p + 42)
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { buffer, entries }
}

/** 解出 ZIP 中某个条目的字节。 */
function zipEntry(zip, name) {
  const entry = zip.entries.get(name)
  if (!entry) return null
  const { buffer } = zip
  const p = entry.localOffset
  if (p + 30 > buffer.length || buffer.readUInt32LE(p) !== 0x04034b50) return null
  const nameLen = buffer.readUInt16LE(p + 26)
  const extraLen = buffer.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const raw = buffer.subarray(start, Math.min(buffer.length, start + entry.compSize))
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`Office 文件使用了不支持的压缩方式（${entry.method}）`)
}

/** 解出 ZIP 中某个条目的 UTF-8 文本。 */
function zipText(zip, name) {
  const bytes = zipEntry(zip, name)
  return bytes === null ? null : bytes.toString('utf8')
}

/** 提取 Word 主文档文本（按段落换行）。 */
export function parseDocx(buffer) {
  const zip = readZip(buffer)
  const xml = zipText(zip, 'word/document.xml')
  if (xml === null) throw new Error('不是有效的 .docx（缺少 word/document.xml）')
  const paragraphs = []
  // 逐个 <w:p> 段落处理；表格里的单元格也是 <w:p>，会被自然展开成一行行文本。
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let match
  while ((match = paraRe.exec(xml)) !== null) {
    const body = match[1]
    let text = ''
    const tokenRe = /<w:(t|tab|br)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:\1>)/g
    let token
    while ((token = tokenRe.exec(body)) !== null) {
      const kind = token[1]
      if (kind === 'tab') text += '\t'
      else if (kind === 'br') text += '\n'
      else if (typeof token[2] === 'string') text += unescapeXml(token[2])
    }
    if (text.trim() !== '') paragraphs.push(text)
  }
  // 没有 <w:p> 的退化文档：直接抓全部 <w:t>。
  if (paragraphs.length === 0) {
    const plain = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => unescapeXml(m[1]))
    if (plain.length > 0) paragraphs.push(plain.join(''))
  }
  return { text: paragraphs.join('\n'), meta: { format: 'docx', paragraphs: paragraphs.length } }
}

/** 解析 sharedStrings.xml 成数组。 */
function parseSharedStrings(xml) {
  if (!xml) return []
  const out = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let match
  while ((match = siRe.exec(xml)) !== null) {
    const inner = match[1]
    let text = ''
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let t
    while ((t = tRe.exec(inner)) !== null) text += unescapeXml(t[1])
    out.push(text)
  }
  return out
}

/** 列号字母 → 从 0 开始的索引。 */
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref ?? '')
  if (!letters) return 0
  let value = 0
  for (const ch of letters[1]) value = value * 26 + (ch.charCodeAt(0) - 64)
  return value - 1
}

/** 提取表格单元格的显示值。 */
function cellText(attrs, inner, shared) {
  const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? ''
  if (type === 'inlineStr') {
    const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]))
    return parts.join('')
  }
  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''
  if (type === 's') {
    const index = Number(value)
    return Number.isInteger(index) ? (shared[index] ?? '') : ''
  }
  if (type === 'str') return unescapeXml(value)
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE'
  return unescapeXml(value)
}

/** 提取 Excel 所有工作表文本（每行用制表符连接非空单元格）。 */
export function parseXlsx(buffer) {
  const zip = readZip(buffer)
  const shared = parseSharedStrings(zipText(zip, 'xl/sharedStrings.xml'))
  const sheetNames = [...zip.entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0))
  if (sheetNames.length === 0) throw new Error('不是有效的 .xlsx（没有工作表）')
  const blocks = []
  let rowCount = 0
  for (const sheet of sheetNames) {
    const xml = zipText(zip, sheet)
    if (!xml) continue
    const rows = []
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
    let row
    while ((row = rowRe.exec(xml)) !== null) {
      const cells = []
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
      let cell
      while ((cell = cellRe.exec(row[2])) !== null) {
        const attrs = cell[1] ?? ''
        const inner = cell[2] ?? ''
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? ''
        const index = columnIndex(ref)
        const text = cellText(attrs, inner, shared)
        cells[index] = text
      }
      const line = cells
        .map((value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''))
        .join('\t')
        .replace(/\t+$/, '')
      if (line.trim() !== '') {
        rows.push(line)
        rowCount += 1
      }
    }
    if (rows.length > 0) blocks.push(rows.join('\n'))
  }
  if (blocks.length === 0) throw new Error('.xlsx 中没有可读的文本内容')
  return { text: blocks.join('\n\n'), meta: { format: 'xlsx', rows: rowCount, sheets: sheetNames.length } }
}

/** 去 Markdown 记法，保留正文与段落。 */
export function parseMarkdown(text) {
  const out = []
  let inFence = false
  for (const rawLine of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    let next = line
    next = next.replace(/^\s{0,3}#{1,6}\s+/, '')
    next = next.replace(/^\s{0,3}>\s?/, '')
    next = next.replace(/^\s{0,3}[-*+]\s+/, '')
    next = next.replace(/^\s{0,3}\d+[.)]\s+/, '')
    next = next.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    next = next.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    next = next.replace(/(\*\*|__)(.*?)\1/g, '$2')
    next = next.replace(/(\*|_)(.*?)\1/g, '$2')
    next = next.replace(/`([^`]*)`/g, '$1')
    next = next.replace(/^\s*([-*_])(\s*\1){2,}\s*$/, '')
    out.push(next)
  }
  return {
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    meta: { format: 'markdown' },
  }
}

/** 纯文本：只做换行规范化与空白压缩。 */
export function parsePlainText(text) {
  const normalized = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: normalized, meta: { format: 'text' } }
}

/**
 * 按文件名分派解析。
 * @param {Buffer} buffer 文件字节
 * @param {string} filename 原始文件名（用于判断格式与返回 meta）
 */
export function parseScript(buffer, filename) {
  const name = String(filename ?? '').toLowerCase()
  const ext = (/(\.[a-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase()
  if (ext === '.docx' || ext === '.doc') {
    if (ext === '.doc') throw new Error('旧版 .doc 不支持，请用 Word 另存为 .docx')
    const result = parseDocx(buffer)
    return { ...result, meta: { ...result.meta, filename } }
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    const result = parseXlsx(buffer)
    return { ...result, meta: { ...result.meta, filename } }
  }
  if (ext === '.md' || ext === '.markdown') {
    const result = parseMarkdown(buffer.toString('utf8'))
    return { ...result, meta: { ...result.meta, filename } }
  }
  if (ext === '.txt' || ext === '' || ext === '.text') {
    const result = parsePlainText(buffer.toString('utf8'))
    return { ...result, meta: { ...result.meta, filename } }
  }
  if (ext === '.pdf') {
    throw new Error('PDF 请在服务端解析：调用 /parse-pdf 端点')
  }
  // 未知扩展名当纯文本处理，至少不会丢内容。
  const result = parsePlainText(buffer.toString('utf8'))
  return { ...result, meta: { ...result.meta, filename, format: 'unknown-as-text' } }
}

/** 供 /health 探测 Python PDF 能力用的脚本。 */
export const PDF_PYTHON_SCRIPT = [
  'import sys, json',
  'try:',
  '    import pymupdf as fitz',
  'except Exception:',
  '    try:',
  '        import fitz',
  '    except Exception:',
  '        print(json.dumps({"ok": False, "error": "pymupdf unavailable"}))',
  '        sys.exit(0)',
  'path = sys.argv[1]',
  'doc = fitz.open(path)',
  'parts = []',
  'for page in doc:',
  '    parts.append(page.get_text())',
  'print(json.dumps({"ok": True, "text": "\\n".join(parts), "pages": doc.page_count}, ensure_ascii=False))',
].join('\n')
