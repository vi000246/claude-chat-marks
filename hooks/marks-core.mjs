// chat-marks core: everything with no `$` in it, so `node --test` runs it.
//   - where a highlight lands in a reply, and how to split the reply so those blocks are drawn
//     with a yellow background while the rest stays the engine's own Markdown
//   - where messages sit in the conversation, and which mark alt+j / alt+k goes to
//   - which replies are long enough to be marked by themselves, and where things sit on the bar
//     alt+j / alt+k show
//   - where two typed letters (or a Boshiamy code's first two) land in a reply, and where a span
//     from there may end, for highlighting by keys

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

// Two keys of one message: equal, or one the head of the other, as when a stored message joins two
// blocks of text the transcript draws apart.
export const keysMeet = (a, b) => a === b || (Math.min(a.length, b.length) >= 40 && (a.startsWith(b) || b.startsWith(a)))

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
    // bold and italics hold markdown of their own (`**use `x` here**`): read it, keep the style
    if (m[1] !== undefined || m[2] !== undefined) segs.push(...inlineSegments(m[1] ?? m[2]).map(s => ({ ...s, bold: true })))
    else if (m[3] !== undefined) segs.push({ text: m[3], code: true })
    else if (m[4] !== undefined) segs.push({ text: m[4], link: true })
    else segs.push(...inlineSegments(m[5]).map(s => ({ ...s, italic: true })))
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

// Which characters of a block's text the fragments light (lit[i] 1), and the fragments found.
function litMask(plain, frags) {
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
  return { lit, hits }
}

// The pieces split where a fragment starts and ends, `hl` on the lit ones, and the fragments found;
// null when none matched.
export function highlightRuns(segs, frags) {
  const plain = segs.map(s => s.text).join('')
  const { lit, hits } = litMask(plain, frags)
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

// ---- long replies -----------------------------------------------------------------

// The terminal rows a message's text takes `columns` cells across, the blank row above it counted:
// each source line wraps on its own. An estimate (Markdown's markers and borders are not taken
// out), near enough to tell a long reply from a line of progress.
export function rowsOf(text, columns) {
  const width = Math.max(20, columns)
  return 1 + (text || '').trimEnd().split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(cellsOf(line) / width)), 0)
}

// The replies marked by themselves: a block of Claude's text at least `minRows` rows tall, its top
// at least `gap` rows under the top of the last one taken (a nearer one is on the screen a jump to
// that one lands on). rows: $.session.messages(), a tool call counted as a row. [{ index, key }]
export function autoMarks(rows, { columns, minRows, gap }) {
  const out = []
  let y = 0
  let last = -Infinity
  rows.forEach((r, index) => {
    const tall = r.text ? rowsOf(r.text, columns) : 0
    if (r.role === 'assistant' && tall >= minRows && y - last >= gap) {
      out.push({ index, key: keyOf(r.text) })
      last = y
    }
    y += tall + (r.toolUses?.length ?? 0)
  })
  return out
}

// Where each message's top is, in rows from the conversation's start, reckoned as autoMarks does,
// and how tall the whole is. rows: $.session.messages().
export function rowTops(rows, columns) {
  const tops = []
  let y = 0
  for (const r of rows) {
    tops.push(y)
    y += (r.text ? rowsOf(r.text, columns) : 0) + (r.toolUses?.length ?? 0)
  }
  return { tops, total: Math.max(1, y) }
}

// How far down the conversation a position (positions(): a message's index plus a fraction of it)
// lies, from 0 to 1.
export function fractionOf(pos, { tops, total }) {
  const i = Math.min(tops.length - 1, Math.max(0, Math.floor(pos)))
  const next = i + 1 < tops.length ? tops[i + 1] : total
  return Math.min(1, (tops[i] + (pos - i) * (next - tops[i])) / total)
}

const RANK = { auto: 1, highlight: 2, mark: 3 }

// The bar alt+j / alt+k show, `width` cells across: the stops at their places (`how` each, the
// one jumped to `current`), and `thumb` (from, to: fractions) the stretch on screen.
// [{ ch, how, isCurrent, isThumb }]
export function barCells(width, stops, thumb) {
  const cell = f => Math.min(width - 1, Math.max(0, Math.round(f * (width - 1))))
  const cells = Array.from({ length: width }, (_, i) => ({ ch: '─', how: null, isCurrent: false, isThumb: false, i }))
  const [a, b] = [cell(thumb[0]), cell(Math.max(thumb[0], thumb[1]))]
  for (let i = a; i <= b; i++) Object.assign(cells[i], { ch: '━', isThumb: true })
  for (const s of stops) {
    const c = cells[cell(s.at)]
    if (c.isCurrent || (c.how && RANK[c.how] >= RANK[s.how] && !s.isCurrent)) continue
    Object.assign(c, { ch: { auto: '◇', mark: '◆', highlight: '■' }[s.how], how: s.how, isCurrent: !!s.isCurrent })
  }
  return cells.map(({ i, ...c }) => c)
}

// ---- choosing a span by keys ----------------------------------------------------------
//
// A point is { block, offset }: a place in a reply as blocksOf() cuts it, `offset` in its block's
// text. A start is the character at it; an end lies just past the span's last character.

// A reply as the reader sees it, block by block: { segs, code, text, line }, `line` the source
// line its text starts on.
export function blocksOf(md) {
  const lines = (md || '').split('\n')
  return splitBlocks(lines).map(b => {
    const segs = blockSegments(lines, b)
    return { segs, code: b.fence, text: segs.map(s => s.text).join(''), line: b.start + (b.fence ? 1 : 0) }
  })
}

// Where two typed characters land, easymotion-s2 style: each place whose next two characters are
// them (any case), and, for two letters, each Chinese character whose Boshiamy code starts with
// them (`bosh`: two letters -> a Set of characters). [{ block, offset, length }]
export function findTwo(blocks, two, bosh) {
  const q = two.toLowerCase()
  const set = /^[a-z]{2}$/.test(q) ? bosh(q) : null
  const out = []
  blocks.forEach((b, block) => {
    const t = b.text
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) continue
      if (t.slice(i, i + 2).toLowerCase() === q) out.push({ block, offset: i, length: 2 })
      else if (set?.has(t[i])) out.push({ block, offset: i, length: 1 })
    }
  })
  return out
}

// Punctuation a span may end on: a sentence's or a clause's. The ASCII ones only before a space
// or the line's end, so a URL's `:` or `.` is not taken for one.
const WIDE_STOP = /[。！？，；：]/
const ASCII_STOP = /[.!?,;:]/
const CLOSER = /[」』）)"'”’\]]/
// a run of ASCII with no space in it, that is a URL or a path when it holds a / or a \
const RUN = /[!-~]+/g
const TRAIL = /[.,;:)\]>'"`]+$/

// Where a span from `from` may end: past a sentence's or a clause's punctuation (and the quotes
// or brackets closing on it), at the end of each line, and at the end of a URL or a path; in the
// block of `from` after it, and in every block after that. [{ block, offset }]
export function endsAfter(blocks, from) {
  const out = []
  for (let block = from.block; block < blocks.length; block++) {
    const t = blocks[block].text
    const ends = new Set([t.length])
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '\n') ends.add(i)
      const stops = WIDE_STOP.test(t[i]) || (ASCII_STOP.test(t[i]) && (i + 1 === t.length || /\s/.test(t[i + 1])))
      if (!stops) continue
      let j = i + 1
      while (j < t.length && CLOSER.test(t[j])) j++
      ends.add(j)
    }
    for (const m of t.matchAll(RUN)) {
      if (!/[/\\]/.test(m[0])) continue
      ends.add(m.index + m[0].replace(TRAIL, '').length)
    }
    for (const offset of [...ends].sort((a, b) => a - b)) {
      if (block > from.block || offset > from.offset) out.push({ block, offset })
    }
  }
  return out
}

// The row a point is on, from the message's top (its blank row 0 counted), as the message's
// `onScreen` counts rows: each source line wrapped on its own `columns` across.
export function rowOfPoint(md, blocks, p, columns) {
  const width = Math.max(20, columns)
  const lines = (md || '').split('\n')
  const b = blocks[p.block]
  const line = b.line + (b.text.slice(0, p.offset).match(/\n/g)?.length ?? 0)
  let row = 1
  for (let i = 0; i < line && i < lines.length; i++) row += Math.max(1, Math.ceil(cellsOf(lines[i]) / width))
  return row
}

// Labels for n hints, the first ones a single letter while enough letters are left over as the
// first of two: no label starts another, so each typed letter either is one or narrows them.
export function hintLabels(n, alphabet) {
  const L = alphabet.length
  if (n <= L) return [...alphabet].slice(0, n)
  let singles = L
  while (singles > 0 && singles + (L - singles) * L < n) singles--
  const out = [...alphabet].slice(0, singles)
  for (const p of alphabet.slice(singles)) for (const q of alphabet) out.push(p + q)
  return out.slice(0, n)
}

// A block's pieces split where a hint goes in (hints: offset -> label, drawn before the character
// at that offset, or after the last one, as a run of its own, `hint`), where a highlight (`lit`)
// and the selection (`sel`: [from, to) offsets) start and end.
export function paintRuns(segs, { lit = null, sel = null, hints = new Map() }) {
  const runs = []
  const flags = k => `${lit?.[k] === 1 ? 1 : 0}${sel && k >= sel[0] && k < sel[1] ? 1 : 0}`
  let at = 0
  for (const { text, ...style } of segs) {
    for (let i = 0; i < text.length;) {
      if (hints.has(at + i)) runs.push({ text: hints.get(at + i), hint: true })
      const f = flags(at + i)
      let j = i + 1
      while (j < text.length && !hints.has(at + j) && flags(at + j) === f) j++
      runs.push({ ...style, text: text.slice(i, j), hl: f[0] === '1', ...(f[1] === '1' ? { sel: true } : {}) })
      i = j
    }
    at += text.length
  }
  if (hints.has(at)) runs.push({ text: hints.get(at), hint: true })
  return runs
}

// The part of block `bi` (`len` long) the selection holds: [from, to) offsets, or null. sel:
// { from, to } points, `to` null for the start alone (its one character).
function selectionIn(sel, bi, len) {
  if (!sel) return null
  const { from } = sel
  const to = sel.to ?? { block: from.block, offset: from.offset + 1 }
  if (bi < from.block || bi > to.block) return null
  return [bi === from.block ? from.offset : 0, bi === to.block ? to.offset : len]
}

// A reply drawn while a span is chosen: every block as runs, `hints` ([{ block, offset, label }])
// in their places, the selection `sel` so far, `frags` lit as ever.
// [{ type: 'runs', runs, code, frags: [] }], as layout() gives.
export function pickLayout(md, frags, { hints = [], sel = null }) {
  return blocksOf(md).map((b, bi) => {
    const at = new Map(hints.filter(h => h.block === bi).map(h => [h.offset, h.label]))
    const lit = frags?.length ? litMask(b.text, frags).lit : null
    return { type: 'runs', runs: paintRuns(b.segs, { lit, sel: selectionIn(sel, bi, b.text.length), hints: at }), code: b.code, frags: [] }
  })
}

// The text from one point to another as a copy takes it: blocks apart by a blank line.
export function spanText(md, from, to) {
  const blocks = blocksOf(md)
  const parts = []
  for (let bi = from.block; bi <= to.block; bi++) {
    parts.push(blocks[bi].text.slice(bi === from.block ? from.offset : 0, bi === to.block ? to.offset : undefined))
  }
  return parts.join('\n\n')
}
