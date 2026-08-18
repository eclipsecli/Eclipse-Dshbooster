import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRouterState, loadRouterState, recordSeam, renderStateAnchor, saveRouterState, updateCheckpoint } from '../src/router-state.mjs'

test('migrates v1 state to schema v2 with stable ids and new lifecycle fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-state-'))
  writeFileSync(join(root, 's.json'), JSON.stringify({ schemaVersion: 1, sessionId: 's', phase: 'execute', goal: 'G', core: ['a'], verified: ['done'], open: ['risk'], checkpoints: [{ at: 'x', phase: 'plan', note: 'old' }], verification: { requirements: [], records: [] } }))
  const state = loadRouterState('s', { stateDirectory: root })
  assert.equal(state.schemaVersion, 2)
  assert.equal(state.verified[0].id, 'v01')
  assert.equal(state.open[0].id, 'o01')
  assert.equal(state.checkpoints[0].id, 'c01')
  assert.equal(state.checkpoints[0].text, 'old')
  assert.deepEqual(state.activeModules, [])
  assert.equal(state.pass, 'fast')
  rmSync(root, { recursive: true, force: true })
})

test('atomic state round-trips stable ids and bounded history', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-state-'))
  let state = createRouterState({ sessionId: 's', task: 'G' })
  state = updateCheckpoint(state, { verified: 'one', open: 'two', checkpoint: 'three' })
  for (let index = 0; index < 60; index++) state = recordSeam(state, `s${index}`, Date.now() + index)
  saveRouterState(state, { stateDirectory: root })
  const loaded = loadRouterState('s', { stateDirectory: root })
  assert.equal(loaded.verified[0].id, 'v01')
  assert.equal(loaded.open[0].id, 'o01')
  assert.equal(loaded.checkpoints[0].id, 'c01')
  assert.equal(loaded.history.length, 50)
  assert.doesNotMatch(readFileSync(join(root, 's.json'), 'utf8'), /\.tmp/)
  rmSync(root, { recursive: true, force: true })
})

test('corruption is rejected plainly', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-state-'))
  writeFileSync(join(root, 's.json'), '{not-json')
  assert.throws(() => loadRouterState('s', { stateDirectory: root }), /router state is unreadable/)
  rmSync(root, { recursive: true, force: true })
})

test('long-gap seam enters recover and produces a full recovery anchor', () => {
  let state = createRouterState({ sessionId: 's', task: 'G' })
  state = recordSeam(state, 'first', 1_000)
  state = recordSeam(state, 'later', 1_000 + 1_800_001)
  assert.equal(state.phase, 'recover')
  assert.match(renderStateAnchor(state), /Recovery anchor/)
  assert.match(renderStateAnchor(state), /Goal: G/)
})
