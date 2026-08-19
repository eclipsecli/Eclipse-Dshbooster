import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const SCHEMA_VERSION = 2
export const ROUTER_PHASES = new Set(['intake', 'plan', 'execute', 'verify', 'recover'])
const VERIFICATION_RESULTS = new Set(['passed', 'partial', 'failed'])
const HISTORY_LIMIT = 50

const timestamp = () => new Date().toISOString()
const cleanId = (id) => String(id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
const array = (value) => Array.isArray(value) ? value : []

export function statePath(sessionId, config = {}) {
  const root = resolve(config.stateDirectory || join(process.cwd(), '.router-state'))
  return join(root, `${cleanId(sessionId)}.json`)
}

export function createRouterState({ sessionId, task = '', classification = null } = {}) {
  const at = timestamp()
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: String(sessionId || ''),
    task,
    route: classification,
    modeOverride: null,
    phase: 'intake',
    pass: 'fast',
    activeModules: [],
    promoted: false,
    goal: task,
    core: [],
    verified: [],
    open: [],
    next: task ? 'Classify the task and choose the first bounded action.' : '',
    checkpoints: [],
    history: [],
    verification: { requirements: [], records: [] },
    seamCount: 0,
    lastSeamAt: null,
    createdAt: at,
    updatedAt: at
  }
}

function stableRows(rows, prefix) {
  let next = 1
  return array(rows).map((row) => {
    if (row && typeof row === 'object' && row.id) {
      const found = Number(String(row.id).replace(/\D/g, ''))
      if (found >= next) next = found + 1
      return { ...row, text: String(row.text ?? row.note ?? '') }
    }
    const text = row && typeof row === 'object' ? row.text ?? row.note ?? '' : row
    return { ...(row && typeof row === 'object' ? row : {}), id: `${prefix}${String(next++).padStart(2, '0')}`, text: String(text || ''), at: row?.at || timestamp() }
  }).filter((row) => row.text)
}

function migrate(value, fallback) {
  if (!value || typeof value !== 'object') throw new Error('state root must be an object')
  if (![1, 2].includes(value.schemaVersion)) throw new Error(`unsupported schema version: ${value.schemaVersion}`)
  const migrated = {
    ...fallback,
    ...value,
    schemaVersion: SCHEMA_VERSION,
    core: array(value.core).slice(0, 2),
    verified: stableRows(value.verified, 'v'),
    open: stableRows(value.open, 'o'),
    checkpoints: stableRows(value.checkpoints, 'c'),
    history: array(value.history).slice(-HISTORY_LIMIT),
    activeModules: array(value.activeModules).slice(0, 2),
    verification: {
      requirements: array(value.verification?.requirements),
      records: array(value.verification?.records)
    }
  }
  if (!ROUTER_PHASES.has(migrated.phase)) throw new Error(`invalid phase: ${migrated.phase}`)
  if (!['fast', 'full', 'loop'].includes(migrated.pass)) migrated.pass = 'fast'
  return migrated
}

export function loadRouterState(sessionId, config = {}, seed = {}) {
  const fallback = createRouterState({ sessionId, ...seed })
  try {
    return migrate(JSON.parse(readFileSync(statePath(sessionId, config), 'utf8')), fallback)
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error(`router state is unreadable: ${error.message}`)
  }
}

export function saveRouterState(state, config = {}) {
  const target = statePath(state.sessionId, config)
  mkdirSync(dirname(target), { recursive: true })
  const next = { ...state, schemaVersion: SCHEMA_VERSION, updatedAt: timestamp() }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
  return next
}

function appendUnique(values, value, limit = 100) {
  const text = String(value || '').trim()
  return !text || values.includes(text) ? values : [...values, text].slice(-limit)
}

function nextRow(rows, prefix, text, extra = {}) {
  const maximum = rows.reduce((max, row) => Math.max(max, Number(String(row.id).replace(/\D/g, '')) || 0), 0)
  return { id: `${prefix}${String(maximum + 1).padStart(2, '0')}`, text: String(text).trim(), at: timestamp(), ...extra }
}

export function updateCheckpoint(state, input = {}) {
  const phase = input.phase ? String(input.phase).trim().toLowerCase() : state.phase
  if (!ROUTER_PHASES.has(phase)) throw new Error(`invalid phase: ${input.phase}`)
  const next = {
    ...state,
    phase,
    goal: input.goal === undefined ? state.goal : String(input.goal).trim(),
    next: input.next === undefined ? state.next : String(input.next).trim(),
    core: appendUnique(state.core, input.core, 2)
  }
  if (input.verified) next.verified = [...state.verified, nextRow(state.verified, 'v', input.verified)].slice(-100)
  if (input.open) next.open = [...state.open, nextRow(state.open, 'o', input.open, { settledBy: String(input.settledBy || '').trim() })].slice(-100)
  if (input.checkpoint) next.checkpoints = [...state.checkpoints, nextRow(state.checkpoints, 'c', input.checkpoint, { phase })].slice(-50)
  return next
}

export function advancePhase(state, eventType) {
  if (eventType === 'tool/call') return { ...state, promoted: true, phase: ['intake', 'plan', 'recover'].includes(state.phase) ? 'execute' : state.phase }
  if (/^(compaction\/|agent\/resume|session\/resume)/.test(String(eventType))) return { ...state, phase: 'recover' }
  return state
}

export function recordSeam(state, reason = 'seam', at = Date.now()) {
  const gapMs = state.lastSeamAt ? at - Date.parse(state.lastSeamAt) : 0
  return {
    ...state,
    seamCount: state.seamCount + 1,
    lastSeamAt: new Date(at).toISOString(),
    phase: gapMs > 1_800_000 ? 'recover' : state.phase,
    history: [...state.history, { at: new Date(at).toISOString(), reason, phase: state.phase, pass: state.pass, next: state.next }].slice(-HISTORY_LIMIT)
  }
}

export function updateVerification(state, input = {}) {
  const action = String(input.action || '').trim().toLowerCase()
  const item = String(input.item || '').trim()
  if (!item) throw new Error('verification item is required')
  if (action === 'declare') return { ...state, phase: state.phase === 'intake' ? 'plan' : state.phase, verification: { ...state.verification, requirements: appendUnique(state.verification.requirements, item) } }
  if (action !== 'record') throw new Error('action must be declare or record')
  const result = String(input.result || '').trim().toLowerCase()
  if (!VERIFICATION_RESULTS.has(result)) throw new Error('result must be passed, partial, or failed')
  const record = { item, result, verifier: String(input.verifier || '').trim(), coverage: String(input.coverage || '').trim(), evidence: String(input.evidence || '').trim(), at: timestamp() }
  if (!record.verifier || !record.coverage) throw new Error('record requires verifier and coverage')
  return { ...state, phase: result === 'passed' ? 'verify' : 'recover', verification: { ...state.verification, records: [...state.verification.records, record].slice(-200) } }
}

export function verificationSummary(state) {
  const latest = new Map(state.verification.records.map((record) => [record.item, record]))
  const requirements = state.verification.requirements.map((item) => ({ item, record: latest.get(item) ?? null }))
  const passed = requirements.filter((entry) => entry.record?.result === 'passed').length
  return { required: requirements.length, passed, complete: requirements.length > 0 && passed === requirements.length, requirements }
}

const texts = (rows) => rows.map((row) => typeof row === 'string' ? row : `${row.id} ${row.text}`)

export function renderStateAnchor(state, { longGap = false } = {}) {
  const verification = verificationSummary(state)
  return [
    longGap || state.phase === 'recover' ? 'Recovery anchor: re-read the durable task state and continue from Next; do not reconstruct hidden reasoning.' : 'Lifecycle anchor: persist observed task state at meaningful seams.',
    `Phase: ${state.phase}; pass: ${state.pass}; route: ${state.route?.mode || state.route || 'weak'}`,
    `Active controls: ${state.activeModules.join(', ') || '(none)'}`,
    `Goal: ${state.goal || '(unset)'}`,
    `Core: ${state.core.join(' | ') || '(none)'}`,
    `Verified: ${texts(state.verified).join(' | ') || '(none)'}`,
    `Open: ${texts(state.open).join(' | ') || '(none)'}`,
    `Next: ${state.next || '(unset)'}`,
    `Verification coverage: ${verification.passed}/${verification.required}; completion-ready=${verification.complete}`,
    'At a seam, record only durable facts. Never store private reasoning text.'
  ].join('\n')
}
