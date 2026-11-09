// chat-marks: a highlighter and vim-style marks for the Claude Code transcript. See README.md.
//
//   alt+m  letters go up on the long replies on screen (on every message when none is long, and on
//          the ones marked already); a letter marks that one, or, on one already marked (its
//          letter red, "unmark?" beside it), takes the mark off
//   alt+j  next stop      alt+k  previous stop: auto marks, marks and highlights alike
//   alt+y  highlight the mouse selection (Claude's replies); again on it takes it off, as does the
//          button that shows while the pointer is over a highlighted block
//   alt+o  the panel (also /mark), two tabs (1, 2):
//          marks    every mark and highlight in conversation order (no auto mark), a letter each;
//                   j / k move the cursor and show the conversation there, a letter or Enter jumps
//                   and closes, Escape closes and goes back to where it was opened; x deletes; 0
//                   twice: all
//          settings the long-reply height, then the hotkeys: click a row, type, saved (/mark keys
//                   opens here; the chords above are only what this author picked: the mod binds
//                   nothing until someone sets them)
//   /mark next|prev|add|hl [words]|auto <rows>|off|on|color <#rrggbb>|lang en|zh
//   /mark-clear  every mark and highlight of this session gone (auto marks are not the person's)
//
// Where alt+j / alt+k and the panel go: a mark is a message's top; a highlight is each highlighted
// block, brought to the middle of the screen. An auto mark (◇) is a long reply's top: worked out
// from the conversation at each turn's end (marks-core autoMarks), never chosen or deleted, so a
// new height (/mark auto) holds for the whole conversation at once.
//
// A mark is a whole transcript row (a prompt, or one block of a reply): $.ui.scroll reveals a row,
// never a line inside one; a highlighted block, drawn by this mod, is reached by its key. A mod
// cannot bind keys of its own: the chords are bound in keybindings.json (the hotkeys panel writes
// them there) to engine actions only the /diff dialog handles (ACTIONS), and Buttons naming them
// sit hidden in the hint line under the prompt, so the chord presses them. Letters reach only a
// site holding the keys, so the pickers are panes opened with `focus`, and the hotkeys tab takes a
// chord as a modifier digit plus a letter (a click on a Client never gave it the keyboard here).
// The selection, onScreen and scrolling all need `/tui fullscreen`.
//
// $.state (the session's, kept through reloads):
//   marks       [{ id, kind, key, snippet, preview, at }]  by the row's requestId
//   highlights  { <requestId>: { key, snippet, text, frags: [normalized line] } }
//   auto        [{ key, id, snippet }]  the auto marks, worked out again at each turn's end; `id` the
//               row it was last drawn under (null while none was), for a jump before it is redrawn
//   pick        { items: [{ id, kind, key, snippet }] } while alt+m's letters are up, else null
//   panel       { tab, mode: 'jump' | 'delete', cursor: <target id>, origin, confirmClear } while
//               the panel is up; origin: where Escape scrolls back to
//   keys        { armed, mods, letter, rows, pending: { slot, chord } | null, note, tone } while the
//               panel is up: the settings row being edited and what its editor holds
//   color, lang the highlight's background; the language spoken (strings.mjs)
// $.store:
//   s:<sessionId>  { marks, highlights, auto, at }, so a resumed session gets them back; the newest
//                  KEEP_SESSIONS are kept
//   cfg            { color, lang, auto, keys: { down, up, remove }, hints }: auto the rows a reply
//                  needs to be marked by itself (0: none is); hints counts the "no hotkeys yet"
//                  toasts (three at most)

import { atom, read, update } from 'claude-code'
import {
  LETTERS, anchorOf, autoMarks, hangOf, jumpTarget, keyOf, keysMeet, layout, linesOf, litOf, padCells, plainOf,
  positions, previewOf, rowsOf, selectionFragments, snippetOf, splitAt, toggleFragments,
} from './marks-core.mjs'
import { canon, chordFor, globalProblem, isPanelKey, rebind, unbind, usersOf } from './keys-core.mjs'
import { LANGS, STRINGS } from './strings.mjs'

const ACTIONS = {
  mark: 'diff:back',
  next: 'diff:nextFile',
  prev: 'diff:previousFile',
  highlight: 'diff:nextSource',
  panel: 'diff:previousSource',
}
// the rows of the settings tab: the long-reply height, the chords kept in keybindings.json, then
// the panel's own keys
const SETTING_SLOTS = ['auto']
const GLOBAL_SLOTS = ['mark', 'next', 'prev', 'highlight', 'panel']
const PANEL_SLOTS = ['down', 'up', 'remove']
const DEFAULT_PANEL_KEYS = { down: 'j', up: 'k', remove: 'x' }
const PICK_PANE = 'chat-marks-pick'
const PANEL = 'chat-marks'
const KEEP_SESSIONS = 40
// dark amber: readable white text on a black terminal without glaring
const DEFAULT_COLOR = '#6b4f00'
// a letter over a message already marked: the press takes the mark off
const UNMARK_COLOR = '#8b1e1e'
const COLOR = /^#[0-9a-f]{6}$/i
const ENTRY = 'chat-marks-e-'
// a reply this many rows tall (or taller) is marked by itself, and gets one of alt+m's letters
const DEFAULT_AUTO_ROWS = 12

const marksAtom = atom({ plugin: 'chat-marks', key: 'marks' }, [])
const hlAtom = atom({ plugin: 'chat-marks', key: 'highlights' }, {})
const autoAtom = atom({ plugin: 'chat-marks', key: 'auto' }, [])
const pickAtom = atom({ plugin: 'chat-marks', key: 'pick' }, null)
const panelAtom = atom({ plugin: 'chat-marks', key: 'panel' }, null)
const colorAtom = atom({ plugin: 'chat-marks', key: 'color' }, DEFAULT_COLOR)
const langAtom = atom({ plugin: 'chat-marks', key: 'lang' }, 'en')
const keysAtom = atom({ plugin: 'chat-marks', key: 'keys' }, null)

// requestId -> { kind, text, onScreen, drawn } of every message drawn since the module loaded;
// `drawn` counts draws, so of two ids for one message (a prompt can be drawn under one id and then
// another) the one drawn last is the one on screen
const seen = new Map()
let draws = 0
// the target the last jump went to: where the next one starts while its message is on screen
let cursor = null
// the conversation's size in cells, as the last message drawn saw it: how tall a reply is
let screen = { columns: 100, rows: 40 }
// the marks panel's own keys (cfg.keys), and the letters left for its entries and alt+m's picker
let keys = { ...DEFAULT_PANEL_KEYS }
let letters = LETTERS

function usePanelKeys(saved) {
  keys = { ...DEFAULT_PANEL_KEYS }
  for (const slot of PANEL_SLOTS) if (isPanelKey(saved?.[slot] ?? '')) keys[slot] = saved[slot]
  const taken = Object.values(keys)
  letters = [...'asdfghjklqwertyuiopzxcvbnm'].filter(c => !taken.includes(c)).join('')
}

const toast = ($, text) => $.ui.toast(text)
const safe = ($, fn) => (...args) => fn(...args).catch(err => toast($, 'chat-marks: ' + (err?.message || err)))
const strings = async $ => STRINGS[await read($, langAtom)] ?? STRINGS.en
const blockKey = (id, i) => `chat-marks-block-${id}-${i}`
const entryKey = tid => ENTRY + tid

function remember(e, kind) {
  seen.set(e.requestId, { kind, text: e.props.text, onScreen: e.props.onScreen, drawn: ++draws })
  if (e.viewport?.columns) screen = { columns: e.viewport.columns, rows: e.viewport.rows || screen.rows }
}

// A reply's text body is the conversation's width less the bullet column.
const bodyColumns = () => screen.columns - 2

const itemOf = (id, s) => ({ id, kind: s.kind, key: keyOf(s.text), snippet: snippetOf(plainOf(s.text)), preview: previewOf(s.text) })

// The messages on screen, one per message: of two ids with the same text, the one drawn last.
function visibleNow() {
  const byText = new Map()
  for (const [id, s] of seen) {
    if (!s.onScreen) continue
    const k = s.kind + '\n' + s.text
    if (!byText.has(k) || byText.get(k).drawn < s.drawn) byText.set(k, { id, s })
  }
  return [...byText.values()].map(({ id, s }) => ({ ...itemOf(id, s), first: s.onScreen.first }))
}

// Every place alt+j / alt+k and the panel go, unordered: a mark is its message's top; a highlight
// is each highlighted block, or the message when its text is not at hand; an auto mark (`auto`,
// alt+j / alt+k's alone) its reply's top, when no mark is there already and a row of it is known.
// [{ tid, id, block, kind, key, snippet, preview, lit, frags, how }]
function targetsOf(marks, highlights, auto = []) {
  const out = []
  for (const a of auto) {
    const id = drawnId(a.key) ?? a.id
    if (!id || marks.some(m => m.kind === 'assistant' && (m.id === id || keysMeet(m.key, a.key)))) continue
    out.push({ tid: 'auto:' + id, id, block: null, kind: 'assistant', key: a.key, snippet: a.snippet, preview: [a.snippet], how: 'auto' })
  }
  for (const m of marks) {
    const text = seen.get(m.id)?.text
    const preview = text ? previewOf(text) : m.preview?.length ? m.preview : [m.snippet]
    out.push({ tid: m.id, id: m.id, block: null, kind: m.kind, key: m.key, snippet: m.snippet, preview, how: 'mark' })
  }
  for (const [id, h] of Object.entries(highlights)) {
    const base = { id, kind: 'assistant', key: h.key, snippet: h.snippet, how: 'highlight' }
    const text = seen.get(id)?.text ?? h.text
    const parts = text ? layout(text, h.frags) ?? [] : []
    const blocks = parts.map((p, i) => ({ p, i })).filter(({ p }) => p.type === 'runs')
    if (!blocks.length) out.push({ ...base, tid: id + '#', block: null, lit: h.frags.join(' … '), frags: h.frags })
    for (const { p, i } of blocks) out.push({ ...base, tid: `${id}#${i}`, block: i, lit: litOf(p.runs), frags: p.frags })
  }
  return out
}

// The targets in conversation order (a block just after its message's top); `extra` are placed too.
// `withAuto`: the auto marks among them (alt+j / alt+k), worked out afresh; the panel lists none.
async function placedTargets($, extra = [], withAuto = false) {
  const auto = withAuto ? await refreshAuto($) : []
  const items = targetsOf(await read($, marksAtom), await read($, hlAtom), auto)
  const msgs = [...new Map(items.map(t => [t.id, { id: t.id, kind: t.kind, key: t.key }])).values()]
  const pos = positions(await $.session.messages(), [...msgs, ...extra])
  const placed = items
    .filter(t => pos.has(t.id))
    .map(t => ({ ...t, pos: pos.get(t.id) + (t.block == null ? 0 : (t.block + 1) * 1e-6) }))
    .sort((a, b) => a.pos - b.pos)
  return { placed, pos }
}

// Where the reader is: the last target jumped to while its message is still on screen, else the
// first message on screen whose top shows.
function startFrom(placed, visible, pos) {
  const cur = cursor && placed.find(t => t.tid === cursor)
  if (cur && (!visible.length || visible.some(v => v.id === cur.id))) return { id: cur.tid, pos: cur.pos, inside: false }
  const anchor = anchorOf(visible.filter(v => pos.has(v.id)).map(v => ({ ...v, pos: pos.get(v.id) })))
  return anchor ? { id: anchor.id, pos: anchor.pos, inside: anchor.first > 0 } : null
}

// ---- persistence --------------------------------------------------------------

async function config($) {
  const cfg = await $.store.get('cfg')
  return cfg && typeof cfg === 'object' ? cfg : {}
}

async function persist($) {
  const key = 's:' + (await $.session.id())
  const marks = await read($, marksAtom)
  const highlights = await read($, hlAtom)
  const auto = await read($, autoAtom)
  // delete first so a rewrite moves the key to the end of the insertion order the pruning reads
  await $.store.delete(key)
  if (marks.length || Object.keys(highlights).length || auto.length) {
    await $.store.set(key, { marks, highlights, auto, at: await $.clock.now() })
  }
  const kept = (await $.store.keys()).filter(k => k.startsWith('s:'))
  for (const k of kept.slice(0, Math.max(0, kept.length - KEEP_SESSIONS))) await $.store.delete(k)
}

async function restore($) {
  const { color, lang, keys: panelKeys } = await config($)
  if (COLOR.test(color ?? '')) await update($, colorAtom, () => color)
  if (LANGS.includes(lang)) await update($, langAtom, () => lang)
  usePanelKeys(panelKeys)
  const held = (await read($, marksAtom)).length || Object.keys(await read($, hlAtom)).length || (await read($, autoAtom)).length
  if (held) return
  const saved = await $.store.get('s:' + (await $.session.id()))
  if (!saved || typeof saved !== 'object') return
  if (Array.isArray(saved.marks)) await update($, marksAtom, () => saved.marks)
  if (saved.highlights && typeof saved.highlights === 'object') await update($, hlAtom, () => saved.highlights)
  if (Array.isArray(saved.auto)) await update($, autoAtom, () => saved.auto)
}

async function clearAll($) {
  await closePick($)
  await update($, marksAtom, () => [])
  await update($, hlAtom, () => ({}))
  cursor = null
}

// ---- auto marks -------------------------------------------------------------------

// How tall a reply is marked by itself (cfg.auto); 0: none is.
async function autoRows($) {
  const n = (await config($)).auto
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_AUTO_ROWS
}

// The row a reply is drawn under now, of those drawn since the module loaded, by its text.
function drawnId(key) {
  let best = null
  for (const [id, s] of seen) {
    if (s.kind === 'assistant' && keysMeet(keyOf(s.text), key) && (!best || s.drawn > best.drawn)) best = { id, drawn: s.drawn }
  }
  return best?.id ?? null
}

// The auto marks worked out again from the conversation. Only the rows they were drawn under carry
// over from the last time, so a jump reaches one not drawn since a reload or a resume.
async function refreshAuto($) {
  const minRows = await autoRows($)
  const rows = minRows ? await $.session.messages() : []
  const gap = Math.max(8, Math.floor(screen.rows / 2))
  const before = await read($, autoAtom)
  const next = (minRows ? autoMarks(rows, { columns: bodyColumns(), minRows, gap }) : []).map(({ index, key }) => ({
    key,
    id: drawnId(key) ?? before.find(a => a.key === key)?.id ?? null,
    snippet: snippetOf(plainOf(rows[index].text)),
  }))
  if (JSON.stringify(next) === JSON.stringify(before)) return next
  await update($, autoAtom, () => next)
  await persist($)
  return next
}

// A new long-reply height for every session (0: none is marked by itself), held at once here.
async function storeAuto($, n) {
  await $.store.set('cfg', { ...(await config($)), auto: n })
  await refreshAuto($)
}

// /mark auto <rows> | on | off; no argument says how it is now.
async function setAuto($, arg) {
  const t = await strings($)
  const n = arg === 'off' ? 0 : arg === 'on' ? DEFAULT_AUTO_ROWS : Number(arg)
  if (!arg || !Number.isInteger(n) || n < 0) return t.autoNow(await autoRows($))
  await storeAuto($, n)
  return n ? t.autoSet(n) : t.autoOff
}

// ---- marks --------------------------------------------------------------------

async function closePick($) {
  if (!(await read($, pickAtom))) return
  await update($, pickAtom, () => null)
  await $.ui.close({ id: PICK_PANE })
}

// A mark on a message that is not one; off a message that is one.
async function toggleMarkOn($, item) {
  await closePick($)
  const t = await strings($)
  const at = await $.clock.now()
  let added = false
  await update($, marksAtom, marks => {
    added = !marks.some(m => m.id === item.id)
    const { id, kind, key, snippet, preview = [] } = item
    return added ? [...marks, { id, kind, key, snippet, preview, at }] : marks.filter(m => m.id !== id)
  })
  await persist($)
  toast($, added ? t.marked(item.snippet) : t.unmarked(item.snippet))
}

// A click on a message's `◆ mark`: that mark off, whichever id it was recorded under.
async function unmark($, id) {
  const s = seen.get(id)
  const key = s && keyOf(s.text)
  const m = (await read($, marksAtom)).find(x => x.id === id || (s && x.kind === s.kind && x.key === key))
  if (m) await toggleMarkOn($, m)
}

// alt+m: a letter over each long reply on screen and each message marked already, or over every
// message when no long reply shows; nothing is marked until one is pressed.
async function markKey($) {
  if (await read($, pickAtom)) return closePick($)
  const t = await strings($)
  const visible = visibleNow()
  const pos = positions(await $.session.messages(), visible)
  const shown = visible.filter(v => pos.has(v.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id))
  if (!shown.length) return toast($, t.noScreen)
  const minRows = (await autoRows($)) || DEFAULT_AUTO_ROWS
  const marks = await read($, marksAtom)
  const isLong = v => v.kind === 'assistant' && (seen.get(v.id)?.onScreen?.of ?? rowsOf(seen.get(v.id)?.text, bodyColumns())) >= minRows
  const isMarked = v => marks.some(m => m.id === v.id || (m.kind === v.kind && m.key === v.key))
  const offered = shown.some(isLong) ? shown.filter(v => isLong(v) || isMarked(v)) : shown
  const items = offered.slice(0, letters.length).map(({ id, kind, key, snippet, preview }) => ({ id, kind, key, snippet, preview }))
  await update($, pickAtom, () => ({ items }))
  await $.ui.open({ id: PICK_PANE, title: t.pickTitle, focus: true, closeOnEscape: true, rows: items.length + 2 })
}

// ---- highlights -----------------------------------------------------------------

async function highlight($) {
  await closePick($)
  const t = await strings($)
  const sel = await $.ui.selection()
  if (!sel) return toast($, t.selectFirst)
  const msg = sel.requestId && seen.get(sel.requestId)
  if (!msg) return toast($, t.oneMessage)
  if (msg.kind !== 'assistant') return toast($, t.onlyReplies)
  const frags = selectionFragments(sel.text)
  if (!frags.length) return toast($, t.tooShort)
  await toggleHighlight($, t, sel.requestId, msg, frags)
}

// /mark hl <words>: the words typed instead of selected, in the latest reply on record that holds
// them (those drawn since the plugin loaded: the ones on screen, and every one written since).
async function highlightWords($, words) {
  await closePick($)
  const t = await strings($)
  const frags = selectionFragments(words)
  if (!frags.length) return toast($, t.tooShort)
  const holding = [...seen].filter(([, s]) => s.kind === 'assistant' && layout(s.text, frags))
  if (!holding.length) return toast($, t.notFound)
  const pos = positions(await $.session.messages(), holding.map(([id, s]) => itemOf(id, s)))
  holding.sort(([a], [b]) => (pos.get(b) ?? -1) - (pos.get(a) ?? -1))
  const [id, msg] = holding[0]
  await toggleHighlight($, t, id, msg, frags)
}

async function toggleHighlight($, t, id, msg, frags) {
  const before = toggleFragments((await read($, hlAtom))[id]?.frags ?? [], frags)
  if (!before.removed && !layout(msg.text, frags)) return toast($, t.notFound)
  await update($, hlAtom, all => {
    const copy = { ...all }
    const { frags: next } = toggleFragments(all[id]?.frags ?? [], frags)
    if (next.length) copy[id] = { key: keyOf(msg.text), snippet: snippetOf(plainOf(msg.text)), text: msg.text, frags: next }
    else delete copy[id]
    return copy
  })
  await persist($)
  toast($, before.removed ? t.unhighlighted : t.highlighted)
}

async function dropFrags($, id, frags) {
  await update($, hlAtom, all => {
    if (!all[id]) return all
    const copy = { ...all }
    const left = all[id].frags.filter(f => !frags.includes(f))
    if (left.length) copy[id] = { ...all[id], frags: left }
    else delete copy[id]
    return copy
  })
  await persist($)
}

// The button over one highlighted block: the fragments lit there go.
async function unhighlight($, id, frags) {
  await dropFrags($, id, frags)
  toast($, (await strings($)).unhighlighted)
}

// ---- jumping --------------------------------------------------------------------

// The ids a message may be on screen under: the one recorded, then every other drawn with its
// text, the latest first.
function idsOf(p) {
  const others = [...seen]
    .filter(([id, s]) => id !== p.id && s.kind === p.kind && keyOf(s.text) === p.key)
    .sort(([, a], [, b]) => b.drawn - a.drawn)
    .map(([id]) => id)
  return [p.id, ...others]
}

// A mark's message comes to the top (under another id of it if the recorded one is gone); a
// highlighted block to the middle, by its key, after its message was brought into the drawn rows
// when the key alone does not reach it.
async function reveal($, p) {
  if (p.block == null) {
    let moved
    for (const id of idsOf(p)) {
      moved = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
      if (!moved?.deny) return moved
    }
    return moved
  }
  const key = blockKey(p.id, p.block)
  const direct = await $.ui.scroll({ to: { key }, block: 'center' })
  if (!direct?.deny) return direct
  const row = await $.ui.scroll({ to: { requestId: p.id }, block: 'start' })
  if (row?.deny) return row
  const again = await $.ui.scroll({ to: { key }, block: 'center' })
  return again?.deny ? row : again
}

const what = p => (p.how === 'highlight' ? snippetOf(p.lit, 40) : p.snippet)
const wordOf = (t, p) => ({ mark: t.markWord, highlight: t.highlightWord, auto: t.autoWord })[p.how]

async function goTo($, p, n, total, wrap = '') {
  const t = await strings($)
  const moved = await reveal($, p)
  if (moved?.deny) return toast($, t.cantScroll(moved.deny))
  cursor = p.tid
  toast($, t.jumped(wordOf(t, p), n, total, wrap, what(p)))
}

// alt+j / alt+k: the next or previous of every mark, highlight and auto mark.
async function jump($, dir) {
  await closePick($)
  const t = await strings($)
  const visible = visibleNow()
  const { placed, pos } = await placedTargets($, visible, true)
  if (!placed.length) {
    const any = (await read($, marksAtom)).length || Object.keys(await read($, hlAtom)).length
    return toast($, any ? t.gone : t.noMarks)
  }
  const hop = jumpTarget(placed.map(p => ({ ...p, id: p.tid })), dir, startFrom(placed, visible, pos))
  const p = placed[hop.index]
  await goTo($, p, hop.index + 1, placed.length, hop.wrapped ? (dir > 0 ? t.wrapFirst : t.wrapLast) : '')
}

// ---- the marks panel ------------------------------------------------------------

// Where the reader was, to come back to when the panel is closed without a jump: the end of the
// last message on screen when its end shows (the reader following the conversation), else the top
// of the first message whose top shows. A row is all $.ui.scroll reaches, so it is that close.
function originOf(visible, pos) {
  const shown = visible.filter(v => pos.has(v.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id))
  if (!shown.length) return null
  const last = shown[shown.length - 1]
  const s = seen.get(last.id)?.onScreen
  if (s && s.last >= s.of - 1) return { id: last.id, block: 'end' }
  const top = shown.find(v => v.first === 0) ?? shown[0]
  return { id: top.id, block: 'start' }
}

// alt+o, /mark: the panel on its marks tab; /mark keys: on its hotkeys tab.
async function openPanel($, tab) {
  await closePick($)
  const t = await strings($)
  const visible = visibleNow()
  const { placed, pos } = await placedTargets($, visible)
  const from = startFrom(placed, visible, pos)
  const at = from ? placed.findIndex(p => p.pos >= from.pos) : 0
  const start = placed[at < 0 ? placed.length - 1 : at]
  const origin = originOf(visible, pos)
  await update($, panelAtom, () => ({ tab, mode: 'jump', cursor: start?.tid ?? null, origin, confirmClear: false }))
  await update($, keysAtom, () => ({ pending: null, note: null, tone: null }))
  await $.ui.open({ id: PANEL, title: t.panelTitle, focus: true, closeOnEscape: true, columns: 64 })
  // the entry the reader is at, in view with as little scrolling as shows it: the tabs and the
  // hint above it stay in sight whenever it fits under them
  if (start && tab === 'marks') {
    await $.ui.scroll({ in: PANEL, to: { key: entryKey(start.tid) }, block: 'nearest' }).catch(() => undefined)
  }
}

// alt+o: the panel opens, or, open, closes as Escape closes it (back to where it was opened).
async function togglePanel($) {
  const panel = await read($, panelAtom)
  if (!panel) return openPanel($, 'marks')
  await update($, panelAtom, () => null)
  await $.ui.close({ id: PANEL })
  if (panel.origin) await $.ui.scroll({ to: { requestId: panel.origin.id }, block: panel.origin.block }).catch(() => undefined)
}

// The marks tab's last button, pressed twice: every mark and highlight of the session gone.
async function pressClearAll($) {
  const panel = await read($, panelAtom)
  if (!panel?.confirmClear) return update($, panelAtom, x => x && { ...x, confirmClear: true })
  await clearAll($)
  await persist($)
  await update($, panelAtom, x => x && { ...x, confirmClear: false, cursor: null })
  toast($, (await strings($)).cleared)
}

// Enter, a letter or a click on an entry: the jump is made, and the panel closes. In delete mode
// the entry goes instead, and the panel stays.
async function pressEntry($, tid) {
  const panel = await read($, panelAtom)
  const { placed } = await placedTargets($)
  const i = placed.findIndex(p => p.tid === tid)
  if (i < 0) return
  const p = placed[i]
  if (panel?.mode === 'delete') return deleteTarget($, p)
  await update($, panelAtom, () => null)
  await $.ui.close({ id: PANEL })
  await goTo($, p, i + 1, placed.length)
}

async function deleteTarget($, p) {
  const t = await strings($)
  if (p.how === 'mark') {
    await update($, marksAtom, ms => ms.filter(m => m.id !== p.id))
    await persist($)
  } else await dropFrags($, p.id, p.frags)
  await update($, panelAtom, x => x && { ...x, mode: 'jump' })
  toast($, t.deleted(what(p)))
}

// j / k: the cursor (the panel's focus ring) to the next or previous entry, kept in view, and the
// conversation shown there as a preview: Escape goes back to where the panel was opened.
async function moveCursor($, dir) {
  const panel = await read($, panelAtom)
  if (!panel) return
  const { placed } = await placedTargets($)
  if (!placed.length) return
  const i = placed.findIndex(p => p.tid === panel.cursor)
  const at = i < 0 ? 0 : Math.min(placed.length - 1, Math.max(0, i + dir))
  const p = placed[at]
  await update($, panelAtom, x => x && { ...x, cursor: p.tid })
  await $.ui.focus({ requestId: PANEL, key: entryKey(p.tid) })
  // on the first entry, the panel's top (its tabs and hint) comes back into sight too
  const to = at === 0 ? 'start' : { key: entryKey(p.tid) }
  await $.ui.scroll({ in: PANEL, to, block: 'nearest' }).catch(() => undefined)
  await reveal($, p)
}

// ---- settings -------------------------------------------------------------------

async function setColor($, arg) {
  const t = await strings($)
  const color = arg === 'reset' ? DEFAULT_COLOR : arg
  if (!COLOR.test(color ?? '')) return t.colorNow(await read($, colorAtom))
  await $.store.set('cfg', { ...(await config($)), color })
  await update($, colorAtom, () => color)
  return t.colorSet(color)
}

async function setLang($, arg) {
  if (!LANGS.includes(arg)) return (await strings($)).langNow
  await $.store.set('cfg', { ...(await config($)), lang: arg })
  await update($, langAtom, () => arg)
  await registerCommands($)
  return STRINGS[arg].langSet
}

// ---- hotkeys ------------------------------------------------------------------

async function bindingsPath($) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
  return `${dir.replace(/\\/g, '/')}/keybindings.json`
}

// keybindings.json as an object: {} when there is none, null when it is there and not JSON.
async function readBindings($, path) {
  let text
  try {
    text = await $.fs.read(path)
  } catch {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const note = ($, text, tone) => update($, keysAtom, k => ({ ...(k ?? {}), pending: null, note: text, tone }))

// Who else answers a chord, in words: one of this mod's rows, the file's own binding, Claude Code's.
function describe(t, user) {
  const slot = GLOBAL_SLOTS.find(s => ACTIONS[s] === user.action)
  if (slot) return t.ourAction(t.slots[slot])
  return user.key ? t.yourBinding(user.action) : t.claudeAction(user.action)
}

// The settings tab edits one row at a time. A hotkey: ctrl / alt / shift toggles and a one-letter
// field, then Save (or Enter in the field). A pane's keys carry no modifiers, so the modifiers are
// chosen, not pressed; everything is reachable from the keyboard (Tab, Enter, typing) as well as by
// a click. The long-reply height: a field of digits, then Save, Off or Default.

const MODS = ['ctrl', 'alt', 'shift']
const LETTER = 'chat-marks-key-letter'
const ROWS_FIELD = 'chat-marks-auto-rows'

// A row picked for editing: its chord as it is now in the toggles and the field (alt, for a row
// with none), or the height as it is now, the field holding the keyboard.
async function armSlot($, slot) {
  if (SETTING_SLOTS.includes(slot)) {
    const rows = String(await autoRows($))
    await update($, keysAtom, k => ({ ...(k ?? {}), armed: slot, mods: {}, rows, pending: null, note: null, tone: null }))
    await $.ui.focus({ requestId: PANEL, key: ROWS_FIELD }).catch(() => undefined)
    await $.ui.scroll({ in: PANEL, to: 'start' }).catch(() => undefined)
    return
  }
  const doc = GLOBAL_SLOTS.includes(slot) ? await readBindings($, await bindingsPath($)) : null
  const chord = PANEL_SLOTS.includes(slot) ? keys[slot] : doc && chordFor(doc, ACTIONS[slot])
  const parts = chord ? chord.split('+') : []
  const letter = parts.pop() ?? ''
  const mods = PANEL_SLOTS.includes(slot) ? {} : chord ? Object.fromEntries(MODS.map(m => [m, parts.includes(m)])) : { alt: true }
  await update($, keysAtom, k => ({ ...(k ?? {}), armed: slot, mods, letter, pending: null, note: null, tone: null }))
  await $.ui.focus({ requestId: PANEL, key: LETTER }).catch(() => undefined)
  await $.ui.scroll({ in: PANEL, to: 'start' }).catch(() => undefined)
}

const disarm = ($, text, tone) => update($, keysAtom, k => ({ ...(k ?? {}), armed: null, pending: null, note: text, tone }))

// The field keeps one letter or digit: the last one typed.
const letterOf = value => {
  const c = String(value ?? '').toLowerCase().slice(-1)
  return /^[a-z0-9]$/.test(c) ? c : ''
}

const chordOfEdit = state => canon([...MODS.filter(m => state.mods?.[m]), state.letter].join('+'))

// The height field keeps up to three digits.
const digitsOf = value => String(value ?? '').replace(/\D/g, '').slice(0, 3)

// Save on the height row: the field's number (0: off), or `n` from its Off / Default buttons.
async function saveRows($, n) {
  const t = await strings($)
  const typed = (await read($, keysAtom))?.rows ?? ''
  const rows = n ?? (typed === '' ? null : Number(typed))
  if (rows == null) return note($, t.needRows, 'error')
  await storeAuto($, rows)
  await disarm($, t.saved(t.slots.auto, rows ? t.rowsValue(rows) : t.autoOffValue), 'ok')
}

// Save: a chord into keybindings.json, or a key of the panel's own.
async function saveKey($) {
  const t = await strings($)
  const state = await read($, keysAtom)
  const slot = state?.armed
  if (!slot) return
  if (!state.letter) return note($, t.needLetter, 'error')
  if (PANEL_SLOTS.includes(slot)) return setPanelKey($, t, slot, state.letter)
  const chord = chordOfEdit(state)
  const problem = globalProblem(chord)
  if (problem) return note($, problem.reserved ? t.reserved(chord, problem.reserved) : t.needsModifier(chord), 'error')
  const path = await bindingsPath($)
  const doc = await readBindings($, path)
  if (doc === null) return disarm($, t.badFile(path), 'error')
  const action = ACTIONS[slot]
  const others = usersOf(doc, chord, action)
  // something else answers it: say what, and take it over only on a second Save of the same chord
  if (others.length && !(state.pending?.slot === slot && state.pending.chord === chord)) {
    await update($, keysAtom, k => ({ ...(k ?? {}), pending: { slot, chord }, note: t.takeOver(chord, describe(t, others[0])), tone: 'warn' }))
    return
  }
  await $.fs.write(path, JSON.stringify(rebind(doc, action, chord).doc, null, 2) + '\n')
  await disarm($, t.saved(t.slots[slot], chord), 'ok')
}

async function setPanelKey($, t, slot, key) {
  const clash = PANEL_SLOTS.find(s => s !== slot && keys[s] === key)
  if (clash) return note($, t.panelKeyTaken(key, t.slots[clash]), 'error')
  const cfg = await config($)
  const saved = { ...keys, [slot]: key }
  await $.store.set('cfg', { ...cfg, keys: saved })
  usePanelKeys(saved)
  await disarm($, t.saved(t.slots[slot], key), 'ok')
}

async function clearSlot($, slot) {
  const t = await strings($)
  if (PANEL_SLOTS.includes(slot)) return setPanelKey($, t, slot, DEFAULT_PANEL_KEYS[slot])
  const path = await bindingsPath($)
  const doc = await readBindings($, path)
  if (doc === null) return disarm($, t.badFile(path), 'error')
  await $.fs.write(path, JSON.stringify(unbind(doc, ACTIONS[slot]), null, 2) + '\n')
  await disarm($, t.cleared1(t.slots[slot]), 'ok')
}

// Three sessions in a row with none of the chords bound say how to set them, then it stops.
async function hintSetup($) {
  const cfg = await config($)
  if ((cfg.hints ?? 0) >= 3) return
  const doc = await readBindings($, await bindingsPath($))
  if (!doc || GLOBAL_SLOTS.some(s => chordFor(doc, ACTIONS[s]))) return
  await $.store.set('cfg', { ...cfg, hints: (cfg.hints ?? 0) + 1 })
  toast($, (await strings($)).setupHint)
}

async function registerCommands($) {
  const t = await strings($)
  await $.command.register({
    name: 'mark',
    description: t.markDescription,
    argumentHint: '[keys|next|prev|add|hl|auto <rows>|off|color <#rrggbb>|lang en|zh]',
    immediate: true,
  })
  await $.command.register({ name: 'mark-clear', description: t.clearDescription, immediate: true })
}

// ---- drawing ------------------------------------------------------------------

// The row above a message. While alt+m's letters are up: its letter, amber, or red with "unmark?"
// beside it when the message is marked already. Otherwise `◆ mark` on a marked one, which a click
// takes off (the pointer over it says so), or a dim `◇` on an auto mark. Null for none.
function headLine($, e, t, color, label, isMarked, isAuto) {
  if (!label && !isMarked && !isAuto) return null
  const { Box, Button, Text } = $.ui.resolve(e)
  const parts = []
  if (label) {
    parts.push(Text({ backgroundColor: isMarked ? UNMARK_COLOR : color, color: 'white', weight: 'bold', children: [` ${label} `] }))
    if (isMarked) parts.push(Text({ color: 'error', children: [' ' + t.unmarkPrefix.trim()] }))
  } else if (!isMarked) {
    parts.push(Text({ dimColor: true, children: ['◇'] }))
  } else {
    parts.push(Button({
      key: `chat-marks-unmark-${e.requestId}`,
      label: '◆ mark',
      plain: true,
      onPress: safe($, () => unmark($, e.requestId)),
      children: [Text({ color: 'warning', children: ['◆ mark'] })],
    }))
    parts.push(Box({ display: 'none', hover: { display: 'flex' }, children: [Text({ dimColor: true, children: [t.clickToRemove] })] }))
  }
  return Box({ key: `chat-marks-head-${e.requestId}`, flexDirection: 'row', children: parts })
}

function runStyle(r, code, color) {
  const s = {}
  if (r.bold) s.weight = 'bold'
  if (r.italic) s.italic = true
  if (r.link) s.underline = true
  if (r.code || code) s.color = 'permission'
  if (r.hl) Object.assign(s, { backgroundColor: color, color: 'white' })
  return s
}

// A reply with highlights, drawn as the engine draws one: a bullet column, then the body; the
// blocks without a highlight stay Markdown. While the pointer is over a highlighted block, a button
// that takes it off sits on the row just above it (the blank row between blocks, painted over, so
// nothing moves; the pointer on the button still counts as over the block).
function drawReply($, e, t, parts, head, color) {
  const { Box, Button, Markdown, Text } = $.ui.resolve(e)
  const body = parts.map((p, i) => {
    if (p.type === 'md') return Markdown({ text: p.text })
    const runsText = runs => Text({
      children: runs.length ? runs.map(r => Text({ ...runStyle(r, p.code, color), children: [r.text] })) : [' '],
    })
    // a line at a time, so a list item's wrapped rows hang under its text, not under its marker
    const lines = linesOf(p.runs).map(line => {
      const hang = p.code ? 0 : hangOf(line)
      if (!hang) return runsText(line)
      const [marker, rest] = splitAt(line, hang)
      return Box({
        flexDirection: 'row',
        children: [Box({ width: hang, flexShrink: 0, children: [runsText(marker)] }), Box({ flexShrink: 1, children: [runsText(rest)] })],
      })
    })
    return Box({
      key: blockKey(e.requestId, i),
      flexDirection: 'column',
      children: [
        ...lines,
        Box({
          position: 'absolute',
          top: -1,
          left: 0,
          display: 'none',
          hover: { display: 'flex' },
          children: [
            Button({
              key: `chat-marks-unhl-${e.requestId}-${i}`,
              label: t.removeHighlight,
              onPress: safe($, () => unhighlight($, e.requestId, p.frags)),
            }),
          ],
        }),
      ],
    })
  })
  return Box({
    flexDirection: 'column',
    marginTop: 1,
    children: [
      ...(head ? [head] : []),
      Box({
        flexDirection: 'row',
        children: [
          Box({ minWidth: 2, children: [Text({ children: [e.props.isFirstOfReply ? '●' : ' '] })] }),
          Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, gap: 1, children: body }),
        ],
      }),
    ],
  })
}

// Whether a mark or a picked item is this row: by its id, or by its text, since one message can be
// drawn under two ids and the one recorded may not be the one on screen.
const isRow = (e, kind) => {
  const key = keyOf(e.props.text)
  return it => it.id === e.requestId || (it.kind === kind && it.key === key)
}

async function headFor($, e, t, kind) {
  const marks = await read($, marksAtom)
  const pick = await read($, pickAtom)
  const color = await read($, colorAtom)
  const auto = await read($, autoAtom)
  const n = pick ? pick.items.findIndex(isRow(e, kind)) : -1
  const key = keyOf(e.props.text)
  const isAuto = kind === 'assistant' && auto.some(a => a.id === e.requestId || keysMeet(a.key, key))
  return headLine($, e, t, color, n >= 0 ? letters[n] : null, marks.some(isRow(e, kind)), isAuto)
}

function withHead($, e, head, theirs) {
  if (!head || !theirs) return theirs
  const { Box } = $.ui.resolve(e)
  return Box({ flexDirection: 'column', children: [head, theirs] })
}

// One entry of the marks panel: a letter, then the mark's first lines or the lit words.
function drawEntry($, e, t, p, i, cursorTid, color) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const room = Math.max(16, e.props.bodyColumns - 6)
  const who = p.kind === 'user' ? t.you : 'Claude'
  const head = p.how === 'mark'
    ? [Text({ color: 'warning', children: ['◆ '] }), Text({ children: [`[${who}] ${snippetOf(p.preview[0] ?? p.snippet, room - 12)}`] })]
    : [Text({ backgroundColor: color, color: 'white', children: [snippetOf(p.lit, room)] })]
  const under = p.how === 'mark'
    ? p.preview.slice(1).map(l => Text({ dimColor: true, children: ['   ' + snippetOf(l, room)] }))
    : [Text({ dimColor: true, children: ['   ' + t.inReply(snippetOf(p.snippet, room - 6))] })]
  return Box({
    flexDirection: 'column',
    children: [
      Button({
        key: entryKey(p.tid),
        label: what(p),
        plain: true,
        ...(letters[i] ? { hotkey: letters[i] } : {}),
        ...(p.tid === cursorTid ? { autoFocus: true } : {}),
        onPress: safe($, () => pressEntry($, p.tid)),
        children: head,
      }),
      ...under,
    ],
  })
}

// The marks tab: every mark and highlight in conversation order, then "delete all".
async function drawMarksTab($, e, t, panel) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const color = await read($, colorAtom)
  const { placed } = await placedTargets($)
  const isDeleting = panel?.mode === 'delete'
  const hint = !placed.length ? t.panelEmpty : isDeleting ? t.panelDelete : t.panelJump
  const hidden = Box({
    display: 'none',
    children: [
      Button({ key: 'chat-marks-down', label: 'down', hotkey: keys.down, onPress: safe($, () => moveCursor($, 1)) }),
      Button({ key: 'chat-marks-up', label: 'up', hotkey: keys.up, onPress: safe($, () => moveCursor($, -1)) }),
      Button({
        key: 'chat-marks-delete',
        label: 'delete',
        hotkey: keys.remove,
        onPress: safe($, () => update($, panelAtom, x => x && { ...x, mode: x.mode === 'delete' ? 'jump' : 'delete' })),
      }),
    ],
  })
  const clearAllButton = Button({
    key: 'chat-marks-clear-all',
    label: panel?.confirmClear ? t.clearConfirm : t.clearAll,
    hotkey: '0',
    plain: true,
    ...(panel?.confirmClear ? {} : { dimColor: true }),
    onPress: safe($, () => pressClearAll($)),
  })
  return [
    Text(isDeleting ? { color: 'error', children: [hint] } : { dimColor: true, children: [hint] }),
    ...placed.map((p, i) => drawEntry($, e, t, p, i, panel?.cursor, color)),
    ...(placed.length ? [clearAllButton] : []),
    hidden,
  ]
}

// The settings tab: the long-reply height, then a row per action with the chord it has now; above
// the rows, while one is picked, its editor: the modifier toggles and the letter field (or the
// height field), its buttons, and what Save writes.
async function drawKeysTab($, e, t) {
  const { Box, Button, Input, Text } = $.ui.resolve(e)
  const state = await read($, keysAtom)
  const doc = await readBindings($, await bindingsPath($))
  const height = await autoRows($)
  const slots = [...SETTING_SLOTS, ...GLOBAL_SLOTS, ...PANEL_SLOTS]
  const current = slot => {
    if (slot === 'auto') return height ? t.rowsValue(height) : t.autoOffValue
    return (PANEL_SLOTS.includes(slot) ? keys[slot] : doc && chordFor(doc, ACTIONS[slot])) || ''
  }
  const armed = state?.armed ?? null
  // a row: the action and its chord, and under it, dim, what the chord does
  const row = (slot, i) => Box({
    flexDirection: 'column',
    children: [
      Button({
        key: 'chat-marks-key-row-' + slot,
        label: t.slots[slot],
        plain: true,
        // while editing, letters are typed into the field: the rows give up theirs
        ...(armed ? {} : { hotkey: LETTERS[i] }),
        ...(armed === slot ? { variant: 'primary' } : {}),
        onPress: safe($, () => armSlot($, slot)),
        children: [
          Text({ children: [padCells(t.slots[slot], 24)] }),
          current(slot) ? Text({ children: [current(slot)] }) : Text({ dimColor: true, children: [t.notSet] }),
        ],
      }),
      Text({ dimColor: true, children: ['   ' + t.slotHelp[slot]] }),
    ],
  })
  const isGlobal = GLOBAL_SLOTS.includes(armed)
  const toggle = mod => Button({
    key: 'chat-marks-mod-' + mod,
    label: `${state.mods?.[mod] ? '[x]' : '[ ]'} ${mod}`,
    plain: true,
    ...(state.mods?.[mod] ? { variant: 'primary' } : { dimColor: true }),
    onPress: safe($, () => update($, keysAtom, k => k && { ...k, mods: { ...k.mods, [mod]: !k.mods?.[mod] }, pending: null })),
  })
  const action = (key, label, fn) => Button({ key, label, onPress: safe($, fn) })
  const typed = state?.rows ?? ''
  const rowsEditor = () => Box({
    flexDirection: 'column',
    borderStyle: 'round',
    paddingX: 1,
    children: [
      Text({ weight: 'bold', children: [t.editing(t.slots.auto)] }),
      Input({
        key: ROWS_FIELD,
        label: t.rowsLabel,
        value: typed,
        placeholder: String(DEFAULT_AUTO_ROWS),
        submitLabel: t.save,
        autoFocus: true,
        onInput: value => update($, keysAtom, k => k && { ...k, rows: digitsOf(value) }),
        onSubmit: safe($, async value => {
          await update($, keysAtom, k => k && { ...k, rows: digitsOf(value) || k.rows })
          await saveRows($)
        }),
      }),
      Box({
        flexDirection: 'row',
        gap: 2,
        children: [
          action('chat-marks-auto-save', t.save, () => saveRows($)),
          action('chat-marks-auto-off', t.turnOff, () => saveRows($, 0)),
          action('chat-marks-auto-default', t.resetKey, () => saveRows($, DEFAULT_AUTO_ROWS)),
          action('chat-marks-key-cancel', t.cancel, () => disarm($, null, null)),
        ],
      }),
      Text({ dimColor: true, children: [t.willSave(typed === '' ? '—' : Number(typed) ? t.rowsValue(Number(typed)) : t.autoOffValue)] }),
    ],
  })
  const editor = SETTING_SLOTS.includes(armed)
    ? rowsEditor()
    : armed
    ? Box({
        flexDirection: 'column',
        borderStyle: 'round',
        paddingX: 1,
        children: [
          Text({ weight: 'bold', children: [t.editing(t.slots[armed])] }),
          Box({
            flexDirection: 'row',
            gap: 2,
            children: [
              ...(isGlobal ? MODS.map(toggle) : []),
              Input({
                key: LETTER,
                label: t.letterLabel,
                value: state.letter ?? '',
                placeholder: 'm',
                submitLabel: t.save,
                autoFocus: true,
                onInput: value => update($, keysAtom, k => k && { ...k, letter: letterOf(value), pending: null }),
                onSubmit: safe($, async value => {
                  await update($, keysAtom, k => k && { ...k, letter: letterOf(value) || k.letter })
                  await saveKey($)
                }),
              }),
            ],
          }),
          Box({
            flexDirection: 'row',
            gap: 2,
            children: [
              action('chat-marks-key-save', t.save, () => saveKey($)),
              action('chat-marks-key-clear', isGlobal ? t.clearKey : t.resetKey, () => clearSlot($, armed)),
              action('chat-marks-key-cancel', t.cancel, () => disarm($, null, null)),
            ],
          }),
          Text({ dimColor: true, children: [t.willSave(state.letter ? (isGlobal ? chordOfEdit(state) : state.letter) : '—')] }),
        ],
      })
    : null
  const tone = { ok: 'success', warn: 'warning', error: 'error' }[state?.tone]
  // the editor and the last note go above the list, where the panel opens: a short pane shows
  // them with the tabs, not scrolled out of sight under the rows
  return [
    Text({ dimColor: true, children: [t.keysHint] }),
    ...(editor ? [editor] : []),
    ...(state?.note ? [Text({ ...(tone ? { color: tone } : {}), children: [state.note] })] : []),
    Box({ flexDirection: 'column', gap: 1, children: SETTING_SLOTS.map(s => row(s, slots.indexOf(s))) }),
    Box({ flexDirection: 'column', gap: 1, children: GLOBAL_SLOTS.map(s => row(s, slots.indexOf(s))) }),
    Box({ flexDirection: 'column', gap: 1, children: PANEL_SLOTS.map(s => row(s, slots.indexOf(s))) }),
  ]
}

// ---- register -----------------------------------------------------------------

export function register(on) {
  on('session.start', async ($, e, next) => {
    await restore($)
    await registerCommands($)
    await hintSetup($)
    await refreshAuto($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await clearAll($)
      await update($, autoAtom, () => [])
      seen.clear()
    }
    return next(e)
  })

  // A turn of the conversation's own (not an agent's) ended: its long replies become auto marks.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) await refreshAuto($)
    return done
  })

  on('prompt.submit', async ($, e, next) => {
    await closePick($)
    return next(e)
  })

  on('ui.close', { id: PICK_PANE }, async ($, e, next) => {
    await update($, pickAtom, () => null)
    return next(e)
  })

  // Escape (or the close mark) with no jump made: back to where the panel was opened.
  on('ui.close', { id: PANEL }, async ($, e, next) => {
    const panel = await read($, panelAtom)
    await update($, panelAtom, () => null)
    await update($, keysAtom, () => null)
    const closed = await next(e)
    if (e.origin.kind === 'person' && panel?.origin) {
      await $.ui.scroll({ to: { requestId: panel.origin.id }, block: panel.origin.block }).catch(() => undefined)
    }
    return closed
  })

  // The panel's cursor follows its focus ring, however the person moved it (Tab, a click).
  on('ui.focus', async ($, e, next) => {
    if (e.requestId === PANEL && e.element?.startsWith(ENTRY)) {
      const tid = e.element.slice(ENTRY.length)
      await update($, panelAtom, x => x && { ...x, cursor: tid })
    }
    return next(e)
  })

  on('command.run', { command: 'mark-clear' }, async $ => {
    await clearAll($)
    await persist($)
    return { text: (await strings($)).cleared }
  })

  on('command.run', { command: 'mark' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = verb.toLowerCase()
    const value = (rest[0] ?? '').toLowerCase()
    if (arg === 'keys' || arg === 'settings') await openPanel($, 'keys')
    else if (arg === 'next' || arg === 'j') await jump($, 1)
    else if (arg === 'prev' || arg === 'k') await jump($, -1)
    else if (arg === 'add' || arg === 'm') await markKey($)
    else if ((arg === 'hl' || arg === 'y') && rest.length) await highlightWords($, rest.join(' '))
    else if (arg === 'hl' || arg === 'y') await highlight($)
    else if (arg === 'auto') return { text: await setAuto($, value) }
    else if (arg === 'color') return { text: await setColor($, value) }
    else if (arg === 'lang') return { text: await setLang($, value) }
    else if (arg === 'clear') {
      await clearAll($)
      await persist($)
      return { text: (await strings($)).cleared }
    } else await openPanel($, 'marks')
    return {}
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    remember(e, 'user')
    return withHead($, e, await headFor($, e, await strings($), 'user'), await next(e))
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    remember(e, 'assistant')
    const t = await strings($)
    const head = await headFor($, e, t, 'assistant')
    const frags = (await read($, hlAtom))[e.requestId]?.frags
    const parts = frags && !e.props.isSummary ? layout(e.props.text, frags) : null
    if (parts) return drawReply($, e, t, parts, head, await read($, colorAtom))
    return withHead($, e, head, await next(e))
  })

  // alt+m's letters: one per message on screen, the same letter over the message itself.
  on('ui.render', { component: 'Pane', requestId: PICK_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const t = await strings($)
    const pickState = await read($, pickAtom)
    const marks = await read($, marksAtom)
    const room = Math.max(16, e.props.bodyColumns - 14)
    const rows = (pickState?.items ?? []).map((it, i) => {
      const isMarked = marks.some(m => m.id === it.id)
      const text = `[${it.kind === 'user' ? t.you : 'Claude'}] ${snippetOf(it.snippet, room)}`
      return Button({
        key: `${PICK_PANE}-${i}`,
        hotkey: letters[i],
        plain: true,
        label: (isMarked ? t.unmarkPrefix : '') + text,
        onPress: safe($, () => toggleMarkOn($, it)),
        children: isMarked ? [Text({ color: 'error', children: [t.unmarkPrefix] }), Text({ children: [text] })] : [text],
      })
    })
    return Box({ flexDirection: 'column', children: [Text({ dimColor: true, children: [t.pickHint] }), ...rows] })
  })

  // The panel: its tabs (1 marks, 2 hotkeys), then the tab shown.
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Button } = $.ui.resolve(e)
    const t = await strings($)
    const panel = await read($, panelAtom)
    const tab = panel?.tab ?? 'marks'
    // while a hotkey row waits for its key, the digits are its modifiers: the tabs give them up
    const isWaiting = tab === 'keys' && !!(await read($, keysAtom))?.armed
    const tabButton = (name, hotkey, label) => Button({
      key: 'chat-marks-tab-' + name,
      label,
      ...(isWaiting ? {} : { hotkey }),
      plain: true,
      ...(tab === name ? { variant: 'primary' } : { dimColor: true }),
      // the focus ring was on an element of the tab going away: keep it in the panel, on this tab,
      // or the panel loses the keyboard and 1 / 2 stop answering
      onPress: safe($, async () => {
        await update($, panelAtom, x => x && { ...x, tab: name, mode: 'jump', confirmClear: false })
        await $.ui.focus({ requestId: PANEL, key: 'chat-marks-tab-' + name }).catch(() => undefined)
      }),
    })
    // the panel's chord again while the panel holds the keyboard: a pane's Button takes it first
    const toggle = Box({
      display: 'none',
      children: [Button({ key: 'chat-marks-panel-close', label: 'close', action: ACTIONS.panel, onPress: safe($, () => togglePanel($)) })],
    })
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        Box({ flexDirection: 'row', gap: 2, children: [tabButton('marks', '1', t.tabMarks), tabButton('keys', '2', t.tabKeys)] }),
        ...(tab === 'keys' ? await drawKeysTab($, e, t) : await drawMarksTab($, e, t, panel)),
        toggle,
      ],
    })
  })

  // The Buttons that carry the chords (see ACTIONS), hidden in the hint line under the prompt.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const theirs = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const chord = (key, action, fn) => Button({ key, label: key, action, onPress: safe($, fn) })
    const chords = Box({
      display: 'none',
      children: [
        chord('chat-marks-mark', ACTIONS.mark, () => markKey($)),
        chord('chat-marks-next', ACTIONS.next, () => jump($, 1)),
        chord('chat-marks-prev', ACTIONS.prev, () => jump($, -1)),
        chord('chat-marks-hl', ACTIONS.highlight, () => highlight($)),
        chord('chat-marks-panel', ACTIONS.panel, () => togglePanel($)),
      ],
    })
    return Box({ flexDirection: 'row', children: theirs ? [theirs, chords] : [chords] })
  })
}

