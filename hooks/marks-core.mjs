// chat-marks core: everything with no `$` in it, so `node --test` runs it.
//   - where a highlight lands in a reply, and how to split the reply so those blocks are drawn
//     with a yellow background while the rest stays the engine's own Markdown
//   - where messages sit in the conversation, and which mark alt+j / alt+k goes to

// Table borders count as space, so a selected table row (drawn with │) still matches the source.
const SPACE = /[\s│┃|]/

// Every run of whitespace collapsed to one space, ends trimmed; map[i] is where out[i] came from.
export function normMap(s) {
  let out = ''
  const map = []
  let space = true
  for (let i = 0; i < s.length; i++) {
    if (SPACE.test(s[i])) {
      if (!space) {
        out += ' '
        map.push(i)
        space = true
      }
      continue
    }
    out += s[i]
    map.push(i)
    space = false
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1)
    map.pop()
  }
  return { out, map }
}

export const norm = s => normMap(s).out

// What finds a message again in $.session.messages(): the head of its text.
export const keyOf = text => norm(text || '').slice(0, 160)

// Terminal cells a string takes (CJK and fullwidth forms two), and the string padded to `n` of them.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힣豈-﫿︰-﹏＀-｠￠-￦]/
export const cellsOf = s => [...s].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0)
export const padCells = (s, n) => s + ' '.repeat(Math.max(1, n - cellsOf(s)))

export const snippetOf = (text, n = 40) => {
  const s = norm(text || '')
  return [...s].length > n ? [...s].slice(0, n).join('') + '…' : s
}

// ---- highlights ---------------------------------------------------------------

// The bullet a selected row starts with is the renderer's, not the reply's text.
const BULLET = /^\s*(?:[●⏺•◦▪\-*+]|\d+[.)])\s+/

// The selection, one fragment per line (wrapped rows come back already joined into their lines).
// A fragment of one character would light up every same character in the reply, so it is dropped.
export function selectionFragments(text) {
  return (text || '')
    .split('\n')
    .map(l => norm(l.replace(BULLET, '')))
    .filter(l => [...l].length >= 2)
}

const FENCE = /^\s*(`{3,}|~{3,})/
const CLOSE_FENCE = /^\s*(`{3,}|~{3,})\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/

// Paragraph-level blocks: runs of non-blank lines, a fenced code block whole. Line indexes.
export function splitBlocks(lines) {
  const blocks = []
  let cur = null
  let fence = null
  lines.forEach((line, i) => {
    if (fence) {
      cur.end = i
      const m = line.match(CLOSE_FENCE)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
        fence = null
        cur = null
      }
      return
    }
    const m = line.match(FENCE)
    if (m) {
      cur = { start: i, end: i, fence: true }
      blocks.push(cur)
      fence = m[1]
      return
    }
    if (!line.trim()) {
      cur = null
      return
    }
    if (!cur) {
      cur = { start: i, end: i, fence: false }
      blocks.push(cur)
    } else cur.end = i
  })
  return blocks
}

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\([^)\s]+\)|(?<![*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?![*\w])/g

// One line's inline markdown as styled pieces, the markers gone: what the reader sees.
export function inlineSegments(line) {
  const segs = []
  let at = 0
  for (const m of line.matchAll(INLINE)) {
    if (m.index > at) segs.push({ text: line.slice(at, m.index) })
    if (m[1] !== undefined || m[2] !== undefined) segs.push({ text: m[1] ?? m[2], bold: true })
    else if (m[3] !== undefined) segs.push({ text: m[3], code: true })
    else if (m[4] !== undefined) segs.push({ text: m[4], link: true })
    else segs.push({ text: m[5], italic: true })
    at = m.index + m[0].length
  }
  if (at < line.length) segs.push({ text: line.slice(at) })
  return segs
}

// A block as styled pieces, lines joined by '\n' pieces. A heading's #s and a table's rule row go.
export function blockSegments(lines, b) {
  const segs = []
  const push = arr => {
    if (segs.length) segs.push({ text: '\n' })
    segs.push(...arr)
  }
  for (let i = b.start; i <= b.end; i++) {
    const line = lines[i]
    if (b.fence) {
      if (!FENCE.test(line)) push([{ text: line, code: true }])
      continue
    }
    if (TABLE_RULE.test(line)) continue
    const h = line.match(HEADING)
    if (h) push(inlineSegments(h[1]).map(s => ({ ...s, bold: true })))
    else push(inlineSegments(line))
  }
  return segs
}

// The pieces split where a fragment starts and ends, `hl` on the lit ones, and the fragments found;
// null when none matched.
export function highlightRuns(segs, frags) {
  const plain = segs.map(s => s.text).join('')
  const { out, map } = normMap(plain)
  const lit = new Uint8Array(plain.length)
  const hits = []
  for (const f of frags) {
    if (!f) continue
    for (let i = out.indexOf(f); i >= 0; i = out.indexOf(f, i + f.length)) {
      if (!hits.includes(f)) hits.push(f)
      for (let k = map[i]; k <= map[i + f.length - 1]; k++) lit[k] = 1
    }
  }
  if (!hits.length) return null
  const runs = []
  let at = 0
  for (const { text, ...style } of segs) {
    for (let i = 0; i < text.length;) {
      const hl = lit[at + i] === 1
      let j = i + 1
      while (j < text.length && (lit[at + j] === 1) === hl) j++
      runs.push({ ...style, text: text.slice(i, j), hl })
      i = j
    }
    at += text.length
  }
  return { runs, hits }
}

function pushMarkdown(parts, lines) {
  const text = lines.join('\n').replace(/^(\s*\n)+/, '').trimEnd()
  if (text.trim()) parts.push({ type: 'md', text })
}

// A reply split into what the engine's Markdown still draws ({ type: 'md', text }) and the blocks a
// highlight lands on ({ type: 'runs', runs, code, frags }: `frags` the fragments lit in that block);
// null when no fragment is found in it.
export function layout(md, frags) {
  const lines = (md || '').split('\n')
  const parts = []
  let from = 0
  for (const b of splitBlocks(lines)) {
    const lit = highlightRuns(blockSegments(lines, b), frags)
    if (!lit) continue
    pushMarkdown(parts, lines.slice(from, b.start))
    parts.push({ type: 'runs', runs: lit.runs, code: b.fence, frags: lit.hits })
    from = b.end + 1
  }
  if (!parts.length) return null
  pushMarkdown(parts, lines.slice(from))
  return parts
}

// The hint letters, home row first; no `j` and `k`, which move the panel's cursor, and no `x`, its
// delete mode.
export const LETTERS = 'asdfghlqwertyuiopzcvbnm'

// What the lit runs of a block say, separate stretches joined by an ellipsis.
export function litOf(runs) {
  const out = []
  let cur = ''
  for (const r of runs) {
    if (r.hl) cur += r.text
    else if (cur) {
      out.push(cur)
      cur = ''
    }
  }
  if (cur) out.push(cur)
  return out.map(norm).join(' … ')
}

// The runs of a block line by line, a run crossing a line break split in two.
export function linesOf(runs) {
  const lines = [[]]
  for (const r of runs) {
    r.text.split('\n').forEach((text, i) => {
      if (i) lines.push([])
      if (text) lines[lines.length - 1].push({ ...r, text })
    })
  }
  return lines
}

const MARKER = /^(\s*(?:[-*+•]|\d+[.)])\s+)/

// How far a list item's wrapped rows hang: its indent and marker, in characters; 0 for any other line.
export const hangOf = line => line.map(r => r.text).join('').match(MARKER)?.[1].length ?? 0

// A line's runs split after `n` characters: [the first n, the rest].
export function splitAt(line, n) {
  const head = []
  const rest = []
  let left = n
  for (const r of line) {
    if (left <= 0) rest.push(r)
    else if (r.text.length <= left) {
      head.push(r)
      left -= r.text.length
    } else {
      head.push({ ...r, text: r.text.slice(0, left) })
      rest.push({ ...r, text: r.text.slice(left) })
      left = 0
    }
  }
  return [head, rest]
}

// A message's text as a reader sees it, on one line: what a snippet of it shows.
export function plainOf(text) {
  return norm(
    (text || '')
      .split('\n')
      .filter(line => !FENCE.test(line) && !TABLE_RULE.test(line))
      .map(line => inlineSegments(line.match(HEADING)?.[1] ?? line).map(s => s.text).join(''))
      .join(' '),
  )
}

// The first `n` lines a reader sees of a message: markdown markers, fences and table rules gone.
export function previewOf(text, n = 3) {
  const out = []
  for (const line of (text || '').split('\n')) {
    if (FENCE.test(line) || TABLE_RULE.test(line) || !line.trim()) continue
    const h = line.match(HEADING)
    out.push(norm(inlineSegments(h ? h[1] : line).map(s => s.text).join('')))
    if (out.length >= n) break
  }
  return out
}

// Highlighting a selection again takes off every fragment it overlaps; otherwise it is added.
export function toggleFragments(cur, frags) {
  const overlaps = c => frags.some(f => c.includes(f) || f.includes(c))
  if (cur.some(overlaps)) return { frags: cur.filter(c => !overlaps(c)), removed: true }
  return { frags: [...cur, ...frags.filter(f => !cur.includes(f))], removed: false }
}

// ---- where things are -----------------------------------------------------------

// rows: $.session.messages(); items: [{ id, kind, key }]. Map id -> position, a row index plus the
// key's offset in the row as a fraction, so two blocks of one assistant message still sort.
export function positions(rows, items) {
  const texts = rows.map(r => norm(r.text || ''))
  const at = new Map()
  for (const it of items) {
    if (!it.key) continue
    const role = it.kind === 'user' ? 'user' : 'assistant'
    for (let i = 0; i < texts.length; i++) {
      if (rows[i].role !== role) continue
      const k = texts[i].indexOf(it.key)
      if (k < 0) continue
      at.set(it.id, i + k / (texts[i].length + 1))
      break
    }
  }
  return at
}

// Where the reader is: of the messages on screen, the first whose top shows; when one message
// fills the screen, that one. visible: [{ id, pos, first }].
export function anchorOf(visible) {
  const tops = visible.filter(v => v.first === 0)
  const pool = tops.length ? tops : visible
  return pool.reduce((a, v) => (a && a.pos <= v.pos ? a : v), null)
}

// targets: [{ id, pos }]; from: { id, pos, inside } or null. `inside`: the reader is past the top
// of `from`, so going back first returns to its top when it is a mark itself (as vim's '[ does).
export function jumpTarget(targets, dir, from) {
  const sorted = [...targets].sort((a, b) => a.pos - b.pos)
  if (!sorted.length) return null
  const index = t => sorted.indexOf(t)
  if (!from) {
    const t = dir > 0 ? sorted[0] : sorted[sorted.length - 1]
    return { target: t, index: index(t), wrapped: false }
  }
  if (dir < 0 && from.inside) {
    const self = sorted.find(t => t.id === from.id)
    if (self) return { target: self, index: index(self), wrapped: false }
  }
  let t = dir > 0 ? sorted.find(t => t.pos > from.pos) : sorted.findLast(t => t.pos < from.pos)
  if (t) return { target: t, index: index(t), wrapped: false }
  t = dir > 0 ? sorted[0] : sorted[sorted.length - 1]
  return { target: t, index: index(t), wrapped: true }
}
