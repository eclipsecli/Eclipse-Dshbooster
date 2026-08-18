import test from 'node:test'
import assert from 'node:assert/strict'
import { auditOutgoing, guideFor, personaFor, selectJSpace } from '../src/protocol.mjs'

test('J-Space gate selects fast, full, and loop with at most two modules', () => {
  assert.deepEqual(selectJSpace({ text: 'rename one label' }), { pass: 'fast', modules: [], untrusted: false, introspectionRequired: false })
  const full = selectJSpace({ text: 'Design a comprehensive architecture and verify edge cases' })
  assert.equal(full.pass, 'full')
  assert.deepEqual(full.modules, ['self-monitoring'])
  const loop = selectJSpace({ text: 'Work across multiple files and turns with checkpoints', retrieved: true })
  assert.equal(loop.pass, 'loop')
  assert.deepEqual(loop.modules, ['capacity', 'broadcast'])
  assert.equal(loop.introspectionRequired, true)
})

test('untrusted content forces introspection outside loop', () => {
  assert.deepEqual(selectJSpace({ text: 'summarize this', retrieved: true }).modules, ['introspection'])
})

test('personas are model-specific and complex non-Flash guidance gets closure', () => {
  assert.notEqual(personaFor('weak', 'deepseek-v4-flash'), personaFor('weak', 'deepseek-v4-pro'))
  assert.match(guideFor(3, 'Design a comprehensive multi-file architecture', 'deepseek-v4-pro'), /new task/i)
  assert.match(guideFor(3, 'Design a comprehensive multi-file architecture', 'deepseek-v4-pro'), /decision or an information need/i)
  assert.doesNotMatch(guideFor(3, 'Design a comprehensive multi-file architecture', 'deepseek-v4-flash'), /decision or an information need/i)
})

test('outgoing audit reports without rewriting', () => {
  const text = 'I see meltdown ⇒ retry\nverified already'
  const result = auditOutgoing(text)
  assert.equal(result.clean, false)
  assert.deepEqual(result.findings, ['inner-register notation in outgoing text', 'state markers in outgoing text', 'verification claim without stated coverage'])
  assert.equal(text, 'I see meltdown ⇒ retry\nverified already')
})
