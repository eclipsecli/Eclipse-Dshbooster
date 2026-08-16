import test from 'node:test'
import assert from 'node:assert/strict'
import { DriftProbe } from '../src/drift-probe.mjs'

test('records observable boundaries without retaining reasoning text', () => {
  const probe = new DriftProbe()
  probe.setExpectedMode('spec')
  probe.observeEvent({
    type: 'assistant/chunk',
    data: { chunk: { type: 'reasoning-delta', text: 'private reasoning marker' } }
  })
  probe.observeEvent({ type: 'tool/call', data: { name: 'read' } })
  probe.observeEvent({ type: 'compaction/end' })
  const snapshot = probe.snapshot()
  assert.equal(snapshot.assistantChunks, 1)
  assert.equal(snapshot.toolCalls, 1)
  assert.equal(snapshot.compactions, 1)
  assert.equal(JSON.stringify(snapshot).includes('private reasoning marker'), false)
})

test('flags missing anchors and mode changes', () => {
  const probe = new DriftProbe()
  probe.setExpectedMode('spec')
  probe.observeAssembly({ mode: 'react', hasPersona: false, hasExpectedTools: false, promoted: false })
  assert.deepEqual(probe.snapshot().signals, ['mode-changed', 'anchor-missing', 'tool-surface-mismatch'])
})
