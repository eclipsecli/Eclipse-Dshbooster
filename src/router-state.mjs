import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const ROUTER_PHASES = new Set(['intake', 'plan', 'execute', 'verify', 'recover'])
const VERIFICATION_RESULTS = new Set(['passed', 'partial', 'failed'])

function now() {
  return new Date().toISOString()
}

function safeSessionId(sessionId) {
  return String(sessionId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
}

export function statePath(sessionId, config = {}) {
  const root = resolve(config.stateDirectory || join(process.cwd(), '.router-state'))
  return join(root, `${safeSessionId(sessionId)}.json`)
}

export function createRouterState({ sessionId, task = '', classification = null } = {}) {
  const timestamp = now()
  return {
    schemaVersion: 1,
    sessionId: String(sessionId || ''),
    task,
    route: classification,
    phase: 'intake',
    goal: task,
    core: [],
    verified: [],
    open: [],
    next: task ? 'Classify the task and choose the first bounded action.' : '',
    checkpoints: [],
    verification: {
      requirements: [],
      records: []
    },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function normalizeState(value, fallback) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) return fallback
  return {
    ...fallback,
    ...value,
    core: Array.isArray(value.core) ? value.core : [],
    verified: Array.isArray(value.verified) ? value.verified : [],
    open: Array.isArray(value.open) ? value.open : [],
    checkpoints: Array.isArray(value.checkpoints) ? value.checkpoints : [],
    verification: {
      requirements: Array.isArray(value.verification?.requirements) ? value.verification.requirements : [],
      records: Array.isArray(value.verification?.records) ? value.verification.records : []
    }
  }
}

export function loadRouterState(sessionId, config = {}, seed = {}) {
  const fallback = createRouterState({ sessionId, ...seed })
  try {
    return normalizeState(JSON.parse(readFileSync(statePath(sessionId, config), 'utf8')), fallback)
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error(`router state is unreadable: ${error.message}`)
  }
}

export function saveRouterState(state, config = {}) {
  const target = statePath(state.sessionId, config)
  mkdirSync(dirname(target), { recursive: true })
  const next = { ...state, updatedAt: now() }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
  return next
}

function appendUnique(values, value, limit = 100) {
  const text = String(value || '').trim()
  if (!text || values.includes(text)) return values
  return [...values, text].slice(-limit)
}

export function updateCheckpoint(state, input = {}) {
  const phase = input.phase ? String(input.phase).trim().toLowerCase() : state.phase
  if (!ROUTER_PHASES.has(phase)) throw new Error(`invalid phase: ${input.phase}`)
  const next = {
    ...state,
    phase,
    goal: input.goal === undefined ? state.goal : String(input.goal).trim(),
    next: input.next === undefined ? state.next : String(input.next).trim(),
    core: appendUnique(state.core, input.core, 2),
    verified: appendUnique(state.verified, input.verified),
    open: appendUnique(state.open, input.open)
  }
  const checkpoint = String(input.checkpoint || '').trim()
  if (checkpoint) {
    next.checkpoints = [...state.checkpoints, { at: now(), phase, note: checkpoint }].slice(-50)
  }
  return next
}

export function advancePhase(state, eventType) {
  if (eventType === 'tool/call' && ['intake', 'plan', 'recover'].includes(state.phase)) {
    return { ...state, phase: 'execute' }
  }
  if (['compaction/start', 'compaction/summary', 'compaction/end', 'compaction/prune', 'agent/resume', 'session/resume'].includes(eventType)) {
    return { ...state, phase: 'recover' }
  }
  return state
}

export function updateVerification(state, input = {}) {
  const action = String(input.action || '').trim().toLowerCase()
  const item = String(input.item || '').trim()
  if (!item) throw new Error('verification item is required')
  if (action === 'declare') {
    return {
      ...state,
      phase: state.phase === 'intake' ? 'plan' : state.phase,
      verification: {
        ...state.verification,
        requirements: appendUnique(state.verification.requirements, item)
      }
    }
  }
  if (action !== 'record') throw new Error('action must be declare or record')
  const result = String(input.result || '').trim().toLowerCase()
  if (!VERIFICATION_RESULTS.has(result)) throw new Error('result must be passed, partial, or failed')
  const record = {
    item,
    result,
    verifier: String(input.verifier || '').trim(),
    coverage: String(input.coverage || '').trim(),
    evidence: String(input.evidence || '').trim(),
    at: now()
  }
  if (!record.verifier || !record.coverage) throw new Error('record requires verifier and coverage')
  return {
    ...state,
    phase: result === 'passed' ? 'verify' : 'recover',
    verification: {
      ...state.verification,
      records: [...state.verification.records, record].slice(-200)
    }
  }
}

export function verificationSummary(state) {
  const latest = new Map()
  for (const record of state.verification.records) latest.set(record.item, record)
  const requirements = state.verification.requirements.map((item) => ({
    item,
    record: latest.get(item) ?? null
  }))
  const passed = requirements.filter((entry) => entry.record?.result === 'passed').length
  return {
    required: requirements.length,
    passed,
    complete: requirements.length > 0 && passed === requirements.length,
    requirements
  }
}

export function renderStateAnchor(state) {
  const verification = verificationSummary(state)
  return [
    'Maintain the task lifecycle using this external router ledger. Do not claim completion from a local success.',
    `Phase: ${state.phase}`,
    `Goal: ${state.goal || '(unset)'}`,
    `Core: ${state.core.length ? state.core.join(' | ') : '(none)'}`,
    `Verified: ${state.verified.length ? state.verified.join(' | ') : '(none)'}`,
    `Open: ${state.open.length ? state.open.join(' | ') : '(none)'}`,
    `Next: ${state.next || '(unset)'}`,
    `Verification coverage: ${verification.passed}/${verification.required}; completion-ready=${verification.complete}`,
    'Use task_router_checkpoint at meaningful seams and task_router_verification to declare and record verifier coverage.'
  ].join('\n')
}
