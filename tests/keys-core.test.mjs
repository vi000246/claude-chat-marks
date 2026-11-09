// node --test tests/keys-core.test.mjs  (from the plugin folder)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canon, chordFor, globalProblem, isPanelKey, rebind, unbind, usersOf } from '../hooks/keys-core.mjs'

test('a chord has one spelling; meta is the terminal\'s alt', () => {
  assert.equal(canon('shift+meta+O'), 'alt+shift+o')
  assert.equal(canon('alt+ctrl+e'), 'ctrl+alt+e')
})

test('a global hotkey needs ctrl or alt and may not be one the terminal keeps', () => {
  assert.equal(globalProblem('alt+m'), null)
  assert.deepEqual(globalProblem('m'), { needsModifier: true })
  assert.deepEqual(globalProblem('shift+m'), { needsModifier: true })
  assert.ok(globalProblem('ctrl+c').reserved)
  assert.ok(isPanelKey('j'))
  assert.ok(!isPanelKey('alt+j'))
})

test('what else answers a chord: the file, and Claude Code unless the file unbound it', () => {
  const doc = { bindings: [{ context: 'Chat', bindings: { 'alt+enter': 'chat:externalEditor' } }] }
  assert.deepEqual(usersOf(doc, 'alt+enter', 'diff:back'), [{ context: 'Chat', action: 'chat:externalEditor', key: 'alt+enter' }])
  assert.deepEqual(usersOf(doc, 'alt+o', 'diff:back'), [{ context: 'Chat', action: 'chat:fastMode' }])
  const unbound = { bindings: [{ context: 'Chat', bindings: { 'meta+o': null } }] }
  assert.deepEqual(usersOf(unbound, 'alt+o', 'diff:back'), [])
  assert.deepEqual(usersOf({}, 'alt+m', 'diff:back'), [])
})

test('rebinding moves the action to the new chord and takes the chord off whatever had it', () => {
  const doc = {
    bindings: [
      { context: 'Chat', bindings: { 'ctrl+v': 'chat:imagePaste' } },
      { context: 'Global', bindings: { 'alt+l': 'app:toggleDiffPreSession', 'alt+m': 'diff:back' } },
    ],
  }
  const { doc: out, taken } = rebind(doc, 'diff:back', 'alt+o')
  assert.deepEqual(taken, [{ context: 'Chat', action: 'chat:fastMode' }])
  assert.deepEqual(out.bindings[0].bindings, { 'ctrl+v': 'chat:imagePaste', 'alt+o': null })
  assert.deepEqual(out.bindings[1].bindings, { 'alt+l': 'app:toggleDiffPreSession', 'alt+o': 'diff:back' })
  assert.equal(chordFor(out, 'diff:back'), 'alt+o')
  // the input is left alone
  assert.equal(doc.bindings[1].bindings['alt+m'], 'diff:back')
})

test('rebinding into an empty file writes the schema and a Global block', () => {
  const { doc } = rebind({}, 'diff:nextFile', 'alt+j')
  assert.equal(doc.$schema, 'https://www.schemastore.org/claude-code-keybindings.json')
  assert.deepEqual(doc.bindings, [{ context: 'Global', bindings: { 'alt+j': 'diff:nextFile' } }])
  assert.equal(chordFor(unbind(doc, 'diff:nextFile'), 'diff:nextFile'), null)
})
