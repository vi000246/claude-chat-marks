import { expect, mock, test } from 'claude-code/testing'

// The chords press hidden Buttons in the hint line; here the tests press them by key.

const AMBER = '#6b4f00'
const KEYFILE = '/home/me/.claude/keybindings.json'

const HINT = {
  plugin: 'chat-marks',
  component: 'PromptHint',
  requestId: 'hint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const pane = (requestId: string) => ({
  plugin: 'chat-marks',
  component: 'Pane',
  requestId,
  surface: 'terminal',
  props: { title: requestId, isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
}) as const

const reply = (requestId: string, text: string, onScreen: unknown = null) => ({
  plugin: 'chat-marks',
  component: 'AssistantMessage',
  requestId,
  surface: 'terminal',
  props: { text, isFirstOfReply: true, onScreen },
}) as const

const prompt = (requestId: string, text: string, onScreen: unknown = null) => ({
  plugin: 'chat-marks',
  component: 'UserMessage',
  requestId,
  surface: 'terminal',
  props: { text, origin: { kind: 'composer' }, isExpanded: true, onScreen },
}) as const

// `ownClock`: the test answers $.clock itself (mock.clock)
type World = { sel?: unknown; rows?: unknown[]; files?: Map<string, string>; copies?: string[]; ownClock?: boolean }

// `sel` is what the mouse selected; `rows` what $.session.messages() answers; `files` the disk.
function stub(on: any, world: World) {
  const store = new Map<string, unknown>()
  const files = (world.files ??= new Map())
  const toasts: string[] = []
  const opened: string[] = []
  const opens: any[] = []
  const closed: string[] = []
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($: any, e: any) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/work/proj' }))
  on('ui.copy', ($: any, e: any) => {
    ;(world.copies ??= []).push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.messages', () => ({ value: world.rows ?? [] }))
  on('ui.selection', () => ({ value: world.sel }))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($: any, e: any) => {
    opened.push(e.id)
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: any, e: any) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.focus', () => ({ value: {} }))
  // the engine's end of a turn, beneath the plugin's hook
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: undefined }))
  if (!world.ownClock) on('clock.now', () => ({ value: 1_000 }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  // the engine resolves a path before a hook sees it (on Windows, C:\home\me\...): compare it bare
  const bare = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('fs.read', ($: any, e: any) => {
    if (!files.has(bare(e.path))) throw new Error('ENOENT')
    return { value: files.get(bare(e.path)) }
  })
  on('fs.write', ($: any, e: any) => {
    files.set(bare(e.path), e.text)
    return { value: undefined }
  })
  // the engine's own drawing of a row
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['engine:' + (e.props.text ?? e.props.hint ?? '')] })
  })
  return { store, toasts, opened, opens, closed, files }
}

const lit = async (ui: any, color = AMBER) =>
  (await ui.findAll({ type: 'Text' })).filter((t: any) => t.props.backgroundColor === color).map((t: any) => t.text)

// alt+y with a mouse selection, then Enter in the pane it opens: the selection lit (or its highlight off)
async function lightSelection($: any, hint: any) {
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  await chooser.press({ key: 'chat-marks-choose-enter' })
  await chooser.unmount()
}

test('alt+y lights the selected words, and a selection over them takes them off', async ($, on) => {
  const world: World = { sel: { text: '很重要 的事', requestId: 'r1' } }
  const { toasts, store } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '前言。\n\n這是 **很重要** 的事\n\n結尾', { first: 0, last: 5, of: 6 }))
  const hint = await $.ui.mount(HINT)

  await lightSelection($, hint)
  expect(toasts.at(-1)).toBe('Highlighted')
  expect((await lit(msg)).join('')).toBe('很重要 的事')
  // the blocks with no highlight are still the engine's markdown
  expect(await msg.find({ type: 'Markdown', text: '前言。' })).toBeDefined()
  expect(store.get('s:sess-1')).toBeDefined()

  // a selection is answered until another is made: a new one, over part of the lit words
  world.sel = { text: '重要', requestId: 'r1' }
  await lightSelection($, hint)
  expect(toasts.at(-1)).toBe('Highlight removed')
  expect(await lit(msg)).toEqual([])
  expect(await msg.find({ type: 'Text', text: /engine:前言/ })).toBeDefined()
})

test('the button over a highlighted block takes that block\'s highlight off', async ($, on) => {
  const world = { sel: { text: '第一段重點\n第二段重點', requestId: 'r1' } }
  const { toasts } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '第一段重點\n\n中間\n\n第二段重點'))
  const hint = await $.ui.mount(HINT)
  await lightSelection($, hint)
  expect(await lit(msg)).toEqual(['第一段重點', '第二段重點'])

  expect((await msg.find({ key: 'chat-marks-unhl-r1-0' }))?.props.label).toBe('Remove highlight')
  await msg.press({ key: 'chat-marks-unhl-r1-0' })
  expect(toasts.at(-1)).toBe('Highlight removed')
  expect(await lit(msg)).toEqual(['第二段重點'])
})

test('a highlight in my own prompt is refused', async ($, on) => {
  const { toasts } = stub(on, { sel: { text: '我的問題', requestId: 'u1' } })
  await $.ui.mount(prompt('u1', '我的問題'))
  const hint = await $.ui.mount(HINT)
  await lightSelection($, hint)
  expect(toasts.at(-1)).toMatch(/Only Claude's replies/)
})

// alt+m, then the letter of the `index`th message on screen
async function markByLetter($: any, hint: any, index: number) {
  await hint.press({ key: 'chat-marks-mark' })
  const picker = await $.ui.mount(pane('chat-marks-pick'))
  await picker.press({ key: `chat-marks-pick-${index}` })
  await picker.unmount()
}

test('alt+m puts letters on the messages on screen, even one; a letter marks it', async ($, on) => {
  const { toasts, opened } = stub(on, { sel: { text: '只有這則', requestId: 'r1' }, rows: [{ role: 'assistant', text: '只有這則', toolUses: [] }] })
  const row = await $.ui.mount(reply('r1', '只有這則', { first: 0, last: 2, of: 3 }))
  const hint = await $.ui.mount(HINT)

  // a selection marks nothing by itself: the letters go up all the same
  await hint.press({ key: 'chat-marks-mark' })
  expect(opened).toEqual(['chat-marks-pick'])
  expect(await row.find({ type: 'Text', text: ' a ' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '◆ mark' })).toBeUndefined()

  const picker = await $.ui.mount(pane('chat-marks-pick'))
  await picker.press({ key: 'chat-marks-pick-0' })
  expect(toasts.at(-1)).toBe('Marked: 只有這則')
  expect(await row.find({ type: 'Text', text: ' a ' })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: '◆ mark' })).toBeDefined()
})

test('a marked message gets a red letter and unmark?; its letter takes the mark off', async ($, on) => {
  const rows = [
    { role: 'user', text: '第一個問題', toolUses: [] },
    { role: 'assistant', text: '第一個回覆', toolUses: [] },
  ]
  const { toasts } = stub(on, { rows })
  const a = await $.ui.mount(prompt('u1', '第一個問題', { first: 3, last: 3, of: 4 }))
  const b = await $.ui.mount(reply('r1', '第一個回覆', { first: 0, last: 2, of: 3 }))
  const hint = await $.ui.mount(HINT)
  await markByLetter($, hint, 1)
  expect(toasts.at(-1)).toBe('Marked: 第一個回覆')

  await hint.press({ key: 'chat-marks-mark' })
  expect((await a.find({ type: 'Text', text: ' a ' }))?.props.backgroundColor).toBe(AMBER)
  expect((await b.find({ type: 'Text', text: ' s ' }))?.props.backgroundColor).toBe('#8b1e1e')
  expect(await b.find({ type: 'Text', text: 'unmark?' })).toBeDefined()
  const picker = await $.ui.mount(pane('chat-marks-pick'))
  expect((await picker.find({ key: 'chat-marks-pick-1' }))?.text).toMatch(/^unmark\? \[Claude\] 第一個回覆/)

  await picker.press({ key: 'chat-marks-pick-1' })
  expect(toasts.at(-1)).toBe('Unmarked: 第一個回覆')
  expect(await b.find({ type: 'Text', text: '◆ mark' })).toBeUndefined()
})

test('one message drawn under two ids gets one letter', async ($, on) => {
  const { opened } = stub(on, { rows: [{ role: 'user', text: '同一則', toolUses: [] }] })
  const before = await $.ui.mount(prompt('old-id', '同一則', { first: 0, last: 0, of: 1 }))
  const now = await $.ui.mount(prompt('new-id', '同一則', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-mark' })
  expect(opened).toEqual(['chat-marks-pick'])
  const picker = await $.ui.mount(pane('chat-marks-pick'))
  expect((await picker.findAll({ type: 'Button' })).filter((b: any) => b.props.hotkey)).toHaveLength(1)
  // the letter goes on the row by its text, so whichever id is the one on screen carries it
  expect(await now.find({ type: 'Text', text: ' a ' })).toBeDefined()
  expect(await before.find({ type: 'Text', text: ' a ' })).toBeDefined()
})

test('a mark recorded under one id shows on the row drawn under another', async ($, on) => {
  const { toasts } = stub(on, { rows: [{ role: 'user', text: '同一則提問', toolUses: [] }] })
  const stale = await $.ui.mount(prompt('stale-id', '同一則提問', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  await markByLetter($, hint, 0)
  await stale.unmount()
  const live = await $.ui.mount(prompt('live-id', '同一則提問', { first: 0, last: 0, of: 1 }))
  expect(await live.find({ type: 'Text', text: '◆ mark' })).toBeDefined()
  // and its click takes it off
  await live.press({ key: 'chat-marks-unmark-live-id' })
  expect(toasts.at(-1)).toBe('Unmarked: 同一則提問')
})

test('a click on ◆ mark takes the mark off', async ($, on) => {
  const { toasts } = stub(on, { rows: [{ role: 'user', text: '我的問題', toolUses: [] }] })
  const row = await $.ui.mount(prompt('u1', '我的問題', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  await markByLetter($, hint, 0)
  expect(await row.find({ type: 'Text', text: 'engine:我的問題' })).toBeDefined()

  await row.press({ key: 'chat-marks-unmark-u1' })
  expect(toasts.at(-1)).toBe('Unmarked: 我的問題')
  expect(await row.find({ type: 'Text', text: '◆ mark' })).toBeUndefined()
})

test('alt+j goes to scroll when there are marks', async ($, on) => {
  const rows = [
    { role: 'user', text: '問一', toolUses: [] },
    { role: 'assistant', text: '答一', toolUses: [] },
  ]
  const world: World = { rows }
  const { toasts } = stub(on, world)
  await $.ui.mount(prompt('u1', '問一', { first: 0, last: 1, of: 2 }))
  await $.ui.mount(reply('r1', '答一', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  await markByLetter($, hint, 1)

  // The kit hands a transcript row's $.ui.scroll to nothing a test can answer, so this only shows
  // the jump found its marks and went to scroll; which one it picks, and the bar a jump made shows
  // (barCells), are in marks-core.test.mjs.
  await hint.press({ key: 'chat-marks-next' })
  expect(toasts.at(-1)).toMatch(/ui\.scroll/)
})

test('the marks panel lists marks and each highlighted block in order; x then a letter deletes', async ($, on) => {
  const rows = [
    { role: 'user', text: '問一', toolUses: [] },
    { role: 'assistant', text: '答一第一段\n\n答一重點段', toolUses: [] },
  ]
  const world: World = { rows }
  const { toasts, opened } = stub(on, world)
  const q = await $.ui.mount(prompt('u1', '問一', { first: 0, last: 0, of: 1 }))
  await $.ui.mount(reply('r1', '答一第一段\n\n答一重點段'))
  const hint = await $.ui.mount(HINT)
  await markByLetter($, hint, 0)
  world.sel = { text: '重點段', requestId: 'r1' }
  await lightSelection($, hint)

  await hint.press({ key: 'chat-marks-panel' })
  expect(opened.at(-1)).toBe('chat-marks')
  const panel = await $.ui.mount(pane('chat-marks'))
  const first = await panel.find({ key: 'chat-marks-e-u1' })
  expect(first?.props.hotkey).toBe('a')
  expect(first?.text).toMatch(/\[You\] 問一/)
  const second = await panel.find({ key: 'chat-marks-e-r1#1' })
  expect(second?.props.hotkey).toBe('s')
  expect(await lit(panel)).toEqual(['重點段'])
  expect(await panel.find({ type: 'Text', text: /in: 答一第一段/ })).toBeDefined()

  await panel.press({ key: 'chat-marks-delete' })
  expect(await panel.find({ type: 'Text', text: /^Delete:/ })).toBeDefined()
  await panel.press({ key: 'chat-marks-e-u1' })
  expect(toasts.at(-1)).toBe('Deleted: 問一')
  expect(await q.find({ type: 'Text', text: '◆ mark' })).toBeUndefined()
  expect(await panel.find({ key: 'chat-marks-e-u1' })).toBeUndefined()
  expect((await panel.find({ key: 'chat-marks-e-r1#1' }))?.props.hotkey).toBe('a')
  // back to jumping after one delete
  expect(await panel.find({ type: 'Text', text: /letter: jump/ })).toBeDefined()

  // 0 twice deletes everything left
  await panel.press({ key: 'chat-marks-clear-all' })
  expect((await panel.find({ key: 'chat-marks-clear-all' }))?.props.label).toMatch(/^Press again/)
  await panel.press({ key: 'chat-marks-clear-all' })
  expect(toasts.at(-1)).toMatch(/Cleared/)
  expect(await panel.find({ key: 'chat-marks-e-r1#1' })).toBeUndefined()
  expect(await panel.find({ type: 'Text', text: /No marks yet/ })).toBeDefined()
})

test('alt+o toggles the panel', async ($, on) => {
  const { opened, closed } = stub(on, {})
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-panel' })
  expect(opened).toEqual(['chat-marks'])
  await hint.press({ key: 'chat-marks-panel' })
  expect(closed).toEqual(['chat-marks'])
  await hint.press({ key: 'chat-marks-panel' })
  expect(opened).toEqual(['chat-marks', 'chat-marks'])
})

test('the panel has a hotkeys tab; /mark keys opens on it', async ($, on) => {
  stub(on, {})
  await $.command.run({ command: 'mark', args: '' })
  const panel = await $.ui.mount(pane('chat-marks'))
  expect((await panel.find({ key: 'chat-marks-tab-marks' }))?.props.variant).toBe('primary')
  expect(await panel.find({ key: 'chat-marks-key-row-mark' })).toBeUndefined()
  await panel.press({ key: 'chat-marks-tab-keys' })
  expect((await panel.find({ key: 'chat-marks-tab-keys' }))?.props.variant).toBe('primary')
  expect(await panel.find({ key: 'chat-marks-key-row-mark' })).toBeDefined()
  // and back again
  expect((await panel.find({ key: 'chat-marks-tab-marks' }))?.props.hotkey).toBe('1')
  await panel.press({ key: 'chat-marks-tab-marks' })
  expect((await panel.find({ key: 'chat-marks-tab-marks' }))?.props.variant).toBe('primary')
  await panel.unmount()

  await $.command.run({ command: 'mark', args: 'keys' })
  const again = await $.ui.mount(pane('chat-marks'))
  expect(await again.find({ key: 'chat-marks-key-row-mark' })).toBeDefined()
})

test('/mark hl <words> highlights them in the latest reply holding them', async ($, on) => {
  const rows = [
    { role: 'assistant', text: '舊的回覆提到重點', toolUses: [] },
    { role: 'user', text: '再說一次', toolUses: [] },
    { role: 'assistant', text: '新的回覆也提到重點', toolUses: [] },
  ]
  const { toasts } = stub(on, { rows })
  const old = await $.ui.mount(reply('r1', '舊的回覆提到重點'))
  const latest = await $.ui.mount(reply('r2', '新的回覆也提到重點'))
  await $.command.run({ command: 'mark', args: 'hl 提到重點' })
  expect(toasts.at(-1)).toBe('Highlighted')
  expect(await lit(latest)).toEqual(['提到重點'])
  expect(await lit(old)).toEqual([])
  await $.command.run({ command: 'mark', args: 'hl 沒有這句話' })
  expect(toasts.at(-1)).toMatch(/Couldn't find/)
})

test('the hotkeys editor: modifier toggles and a letter field, saved into keybindings.json', async ($, on) => {
  const world: World = {}
  const { files } = stub(on, world)
  files.set(KEYFILE, JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'alt+l': 'app:toggleDiffPreSession' } }] }))
  await $.command.run({ command: 'mark', args: 'keys' })
  const keys = await $.ui.mount(pane('chat-marks'))
  const json = () => JSON.parse(files.get(KEYFILE)!)
  const global = () => json().bindings.find((b: any) => b.context === 'Global').bindings

  // a row picked opens its editor, alt ticked for a row with no key yet (`a` is the height row's)
  expect((await keys.find({ key: 'chat-marks-key-row-mark' }))?.props.hotkey).toBe('s')
  // what each key does is the guide tab's, not here
  expect(await keys.find({ type: 'Text', text: /past the last, back to the first/ })).toBeUndefined()
  await keys.press({ key: 'chat-marks-key-row-mark' })
  expect(await keys.find({ type: 'Text', text: 'Editing: Mark / unmark' })).toBeDefined()
  expect((await keys.find({ key: 'chat-marks-mod-alt' }))?.props.label).toBe('[x] alt')
  expect((await keys.find({ key: 'chat-marks-mod-ctrl' }))?.props.label).toBe('[ ] ctrl')
  expect((await keys.find({ key: 'chat-marks-tab-marks' }))?.props.hotkey).toBeUndefined()
  // the field keeps the last letter typed; Enter saves
  await keys.input({ key: 'chat-marks-key-letter', text: 'xm', kind: 'change' })
  expect(await keys.find({ type: 'Text', text: 'Saves as: alt+m' })).toBeDefined()
  await keys.input({ key: 'chat-marks-key-letter', text: 'm' })
  expect(json().bindings[0].bindings).toEqual({ 'alt+l': 'app:toggleDiffPreSession', 'alt+m': 'diff:back' })
  expect(await keys.find({ type: 'Text', text: 'Mark / unmark: alt+m' })).toBeDefined()

  // toggles: alt off, ctrl on, then Save
  await keys.press({ key: 'chat-marks-key-row-next' })
  await keys.press({ key: 'chat-marks-mod-alt' })
  await keys.press({ key: 'chat-marks-mod-ctrl' })
  await keys.input({ key: 'chat-marks-key-letter', text: 'e', kind: 'change' })
  await keys.press({ key: 'chat-marks-key-save' })
  expect(global()['ctrl+e']).toBe('diff:nextFile')

  // a row with a key opens with it in the editor
  await keys.press({ key: 'chat-marks-key-row-next' })
  expect((await keys.find({ key: 'chat-marks-mod-ctrl' }))?.props.label).toBe('[x] ctrl')
  await keys.press({ key: 'chat-marks-key-cancel' })

  // a chord Claude Code uses asks first, and takes it over on a second Save
  await keys.press({ key: 'chat-marks-key-row-panel' })
  await keys.input({ key: 'chat-marks-key-letter', text: 'o' })
  expect(await keys.find({ type: 'Text', text: /alt\+o is Claude Code's chat:fastMode/ })).toBeDefined()
  expect(json().bindings.some((b: any) => b.bindings['alt+o'])).toBe(false)
  await keys.press({ key: 'chat-marks-key-save' })
  expect(json().bindings.find((b: any) => b.context === 'Chat').bindings).toEqual({ 'alt+o': null })
  expect(global()['alt+o']).toBe('diff:previousSource')

  // no modifier, or ctrl+c, is refused
  await keys.press({ key: 'chat-marks-key-row-prev' })
  await keys.press({ key: 'chat-marks-mod-alt' })
  await keys.input({ key: 'chat-marks-key-letter', text: 'q' })
  expect(await keys.find({ type: 'Text', text: /needs ctrl or alt/ })).toBeDefined()
  await keys.press({ key: 'chat-marks-mod-ctrl' })
  await keys.input({ key: 'chat-marks-key-letter', text: 'c' })
  expect(await keys.find({ type: 'Text', text: /ctrl\+c can't be a hotkey/ })).toBeDefined()
  await keys.press({ key: 'chat-marks-key-cancel' })

  // Clear takes a row's key away
  await keys.press({ key: 'chat-marks-key-row-mark' })
  await keys.press({ key: 'chat-marks-key-clear' })
  expect(global()['alt+m']).toBeUndefined()

  // a key of the panel's own: just the letter, no toggles
  await keys.press({ key: 'chat-marks-key-row-down' })
  expect(await keys.find({ key: 'chat-marks-mod-alt' })).toBeUndefined()
  await keys.input({ key: 'chat-marks-key-letter', text: 'n' })
  expect(await keys.find({ type: 'Text', text: 'Panel: cursor down: n' })).toBeDefined()
})

// a reply `n` lines long: 14 is past the default of 12 rows
const long = (head: string, n = 14) => [head, ...Array.from({ length: n - 1 }, (_, i) => `第 ${i + 2} 行`)].join('\n')
const turnEnds = ($: any) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

test('a turn\'s end marks its long replies with ◇; alt+j stops there; the panel lists none', async ($, on) => {
  const rows = [
    { role: 'user', text: '問一', toolUses: [] },
    { role: 'assistant', text: '先查一下', toolUses: [{}] },
    { role: 'assistant', text: long('長報告'), toolUses: [] },
  ]
  const { toasts, store } = stub(on, { rows })
  const short = await $.ui.mount(reply('r1', '先查一下', { first: 0, last: 1, of: 2 }))
  const report = await $.ui.mount(reply('r2', long('長報告'), { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)

  await turnEnds($)
  expect(await report.find({ type: 'Text', text: '◇' })).toBeDefined()
  expect(await short.find({ type: 'Text', text: '◇' })).toBeUndefined()
  // kept with the row it is drawn under, so a resumed session can scroll to it
  const kept = (store.get('s:sess-1') as any).auto
  expect(kept.map((a: any) => a.id)).toEqual(['r2'])
  expect(kept[0].snippet).toMatch(/^長報告 第 2 行/)

  // as in 'alt+j goes to scroll': the jump found a stop and went to scroll there
  await hint.press({ key: 'chat-marks-next' })
  expect(toasts.at(-1)).toMatch(/ui\.scroll/)

  await hint.press({ key: 'chat-marks-panel' })
  const panel = await $.ui.mount(pane('chat-marks'))
  expect(await panel.find({ type: 'Text', text: /No marks yet/ })).toBeDefined()

  // a mark on it: ◆ mark instead of ◇, and the panel lists it
  await panel.unmount()
  await hint.press({ key: 'chat-marks-panel' })
  await markByLetter($, hint, 0)
  expect(await report.find({ type: 'Text', text: '◇' })).toBeUndefined()
  expect(await report.find({ type: 'Text', text: '◆ mark' })).toBeDefined()
})

test('alt+m puts letters on the long replies only while one is on screen', async ($, on) => {
  const rows = [
    { role: 'user', text: '短問題', toolUses: [] },
    { role: 'assistant', text: '好', toolUses: [] },
    { role: 'assistant', text: long('長回應'), toolUses: [] },
  ]
  const { toasts } = stub(on, { rows })
  const q = await $.ui.mount(prompt('u1', '短問題', { first: 0, last: 0, of: 1 }))
  const s = await $.ui.mount(reply('r1', '好', { first: 0, last: 1, of: 2 }))
  const l = await $.ui.mount(reply('r2', long('長回應'), { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-mark' })
  const picker = await $.ui.mount(pane('chat-marks-pick'))
  expect((await picker.findAll({ type: 'Button' })).filter((b: any) => b.props.hotkey)).toHaveLength(1)
  expect(await l.find({ type: 'Text', text: ' a ' })).toBeDefined()
  expect(await q.find({ type: 'Text', text: ' a ' })).toBeUndefined()
  expect(await s.find({ type: 'Text', text: ' a ' })).toBeUndefined()
  await picker.press({ key: 'chat-marks-pick-0' })
  expect(toasts.at(-1)).toMatch(/^Marked: 長回應/)
})

test('/mark auto off takes the ◇ away, a height brings it back', async ($, on) => {
  const rows = [{ role: 'assistant', text: long('長報告'), toolUses: [] }]
  stub(on, { rows })
  const report = await $.ui.mount(reply('r1', long('長報告'), { first: 0, last: 14, of: 15 }))
  await turnEnds($)
  expect(await report.find({ type: 'Text', text: '◇' })).toBeDefined()

  expect((await $.command.run({ command: 'mark', args: 'auto off' })).text).toMatch(/No reply is marked by itself/)
  expect(await report.find({ type: 'Text', text: '◇' })).toBeUndefined()
  expect((await $.command.run({ command: 'mark', args: 'auto' })).text).toMatch(/auto on/)
  // taller than this reply: still none
  expect((await $.command.run({ command: 'mark', args: 'auto 20' })).text).toMatch(/at least 20 rows/)
  expect(await report.find({ type: 'Text', text: '◇' })).toBeUndefined()
  await $.command.run({ command: 'mark', args: 'auto 10' })
  expect(await report.find({ type: 'Text', text: '◇' })).toBeDefined()
})

test('the settings tab shows the long-reply height and changes it', async ($, on) => {
  const rows = [{ role: 'assistant', text: long('長報告'), toolUses: [] }]
  stub(on, { rows })
  const report = await $.ui.mount(reply('r1', long('長報告'), { first: 0, last: 14, of: 15 }))
  await turnEnds($)
  await $.command.run({ command: 'mark', args: 'settings' })
  const panel = await $.ui.mount(pane('chat-marks'))
  expect((await panel.find({ key: 'chat-marks-tab-keys' }))?.props.label).toBe('Settings')
  const row = await panel.find({ key: 'chat-marks-key-row-auto' })
  expect(row?.props.hotkey).toBe('a')
  expect(row?.text).toMatch(/Long reply height\s+12 rows/)

  // typed and Enter: taller than this reply, so its ◇ goes
  await panel.press({ key: 'chat-marks-key-row-auto' })
  expect(await panel.find({ type: 'Text', text: 'Editing: Long reply height' })).toBeDefined()
  await panel.input({ key: 'chat-marks-auto-rows', text: '2x0', kind: 'change' })
  expect(await panel.find({ type: 'Text', text: 'Saves as: 20 rows' })).toBeDefined()
  await panel.input({ key: 'chat-marks-auto-rows', text: '20' })
  expect(await panel.find({ type: 'Text', text: 'Long reply height: 20 rows' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: '◇' })).toBeUndefined()

  await panel.press({ key: 'chat-marks-key-row-auto' })
  await panel.press({ key: 'chat-marks-auto-default' })
  expect(await report.find({ type: 'Text', text: '◇' })).toBeDefined()
  await panel.press({ key: 'chat-marks-key-row-auto' })
  await panel.press({ key: 'chat-marks-auto-off' })
  expect(await panel.find({ type: 'Text', text: 'Long reply height: off' })).toBeDefined()
  expect(await report.find({ type: 'Text', text: '◇' })).toBeUndefined()
  expect((await $.command.run({ command: 'mark', args: 'auto' })).text).toMatch(/No reply is marked by itself/)
})

// what the reply shows: its hints (amber), its selection (blue)
const hintsIn = async (msg: any) => (await msg.findAll({ type: 'Text' })).filter((x: any) => x.props.backgroundColor === AMBER).map((x: any) => x.text)
const selectedIn = async (msg: any) =>
  (await msg.findAll({ type: 'Text' })).filter((x: any) => x.props.backgroundColor === '#264f78').map((x: any) => x.text).join('')
// keys pressed one by one in the pane, each by the hidden button that answers it
const type = async (pane: any, keys: string) => {
  for (const c of keys) await pane.press({ key: 'chat-marks-ch-' + c.charCodeAt(0) })
}

test('alt+y by keys: two letters land on the one place they match; an end\'s hint copies the span; n leaves it at that', async ($, on) => {
  const text = long('See https://x.dev/a/b for docs. Then more.')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  const { opened } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)

  // no letters on the replies first: straight to typing
  await hint.press({ key: 'chat-marks-hl' })
  expect(opened).toEqual(['chat-marks-choose'])
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect(await chooser.find({ type: 'Text', text: "Type the start's two letters" })).toBeDefined()

  // (a digit: no Boshiamy code has one, and the text has not these two)
  await type(chooser, 'x')
  expect(await chooser.find({ type: 'Text', text: '> x' })).toBeDefined()
  await type(chooser, '9')
  expect(await chooser.find({ type: 'Text', text: 'No "x9" on screen' })).toBeDefined()

  // `ht` is only in the URL: the start is taken at once, and the end hints follow each place it may end
  await type(chooser, 'ht')
  expect(await chooser.find({ type: 'Text', text: "Type the end's hint (s: by letters)" })).toBeDefined()
  expect(await selectedIn(msg)).toBe('h')
  // never s: it starts looking for the end by letters
  expect((await hintsIn(msg)).slice(0, 3)).toEqual(['a', 'd', 'f'])

  await type(chooser, 'a')
  expect(world.copies).toEqual(['https://x.dev/a/b'])
  expect(await chooser.find({ type: 'Text', text: 'Copied 17. Highlight?' })).toBeDefined()
  expect(await selectedIn(msg)).toBe('https://x.dev/a/b')
  expect(await hintsIn(msg)).toEqual([])

  await type(chooser, 'n')
  expect(await lit(msg)).toEqual([])
  expect(await selectedIn(msg)).toBe('')
})

test('alt+y by keys: a Chinese start by its Boshiamy code, picked among two by its hint; Enter highlights', async ($, on) => {
  // 重's Boshiamy code starts gq
  const text = long('這是重點。重要的事，要記得。')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  const { toasts } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))

  await type(chooser, 'gq')
  expect(await chooser.find({ type: 'Text', text: '2 places: type a hint' })).toBeDefined()
  expect(await hintsIn(msg)).toEqual(['a', 's'])
  await type(chooser, 's')
  expect(await selectedIn(msg)).toBe('重')
  // the first end: past the comma
  await type(chooser, 'a')
  expect(world.copies).toEqual(['重要的事，'])

  // Enter presses the focused yes
  // the button Enter presses, the same one from the first step on, is yes now
  const enter = await chooser.find({ key: 'chat-marks-choose-enter' })
  expect([enter?.props.label, enter?.props.autoFocus]).toEqual(['y  yes', true])
  await chooser.press({ key: 'chat-marks-choose-enter' })
  expect(toasts.at(-1)).toBe('Highlighted')
  expect(await lit(msg)).toEqual(['重要的事，'])
})

test('alt+y by keys: / looks for the end by the two letters it ends on', async ($, on) => {
  const text = long('alpha beta gamma delta.')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  stub(on, world)
  await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  await type(chooser, 'be')
  await type(chooser, 's')
  expect(await chooser.find({ type: 'Text', text: "Type the end's last two letters" })).toBeDefined()
  await type(chooser, 'ma')
  expect(world.copies).toEqual(['beta gamma'])
})

test('alt+y by keys: one letter and Enter find a character whose code is that letter alone', async ($, on) => {
  // 四's Boshiamy code is f alone: no two letters find it
  const text = long('第四章，四個重點。')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect((await chooser.find({ key: 'chat-marks-choose-enter' }))?.props.label).toBe('Enter: one-letter code')
  await type(chooser, 'f')
  await chooser.press({ key: 'chat-marks-choose-enter' })
  expect(await chooser.find({ type: 'Text', text: '2 places: type a hint' })).toBeDefined()
  expect(await hintsIn(msg)).toEqual(['a', 's'])
  // picking a hint, the same button is cancel
  // (no keybindings.json here: the chord is named by its row)
  expect((await chooser.find({ key: 'chat-marks-choose-enter' }))?.props.label).toBe('Highlight: cancel')
  await type(chooser, 's')
  expect(await selectedIn(msg)).toBe('四')
  await type(chooser, 'a')
  expect(world.copies).toEqual(['四個重點。'])
})

test('alt+y by keys without the keyboard (text in the prompt): the pane says which key moves it there', async ($, on) => {
  const text = long('一段回應')
  const { files } = stub(on, { rows: [{ role: 'assistant', text, toolUses: [] }] })
  await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const unfocused = { ...pane('chat-marks-choose'), props: { ...pane('chat-marks-choose').props, isFocused: false } }
  const chooser = await $.ui.mount(unfocused as any)
  expect(await chooser.find({ type: 'Text', text: 'Press ctrl+x tab to type here' })).toBeDefined()
  await chooser.unmount()
  // a key of the person's own for it
  files.set(KEYFILE, JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'alt+i': 'abovePrompt:focus' } }] }))
  const again = await $.ui.mount(unfocused as any)
  expect(await again.find({ type: 'Text', text: 'Press alt+i to type here' })).toBeDefined()
})

test('the guide tab says how each part works, with the keys it answers to', async ($, on) => {
  const { files } = stub(on, {})
  files.set(KEYFILE, JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'alt+y': 'diff:nextSource' } }] }))
  await $.command.run({ command: 'mark', args: 'guide' })
  const panel = await $.ui.mount(pane('chat-marks'))
  expect((await panel.find({ key: 'chat-marks-tab-guide' }))?.props.variant).toBe('primary')
  expect((await panel.find({ key: 'chat-marks-tab-guide' }))?.props.hotkey).toBe('3')
  const section = await panel.find({ key: 'chat-marks-guide-4' })
  expect(section?.text).toMatch(/^Highlight by keys\s*alt\+y/)
  expect(section?.text).toMatch(/Boshiamy code/)
  // the marks list's own keys as set
  expect(await panel.find({ type: 'Text', text: /j \/ k move and show the spot/ })).toBeDefined()
})

test('an auto mark not drawn since a reload is found in the transcript file', async ($, on) => {
  const text = long('沒畫過的報告')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  const { store, files } = stub(on, world)
  const line = { uuid: 'old-uuid', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } }
  files.set('/home/me/.claude/projects/-work-proj/sess-1.jsonl', '{"type":"user"}\n' + JSON.stringify(line) + '\n')
  await turnEnds($)
  expect((store.get('s:sess-1') as any).auto.map((a: any) => a.id)).toEqual(['old-uuid'])
})

test('Escape closes none of the panes; each closes by the chord that opened it', async ($, on) => {
  const text = long('一段長回應')
  const { opens, closed, files } = stub(on, { rows: [{ role: 'assistant', text, toolUses: [] }] })
  files.set(KEYFILE, JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'alt+o': 'diff:previousSource', 'alt+y': 'diff:nextSource', 'alt+m': 'diff:back' } }] }))
  await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)

  await hint.press({ key: 'chat-marks-panel' })
  const panel = await $.ui.mount(pane('chat-marks'))
  expect(await panel.find({ type: 'Text', text: /alt\+o: back to where you were|alt\+o closes/ })).toBeDefined()
  await panel.press({ key: 'chat-marks-panel-close' })
  expect(closed).toEqual(['chat-marks'])

  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  await chooser.press({ key: 'chat-marks-choose-close' })
  expect(closed.at(-1)).toBe('chat-marks-choose')

  await hint.press({ key: 'chat-marks-mark' })
  const picker = await $.ui.mount(pane('chat-marks-pick'))
  expect(await picker.find({ type: 'Text', text: /alt\+m closes/ })).toBeDefined()
  await picker.press({ key: 'chat-marks-pick-close' })
  expect(closed.at(-1)).toBe('chat-marks-pick')

  expect(opens.map(o => [o.id, o.closeOnEscape])).toEqual([
    ['chat-marks', undefined],
    ['chat-marks-choose', undefined],
    ['chat-marks-pick', undefined],
  ])
})

test('the copy question closes by itself after five seconds with no y or n, the copy kept', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const text = long('See https://x.dev/a/b for docs.')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }], ownClock: true }
  const { closed } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  await type(chooser, 'ht')
  await type(chooser, 'a')
  expect(world.copies).toEqual(['https://x.dev/a/b'])
  expect(await chooser.find({ type: 'Text', text: 'Closes in 5 s, the copy kept' })).toBeDefined()

  await clock.advance(4_900)
  expect(closed).toEqual([])
  await clock.advance(200)
  expect(closed).toEqual(['chat-marks-choose'])
  expect(await lit(msg)).toEqual([])
  expect(await selectedIn(msg)).toBe('')
})

test('alt+u undoes the last change, again and again back', async ($, on) => {
  const world: World = { rows: [{ role: 'assistant', text: '一段重點文字', toolUses: [] }] }
  const { toasts } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '一段重點文字', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-undo' })
  expect(toasts.at(-1)).toMatch(/^Nothing to undo/)

  world.sel = { text: '重點文字', requestId: 'r1' }
  await lightSelection($, hint)
  await markByLetter($, hint, 0)
  await $.command.run({ command: 'mark-clear', args: '' })
  expect(await lit(msg)).toEqual([])

  await hint.press({ key: 'chat-marks-undo' })
  expect(toasts.at(-1)).toBe('Undone: clearing every mark and highlight')
  expect(await lit(msg)).toEqual(['重點文字'])
  expect(await msg.find({ type: 'Text', text: '◆ mark' })).toBeDefined()

  await hint.press({ key: 'chat-marks-undo' })
  expect(toasts.at(-1)).toMatch(/^Undone: marking "一段重點文字"/)
  expect(await msg.find({ type: 'Text', text: '◆ mark' })).toBeUndefined()
  expect(await lit(msg)).toEqual(['重點文字'])

  await $.command.run({ command: 'mark', args: 'undo' })
  expect(toasts.at(-1)).toBe('Undone: highlighting "重點文字"')
  expect(await lit(msg)).toEqual([])
})

test('/mark-clear takes every mark and highlight off', async ($, on) => {
  const world: World = { rows: [{ role: 'assistant', text: '一段重點文字', toolUses: [] }] }
  const { store } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '一段重點文字', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  world.sel = { text: '重點文字', requestId: 'r1' }
  await lightSelection($, hint)
  await markByLetter($, hint, 0)
  expect(await lit(msg)).toEqual(['重點文字'])
  expect(await msg.find({ type: 'Text', text: '◆ mark' })).toBeDefined()

  const out = await $.command.run({ command: 'mark-clear', args: '' })
  expect(out.text).toMatch(/Cleared/)
  expect(await lit(msg)).toEqual([])
  expect(await msg.find({ type: 'Text', text: /◆ mark/ })).toBeUndefined()
  expect(store.has('s:sess-1')).toBe(false)
})

test('/mark color and /mark lang change the background and the language', async ($, on) => {
  const world: World = { sel: { text: '重點文字', requestId: 'r1' } }
  const { toasts } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '一段重點文字'))
  const hint = await $.ui.mount(HINT)
  await lightSelection($, hint)

  expect((await $.command.run({ command: 'mark', args: 'color #4d3b00' })).text).toMatch(/#4d3b00/)
  expect(await lit(msg, '#4d3b00')).toEqual(['重點文字'])
  expect((await $.command.run({ command: 'mark', args: 'color yellowish' })).text).toMatch(/is #4d3b00/)

  expect((await $.command.run({ command: 'mark', args: 'lang zh' })).text).toMatch(/語言：中文/)
  world.sel = { text: '重點', requestId: 'r1' }
  await lightSelection($, hint)
  expect(toasts.at(-1)).toBe('已取消重點')
})

test('alt+y by keys: a number before each ! command and web address; the number copies it, nothing asked', async ($, on) => {
  const text = long('先跑 `! npm test`，再看 https://x.dev/a/b。也可以開 (https://y.dev/c). 又是 https://x.dev/a/b')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  const { toasts, opened, closed } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)

  await hint.press({ key: 'chat-marks-hl' })
  expect(opened).toEqual(['chat-marks-choose'])
  // an address met again gets no number of its own
  expect(await hintsIn(msg)).toEqual(['1', '2', '3'])
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect(await chooser.find({ type: 'Text', text: "Type the start's two letters" })).toBeDefined()
  expect(await chooser.find({ type: 'Text', text: 'Or a number: copy' })).toBeDefined()

  // the command with its `!`, without the backticks; the pane closes with no question
  await type(chooser, '1')
  expect(world.copies).toEqual(['! npm test'])
  expect(toasts.at(-1)).toBe('Copied: ! npm test')
  expect(closed).toEqual(['chat-marks-choose'])
  expect(await hintsIn(msg)).toEqual([])
  expect(await lit(msg)).toEqual([])
  await hint.press({ key: 'chat-marks-undo' })
  expect(toasts.at(-1)).toMatch(/^Nothing to undo/)

  // an address without the bracket and the full stop round it
  await hint.press({ key: 'chat-marks-hl' })
  await type(chooser, '3')
  expect(world.copies).toEqual(['! npm test', 'https://y.dev/c'])
})

test('alt+y by keys: once a letter is typed the numbers go, and a digit is the second of the two letters', async ($, on) => {
  const text = long('`! ls` 與 https://x.dev')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect(await hintsIn(msg)).toEqual(['1', '2'])

  await type(chooser, 'x')
  expect(await hintsIn(msg)).toEqual([])
  expect(await chooser.find({ type: 'Text', text: 'Or a number: copy' })).toBeUndefined()
  await type(chooser, '1')
  expect(await chooser.find({ type: 'Text', text: 'No "x1" on screen' })).toBeDefined()
  expect(world.copies).toBeUndefined()
  // back to the start: the numbers are up again; a digit no number sits on starts the search
  expect(await hintsIn(msg)).toEqual(['1', '2'])
  await type(chooser, '7')
  expect(await chooser.find({ type: 'Text', text: '> 7' })).toBeDefined()
  expect(world.copies).toBeUndefined()
})

test('alt+y by keys: a link\'s hidden address gets no number; with none, the pane says nothing of copying', async ($, on) => {
  const text = long('沒有命令，也沒有看得到的網址：[SP-800](https://ob-link.dev/SP-800)')
  const world: World = { rows: [{ role: 'assistant', text, toolUses: [] }] }
  stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect(await hintsIn(msg)).toEqual([])
  expect(await chooser.find({ type: 'Text', text: 'Or a number: copy' })).toBeUndefined()
  await type(chooser, '1')
  expect(await chooser.find({ type: 'Text', text: '> 1' })).toBeDefined()
  expect(world.copies).toBeUndefined()
})

test('the guide says a number copies a ! command or a web address', async ($, on) => {
  stub(on, {})
  await $.command.run({ command: 'mark', args: 'guide' })
  const panel = await $.ui.mount(pane('chat-marks'))
  const section = await panel.find({ key: 'chat-marks-guide-4' })
  expect(section?.text).toMatch(/A number sits before each ! command and web address on screen/)
})

test('alt+y with a mouse selection (shown or taken down) lights nothing until Enter; the Enter names the words', async ($, on) => {
  // the terminal answers the last selection until the next prompt, even after it was taken down
  const text = long('這是 **很重要** 的事，見 https://x.dev/a')
  const world: World = { sel: { text: '很重要 的事', requestId: 'r1' }, rows: [{ role: 'assistant', text, toolUses: [] }] }
  const { toasts, opened } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)

  await hint.press({ key: 'chat-marks-hl' })
  expect(opened).toEqual(['chat-marks-choose'])
  expect(await lit(msg)).toEqual(['1'])
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect((await chooser.find({ key: 'chat-marks-choose-enter' }))?.props.label).toBe('Enter: highlight "很重要 的事"')
  await chooser.press({ key: 'chat-marks-choose-enter' })
  expect(toasts.at(-1)).toBe('Highlighted')
  expect((await lit(msg)).join('')).toBe('很重要 的事')

  // used once: the same selection is not offered again
  await hint.press({ key: 'chat-marks-hl' })
  expect((await chooser.find({ key: 'chat-marks-choose-enter' }))?.props.label).toBe('Enter: one-letter code')
  await hint.press({ key: 'chat-marks-hl' })

  // a new one over the lit words: Enter takes the highlight off
  world.sel = { text: '重要', requestId: 'r1' }
  await hint.press({ key: 'chat-marks-hl' })
  expect((await chooser.find({ key: 'chat-marks-choose-enter' }))?.props.label).toBe('Enter: unhighlight "重要"')
})

test('a selection the pane lets go by (a number copied, a span by keys) is not offered again', async ($, on) => {
  const text = long('先跑 `! ls`，再看 alpha beta.')
  const world: World = { sel: { text: 'alpha', requestId: 'r1' }, rows: [{ role: 'assistant', text, toolUses: [] }] }
  stub(on, world)
  const msg = await $.ui.mount(reply('r1', text, { first: 0, last: 14, of: 15 }))
  const hint = await $.ui.mount(HINT)
  const enterLabel = async (chooser: any) => (await chooser.find({ key: 'chat-marks-choose-enter' }))?.props.label

  await hint.press({ key: 'chat-marks-hl' })
  const chooser = await $.ui.mount(pane('chat-marks-choose'))
  expect(await enterLabel(chooser)).toBe('Enter: highlight "alpha"')
  await type(chooser, '1')
  expect(world.copies).toEqual(['! ls'])
  expect(await lit(msg)).toEqual([])
  await hint.press({ key: 'chat-marks-hl' })
  expect(await enterLabel(chooser)).toBe('Enter: one-letter code')
  await hint.press({ key: 'chat-marks-hl' })

  world.sel = { text: 'beta', requestId: 'r1' }
  await hint.press({ key: 'chat-marks-hl' })
  expect(await enterLabel(chooser)).toBe('Enter: highlight "beta"')
  // a letter typed: Enter is the one-letter code again, and the span picked lets the selection go
  await type(chooser, 'a')
  expect(await enterLabel(chooser)).toBe('Enter: one-letter code')
  await type(chooser, 'l')
  await type(chooser, 'a')
  expect(world.copies?.at(-1)).toBe('alpha beta.')
  await type(chooser, 'n')
  await hint.press({ key: 'chat-marks-hl' })
  expect(await enterLabel(chooser)).toBe('Enter: one-letter code')
})
