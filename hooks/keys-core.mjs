// chat-marks hotkeys: chords as keybindings.json spells them, what else answers one, and
// keybindings.json rewritten so a chord runs one of the mod's actions. No `$` here, so
// `node --test` runs it.

export const SCHEMA = 'https://www.schemastore.org/claude-code-keybindings.json'
export const DOCS = 'https://code.claude.com/docs/en/keybindings'

// Chords a terminal cannot deliver apart from another key, or that Claude Code keeps for itself.
export const RESERVED = {
  'ctrl+c': 'interrupt',
  'ctrl+d': 'exit',
  'ctrl+m': 'the same key as Enter',
  'ctrl+[': 'the same key as Escape',
  'ctrl+i': 'the same key as Tab',
  'ctrl+h': 'the same key as Backspace',
  'ctrl+z': 'suspend',
  'ctrl+\\': 'quit',
  'ctrl+x': "the prefix of Claude Code's ctrl+x chords",
}

// Claude Code's own one-step chords with a modifier: [context, action]. Taking one over unbinds it.
export const DEFAULTS = {
  'ctrl+t': ['Global', 'app:toggleTodos'],
  'ctrl+o': ['Global', 'app:toggleTranscript'],
  'ctrl+shift+b': ['Global', 'app:toggleBrief'],
  'ctrl+up': ['Global', 'app:diffFileListUp'],
  'ctrl+down': ['Global', 'app:diffFileListDown'],
  'alt+up': ['Global', 'app:diffFileListUp'],
  'alt+down': ['Global', 'app:diffFileListDown'],
  'ctrl+]': ['Global', 'app:openArtifact'],
  'ctrl+r': ['Global', 'history:search'],
  'alt+p': ['Chat', 'chat:modelPicker'],
  'alt+o': ['Chat', 'chat:fastMode'],
  'alt+t': ['Chat', 'chat:thinkingToggle'],
  'alt+w': ['Chat', 'chat:workflowKeywordToggle'],
  'alt+v': ['Chat', 'chat:imagePaste'],
  'ctrl+y': ['Chat', 'chat:defaultToNewerModel'],
  'ctrl+enter': ['Chat', 'chat:sendNow'],
  'ctrl+j': ['Chat', 'chat:newline'],
  'ctrl+_': ['Chat', 'chat:undo'],
  'ctrl+-': ['Chat', 'chat:undo'],
  'ctrl+g': ['Chat', 'chat:externalEditor'],
  'ctrl+s': ['Chat', 'chat:stash'],
  'ctrl+l': ['Chat', 'chat:clearInput'],
  'ctrl+b': ['Task', 'task:background'],
}

// One spelling per chord: `meta` and `opt` are the terminal's alt, modifiers in a fixed order.
export function canon(chord) {
  const parts = String(chord).toLowerCase().split('+')
  const key = parts.pop()
  const mods = new Set(parts.map(m => (m === 'meta' || m === 'opt' || m === 'option' ? 'alt' : m === 'control' ? 'ctrl' : m)))
  return [...['ctrl', 'alt', 'shift'].filter(m => mods.has(m)), key].join('+')
}

// Why a chord cannot be a global hotkey (null when it can): it needs ctrl or alt, so typing is safe.
export function globalProblem(chord) {
  if (RESERVED[chord]) return { reserved: RESERVED[chord] }
  if (!/^(ctrl|alt)\+/.test(chord)) return { needsModifier: true }
  return null
}

// A key for inside the panel: one lowercase letter or digit, no modifier.
export const isPanelKey = chord => /^[a-z0-9]$/.test(chord)

const blocksOf = doc => (Array.isArray(doc?.bindings) ? doc.bindings : [])

// The chord bound to `action` in keybindings.json, or null.
export function chordFor(doc, action) {
  for (const b of blocksOf(doc)) {
    for (const [k, v] of Object.entries(b?.bindings ?? {})) if (v === action) return canon(k)
  }
  return null
}

// What else answers `chord`: the file's own bindings of it, and Claude Code's default when the
// file has not already unbound it. [{ context, action, key? }]
export function usersOf(doc, chord, action) {
  const c = canon(chord)
  const out = []
  let unbound = false
  for (const b of blocksOf(doc)) {
    for (const [k, v] of Object.entries(b?.bindings ?? {})) {
      if (canon(k) !== c) continue
      if (v === null && DEFAULTS[c]?.[0] === b.context) unbound = true
      else if (v !== null && v !== action) out.push({ context: b.context, action: v, key: k })
    }
  }
  if (DEFAULTS[c] && !unbound) out.push({ context: DEFAULTS[c][0], action: DEFAULTS[c][1] })
  return out
}

// keybindings.json with `chord` (canonical) running `action` in Global, the action's old chords
// gone, and whatever else answered the chord taken off it: the file's own bindings removed,
// Claude Code's default unbound with null. A new object; `doc` is left alone.
export function rebind(doc, action, chord) {
  const out = JSON.parse(JSON.stringify(doc && typeof doc === 'object' ? doc : {}))
  out.$schema ??= SCHEMA
  out.$docs ??= DOCS
  if (!Array.isArray(out.bindings)) out.bindings = []
  const block = context => {
    let b = out.bindings.find(x => x?.context === context)
    if (!b) out.bindings.push((b = { context, bindings: {} }))
    if (!b.bindings || typeof b.bindings !== 'object') b.bindings = {}
    return b
  }
  const taken = usersOf(out, chord, action)
  for (const b of out.bindings) {
    for (const [k, v] of Object.entries(b?.bindings ?? {})) {
      if (v === action || (canon(k) === chord && v !== null)) delete b.bindings[k]
    }
  }
  for (const u of taken) if (!u.key) block(u.context).bindings[chord] = null
  block('Global').bindings[chord] = action
  return { doc: out, taken }
}

// keybindings.json without any chord for `action`.
export function unbind(doc, action) {
  const out = JSON.parse(JSON.stringify(doc && typeof doc === 'object' ? doc : {}))
  for (const b of blocksOf(out)) {
    for (const [k, v] of Object.entries(b?.bindings ?? {})) if (v === action) delete b.bindings[k]
  }
  return out
}
