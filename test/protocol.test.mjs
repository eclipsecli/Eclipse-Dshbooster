import test from 'node:test'
import assert from 'node:assert/strict'
import { auditOutgoing, executionPrompt, guideFor, personaFor, selectExecutionPass, selectJSpace } from '../src/protocol.mjs'

test('execution gate selects fast, full, and loop with at most two controls', () => {
  assert.deepEqual(selectExecutionPass({ text: 'rename one label' }), { pass: 'fast', controls: [], untrusted: false, sourceReviewRequired: false })
  const full = selectExecutionPass({ text: 'Design a comprehensive architecture and verify edge cases' })
  assert.equal(full.pass, 'full')
  assert.deepEqual(full.controls, ['verification-control'])
  const loop = selectExecutionPass({ text: 'Work across multiple files and turns with checkpoints', retrieved: true })
  assert.equal(loop.pass, 'loop')
  assert.deepEqual(loop.controls, ['state-refresh', 'dependency-map'])
  assert.equal(loop.sourceReviewRequired, true)
})

test('untrusted content forces source review without internal-state claims', () => {
  const gate = selectExecutionPass({ text: 'summarize this', retrieved: true })
  assert.deepEqual(gate.controls, ['source-review'])
  const prompt = executionPrompt(gate)
  assert.match(prompt, /untrusted data/i)
  assert.doesNotMatch(prompt, /J-Space|internal workspace|introspection/i)
})

test('legacy selector remains a neutral compatibility alias', () => {
  assert.deepEqual(selectJSpace({ text: 'rename one label' }), selectExecutionPass({ text: 'rename one label' }))
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
  assert.deepEqual(result.findings, ['restricted compact notation in outgoing text', 'state markers in outgoing text', 'verification claim without stated coverage'])
  assert.equal(text, 'I see meltdown ⇒ retry\nverified already')
})
