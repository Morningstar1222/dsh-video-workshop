/**
 * 支教知识视频工坊 —— 客户端（React，无 JSX，无外部依赖）。
 *
 * 渲染器 drawFrame() 是预览和导出共用的唯一真相：
 * 导出的每一帧都是这个函数画出来的，所以「所见即所得」不需要额外对齐逻辑。
 *
 * 面板外再包一层 PanelBoundary：渲染期抛错时把错误原文画在面板里，避免整块主区空白。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-video-workshop',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo, useReducer } = React

    const NS = 'video-workshop'
    const PANEL_ID = 'video-workshop'
    const API = '/video-workshop/api'

    /* ------------------------------------------------------------- 样式 */

    const CSS = `
.vw-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.vw-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;flex-wrap:wrap}
.vw-bar .vw-grow{flex:1}
.vw-title{font-weight:600;font-size:14px}
.vw-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;white-space:nowrap}
.vw-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.vw-btn[disabled]{opacity:.45;cursor:not-allowed}
.vw-btn.vw-primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.vw-btn.vw-danger{color:var(--dsw-alias-state-error-primary)}
.vw-body{flex:1;display:flex;min-height:0}
.vw-left{width:210px;flex:0 0 auto;border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0}
.vw-left-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}
.vw-scenes{flex:1;overflow:auto;padding:6px}
.vw-scene{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid transparent}
.vw-scene:hover{background:var(--dsw-alias-interactive-bg-hover)}
.vw-scene[data-on="1"]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary)}
.vw-scene-no{width:20px;height:20px;border-radius:4px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;font-size:11px;flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.vw-scene-main{flex:1;min-width:0}
.vw-scene-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vw-scene-meta{color:var(--dsw-alias-label-caption);font-size:11px}
.vw-center{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.vw-stage{flex:1;display:flex;align-items:center;justify-content:center;padding:12px;min-height:0;background:var(--dsw-alias-bg-base);overflow:hidden}
.vw-canvas{max-width:100%;max-height:100%;border-radius:6px;box-shadow:var(--dsw-shadow-lv3);background:#000}
.vw-transport{display:flex;align-items:center;gap:10px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.vw-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px;min-width:110px}
.vw-right{width:268px;flex:0 0 auto;border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0}
.vw-tabs{display:flex;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.vw-tab{flex:1;text-align:center;padding:7px 4px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);border-bottom:2px solid transparent}
.vw-tab[data-on="1"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}
.vw-pane{flex:1;overflow:auto;padding:10px}
.vw-field{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.vw-field>label{width:66px;flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:12px}
.vw-field>input[type=text],.vw-field>input[type=number],.vw-field>select,.vw-field>textarea{flex:1;min-width:0;height:26px;padding:0 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px}
.vw-field>textarea{height:auto;min-height:64px;padding:5px 6px;resize:vertical;line-height:1.5;font-family:inherit}
.vw-field>input[type=color]{width:32px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent}
.vw-field>input[type=range]{flex:1}
.vw-field>input[type=checkbox]{flex:0 0 auto}
.vw-sec{margin:14px 0 8px;color:var(--dsw-alias-label-caption);font-size:11px;letter-spacing:.4px;text-transform:uppercase}
.vw-row{display:flex;gap:6px;margin-bottom:8px}
.vw-row>.vw-btn{flex:1;justify-content:center}
.vw-timeline{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-l1);padding:6px 10px 10px;background:var(--dsw-alias-bg-base);max-height:190px;overflow:auto}
.vw-track{position:relative;height:30px;margin-bottom:4px;background:var(--dsw-alias-bg-layer-1);border-radius:4px;overflow:hidden}
.vw-clip{position:absolute;top:2px;bottom:2px;border-radius:3px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;white-space:nowrap;cursor:pointer;display:flex;align-items:center;padding:0 5px}
.vw-clip[data-on="1"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.vw-clip.vw-clip-sub{background:transparent}
.vw-head{position:absolute;top:0;bottom:0;width:2px;background:var(--dsw-alias-state-business-primary);pointer-events:none;z-index:2}
.vw-track-label{font-size:11px;color:var(--dsw-alias-label-caption);margin:6px 0 3px}
.vw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary);padding:24px;text-align:center}
.vw-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9000}
.vw-modal{width:min(720px,92vw);max-height:86vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:var(--dsw-shadow-lv3);overflow:hidden}
.vw-modal-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600}
.vw-modal-body{padding:14px;overflow:auto;flex:1;min-height:0}
.vw-modal-foot{display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.vw-progress{height:6px;border-radius:3px;background:var(--dsw-alias-bg-base);overflow:hidden;margin:8px 0}
.vw-progress>div{height:100%;background:var(--dsw-alias-state-business-primary);transition:width .2s}
.vw-hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:1.5;margin-top:6px}
.vw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px;white-space:pre-wrap}
.vw-drop{outline:2px dashed var(--dsw-alias-state-business-primary);outline-offset:-6px}
.vw-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}
`

    if (document.querySelector('style[data-plugin-css="@local/dsh-video-workshop"]') === null) {
      const style = document.createElement('style')
      style.dataset.plugin = '@local/dsh-video-workshop'
      style.dataset.pluginCss = '@local/dsh-video-workshop'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /* --------------------------------------------------- 常量与渲染工具 */

    const FONTS = [
      { id: 'yahei', label: '微软雅黑', stack: '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif' },
      { id: 'heiti', label: '黑体', stack: 'SimHei,"Heiti SC",sans-serif' },
      { id: 'songti', label: '宋体', stack: 'SimSun,"Songti SC",serif' },
      { id: 'kaiti', label: '楷体', stack: 'KaiTi,"Kaiti SC",serif' },
      { id: 'pingfang', label: '苹方', stack: '"PingFang SC","Microsoft YaHei",sans-serif' },
      { id: 'inter', label: 'Inter', stack: 'Inter,"Segoe UI",sans-serif' },
      { id: 'arial', label: 'Arial', stack: 'Arial,Helvetica,sans-serif' },
      { id: 'georgia', label: 'Georgia', stack: 'Georgia,serif' },
    ]
    const MONO = [
      { id: 'consolas', label: 'Consolas', stack: 'Consolas,"Courier New",monospace' },
      { id: 'cascadia', label: 'Cascadia Code', stack: '"Cascadia Code","Cascadia Mono",Consolas,monospace' },
      { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono",Consolas,monospace' },
      { id: 'fira', label: 'Fira Code', stack: '"Fira Code",Consolas,monospace' },
      { id: 'menlo', label: 'Menlo', stack: 'Menlo,Monaco,Consolas,monospace' },
    ]
    const FONT_MAP = Object.fromEntries([...FONTS, ...MONO].map((f) => [f.id, f.stack]))

    function fontStack(id, fallback) {
      const mapped = FONT_MAP[id]
      if (mapped) return mapped
      // 旧工程可能直接存了 CSS 字体名（如 "Microsoft YaHei"）：原样用掉，别悄悄换成默认字体。
      const named = typeof id === 'string' ? id.trim() : ''
      if (named !== '') {
        const base = FONT_MAP[fallback] ?? 'sans-serif'
        return /\s/.test(named) ? `"${named}",${base}` : `${named},${base}`
      }
      return FONT_MAP[fallback] ?? 'sans-serif'
    }

    /** 解析 #rrggbb / #rgb 的相对亮度（0=黑 1=白）；非纯色返回 null。 */
    function relLuminance(input) {
      const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(input ?? '').trim())
      if (!match) return null
      let hex = match[1]
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
      const channel = (offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
    }

    /**
     * 换了背景色以后文字经常看不见（浅底 + 白字）。按背景亮度推荐一组高对比配色：
     * 浅底用深色系，深底用浅色系。rgba 之类的背景判断不了亮度，按深底处理。
     */
    function paletteFor(background) {
      const bg = background ?? {}
      const solid = bg.type === 'solid'
      const samples = [solid ? bg.color : bg.from, solid ? bg.color : bg.to]
        .map(relLuminance)
        .filter((value) => typeof value === 'number')
      const light = samples.length > 0 && samples.reduce((sum, value) => sum + value, 0) / samples.length > 0.55
      return light
        ? { color: '#0f172a', muted: 'rgba(15,23,42,.72)', accent: '#b45309' }
        : { color: '#f8fafc', muted: 'rgba(248,250,252,.72)', accent: '#38bdf8' }
    }

    const KEYWORDS = {
      python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print self',
      javascript: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield',
      typescript: 'abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface let namespace never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined var void while yield',
      java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null',
      go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil',
      rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
      sql: 'select from where group by order having insert into values update set delete create table alter drop join left right inner outer on as and or not null',
      css: 'color background margin padding display flex grid border font width height position top left right bottom',
      bash: 'if then else elif fi for while do done case esac function return local export echo cd ls cat grep sed awk',
    }

    const LANG_ALIAS = {
      py: 'python', python3: 'python', js: 'javascript', jsx: 'javascript', node: 'javascript',
      ts: 'typescript', tsx: 'typescript', rs: 'rust', golang: 'go', sh: 'bash', shell: 'bash', zsh: 'bash',
      yml: 'yaml', md: 'markdown', c: 'c', 'c++': 'cpp', h: 'c', hpp: 'cpp',
    }

    const TOKEN_COLORS = {
      comment: '#6a737d', string: '#98c379', number: '#d19a66', keyword: '#c678dd',
      func: '#61afef', punct: '#abb2bf', plain: '#d4d4d4',
    }

    /** 极简高亮：注释/字符串/数字/关键字。够用且零依赖。 */
    function tokenize(code, language) {
      const lang = LANG_ALIAS[String(language).toLowerCase()] ?? String(language).toLowerCase()
      const words = new Set(String(KEYWORDS[lang] ?? '').split(/\s+/).filter(Boolean))
      const hashComment = ['python', 'bash', 'yaml', 'ruby', 'toml'].includes(lang)
      const tokens = []
      let i = 0
      const src = String(code ?? '')
      const push = (text, cls) => {
        if (text !== '') tokens.push({ text, cls })
      }
      while (i < src.length) {
        const ch = src[i]
        const rest = src.slice(i)
        // 块注释
        if (rest.startsWith('/*')) {
          const end = src.indexOf('*/', i + 2)
          const stop = end < 0 ? src.length : end + 2
          push(src.slice(i, stop), 'comment')
          i = stop
          continue
        }
        // 行注释
        if (hashComment && ch === '#') {
          const end = src.indexOf('\n', i)
          const stop = end < 0 ? src.length : end
          push(src.slice(i, stop), 'comment')
          i = stop
          continue
        }
        if (!hashComment && rest.startsWith('//')) {
          const end = src.indexOf('\n', i)
          const stop = end < 0 ? src.length : end
          push(src.slice(i, stop), 'comment')
          i = stop
          continue
        }
        // 字符串
        if (ch === '"' || ch === "'" || ch === '`') {
          let j = i + 1
          let closed = false
          while (j < src.length) {
            if (src[j] === '\\') {
              j += 2
              continue
            }
            if (src[j] === ch) {
              j += 1
              closed = true
              break
            }
            if (ch !== '`' && src[j] === '\n') break
            j += 1
          }
          push(src.slice(i, closed ? j : j), 'string')
          i = closed ? j : j
          continue
        }
        // 数字
        if (/[0-9]/.test(ch)) {
          let j = i
          while (j < src.length && /[0-9a-fA-FxX._]/.test(src[j])) j += 1
          push(src.slice(i, j), 'number')
          i = j
          continue
        }
        // 标识符 / 关键字
        if (/[A-Za-z_$]/.test(ch)) {
          let j = i
          while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1
          const word = src.slice(i, j)
          const isCall = /^\s*\(/.test(src.slice(j))
          push(word, words.has(word) ? 'keyword' : isCall ? 'func' : 'plain')
          i = j
          continue
        }
        if (/\s/.test(ch)) {
          let j = i
          while (j < src.length && /\s/.test(src[j])) j += 1
          push(src.slice(i, j), 'plain')
          i = j
          continue
        }
        push(ch, 'punct')
        i += 1
      }
      return tokens
    }

    /** 按宽度折行（中文按字符、英文按空格优先）。 */
    function wrapText(ctx, text, maxWidth) {
      const paragraphs = String(text ?? '').split('\n')
      const lines = []
      for (const para of paragraphs) {
        if (para === '') {
          lines.push('')
          continue
        }
        let line = ''
        for (const char of para) {
          const next = line + char
          if (ctx.measureText(next).width > maxWidth && line !== '') {
            lines.push(line)
            line = char
          } else {
            line = next
          }
        }
        if (line !== '') lines.push(line)
      }
      return lines
    }

    /** 背景绘制：纯色 / 线性渐变。 */
    function drawBackground(ctx, look, width, height) {
      const bg = look?.background ?? {}
      if (bg.type === 'gradient') {
        const angle = ((Number(bg.angle) || 135) * Math.PI) / 180
        const cx = width / 2
        const cy = height / 2
        const len = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))
        const dx = (Math.cos(angle) * len) / 2
        const dy = (Math.sin(angle) * len) / 2
        const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
        gradient.addColorStop(0, bg.from ?? '#0f172a')
        gradient.addColorStop(1, bg.to ?? '#1e293b')
        ctx.fillStyle = gradient
      } else {
        ctx.fillStyle = bg.color ?? '#0f172a'
      }
      ctx.fillRect(0, 0, width, height)
    }

    /** 圆角矩形。 */
    function roundRect(ctx, x, y, w, h, r) {
      const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.arcTo(x + w, y, x + w, y + h, radius)
      ctx.arcTo(x + w, y + h, x, y + h, radius)
      ctx.arcTo(x, y + h, x, y, radius)
      ctx.arcTo(x, y, x + w, y, radius)
      ctx.closePath()
    }

    /** 绘制代码块。 */
    function drawCode(ctx, scene, look, box) {
      const code = scene.code ?? {}
      const content = String(code.content ?? '')
      if (content === '') return
      const theme = look.code ?? {}
      const lines = content.split('\n')
      const fontSize = Math.max(12, Number(theme.fontSize) || 30)
      const lineHeight = fontSize * (Number(theme.lineHeight) || 1.55)
      const padX = fontSize * 1.1
      const padY = fontSize * 0.9
      const showNo = code.showLineNumbers !== false
      const gutter = showNo ? String(lines.length).length * fontSize * 0.66 + fontSize * 0.8 : 0
      ctx.font = `${fontSize}px ${fontStack(theme.fontFamily, 'consolas')}`
      ctx.textBaseline = 'top'
      const blockH = Math.min(box.height, lines.length * lineHeight + padY * 2)
      roundRect(ctx, box.x, box.y, box.width, blockH, fontSize * 0.5)
      ctx.fillStyle = theme.bg ?? '#111827'
      ctx.fill()
      ctx.strokeStyle = theme.border ?? 'rgba(148,163,184,.25)'
      ctx.lineWidth = 1
      ctx.stroke()
      const highlight = new Set(Array.isArray(code.highlightLines) ? code.highlightLines : [])
      const startY = box.y + padY
      ctx.save()
      ctx.beginPath()
      roundRect(ctx, box.x, box.y, box.width, blockH, fontSize * 0.5)
      ctx.clip()
      for (let i = 0; i < lines.length; i += 1) {
        const y = startY + i * lineHeight
        if (highlight.has(i + 1)) {
          ctx.fillStyle = theme.highlightBg ?? 'rgba(56,189,248,.16)'
          ctx.fillRect(box.x + 1, y - 2, box.width - 2, lineHeight)
        }
        if (showNo) {
          ctx.fillStyle = theme.gutterColor ?? 'rgba(148,163,184,.55)'
          ctx.textAlign = 'right'
          ctx.fillText(String(i + 1), box.x + gutter + padX - fontSize * 0.4, y)
          ctx.textAlign = 'left'
        }
        const x0 = box.x + padX + gutter
        let x = x0
        for (const token of tokenize(lines[i], code.language)) {
          const color = TOKEN_COLORS[token.cls] ?? TOKEN_COLORS.plain
          ctx.fillStyle = theme[`token_${token.cls}`] ?? color
          ctx.fillText(token.text, x, y)
          x += ctx.measureText(token.text).width
          if (x > box.x + box.width) break
        }
      }
      ctx.restore()
    }

    /** 绘制正文段落。 */
    function drawText(ctx, scene, look, box, { titleScale = 1 } = {}) {
      const theme = look.theme ?? {}
      const text = scene.text ?? {}
      const fontSize = Math.max(10, Number(theme.fontSize) || 64)
      let y = box.y
      if (text.title) {
        ctx.font = `${Math.round(fontSize * 1.15 * titleScale)}px ${fontStack(theme.fontFamily, 'yahei')}`
        ctx.fillStyle = theme.accent ?? '#38bdf8'
        ctx.textAlign = theme.align ?? 'center'
        const lines = wrapText(ctx, text.title, box.width)
        for (const line of lines) {
          ctx.fillText(line, theme.align === 'left' ? box.x : theme.align === 'right' ? box.x + box.width : box.x + box.width / 2, y)
          y += Math.round(fontSize * 1.15 * titleScale) * 1.3
        }
        y += fontSize * 0.35
      }
      if (text.body) {
        ctx.font = `${fontSize}px ${fontStack(theme.fontFamily, 'yahei')}`
        ctx.fillStyle = theme.color ?? '#f8fafc'
        ctx.textAlign = theme.align ?? 'center'
        const lineHeight = fontSize * (Number(theme.lineHeight) || 1.35)
        const lines = wrapText(ctx, text.body, box.width)
        for (const line of lines) {
          if (y + lineHeight > box.y + box.height) break
          ctx.fillText(line, theme.align === 'left' ? box.x : theme.align === 'right' ? box.x + box.width : box.x + box.width / 2, y)
          y += lineHeight
        }
      }
    }

    /** 绘制字幕。 */
    function drawSubtitle(ctx, cue, look, width, height) {
      const style = look.subtitle ?? {}
      if (!style.enabled) return
      const fontSize = Math.max(12, Number(style.fontSize) || 44)
      ctx.font = `${fontSize}px ${fontStack(style.fontFamily, 'yahei')}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      const lines = wrapText(ctx, cue.text, width * (Number(style.maxWidth) || 0.78))
      const lineHeight = fontSize * 1.32
      const bottom = height - (height * (Number(style.bottom) || 0.06))
      const totalH = lines.length * lineHeight
      if (style.background) {
        let maxLineWidth = 0
        for (const line of lines) maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width)
        const padX = fontSize * 0.6
        const padY = fontSize * 0.32
        roundRect(
          ctx,
          width / 2 - maxLineWidth / 2 - padX,
          bottom - totalH - padY,
          maxLineWidth + padX * 2,
          totalH + padY * 2,
          fontSize * 0.28,
        )
        ctx.fillStyle = style.background
        ctx.fill()
      }
      ctx.fillStyle = style.color ?? '#ffffff'
      for (let i = 0; i < lines.length; i += 1) {
        ctx.fillText(lines[i], width / 2, bottom - totalH + (i + 1) * lineHeight - fontSize * 0.28)
      }
    }

    /**
     * 同一场景区间内画面完全一样（本渲染器没有逐帧动画），只有字幕会随换行切换。
     * 用「场景 + 当前可见字幕」做签名，导出时同签名的帧复用同一张 JPEG，
     * 把 933 帧的编码量降到个位数。
     */
    function frameSignature(project, timeSec) {
      const rows = project?.timeline?.rows ?? []
      let sceneKey = ''
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (timeSec >= rows[i].startSec && timeSec < rows[i].endSec) {
          sceneKey = String(rows[i].id ?? rows[i].index ?? i)
          break
        }
      }
      const cueKey = (project?.subtitles ?? [])
        .filter((cue) => timeSec >= Number(cue.startSec) && timeSec < Number(cue.endSec))
        .map((cue) => cue.id ?? `${cue.startSec}-${cue.endSec}`)
        .join(',')
      return sceneKey + '|' + cueKey
    }

    /** 主渲染：给定时间点画出整帧。预览与导出共用。 */
    function drawFrame(canvas, project, timeSec, images) {
      if (!canvas || !project) return
      const look = project.look ?? {}
      const width = Math.round(Number(project.canvas?.width) || 1920)
      const height = Math.round(Number(project.canvas?.height) || 1080)
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, width, height)
      drawBackground(ctx, look, width, height)

      const scenes = Array.isArray(project.scenes) ? project.scenes : []
      const timeline = project.timeline?.rows ?? []
      let active = null
      let localTime = 0
      // 转场会让相邻两场景在时间轴上重叠，重叠区应显示「后一个」场景（新场景淡入），
      // 因此倒序查找：命中首个 startSec <= t 的行即为当前场景。
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        const row = timeline[i]
        if (timeSec >= row.startSec && timeSec < row.endSec) {
          active = scenes[row.index]
          localTime = timeSec - row.startSec
          break
        }
      }
      if (!active && timeline.length > 0) {
        const last = timeline[timeline.length - 1]
        active = scenes[last.index]
        localTime = last.durationSec
      }
      if (active) {
        const margin = width * 0.09
        const contentW = width - margin * 2
        const top = height * 0.16
        const bottomLimit = height * 0.78
        const box = { x: margin, y: top, width: contentW, height: bottomLimit - top }
        const layout = active.layout ?? 'text'
        if (layout === 'code' || layout === 'split') {
          if (layout === 'split' && (active.text?.title || active.text?.body)) {
            const leftW = contentW * 0.42
            drawText(ctx, active, look, { x: margin, y: top, width: leftW, height: box.height }, { titleScale: 1 })
            drawCode(ctx, active, look, { x: margin + leftW + width * 0.03, y: top, width: contentW - leftW - width * 0.03, height: box.height })
          } else {
            if (active.text?.title) {
              ctx.font = `${Math.round((Number(look.theme?.fontSize) || 64) * 0.7)}px ${fontStack(look.theme?.fontFamily, 'yahei')}`
              ctx.fillStyle = look.theme?.accent ?? '#38bdf8'
              ctx.textAlign = 'left'
              ctx.fillText(active.text.title, margin, top - height * 0.03)
            }
            const codeTop = active.text?.title ? top : top
            drawCode(ctx, active, look, { x: margin, y: codeTop, width: contentW, height: box.height })
          }
        } else if (layout === 'title') {
          const theme = look.theme ?? {}
          const fontSize = Math.max(10, Number(theme.fontSize) || 64)
          ctx.textAlign = 'center'
          ctx.font = `${Math.round(fontSize * 1.9)}px ${fontStack(theme.fontFamily, 'yahei')}`
          ctx.fillStyle = theme.color ?? '#f8fafc'
          const lines = wrapText(ctx, active.text?.title || active.name, contentW)
          let y = height / 2 - ((lines.length - 1) * fontSize * 1.6) / 2
          for (const line of lines) {
            ctx.fillText(line, width / 2, y)
            y += fontSize * 1.6
          }
          if (active.text?.body) {
            ctx.font = `${Math.round(fontSize * 0.62)}px ${fontStack(theme.fontFamily, 'yahei')}`
            ctx.fillStyle = theme.muted ?? 'rgba(248,250,252,.72)'
            const subLines = wrapText(ctx, active.text.body, contentW * 0.9)
            let sy = y + fontSize * 0.4
            for (const line of subLines) {
              ctx.fillText(line, width / 2, sy)
              sy += fontSize * 0.92
            }
          }
        } else {
          drawText(ctx, active, look, box, { titleScale: 1 })
        }

        // 叠加图片
        const overlays = Array.isArray(active.overlays) ? active.overlays : []
        for (const overlay of overlays) {
          const image = overlay?.asset ? images?.[overlay.asset] : null
          if (!image) continue
          const ow = (Number(overlay.width) || 0.2) * width
          const oh = (Number(overlay.height) || 0.2) * height
          ctx.drawImage(image, (Number(overlay.x) || 0.5) * width - ow / 2, (Number(overlay.y) || 0.5) * height - oh / 2, ow, oh)
        }
      }

      // 字幕（全局轨）
      const cues = Array.isArray(project.subtitles) ? project.subtitles : []
      const cue = cues.find((item) => timeSec >= item.startSec && timeSec < item.endSec)
      if (cue && look.subtitle?.enabled) drawSubtitle(ctx, cue, look, width, height)
    }

    /* --------------------------------------------------------- HTTP 层 */

    function formatBytes(bytes) {
      const n = Number(bytes) || 0
      if (n <= 0) return '0 KB'
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(2)} MB`
    }

    function buildQuery(root, path) {
      if (!root) return ''
      return `${String(path ?? '').includes('?') ? '&' : '?'}root=${encodeURIComponent(root)}`
    }

    async function apiCall(path, { method = 'GET', body, root, raw, headers, signal } = {}) {
      const url = `${API}${path}${buildQuery(root, path)}`
      const init = { method, signal, headers: { ...(headers ?? {}) } }
      if (raw !== undefined) {
        init.body = raw
      } else if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(url, init)
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        let payload = null
        try {
          payload = type.includes('json') ? await response.json() : { error: await response.text() }
          message = payload?.error ?? message
        } catch {
          // 忽略解析失败。
        }
        const error = new Error(message)
        error.status = response.status
        error.payload = payload
        throw error
      }
      if (type.includes('application/json')) return response.json()
      return response.text()
    }

    /** 探测当前会话的工作目录。 */
    function detectRoot(ctx) {
      try {
        const sessions = ctx.get('sessions')
        const snap = sessions?.list?.getSnapshot?.()
        if (!snap) return null
        const current = snap.current
        if (current && snap.byId?.[current]?.cwd) return snap.byId[current].cwd
        for (const id of snap.ids ?? []) {
          const cwd = snap.byId?.[id]?.cwd
          if (typeof cwd === 'string' && cwd !== '') return cwd
        }
      } catch {
        // 探测失败交给界面引导。
      }
      return null
    }

    /* -------------------------------------------------------- 错误边界 */

    /**
     * 面板渲染期抛错时不要把整块主区变成空白：把错误原文画在面板里，
     * 用户可以直接截图反馈，而不是面对一个「什么都没有」的窗口。
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        // 保留栈信息，方便在 DevTools 里定位。
        console.error('[video-workshop] 渲染失败', error, info)
      }

      render() {
        if (this.state.error) {
          const message = String(this.state.error?.message ?? this.state.error)
          return h(
            'div',
            { className: 'vw-root', style: { padding: 24, overflow: 'auto' } },
            h('div', { className: 'vw-h1' }, '视频工坊渲染出错'),
            h('div', { className: 'vw-err', style: { marginTop: 8, whiteSpace: 'pre-wrap' } }, message),
            h('div', { className: 'vw-hint', style: { marginTop: 8 } }, '把这段信息发给我，我来修。'),
          )
        }
        return this.props.children
      }
    }

    /* ------------------------------------------------------------ 图标 */

    function PanelIcon(props) {
      const size = props?.size ?? 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        h('rect', { x: 2.5, y: 4.5, width: 19, height: 13, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M10 9.2v4.6l4-2.3-4-2.3Z', fill: 'currentColor' }),
        h('path', { d: 'M7 20.5h10', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M4 17.5h16', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.5 }),
      )
    }

    /* --------------------------------------------------------- 主面板 */

    function WorkshopPanel(props) {
      const ctx = props?.workshop ?? props?.ctx
      const [root, setRoot] = useState(null)
      const [health, setHealth] = useState(null)
      const [projects, setProjects] = useState([])
      const [project, setProject] = useState(null)
      const [status, setStatus] = useState('idle')
      const [error, setError] = useState(null)
      const [selectedScene, setSelectedScene] = useState(0)
      const [time, setTime] = useState(0)
      const [playing, setPlaying] = useState(false)
      const [tab, setTab] = useState('scene')
      const [modal, setModal] = useState(null)
      const [models, setModels] = useState({ providers: [], llmReady: false })
      const [model, setModel] = useState('')
      const imagesRef = useRef({})
      const canvasRef = useRef(null)
      const projectRef = useRef(null)
      const saveTimer = useRef(null)
      const rafRef = useRef(0)
      const revRef = useRef(0)
      projectRef.current = project

      // 初始化：定位根目录 → 健康检查 → 拉项目列表
      useEffect(() => {
        let alive = true
        const boot = async () => {
          const detected = detectRoot(ctx)
          if (!detected) {
            setStatus('need-root')
            return
          }
          setRoot(detected)
          try {
            const [healthRes, listRes] = await Promise.all([
              apiCall('/health', { root: detected }),
              apiCall('/projects', { root: detected }),
            ])
            if (!alive) return
            setHealth(healthRes)
            setProjects(listRes.projects ?? [])
            if ((listRes.projects ?? []).length > 0) {
              await openProject(listRes.projects[0].id, detected)
            } else {
              setStatus('empty')
            }
          } catch (e) {
            if (alive) setError(e.message)
          }
        }
        boot()
        return () => {
          alive = false
        }
      }, [])

      // 模型目录
      useEffect(() => {
        if (!root) return
        apiCall('/models', { root })
          .then((res) => {
            setModels(res)
            const first = res.providers?.find((p) => p.models?.length > 0)
            if (first) setModel(`${first.provider}::${first.models[0].id}`)
          })
          .catch(() => {})
      }, [root])

      const openProject = useCallback(async (id, rootOverride) => {
        const useRoot = rootOverride ?? root
        setStatus('loading')
        try {
          const res = await apiCall(`/projects/${encodeURIComponent(id)}`, { root: useRoot })
          revRef.current = res.project.rev
          setProject(res.project)
          projectRef.current = res.project
          setSelectedScene(0)
          setTime(0)
          setStatus('ready')
          setError(null)
          loadImages(res.project, useRoot)
        } catch (e) {
          setError(e.message)
          setStatus('empty')
        }
      }, [root])

      const loadImages = (proj, useRoot) => {
        const assets = Array.isArray(proj.assets) ? proj.assets : []
        for (const asset of assets) {
          if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(asset.name ?? '')) continue
          if (imagesRef.current[asset.name]) continue
          const img = new Image()
          img.src = `${API}/assets/${encodeURIComponent(proj.id)}/${encodeURIComponent(asset.name)}${buildQuery(useRoot)}`
          imagesRef.current[asset.name] = img
        }
      }

      // 预览重绘
      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !project) return
        drawFrame(canvas, project, time, imagesRef.current)
      }, [project, time, tab])

      // 播放循环
      useEffect(() => {
        if (!playing || !project) return
        let last = performance.now()
        const total = project.timeline?.totalSec ?? 0
        const tick = (now) => {
          const delta = (now - last) / 1000
          last = now
          setTime((prev) => {
            const next = prev + delta
            if (next >= total) {
              setPlaying(false)
              return total
            }
            return next
          })
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafRef.current)
      }, [playing, project])

      /** 本地修改 + 防抖保存。 */
      const patch = useCallback((mutator) => {
        setProject((prev) => {
          if (!prev) return prev
          const draft = JSON.parse(JSON.stringify(prev))
          mutator(draft)
          draft.timeline = recomputeTimeline(draft.scenes)
          scheduleSave(draft)
          return draft
        })
      }, [])

      const scheduleSave = (draft) => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        setStatus('saving')
        saveTimer.current = setTimeout(async () => {
          try {
            const res = await apiCall(`/projects/${encodeURIComponent(draft.id)}`, {
              method: 'PUT',
              root,
              body: { project: draft, expectedRev: revRef.current },
            })
            revRef.current = res.project.rev
            setStatus('saved')
            setError(null)
            setProjects((list) => list.map((item) => (item.id === res.project.id ? { ...item, title: res.project.title, updatedAt: res.project.updatedAt, sceneCount: res.project.scenes?.length ?? 0 } : item)))
          } catch (e) {
            if (e.status === 409) {
              setError('这个工程在别处被改过（可能另一个窗口在编辑）。刷新后再试，避免覆盖。')
            } else {
              setError(e.message)
            }
            setStatus('error')
          }
        }, 700)
      }

      const createNew = async (title) => {
        try {
          const res = await apiCall('/projects', { method: 'POST', root, body: { title } })
          const list = await apiCall('/projects', { root })
          setProjects(list.projects ?? [])
          revRef.current = res.project.rev
          setProject(res.project)
          setSelectedScene(0)
          setTime(0)
          setStatus('ready')
          setModal(null)
        } catch (e) {
          setError(e.message)
          throw e
        }
      }

      if (status === 'need-root') {
        return h(
          'div',
          { className: 'vw-root' },
          h(
            'div',
            { className: 'vw-empty' },
            h('div', { className: 'vw-title' }, '支教知识视频工坊'),
            h('div', null, '看不到当前会话的工作目录。请选择工程存放的文件夹：'),
            h(
              'button',
              {
                className: 'vw-btn vw-primary',
                onClick: async () => {
                  try {
                    const picked = await ctx.get('uiWorkspace')?.pickDirectory?.()
                    if (!picked) return
                    setRoot(picked)
                    const healthRes = await apiCall('/health', { root: picked })
                    setHealth(healthRes)
                    const list = await apiCall('/projects', { root: picked })
                    setProjects(list.projects ?? [])
                    if ((list.projects ?? []).length > 0) await openProject(list.projects[0].id, picked)
                    else setStatus('empty')
                  } catch (e) {
                    setError(e.message)
                  }
                },
              },
              '选择文件夹',
            ),
            error ? h('div', { className: 'vw-err' }, error) : null,
          ),
        )
      }

      if (!project) {
        return h(
          'div',
          { className: 'vw-root' },
          h(
            'div',
            { className: 'vw-bar' },
            h('span', { className: 'vw-title' }, '支教知识视频工坊'),
            h('span', { className: 'vw-grow' }),
            h('button', { className: 'vw-btn vw-primary', onClick: () => setModal('new-project') }, '新建工程'),
          ),
          h(
            'div',
            { className: 'vw-empty' },
            status === 'loading' ? '加载中…' : '还没有视频工程',
            h('div', { className: 'vw-hint' }, '新建一个工程后，可以导入台本让模型生成初稿，也可以自己从零写场景。'),
            h('div', { className: 'vw-hint' }, root ?? ''),
            error ? h('div', { className: 'vw-err' }, error) : null,
          ),
          modal === 'new-project' ? h(NewProjectModal, { onClose: () => setModal(null), onCreate: createNew }) : null,
        )
      }

      const total = project.timeline?.totalSec ?? 0
      const scenes = project.scenes ?? []
      const scene = scenes[selectedScene] ?? scenes[0]

      return h(
        'div',
        { className: 'vw-root' },
        // 顶栏
        h(
          'div',
          { className: 'vw-bar' },
          h('span', { className: 'vw-title' }, project.title || '未命名视频'),
          h('span', { className: 'vw-chip' }, `${scenes.length} 场景 · ${(total).toFixed(1)}s`),
          health?.ffmpegReady === false ? h('span', { className: 'vw-chip', style: { color: 'var(--dsw-alias-state-error-primary)' } }, 'ffmpeg 未就绪') : null,
          h('span', { className: 'vw-grow' }),
          h(
            'select',
            { value: project.id, onChange: (e) => openProject(e.target.value), className: 'vw-btn', style: { maxWidth: 180 } },
            projects.map((item) => h('option', { key: item.id, value: item.id }, item.title ?? item.id)),
          ),
          h('button', { className: 'vw-btn', onClick: () => setModal('new-project'), title: '新建工程' }, '＋ 新建'),
          h('button', { className: 'vw-btn', onClick: () => setModal('script'), title: '导入台本并用模型生成初稿' }, '台本 → 初稿'),
          h('button', { className: 'vw-btn', onClick: () => setModal('export'), title: '导出 MP4' }, '导出 MP4'),
          h('span', { className: 'vw-chip' }, status === 'saving' ? '保存中…' : status === 'saved' ? '已保存' : status === 'error' ? '保存失败' : ''),
        ),
        error ? h('div', { className: 'vw-err', style: { padding: '0 12px 6px' } }, error) : null,

        // 主体
        h(
          'div',
          { className: 'vw-body' },
          // 场景列表
          h(
            'div',
            { className: 'vw-left' },
            h(
              'div',
              { className: 'vw-left-head' },
              h('span', null, '场景'),
              h(
                'button',
                {
                  className: 'vw-btn',
                  style: { height: 22, padding: '0 6px' },
                  onClick: () => patch((draft) => {
                    finalizeTimeline(draft)
                    draft.scenes.push(makeScene(draft.scenes.length + 1))
                  }),
                  title: '追加场景',
                },
                '＋',
              ),
            ),
            h(
              'div',
              { className: 'vw-scenes' },
              scenes.map((item, index) =>
                h(
                  'div',
                  {
                    key: item.id,
                    className: 'vw-scene',
                    'data-on': index === selectedScene ? '1' : '0',
                    onClick: () => {
                      setSelectedScene(index)
                      const row = project.timeline?.rows?.[index]
                      if (row) setTime(row.startSec)
                    },
                  },
                  h('div', { className: 'vw-scene-no' }, String(index + 1)),
                  h(
                    'div',
                    { className: 'vw-scene-main' },
                    h('div', { className: 'vw-scene-name' }, item.name || `场景 ${index + 1}`),
                    h('div', { className: 'vw-scene-meta' }, `${item.layout} · ${Number(item.durationSec).toFixed(1)}s`),
                  ),
                ),
              ),
              scenes.length === 0 ? h('div', { className: 'vw-hint', style: { padding: 8 } }, '还没有场景') : null,
            ),
          ),

          // 舞台
          h(
            'div',
            { className: 'vw-center' },
            h('div', { className: 'vw-stage' }, h('canvas', { ref: canvasRef, className: 'vw-canvas' })),
            h(
              'div',
              { className: 'vw-transport' },
              h(
                'button',
                { className: 'vw-btn', onClick: () => setPlaying((v) => !v) },
                playing ? '⏸ 暂停' : '▶ 播放',
              ),
              h(
                'button',
                { className: 'vw-btn', onClick: () => { setPlaying(false); setTime(0) } },
                '⏮ 回到开头',
              ),
              h(
                'input',
                {
                  type: 'range',
                  min: 0,
                  max: Math.max(total, 0.1),
                  step: 0.01,
                  value: Math.min(time, total),
                  style: { flex: 1, minWidth: 80 },
                  onChange: (e) => {
                    setPlaying(false)
                    setTime(Number(e.target.value))
                  },
                },
              ),
              h('span', { className: 'vw-time' }, `${time.toFixed(2)} / ${total.toFixed(2)} s`),
            ),
          ),

          // 属性面板
          h(
            'div',
            { className: 'vw-right' },
            h(
              'div',
              { className: 'vw-tabs' },
              ['scene', 'style', 'subtitle', 'audio'].map((key) =>
                h(
                  'div',
                  { key, className: 'vw-tab', 'data-on': tab === key ? '1' : '0', onClick: () => setTab(key) },
                  { scene: '场景', style: '外观', subtitle: '字幕', audio: '音频' }[key],
                ),
              ),
            ),
            h(
              'div',
              { className: 'vw-pane' },
              tab === 'scene' && scene ? h(SceneInspector, { scene, index: selectedScene, scenes, patch, model, models }) : null,
              tab === 'style' ? h(StyleInspector, { project, patch }) : null,
              tab === 'subtitle' ? h(SubtitleInspector, { project, patch, scenes, selectedScene }) : null,
              tab === 'audio' ? h(AudioInspector, { project, patch, root }) : null,
            ),
          ),
        ),

        // 时间轴
        h(Timeline, { project, selectedScene, setSelectedScene, setTime, time, patch }),

        // 模态
        modal === 'new-project' ? h(NewProjectModal, { onClose: () => setModal(null), onCreate: createNew }) : null,
        modal === 'script' ? h(ScriptModal, { onClose: () => setModal(null), root, models, onApply: async (draftData) => {
          try {
            const res = await apiCall('/projects', { method: 'POST', root, body: { title: draftData.title } })
            const merged = { ...res.project, scenes: draftData.scenes, subtitles: draftData.subtitles, assets: [] }
            merged.timeline = recomputeTimeline(merged.scenes)
            const saved = await apiCall(`/projects/${encodeURIComponent(merged.id)}`, {
              method: 'PUT', root, body: { project: merged, expectedRev: res.project.rev },
            })
            revRef.current = saved.project.rev
            setProject(saved.project)
            setSelectedScene(0)
            setTime(0)
            const list = await apiCall('/projects', { root })
            setProjects(list.projects ?? [])
            setModal(null)
            setStatus('saved')
          } catch (e) {
            setError(e.message)
          }
        } }) : null,
        modal === 'export' ? h(ExportModal, { onClose: () => setModal(null), project, root, onDone: () => setModal(null) }) : null,
      )
    }

    /* -------------------------------------------------------- 局部工具 */

    function recomputeTimeline(scenes) {
      const rows = []
      let cursor = 0
      for (let i = 0; i < (scenes ?? []).length; i += 1) {
        const duration = Math.max(0.2, Number(scenes[i].durationSec) || 1)
        const start = cursor
        const end = start + duration
        rows.push({ id: scenes[i].id, index: i, startSec: round3(start), endSec: round3(end), durationSec: round3(duration) })
        const transition = scenes[i].transitionOut?.durationSec ?? 0
        cursor = end - Math.min(Number(transition) || 0, duration / 2)
      }
      return { rows, totalSec: round3(Math.max(0, rows.length > 0 ? rows[rows.length - 1].endSec : 0)) }
    }

    function round3(value) {
      return Math.round(Number(value) * 1000) / 1000
    }

    function finalizeTimeline(draft) {
      draft.timeline = recomputeTimeline(draft.scenes)
    }

    function makeScene(no) {
      return {
        id: `s${Date.now().toString(36)}`,
        name: `场景 ${no}`,
        durationSec: 5,
        transitionOut: { type: 'fade', durationSec: 0.3 },
        layout: 'text',
        text: { title: '', body: '在这里写讲解内容', style: {} },
        code: null,
        subtitle: { burnIn: true, style: {} },
        overlays: [],
      }
    }

    /* ------------------------------------------------------- 属性面板 */

    function Field(props) {
      return h('div', { className: 'vw-field' }, h('label', null, props.label), props.children)
    }

    function SceneInspector({ scene, index, scenes, patch, model, models }) {
      const [rewriting, setRewriting] = useState(false)
      const [rwErr, setRwErr] = useState(null)
      const update = (mutator) => patch((draft) => mutator(draft.scenes[index]))
      const provider = model.includes('::') ? model.split('::')[0] : ''
      const modelId = model.includes('::') ? model.split('::')[1] : ''
      const onRewrite = async (mode, fieldPath) => {
        if (!modelId) {
          setRwErr('先在上方选择一个模型')
          return
        }
        const source = fieldPath === 'title' ? scene.text?.title : scene.text?.body
        if (!source) return
        setRewriting(true)
        setRwErr(null)
        try {
          const res = await apiCall('/rewrite', {
            method: 'POST',
            body: { provider, model: modelId, text: source, mode },
          })
          if (res?.text) {
            update((draft) => {
              if (fieldPath === 'title') draft.text.title = res.text
              else draft.text.body = res.text
            })
          }
        } catch (e) {
          setRwErr(e.message)
        } finally {
          setRewriting(false)
        }
      }
      return h(
        'div',
        null,
        h('div', { className: 'vw-sec' }, `场景 ${index + 1}`),
        rwErr ? h('div', { className: 'vw-err', style: { marginBottom: 6 } }, rwErr) : null,
        h(Field, { label: '名称' }, h('input', { type: 'text', value: scene.name ?? '', onChange: (e) => update((d) => { d.name = e.target.value }) })),
        h(
          Field,
          { label: '布局' },
          h(
            'select',
            { value: scene.layout ?? 'text', onChange: (e) => update((d) => { d.layout = e.target.value }) },
            h('option', { value: 'title' }, '标题页'),
            h('option', { value: 'text' }, '文字'),
            h('option', { value: 'code' }, '代码'),
            h('option', { value: 'split' }, '左文右码'),
          ),
        ),
        h(Field, { label: '时长(s)' }, h('input', { type: 'number', min: 0.5, step: 0.1, value: scene.durationSec ?? 5, onChange: (e) => update((d) => { d.durationSec = Math.max(0.2, Number(e.target.value) || 1) }) })),
        h(Field, { label: '转场' }, h(
          'select',
          { value: scene.transitionOut?.type ?? 'none', onChange: (e) => update((d) => { d.transitionOut = { type: e.target.value, durationSec: e.target.value === 'none' ? 0 : 0.3 } }) },
          h('option', { value: 'none' }, '无'),
          h('option', { value: 'fade' }, '淡入'),
        )),
        h('div', { className: 'vw-sec' }, '画面文字'),
        h(Field, { label: '标题' }, h('input', { type: 'text', value: scene.text?.title ?? '', onChange: (e) => update((d) => { d.text.title = e.target.value }) })),
        h(Field, { label: '正文' }, h('textarea', { value: scene.text?.body ?? '', onChange: (e) => update((d) => { d.text.body = e.target.value }) })),
        h(
          'div',
          { className: 'vw-row' },
          h('button', { className: 'vw-btn', disabled: rewriting, onClick: () => onRewrite('rewrite', 'body') }, rewriting ? '改写中…' : 'AI 改写正文'),
          h('button', { className: 'vw-btn', disabled: rewriting, onClick: () => onRewrite('shorten', 'body') }, '压缩'),
        ),
        h(
          'div',
          { className: 'vw-row' },
          h('button', { className: 'vw-btn', disabled: rewriting, onClick: () => onRewrite('rewrite', 'title') }, 'AI 改写标题'),
          h('button', { className: 'vw-btn', disabled: rewriting, onClick: () => onRewrite('translate', 'body') }, '译成英文'),
        ),
        scene.layout === 'code' || scene.layout === 'split'
          ? h(
            'div',
            null,
            h('div', { className: 'vw-sec' }, '代码'),
            h(Field, { label: '语言' }, h('input', { type: 'text', value: scene.code?.language ?? 'python', onChange: (e) => update((d) => { d.code = { ...(d.code ?? {}), language: e.target.value, content: d.code?.content ?? '', showLineNumbers: true, highlightLines: [], highlightTheme: 'dark-plus' } }) })),
            h(Field, { label: '代码' }, h('textarea', { style: { fontFamily: 'Consolas,monospace', minHeight: 120 }, value: scene.code?.content ?? '', onChange: (e) => update((d) => { d.code = { ...(d.code ?? { language: 'python' }), content: e.target.value } }) })),
            h(Field, { label: '行号' }, h('input', { type: 'checkbox', checked: scene.code?.showLineNumbers !== false, onChange: (e) => update((d) => { d.code = { ...(d.code ?? { language: 'python', content: '' }), showLineNumbers: e.target.checked } }) })),
          )
          : null,
        h('div', { className: 'vw-sec' }, '操作'),
        h(
          'div',
          { className: 'vw-row' },
          h('button', { className: 'vw-btn', onClick: () => patch((draft) => { draft.scenes.splice(index, 0, { ...JSON.parse(JSON.stringify(draft.scenes[index])), id: `s${Date.now().toString(36)}` }) }) }, '复制'),
          h('button', { className: 'vw-btn vw-danger', disabled: scenes.length <= 1, onClick: () => patch((draft) => { draft.scenes.splice(index, 1) }) }, '删除'),
        ),
      )
    }

    function StyleInspector({ project, patch }) {
      const look = project.look ?? {}
      const bg = look.background ?? {}
      const theme = look.theme ?? {}
      const set = (mutator) => patch((draft) => { mutator(draft.look) })
      return h(
        'div',
        null,
        h('div', { className: 'vw-sec' }, '背景'),
        h(Field, { label: '类型' }, h('select', { value: bg.type ?? 'gradient', onChange: (e) => set((l) => { l.background = { ...l.background, type: e.target.value } }) },
          h('option', { value: 'solid' }, '纯色'),
          h('option', { value: 'gradient' }, '渐变'),
        )),
        bg.type === 'gradient'
          ? h(
            'div',
            null,
            h(Field, { label: '起色' }, h('input', { type: 'color', value: bg.from ?? '#0f172a', onChange: (e) => set((l) => { l.background = { ...l.background, from: e.target.value } }) })),
            h(Field, { label: '止色' }, h('input', { type: 'color', value: bg.to ?? '#1e293b', onChange: (e) => set((l) => { l.background = { ...l.background, to: e.target.value } }) })),
            h(Field, { label: '角度' }, h('input', { type: 'range', min: 0, max: 360, value: bg.angle ?? 135, onChange: (e) => set((l) => { l.background = { ...l.background, angle: Number(e.target.value) } }) })),
          )
          : h(Field, { label: '颜色' }, h('input', { type: 'color', value: bg.color ?? '#0f172a', onChange: (e) => set((l) => { l.background = { ...l.background, color: e.target.value } }) })),
        h('div', { className: 'vw-sec' }, '文字'),
        h(Field, { label: '字体' }, h('select', { value: theme.fontFamily ?? 'yahei', onChange: (e) => set((l) => { l.theme = { ...l.theme, fontFamily: e.target.value } }) },
          FONTS.map((f) => h('option', { key: f.id, value: f.id }, f.label)),
        )),
        h(Field, { label: '字号' }, h('input', { type: 'number', min: 12, max: 200, value: theme.fontSize ?? 64, onChange: (e) => set((l) => { l.theme = { ...l.theme, fontSize: Number(e.target.value) || 40 } }) })),
        h(Field, { label: '行距' }, h('input', { type: 'range', min: 1, max: 2.4, step: 0.05, value: theme.lineHeight ?? 1.35, onChange: (e) => set((l) => { l.theme = { ...l.theme, lineHeight: Number(e.target.value) } }) })),
        h(Field, { label: '对齐' }, h('select', { value: theme.align ?? 'center', onChange: (e) => set((l) => { l.theme = { ...l.theme, align: e.target.value } }) },
          h('option', { value: 'left' }, '左'),
          h('option', { value: 'center' }, '中'),
          h('option', { value: 'right' }, '右'),
        )),
        h(Field, { label: '文字色' }, h('input', { type: 'color', value: theme.color ?? '#f8fafc', onChange: (e) => set((l) => { l.theme = { ...l.theme, color: e.target.value } }) })),
        h(Field, { label: '副文字色' }, h('input', { type: 'color', value: theme.muted ?? '#f8fafc', onChange: (e) => set((l) => { l.theme = { ...l.theme, muted: e.target.value } }) })),
        h(Field, { label: '强调色' }, h('input', { type: 'color', value: theme.accent ?? '#38bdf8', onChange: (e) => set((l) => { l.theme = { ...l.theme, accent: e.target.value } }) })),
        h('div', { className: 'vw-hint', style: { marginBottom: 6 } }, '换过背景色以后文字看不清时，点下面的按钮按背景自动配色。'),
        h('button', { className: 'vw-btn', onClick: () => set((l) => { const p = paletteFor(l.background); l.theme = { ...l.theme, ...p } }) }, '按背景自动配色'),
        h('div', { className: 'vw-sec' }, '代码块'),
        h(Field, { label: '等宽字体' }, h('select', { value: look.code?.fontFamily ?? 'consolas', onChange: (e) => set((l) => { l.code = { ...l.code, fontFamily: e.target.value } }) },
          MONO.map((f) => h('option', { key: f.id, value: f.id }, f.label)),
        )),
        h(Field, { label: '代码字号' }, h('input', { type: 'number', min: 10, max: 80, value: look.code?.fontSize ?? 30, onChange: (e) => set((l) => { l.code = { ...l.code, fontSize: Number(e.target.value) || 26 } }) })),
        h(Field, { label: '卡片底色' }, h('input', { type: 'color', value: look.code?.bg ?? '#111827', onChange: (e) => set((l) => { l.code = { ...l.code, bg: e.target.value } }) })),
      )
    }

    function SubtitleInspector({ project, patch, scenes, selectedScene }) {
      const subtitle = project.look?.subtitle ?? {}
      const cues = project.subtitles ?? []
      const set = (mutator) => patch((draft) => { mutator(draft.look) })
      const setCue = (id, mutator) => patch((draft) => {
        const cue = (draft.subtitles ?? []).find((item) => item.id === id)
        if (cue) mutator(cue)
      })
      return h(
        'div',
        null,
        h('div', { className: 'vw-sec' }, '全局字幕样式'),
        h(Field, { label: '显示' }, h('input', { type: 'checkbox', checked: subtitle.enabled !== false, onChange: (e) => set((l) => { l.subtitle = { ...l.subtitle, enabled: e.target.checked } }) })),
        h(Field, { label: '字体' }, h('select', { value: subtitle.fontFamily ?? 'yahei', onChange: (e) => set((l) => { l.subtitle = { ...l.subtitle, fontFamily: e.target.value } }) },
          FONTS.map((f) => h('option', { key: f.id, value: f.id }, f.label)),
        )),
        h(Field, { label: '字号' }, h('input', { type: 'number', min: 12, max: 120, value: subtitle.fontSize ?? 44, onChange: (e) => set((l) => { l.subtitle = { ...l.subtitle, fontSize: Number(e.target.value) || 40 } }) })),
        h(Field, { label: '颜色' }, h('input', { type: 'color', value: subtitle.color ?? '#ffffff', onChange: (e) => set((l) => { l.subtitle = { ...l.subtitle, color: e.target.value } }) })),
        h(Field, { label: '底衬' }, h('input', { type: 'text', value: subtitle.background ?? 'rgba(0,0,0,.55)', onChange: (e) => set((l) => { l.subtitle = { ...l.subtitle, background: e.target.value } }) })),
        h(Field, { label: '距底' }, h('input', { type: 'range', min: 0.01, max: 0.3, step: 0.005, value: subtitle.bottom ?? 0.06, onChange: (e) => set((l) => { l.subtitle = { ...l.subtitle, bottom: Number(e.target.value) } }) })),
        h('div', { className: 'vw-sec' }, `字幕条（${cues.length}）`),
        h(
          'div',
          { className: 'vw-row' },
          h('button', { className: 'vw-btn', onClick: () => patch((draft) => {
            const scene = draft.scenes[selectedScene]
            const rows = draft.timeline?.rows ?? []
            const row = rows[selectedScene] ?? { startSec: 0, endSec: scene?.durationSec ?? 3 }
            const start = row.startSec
            draft.subtitles = [...(draft.subtitles ?? []), { id: `c${Date.now().toString(36)}`, startSec: start, endSec: start + Math.min(3, row.endSec - start), text: '新字幕' }]
          }) }, '在选中场景加一条'),
        ),
        ...cues.map((cue) =>
          h(
            'div',
            { key: cue.id, style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: 6, marginBottom: 6 } },
            h('input', { type: 'text', value: cue.text, style: { width: '100%', marginBottom: 4, height: 24, borderRadius: 4, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit', padding: '0 5px' }, onChange: (e) => setCue(cue.id, (c) => { c.text = e.target.value }) }),
            h(
              'div',
              { style: { display: 'flex', gap: 4, alignItems: 'center' } },
              h('input', { type: 'number', step: 0.1, value: cue.startSec, style: { width: 62, height: 22, fontSize: 11 }, onChange: (e) => setCue(cue.id, (c) => { c.startSec = Number(e.target.value) || 0 }) }),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption)' } }, '→'),
              h('input', { type: 'number', step: 0.1, value: cue.endSec, style: { width: 62, height: 22, fontSize: 11 }, onChange: (e) => setCue(cue.id, (c) => { c.endSec = Number(e.target.value) || 0 }) }),
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'vw-btn vw-danger', style: { height: 22, padding: '0 6px' }, onClick: () => patch((draft) => { draft.subtitles = (draft.subtitles ?? []).filter((item) => item.id !== cue.id) }) }, '删'),
            ),
          ),
        ),
      )
    }

    function AudioInspector({ project, patch, root }) {
      const audio = project.audio ?? {}
      const assets = project.assets ?? []
      const audioAssets = assets.filter((item) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(item.name ?? ''))
      const set = (mutator) => patch((draft) => { mutator(draft.audio ??= {}) })
      return h(
        'div',
        null,
        h('div', { className: 'vw-sec' }, '音轨'),
        h(Field, { label: '旁白' }, h('select', { value: audio.narration ?? '', onChange: (e) => set((a) => { a.narration = e.target.value || null }) },
          h('option', { value: '' }, '（无）'),
          audioAssets.map((item) => h('option', { key: item.name, value: item.name }, item.name)),
        )),
        h(Field, { label: '旁白音量' }, h('input', { type: 'range', min: -30, max: 12, value: audio.narrationGainDb ?? 0, onChange: (e) => set((a) => { a.narrationGainDb = Number(e.target.value) }) })),
        h(Field, { label: 'BGM' }, h('select', { value: audio.bgm ?? '', onChange: (e) => set((a) => { a.bgm = e.target.value || null }) },
          h('option', { value: '' }, '（无）'),
          audioAssets.map((item) => h('option', { key: item.name, value: item.name }, item.name)),
        )),
        h(Field, { label: 'BGM 音量' }, h('input', { type: 'range', min: -40, max: 6, value: audio.bgmGainDb ?? -18, onChange: (e) => set((a) => { a.bgmGainDb = Number(e.target.value) }) })),
        h('div', { className: 'vw-sec' }, '素材'),
        h(AssetUploader, { project, root, patch }),
        h(
          'div',
          { style: { marginTop: 6 } },
          assets.length === 0 ? h('div', { className: 'vw-hint' }, '还没有素材') : null,
          assets.map((item) =>
            h(
              'div',
              { key: item.name, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 3 } },
              h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
              h('span', { className: 'vw-chip' }, `${Math.round((item.size ?? 0) / 1024)} KB`),
              h('button', { className: 'vw-btn', style: { height: 20, padding: '0 5px' }, onClick: () => patch((draft) => { draft.assets = (draft.assets ?? []).filter((a) => a.name !== item.name) }) }, '移除'),
            ),
          ),
        ),
      )
    }

    function AssetUploader({ project, root, patch }) {
      const inputRef = useRef(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const upload = async (file) => {
        if (!file) return
        setBusy(true)
        setErr(null)
        try {
          const buffer = await file.arrayBuffer()
          const res = await apiCall(`/projects/${encodeURIComponent(project.id)}/assets?name=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            root,
            raw: buffer,
            headers: { 'content-type': 'application/octet-stream' },
          })
          patch((draft) => {
            draft.assets = [...(draft.assets ?? []).filter((a) => a.name !== res.asset.name), res.asset]
          })
        } catch (e) {
          setErr(e.message)
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        null,
        err ? h('div', { className: 'vw-err', style: { marginBottom: 4 } }, err) : null,
        h('input', {
          ref: inputRef,
          type: 'file',
          multiple: true,
          style: { display: 'none' },
          onChange: (e) => {
            const files = Array.from(e.target.files ?? [])
            for (const file of files) upload(file)
            e.target.value = ''
          },
        }),
        h('button', { className: 'vw-btn', style: { width: '100%', justifyContent: 'center' }, disabled: busy, onClick: () => inputRef.current?.click() }, busy ? '上传中…' : '上传素材（音频/图片/视频）'),
      )
    }

    /* --------------------------------------------------------- 时间轴 */

    function Timeline({ project, selectedScene, setSelectedScene, setTime, time, patch }) {
      const total = project.timeline?.totalSec ?? 0
      const rows = project.timeline?.rows ?? []
      const cues = project.subtitles ?? []
      const trackRef = useRef(null)
      const seek = (event) => {
        const el = trackRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        setTime(ratio * total)
      }
      const pct = (value) => (total <= 0 ? 0 : (value / total) * 100)
      return h(
        'div',
        { className: 'vw-timeline' },
        h('div', { className: 'vw-track-label' }, `场景轨（${rows.length}）· 总长 ${total.toFixed(2)}s`),
        h(
          'div',
          { className: 'vw-track', ref: trackRef, onMouseDown: seek },
          rows.map((row) =>
            h(
              'div',
              {
                key: row.id,
                className: 'vw-clip',
                'data-on': row.index === selectedScene ? '1' : '0',
                style: { left: `${pct(row.startSec)}%`, width: `${Math.max(0.6, pct(row.durationSec))}%` },
                title: `${project.scenes[row.index]?.name ?? ''} ${row.durationSec}s`,
                onMouseDown: (event) => {
                  event.stopPropagation()
                  setSelectedScene(row.index)
                  setTime(row.startSec)
                },
              },
              project.scenes[row.index]?.name ?? `#${row.index + 1}`,
            ),
          ),
          h('div', { className: 'vw-head', style: { left: `${pct(time)}%` } }),
        ),
        h('div', { className: 'vw-track-label' }, `字幕轨（${cues.length}）`),
        h(
          'div',
          { className: 'vw-track', style: { height: 22 }, onMouseDown: seek },
          cues.map((cue) =>
            h('div', {
              key: cue.id,
              className: 'vw-clip vw-clip-sub',
              style: { left: `${pct(cue.startSec)}%`, width: `${Math.max(0.4, pct(Math.max(0.2, cue.endSec - cue.startSec)))}%`, borderColor: 'var(--dsw-alias-state-business-primary)' },
              title: cue.text,
            }),
          ),
          h('div', { className: 'vw-head', style: { left: `${pct(time)}%` } }),
        ),
      )
    }

    /* ---------------------------------------------------------- 模态框 */

    function ModalShell({ title, onClose, children, footer }) {
      return h(
        'div',
        { className: 'vw-modal-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h(
          'div',
          { className: 'vw-modal' },
          h('div', { className: 'vw-modal-head' }, h('span', null, title), h('button', { className: 'vw-btn', onClick: onClose }, '关闭')),
          h('div', { className: 'vw-modal-body' }, children),
          footer ? h('div', { className: 'vw-modal-foot' }, footer) : null,
        ),
      )
    }

    function NewProjectModal({ onClose, onCreate }) {
      const [title, setTitle] = useState('支教知识视频')
      const [err, setErr] = useState(null)
      const [busy, setBusy] = useState(false)
      const submit = async () => {
        const text = title.trim()
        if (text === '') {
          setErr('先写一个工程标题')
          return
        }
        setBusy(true)
        setErr(null)
        try {
          await onCreate(text)
        } catch (e) {
          setErr(e.message)
          setBusy(false)
        }
      }
      return h(
        ModalShell,
        {
          title: '新建视频工程',
          onClose,
          footer: [
            h('button', { key: 'cancel', className: 'vw-btn', onClick: onClose }, '取消'),
            h('button', { key: 'ok', className: 'vw-btn vw-primary', disabled: busy, onClick: submit }, busy ? '创建中…' : '创建'),
          ],
        },
        h(
          Field,
          { label: '工程标题' },
          h('input', {
            type: 'text',
            value: title,
            autoFocus: true,
            onChange: (e) => setTitle(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit() },
          }),
        ),
        h('div', { className: 'vw-hint' }, '工程会存到当前会话目录下的 video-projects/<工程名>/，随时可以回到列表继续编辑。'),
        err ? h('div', { className: 'vw-err' }, err) : null,
      )
    }

    function ScriptModal({ onClose, root, models, onApply }) {
      const [text, setText] = useState('')
      const [title, setTitle] = useState('支教知识视频')
      const [model, setModel] = useState('')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const [stage, setStage] = useState('')
      const fileRef = useRef(null)
      const options = (models.providers ?? []).flatMap((p) => (p.models ?? []).map((m) => ({ value: `${p.provider}::${m.id}`, label: `${p.label} / ${m.label}` })))

      useEffect(() => {
        if (!model && options.length > 0) setModel(options[0].value)
      }, [options.length])

      const importFile = async (file) => {
        if (!file) return
        setBusy(true)
        setErr(null)
        try {
          const buffer = await file.arrayBuffer()
          const isPdf = /\.pdf$/i.test(file.name)
          const res = await apiCall(`${isPdf ? '/parse-pdf' : '/parse'}?filename=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            root,
            raw: buffer,
            headers: { 'content-type': 'application/octet-stream' },
          })
          const incoming = String(res.text ?? '').trim()
          setText((prev) => (prev.trim() === '' ? incoming : `${prev}\n\n${incoming}`))
        } catch (e) {
          setErr(e.message)
        } finally {
          setBusy(false)
        }
      }

      const generate = async () => {
        if (text.trim() === '') {
          setErr('先粘贴台本或导入文件')
          return
        }
        if (options.length === 0) {
          setErr('没有可用模型，先在 DSH 里配置一个模型')
          return
        }
        setBusy(true)
        setErr(null)
        setStage('模型正在写分镜…（可能需要 30–90 秒）')
        try {
          const [provider, modelId] = model.split('::')
          const res = await apiCall('/draft', {
            method: 'POST',
            root,
            body: { provider, model: modelId, scriptText: text, title },
          })
          if (res.source === 'fallback' && res.warning) setStage(res.warning)
          await onApply({ title: res.title, scenes: res.scenes, subtitles: res.subtitles })
        } catch (e) {
          setErr(e.message)
          setStage('')
        } finally {
          setBusy(false)
        }
      }

      return h(
        ModalShell,
        {
          title: '台本 → 分镜初稿',
          onClose,
          footer: [
            h('button', { key: 'cancel', className: 'vw-btn', onClick: onClose }, '取消'),
            h('button', { key: 'go', className: 'vw-btn vw-primary', disabled: busy, onClick: generate }, busy ? '生成中…' : '生成初稿'),
          ],
        },
        h('div', { className: 'vw-sec' }, '视频标题'),
        h('input', { type: 'text', value: title, onChange: (e) => setTitle(e.target.value), style: { width: '100%', height: 28, borderRadius: 5, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit', padding: '0 8px', marginBottom: 10 } }),
        h('div', { className: 'vw-sec' }, '模型'),
        h('select', { value: model, onChange: (e) => setModel(e.target.value), style: { width: '100%', height: 28, borderRadius: 5, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit' } },
          options.length === 0 ? h('option', { value: '' }, '（没有可用模型）') : options.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
        ),
        h('div', { className: 'vw-sec' }, '台本'),
        h('textarea', {
          value: text,
          onChange: (e) => setText(e.target.value),
          placeholder: '粘贴台本，或点下面的按钮导入 .md / .txt / .docx / .xlsx / .pdf',
          style: { width: '100%', minHeight: 200, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit', padding: 8, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical' },
        }),
        h('input', { ref: fileRef, type: 'file', accept: '.md,.txt,.docx,.xlsx,.csv,.pdf,.doc', style: { display: 'none' }, onChange: (e) => { importFile(e.target.files?.[0]); e.target.value = '' } }),
        h(
          'div',
          { style: { marginTop: 8, display: 'flex', gap: 6 } },
          h('button', { className: 'vw-btn', disabled: busy, onClick: () => fileRef.current?.click() }, '导入台本文件'),
          h('span', { className: 'vw-chip' }, `${text.length} 字`),
        ),
        stage ? h('div', { className: 'vw-hint' }, stage) : null,
        err ? h('div', { className: 'vw-err' }, err) : null,
        h('div', { className: 'vw-hint' }, '生成的初稿会建为一个新工程，之后可以在画布上逐场景改文字、样式、字幕。'),
      )
    }

    function ExportModal({ onClose, project, root, onDone }) {
      const [busy, setBusy] = useState(false)
      const [phase, setPhase] = useState('idle')
      const [progress, setProgress] = useState(0)
      const [message, setMessage] = useState('')
      const [output, setOutput] = useState(null)
      const [err, setErr] = useState(null)
      const jobRef = useRef(null)
      const cancelledRef = useRef(false)

      const start = async () => {
        setBusy(true)
        setErr(null)
        setOutput(null)
        cancelledRef.current = false
        const fps = Math.max(1, Math.round(Number(project.canvas?.fps) || 30))
        const totalSec = project.timeline?.totalSec ?? 0
        const totalFrames = Math.max(1, Math.round(totalSec * fps))
        const canvas = document.createElement('canvas')
        try {
          setPhase('preparing')
          setMessage('准备字体与画布…')
          if (document.fonts?.ready) await document.fonts.ready
          const jobRes = await apiCall('/render/start', {
            method: 'POST',
            root,
            body: {
              projectId: project.id,
              project,
              audio: project.audio,
              outName: 'final',
            },
          })
          jobRef.current = jobRes.job
          setPhase('rendering')
          const frameCache = new Map()
          for (let i = 0; i < totalFrames; i += 1) {
            if (cancelledRef.current) throw new Error('已取消')
            const signature = frameSignature(project, i / fps)
            let buffer = frameCache.get(signature)
            if (!buffer) {
              drawFrame(canvas, project, i / fps, {})
              const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94))
              if (!blob) throw new Error('帧编码失败')
              buffer = await blob.arrayBuffer()
              frameCache.set(signature, buffer)
            }
            await apiCall(`/render/frame?job=${encodeURIComponent(jobRes.job.jobId)}&index=${i}`, {
              method: 'POST',
              root,
              raw: buffer,
              headers: { 'content-type': 'image/jpeg' },
            })
            if (i % 3 === 0 || i === totalFrames - 1) {
              setProgress(((i + 1) / totalFrames) * 0.82)
              setMessage(`上传帧 ${i + 1} / ${totalFrames}`)
            }
          }
          setPhase('encoding')
          setMessage('ffmpeg 正在编码并混音（画质优先，可能需要几分钟）…')
          setProgress(0.86)
          const finished = await apiCall('/render/finish', {
            method: 'POST',
            root,
            body: { job: jobRef.current.jobId, narrationRef: project.audio?.narration, bgmRef: project.audio?.bgm },
          })
          setOutput(finished.output)
          setProgress(1)
          setPhase('done')
          setMessage('导出完成')
        } catch (e) {
          setErr(e.message)
          setPhase('failed')
          try {
            if (jobRef.current) await apiCall('/render/cancel', { method: 'POST', root, body: { job: jobRef.current.jobId } })
          } catch {
            // 忽略。
          }
        } finally {
          setBusy(false)
        }
      }

      return h(
        ModalShell,
        {
          title: '导出 MP4',
          onClose: () => {
            cancelledRef.current = true
            onClose()
          },
          footer: [
            h('button', { key: 'close', className: 'vw-btn', onClick: () => { cancelledRef.current = true; onClose() } }, '关闭'),
            output
              ? h('a', { key: 'dl', className: 'vw-btn vw-primary', href: `${API}/exports/${encodeURIComponent(project.id)}/${encodeURIComponent(output.mp4.split(/[\\/]/).pop())}${buildQuery(root)}`, download: '' }, '下载 MP4')
              : h('button', { key: 'go', className: 'vw-btn vw-primary', disabled: busy, onClick: start }, busy ? '导出中…' : '开始导出'),
          ],
        },
        h('div', { className: 'vw-hint' }, `画布 ${project.canvas?.width ?? 1920}×${project.canvas?.height ?? 1080} @ ${project.canvas?.fps ?? 30}fps，总时长 ${(project.timeline?.totalSec ?? 0).toFixed(2)}s`),
        h('div', { className: 'vw-hint' }, `预计 ${Math.round((project.timeline?.totalSec ?? 0) * (project.canvas?.fps ?? 30))} 帧。渲染逐帧上传到本机 ffmpeg，画质优先。`),
        h('div', { className: 'vw-progress' }, h('div', { style: { width: `${Math.round(progress * 100)}%` } })),
        h('div', { className: 'vw-hint' }, message),
        output ? h('div', { className: 'vw-hint' }, `输出：${output.mp4}（${formatBytes(output.bytes)}${output.srt ? '，另附 .srt' : ''}）`) : null,
        err ? h('div', { className: 'vw-err' }, err) : null,
        phase === 'done' ? h('div', { className: 'vw-hint' }, '成片已写到工程的 exports/ 目录。') : null,
      )
    }

    /* ---------------------------------------------------------- apply */

    function apply(ctx) {
      // 必须先在真实存在的 slot 上 inject：'main' 与 'sidebar.panellist' 是宿主声明的槽，
      // ownerKey 写错（例如自造的 'xxx.panel'）会静默不注册。
      const stop = ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
        const stopPanel = ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ workshop: ctx }) },
          (props) => h(PanelBoundary, null, h(WorkshopPanel, props)),
        )
        let stopIcon
        try {
          stopIcon = ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 41, label: () => '支教知识视频工坊', locale: NS },
            PanelIcon,
          )
        } catch (error) {
          stopIcon?.()
          stopPanel()
          throw error
        }
        return () => {
          stopIcon?.()
          stopPanel()
        }
      }))
      return stop
    }

    return { inject: ['slots'], apply }
  },
})
