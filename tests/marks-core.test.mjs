// node --test tests/marks-core.test.mjs  (from the plugin folder)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  anchorOf, autoMarks, barCells, fractionOf, hangOf, hintLabels, hintOrder, jumpTarget, keysMeet, layout, linesOf, litOf,
  normMap, padCells, pickLayout, plainOf, positions, previewOf, rowTops, rowsOf, selectionFragments, sentencesOf,
  spanOf, splitAt, toggleFragments,
} from '../hooks/marks-core.mjs'

const lit = parts => parts.filter(p => p.type === 'runs').flatMap(p => p.runs.filter(r => r.hl).map(r => r.text))

test('normMap collapses whitespace and maps back to the source', () => {
  const { out, map } = normMap('  a \n\t b  ')
  assert.equal(out, 'a b')
  assert.deepEqual(map, [2, 3, 7])
})

test('a selection becomes one fragment per line, without the bullets the renderer drew', () => {
  assert.deepEqual(selectionFragments('● 第一行重點\n  - 清單 項目\n2. 第三\nx'), ['第一行重點', '清單 項目', '第三'])
})

test('a highlight lands on the plain text across bold markers; the rest stays Markdown', () => {
  const md = '# 標題\n\n前言一段。\n\n這是 **很重要** 的事，\n要記得。\n\n- 結尾'
  const parts = layout(md, selectionFragments('這是 很重要 的事，'))
  assert.deepEqual(parts.map(p => p.type), ['md', 'runs', 'md'])
  assert.equal(parts[0].text, '# 標題\n\n前言一段。')
  assert.equal(parts[2].text, '- 結尾')
  assert.deepEqual(lit(parts), ['這是 ', '很重要', ' 的事，'])
  assert.deepEqual(parts[1].frags, ['這是 很重要 的事，'])
  const bold = parts[1].runs.find(r => r.text === '很重要')
  assert.equal(bold.bold, true)
  // the unlit rest of the block is still drawn
  assert.ok(parts[1].runs.some(r => !r.hl && r.text.includes('要記得')))
})

test('a fragment spanning a soft line break in the source still matches', () => {
  const parts = layout('一段很長的\n說明文字', ['很長的 說明'])
  assert.equal(lit(parts).join(''), '很長的\n說明')
})

test('nothing found draws nothing of its own', () => {
  assert.equal(layout('hello world', ['不存在的字']), null)
})

test('a fenced block is one block, drawn without its fences', () => {
  const parts = layout('看這段：\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\n完', ['const b = 2'])
  assert.deepEqual(parts.map(p => p.type), ['md', 'runs', 'md'])
  assert.equal(parts[1].code, true)
  assert.equal(parts[1].runs.map(r => r.text).join(''), 'const a = 1\n\nconst b = 2')
})

test('a selected table row, drawn with box borders, matches the pipes of the source', () => {
  const md = '| 欄 | 值 |\n|---|---|\n| 甲 | 一 |'
  const parts = layout(md, selectionFragments('│ 甲 │ 一 │'))
  assert.ok(parts)
  assert.equal(parts[0].runs.map(r => r.text).join(''), '| 欄 | 值 |\n| 甲 | 一 |')
})

test('highlighting what is lit takes it off; anything else adds', () => {
  assert.deepEqual(toggleFragments(['很重要的事'], ['重要']), { frags: [], removed: true })
  assert.deepEqual(toggleFragments(['甲乙'], ['丙丁']), { frags: ['甲乙', '丙丁'], removed: false })
})

test('positions follow the conversation; two blocks of one message still sort', () => {
  const rows = [
    { role: 'user', text: '問題一' },
    { role: 'assistant', text: '第一段回覆。 第二段回覆。' },
    { role: 'user', text: '問題二' },
  ]
  const pos = positions(rows, [
    { id: 'q2', kind: 'user', key: '問題二' },
    { id: 'b', kind: 'assistant', key: '第二段回覆。' },
    { id: 'a', kind: 'assistant', key: '第一段回覆。' },
    { id: 'gone', kind: 'user', key: '不在了' },
  ])
  assert.ok(pos.get('a') < pos.get('b'))
  assert.ok(pos.get('b') < pos.get('q2'))
  assert.equal(pos.has('gone'), false)
})

test('the anchor is the first message whose top shows', () => {
  const visible = [
    { id: 'tail', pos: 1, first: 12 },
    { id: 'b', pos: 3, first: 0 },
    { id: 'a', pos: 2, first: 0 },
  ]
  assert.equal(anchorOf(visible).id, 'a')
  assert.equal(anchorOf([{ id: 'long', pos: 5, first: 30 }]).id, 'long')
  assert.equal(anchorOf([]), null)
})

test('next and previous go from the anchor, wrapping at the ends', () => {
  const t = [{ id: 'm1', pos: 1 }, { id: 'm5', pos: 5 }, { id: 'm9', pos: 9 }]
  assert.equal(jumpTarget(t, 1, { id: 'x', pos: 5, inside: false }).target.id, 'm9')
  assert.equal(jumpTarget(t, -1, { id: 'x', pos: 5, inside: false }).target.id, 'm1')
  const wrapped = jumpTarget(t, 1, { id: 'm9', pos: 9, inside: false })
  assert.deepEqual([wrapped.target.id, wrapped.wrapped, wrapped.index], ['m1', true, 0])
  // inside a long marked message, back first goes to its own top
  assert.equal(jumpTarget(t, -1, { id: 'm5', pos: 5, inside: true }).target.id, 'm5')
  assert.equal(jumpTarget(t, 1, null).target.id, 'm1')
  assert.equal(jumpTarget([], 1, null), null)
})

test('a block\'s lit words, separate stretches joined by an ellipsis', () => {
  const runs = [{ text: '甲乙', hl: true }, { text: '丙', hl: false }, { text: '丁\n戊', hl: true }]
  assert.equal(litOf(runs), '甲乙 … 丁 戊')
})

test('inline code inside bold loses its backticks and keeps both styles', () => {
  const parts = layout('**Use `public` here.** And more', ['And more'])
  const runs = parts[0].runs
  assert.equal(runs.map(r => r.text).join(''), 'Use public here. And more')
  assert.deepEqual(runs.find(r => r.text === 'public'), { text: 'public', code: true, bold: true, hl: false })
})

test('a block\'s runs line by line; a list item hangs under its marker', () => {
  const lines = linesOf([{ text: '1. 甲' }, { text: '乙\n   丙', hl: true }])
  assert.deepEqual(lines, [[{ text: '1. 甲' }, { text: '乙', hl: true }], [{ text: '   丙', hl: true }]])
  assert.equal(hangOf(lines[0]), 3)
  assert.equal(hangOf([{ text: '  - item' }]), 4)
  assert.equal(hangOf([{ text: 'plain line' }]), 0)
  assert.deepEqual(splitAt(lines[0], 3), [[{ text: '1. ' }], [{ text: '甲' }, { text: '乙', hl: true }]])
})

test('padding counts a CJK character as two cells', () => {
  assert.equal(padCells('Next mark', 12), 'Next mark   ')
  assert.equal(padCells('下一個 mark', 12), '下一個 mark ')
})

test('a snippet\'s text has no markdown markers', () => {
  assert.equal(plainOf('**HTTP caching** lets `CDNs`\n\n# Next'), 'HTTP caching lets CDNs Next')
})

test('a preview is the first lines a reader sees, markers gone', () => {
  assert.deepEqual(previewOf('# 標題\n\n```js\ncode\n```\n**粗體** 文字\n- 清單\n第四行'), ['標題', 'code', '粗體 文字'])
})

test('rows: each line wraps on its own, a CJK character two cells, a blank row above', () => {
  assert.equal(rowsOf('short', 40), 2)
  assert.equal(rowsOf('a'.repeat(41) + '\n\nb', 40), 1 + 2 + 1 + 1)
  assert.equal(rowsOf('中'.repeat(21), 40), 1 + 2)
  assert.equal(rowsOf('one\n\n\n', 40), 2)
})

const lines = (head, n) => [head, ...Array.from({ length: n - 1 }, (_, i) => `line ${i + 2}`)].join('\n')

test('auto marks: long replies only, a near one left out, tool calls counted', () => {
  const rows = [
    { role: 'user', text: 'question one', toolUses: [] },
    { role: 'assistant', text: 'checking the API first', toolUses: [{}, {}] },
    { role: 'user', text: '', toolUses: [] },
    { role: 'assistant', text: lines('first report', 14), toolUses: [] },
    { role: 'user', text: 'question two', toolUses: [] },
    // its top is 15 + 2 rows under the first report's: on the screen a jump there shows
    { role: 'assistant', text: lines('near report', 12), toolUses: [] },
    { role: 'user', text: 'question three', toolUses: [] },
    { role: 'assistant', text: 'working', toolUses: Array.from({ length: 20 }, () => ({})) },
    { role: 'assistant', text: lines('far report', 30), toolUses: [] },
    { role: 'user', text: lines('a long prompt of mine', 30), toolUses: [] },
  ]
  const got = autoMarks(rows, { columns: 80, minRows: 12, gap: 20 })
  assert.deepEqual(got.map(a => a.index), [3, 8])
  assert.match(got[0].key, /^first report/)
  // a lower bar takes more; with no gap the near one too
  assert.deepEqual(autoMarks(rows, { columns: 80, minRows: 12, gap: 0 }).map(a => a.index), [3, 5, 8])
  assert.deepEqual(autoMarks(rows, { columns: 80, minRows: 20, gap: 20 }).map(a => a.index), [8])
})

test('a position is a fraction of the conversation\'s rows', () => {
  const rows = [
    { role: 'user', text: 'q', toolUses: [] },
    { role: 'assistant', text: lines('answer', 8), toolUses: [] },
  ]
  const geo = rowTops(rows, 80)
  assert.deepEqual(geo, { tops: [0, 2], total: 11 })
  assert.equal(fractionOf(0, geo), 0)
  assert.equal(fractionOf(1, geo), 2 / 11)
  assert.equal(fractionOf(1.5, geo), (2 + 4.5) / 11)
})

test('the bar: the stops in their cells, the one jumped to winning a shared cell, the screen\'s stretch thick', () => {
  const cells = barCells(11, [
    { at: 0, how: 'auto' },
    { at: 0.5, how: 'auto' },
    { at: 0.5, how: 'mark', isCurrent: true },
    { at: 1, how: 'highlight' },
  ], [0.5, 0.7])
  assert.equal(cells.map(c => c.ch).join(''), '◇────◆━━──■')
  assert.ok(cells[5].isCurrent)
  assert.equal(cells.filter(c => c.isThumb).length, 3)
})

test('sentences: cut at 。！？ and a full stop before a space, a line of code or a table whole, a list\'s 1. kept', () => {
  const md = '# 標題\n\n第一句。第二句！Third one. Fourth\n\n1. 項目一。\n2. 項目二\n\n```\nconst a = 1. b\n```\n\n| 甲。 | 乙 |\n|---|---|\n| 丙 | 丁 |'
  const { blocks, units } = sentencesOf(md)
  const texts = units.map(u => blocks[u.block].text.slice(u.start, u.end))
  assert.deepEqual(texts, ['標題', '第一句。', '第二句！', 'Third one.', 'Fourth', '1. 項目一。', '2. 項目二', 'const a = 1. b', '| 甲。 | 乙 |', '| 丙 | 丁 |'])
  // a table's rule row is not counted (near enough for which hints show first)
  assert.deepEqual(units.map(u => u.line), [0, 2, 2, 2, 2, 4, 5, 8, 11, 12])
})

test('hint labels: single letters while they last, then two with no label starting another', () => {
  assert.deepEqual(hintLabels(3, 'abc'), ['a', 'b', 'c'])
  const ls = hintLabels(5, 'abc')
  assert.deepEqual(ls, ['a', 'b', 'ca', 'cb', 'cc'])
  for (const a of ls) for (const b of ls) if (a !== b) assert.ok(!b.startsWith(a))
  assert.equal(hintLabels(9, 'abc').length, 9)
})

test('hints go first to the sentences on screen', () => {
  const md = 'one.\ntwo.\nthree.\nfour.'
  const { units } = sentencesOf(md)
  // rows 1..4 hold the lines; rows 3 and 4 show
  assert.deepEqual(hintOrder(md, units, 80, { first: 3, last: 4 }), [2, 3, 0, 1])
  assert.deepEqual(hintOrder(md, units, 80, null), [0, 1, 2, 3])
})

test('picked sentences: labels drawn before them, the span selected, its text highlightable', () => {
  const md = '前言一句。重點**開始**了。\n\n下一段的結尾。最後'
  const parts = pickLayout(md, [], { labels: ['a', 'b', 'c', 'd', 'e'], from: 1, to: 2 })
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[0].runs.filter(r => r.hint).map(r => r.text), ['a', 'b'])
  assert.equal(parts[0].runs.filter(r => r.sel).map(r => r.text).join(''), '重點開始了。')
  assert.equal(parts[1].runs.filter(r => r.sel).map(r => r.text).join(''), '下一段的結尾。')
  const text = spanOf(md, 2, 1)
  assert.equal(text, '重點開始了。\n\n下一段的結尾。')
  // what is copied lights up again as a highlight of the same words
  const lit = layout(md, selectionFragments(text))
  assert.deepEqual(lit.filter(p => p.type === 'runs').map(p => litOf(p.runs)), ['重點開始了。', '下一段的結尾。'])
})

test('keys meet when equal, or one long enough is the head of the other', () => {
  const head = 'x'.repeat(40)
  assert.ok(keysMeet(head, head + ' more'))
  assert.ok(!keysMeet('short', 'short and more'))
  assert.ok(keysMeet('short', 'short'))
})
