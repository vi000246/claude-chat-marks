import { expect, test } from 'claude-code/testing'

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

type World = { sel?: unknown; rows?: unknown[]; files?: Map<string, string> }

// `sel` is what the mouse selected; `rows` what $.session.messages() answers; `files` the disk.
function stub(on: any, world: World) {
  const store = new Map<string, unknown>()
  const files = (world.files ??= new Map())
  const toasts: string[] = []
  const opened: string[] = []
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
  on('session.messages', () => ({ value: world.rows ?? [] }))
  on('ui.selection', () => ({ value: world.sel }))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: any, e: any) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.focus', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000 }))
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
  return { store, toasts, opened, closed, files }
}

const lit = async (ui: any, color = AMBER) =>
  (await ui.findAll({ type: 'Text' })).filter((t: any) => t.props.backgroundColor === color).map((t: any) => t.text)

test('alt+y lights the selected words, and again takes them off', async ($, on) => {
  const world = { sel: { text: '很重要 的事', requestId: 'r1' } }
  const { toasts, store } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '前言。\n\n這是 **很重要** 的事\n\n結尾', { first: 0, last: 5, of: 6 }))
  const hint = await $.ui.mount(HINT)

  await hint.press({ key: 'chat-marks-hl' })
  expect(toasts.at(-1)).toBe('Highlighted')
  expect((await lit(msg)).join('')).toBe('很重要 的事')
  // the blocks with no highlight are still the engine's markdown
  expect(await msg.find({ type: 'Markdown', text: '前言。' })).toBeDefined()
  expect(store.get('s:sess-1')).toBeDefined()

  await hint.press({ key: 'chat-marks-hl' })
  expect(toasts.at(-1)).toBe('Highlight removed')
  expect(await lit(msg)).toEqual([])
  expect(await msg.find({ type: 'Text', text: /engine:前言/ })).toBeDefined()
})

test('the button over a highlighted block takes that block\'s highlight off', async ($, on) => {
  const world = { sel: { text: '第一段重點\n第二段重點', requestId: 'r1' } }
  const { toasts } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '第一段重點\n\n中間\n\n第二段重點'))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })
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
  await hint.press({ key: 'chat-marks-hl' })
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
  expect(await picker.findAll({ type: 'Button' })).toHaveLength(1)
  // the letter is on whichever of the two was drawn last: one of them, never both
  const badges = [await before.find({ type: 'Text', text: ' a ' }), await now.find({ type: 'Text', text: ' a ' })]
  expect(badges.filter(Boolean)).toHaveLength(1)
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
  // the jump found its marks and went to scroll; which one it picks is in marks-core.test.mjs.
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
  await hint.press({ key: 'chat-marks-hl' })

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

  // a row picked opens its editor, alt ticked for a row with no key yet
  expect((await keys.find({ key: 'chat-marks-key-row-mark' }))?.props.hotkey).toBe('a')
  // each row says what its key does
  expect(await keys.find({ type: 'Text', text: /Jump to the next mark or highlight/ })).toBeDefined()
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

test('/mark-clear takes every mark and highlight off', async ($, on) => {
  const world: World = { rows: [{ role: 'assistant', text: '一段重點文字', toolUses: [] }] }
  const { store } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '一段重點文字', { first: 0, last: 0, of: 1 }))
  const hint = await $.ui.mount(HINT)
  world.sel = { text: '重點文字', requestId: 'r1' }
  await hint.press({ key: 'chat-marks-hl' })
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
  const world = { sel: { text: '重點文字', requestId: 'r1' } }
  const { toasts } = stub(on, world)
  const msg = await $.ui.mount(reply('r1', '一段重點文字'))
  const hint = await $.ui.mount(HINT)
  await hint.press({ key: 'chat-marks-hl' })

  expect((await $.command.run({ command: 'mark', args: 'color #4d3b00' })).text).toMatch(/#4d3b00/)
  expect(await lit(msg, '#4d3b00')).toEqual(['重點文字'])
  expect((await $.command.run({ command: 'mark', args: 'color yellowish' })).text).toMatch(/is #4d3b00/)

  expect((await $.command.run({ command: 'mark', args: 'lang zh' })).text).toMatch(/語言：中文/)
  await hint.press({ key: 'chat-marks-hl' })
  expect(toasts.at(-1)).toBe('已取消重點')
})
