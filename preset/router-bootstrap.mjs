import { classifyTask } from '../src/classifier.mjs'
import { DriftProbe } from '../src/drift-probe.mjs'
import {
  MANAGEMENT_TOOLS,
  RL_PERSONA,
  auditOutgoing,
  guideFor,
  hasRouterOwner,
  isChatTask,
  executionPrompt,
  parseMode,
  personaFor,
  selectExecutionPass
} from '../src/protocol.mjs'
import {
  advancePhase,
  loadRouterState,
  recordSeam,
  renderStateAnchor,
  saveRouterState,
  updateCheckpoint,
  updateVerification,
  verificationSummary
} from '../src/router-state.mjs'

export const name = 'eclipse-dshbooster'
export const inject = ['systemPrompt', 'tools', 'llm']

const management = new Set(MANAGEMENT_TOOLS)
const routerModes = new Set(['off', 'ambiguous-only', 'always'])

function textFromEvent(data) {
  const payload = data?.message && typeof data.message === 'object' ? data.message : data
  const content = Array.isArray(payload?.content) ? payload.content : []
  return content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join(' ')
}

function schema(parameters = {}) {
  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(parameters)) {
    properties[key] = { type: value.type, description: value.description }
    if (value.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function parseClassifierJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0])
    if (!['spec', 'react', 'deep-react', 'weak', 'mixed'].includes(value.mode) || typeof value.confidence !== 'number') return null
    return value
  } catch { return null }
}

export async function classifyWithLlm(ctx, agent, task, timeoutMs = 1200) {
  const provider = agent?.options?.provider
  const model = agent?.options?.model
  if (!provider || !model || !ctx?.llm?.stream) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let output = ''
  try {
    const stream = ctx.llm.stream({
      provider, model, reasoningEffort: 'off', maxTokens: 160, temperature: 0,
      system: 'Classify the task. Return JSON only: {"mode":"spec|react|deep-react|weak|mixed","confidence":0.0,"reason":"short"}.',
      messages: [{ role: 'user', content: [{ type: 'text', text: task }] }], signal: controller.signal
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (output.length > 1200) break
    }
    return parseClassifierJson(output)
  } catch { return null } finally { clearTimeout(timer) }
}

export function apply(ctx, config = {}) {
  const classifications = new Map()
  const firstTexts = new Map()
  const states = new Map()
  const agents = new Map()
  const probes = new Map()
  const guided = new Map()
  const guidedEvents = new WeakSet()
  const inactive = new Set()
  const chat = new Set()
  const llmResults = new Map()
  const llmMode = routerModes.has(config.llmClassifier) ? config.llmClassifier : 'off'
  const runtimeMode = config.routerMode === 'spec' ? 'spec' : 'standard'
  const dedicatedPreset = config.dedicatedPreset !== false

  const stateConfig = (session) => config.stateDirectory
    ? config
    : session?.header?.cwd ? { ...config, stateDirectory: `${session.header.cwd}/.router-state` } : config

  function stateFor(session, seed = {}) {
    if (!states.has(session.id)) states.set(session.id, loadRouterState(session.id, stateConfig(session), seed))
    return states.get(session.id)
  }

  function persist(session, state) {
    const saved = saveRouterState(state, stateConfig(session))
    states.set(session.id, saved)
    return saved
  }

  function routeFor(session, modelId) {
    const state = stateFor(session)
    const classified = classifications.get(session.id) || state.route || classifyTask(firstTexts.get(session.id) || '')
    const mode = state.modeOverride || classified.mode || 'weak'
    return { classified, mode, persona: personaFor(mode, modelId) }
  }

  ctx.on('session/event', (session, event) => {
    const probe = probes.get(session.id) || new DriftProbe()
    probes.set(session.id, probe)
    probe.observeEvent(event)
    const current = stateFor(session, { task: firstTexts.get(session.id) || '', classification: classifications.get(session.id) || null })
    const advanced = advancePhase(current, event?.type)
    if (advanced !== current) persist(session, advanced)

    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') return
    const text = textFromEvent(event.data).trim()
    if (!text) return
    if (guidedEvents.has(event)) return
    if (!firstTexts.has(session.id)) firstTexts.set(session.id, text)
    const round = (session.events || []).filter((item) => item.type === 'user/message' && item.data?.source?.kind === 'user').length || 1
    if (!classifications.has(session.id) || round >= 3) classifications.set(session.id, classifyTask(text))
    const classification = classifications.get(session.id)
    let next = stateFor(session, { task: text, classification })
    if (!next.task) next = { ...next, task: text, goal: text, route: classification, phase: 'plan', next: 'Choose the first bounded action.' }
    else if (round >= 3) next = { ...next, route: classification }
    persist(session, next)

    if (inactive.has(session.id) || chat.has(session.id)) return
    const target = ctx.get('agent')?.session === session ? ctx.get('agent') : agents.get(session.id)
    const mode = next.modeOverride || classification.mode
    if (mode !== 'weak' || !target?.inbox || (event.id !== undefined && guided.get(session.id) === event.id)) return
    try {
      target.inbox.append('next-step', {
        id: `dshbooster-guide-${event.id || `${round}-${Date.now()}`}`,
        role: 'user', source: { kind: 'plugin', plugin: name },
        content: [{ type: 'text', text: guideFor(round, text, target.options?.model) }]
      })
      guidedEvents.add(event)
      if (event.id !== undefined) guided.set(session.id, event.id)
    } catch { /* inbox races are harmless; a later assembly still carries the route */ }
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (!agent) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    if (hasRouterOwner(assembled)) {
      inactive.add(session.id)
      return assembled
    }
    inactive.delete(session.id)

    const firstText = firstTexts.get(session.id) || textFromEvent(session.events?.find((event) => event.type === 'user/message')?.data)
    if (!dedicatedPreset && isChatTask(firstText)) {
      chat.add(session.id)
      return assembled
    }
    chat.delete(session.id)

    let classification = classifications.get(session.id) || classifyTask(firstText)
    const askLlm = llmMode === 'always' || (llmMode === 'ambiguous-only' && classification.abstain)
    if (askLlm && !llmResults.has(session.id)) llmResults.set(session.id, await classifyWithLlm(ctx, agent, firstText, config.llmTimeoutMs || 1200))
    const refined = llmResults.get(session.id)
    if (refined?.confidence >= (config.llmMinConfidence ?? 0.7)) classification = { ...classification, ...refined, abstain: false, source: 'llm-classifier' }
    classifications.set(session.id, classification)

    let state = stateFor(session, { task: firstText, classification })
    const promoted = session.events?.some((event) => event.type === 'tool/call') || state.promoted
    if (promoted !== state.promoted) state = persist(session, { ...state, promoted })
    const mode = state.modeOverride || classification.mode || 'weak'
    const persona = runtimeMode === 'standard' && !promoted ? RL_PERSONA : personaFor(mode, agent.options?.model)
    const available = new Set(assembled.tools.map((tool) => tool.name))
    const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
    if (!shell) throw new Error(`${name}: no platform shell in catalog`)

    if (!promoted && runtimeMode === 'standard') {
      const editor = available.has('str_replace_editor') ? 'str_replace_editor' : null
      if (!editor) throw new Error(`${name}: str_replace_editor missing from catalog`)
      const routed = {
        ...assembled,
        contexts: [],
        sections: [{ name: 'dshbooster-persona', text: RL_PERSONA, order: 0 }],
        tools: assembled.tools.filter((tool) => tool.name === shell || tool.name === editor)
      }
      probes.get(session.id)?.observeAssembly({ mode, hasPersona: true, hasExpectedTools: routed.tools.length === 2, promoted: false })
      return routed
    }

    const carriesUntrustedOutput = session.events?.some((event) => ['tool/result', 'tool/output', 'retrieval/result'].includes(event.type))
    const gate = selectExecutionPass({ text: firstText, pass: state.pass === 'loop' ? 'loop' : undefined, toolOutput: carriesUntrustedOutput })
    state = persist(session, { ...state, route: classification, pass: gate.pass, activeModules: gate.controls, phase: state.phase === 'intake' ? 'plan' : state.phase })
    const sections = (assembled.sections || []).filter((section) => !/persona|j-space|dshbooster/i.test(section.name))
    sections.push({ name: 'dshbooster-persona', text: persona, order: 0 })
    sections.push({ name: 'dshbooster-protocol', text: executionPrompt(gate), order: 20 })
    sections.push({ name: 'dshbooster-lifecycle', text: renderStateAnchor(state), order: 25 })

    if (promoted) {
      probes.get(session.id)?.observeAssembly({ mode, hasPersona: true, hasExpectedTools: true, promoted: true })
      return { ...assembled, sections, contexts: [] }
    }

    const allowed = new Set([shell])
    if (mode === 'spec') ['read', 'edit', 'glob', 'grep'].forEach((tool) => allowed.add(tool))
    else if (mode === 'mixed') ['read', 'write', 'edit', 'glob', 'grep'].forEach((tool) => allowed.add(tool))
    else ['read', 'write', 'edit'].forEach((tool) => allowed.add(tool))
    const routed = { ...assembled, sections, contexts: [], tools: assembled.tools.filter((tool) => allowed.has(tool.name) && !management.has(tool.name)) }
    probes.get(session.id)?.observeAssembly({ mode, hasPersona: true, hasExpectedTools: routed.tools.length > 0, promoted: false })
    return routed
  })

  const currentAgent = () => ctx.get('agent') || [...agents.values()].at(-1)
  const currentSession = () => currentAgent()?.session
  const register = (tool) => ctx.effect(() => ctx.tools.register({ ...tool, parameters: schema(tool.parameters) }))
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

  function status() {
    const session = currentSession()
    if (!session) return 'dshbooster: no active session'
    const state = stateFor(session)
    const route = routeFor(session, currentAgent()?.options?.model)
    return JSON.stringify({ protocol: 'eclipse-dshbooster', schemaVersion: state.schemaVersion, routerMode: runtimeMode, policySource: { routing: 'dsh-mode-boost-derived', governance: 'dshbooster-native', jSpace: 'reference-only' }, evidenceLevel: { routing: 'observed-community-feedback', governance: 'verified-by-local-tests', jSpacePerformance: 'unverified' }, classification: route.classified, effectiveMode: route.mode, override: state.modeOverride, promoted: state.promoted || session.events.some((event) => event.type === 'tool/call'), executionPass: state.pass, activeControls: state.activeModules, pass: state.pass, activeModules: state.activeModules, state, verification: verificationSummary(state), driftProbe: probes.get(session.id)?.snapshot() || null }, null, 2)
  }

  register({ name: 'dshbooster_status', description: 'Show the effective route, promotion, execution pass/controls, durable state, provenance, and verification coverage.', parameters: {}, output, execute: status })
  register({ name: 'task_router_status', description: 'Compatibility alias for dshbooster_status.', parameters: {}, output, execute: status })

  register({
    name: 'dshbooster_mode', description: 'Set a durable session mode override, or auto to clear it.',
    parameters: { mode: { type: 'string', required: true, description: 'auto, spec, weak, mixed, react, or deep-react' } }, output,
    execute(args = {}) {
      const session = currentSession()
      if (!session) return 'dshbooster: no active session'
      const parsed = parseMode(args.mode)
      if (!parsed) return `invalid mode "${args.mode}"`
      const state = stateFor(session)
      persist(session, { ...state, modeOverride: parsed === 'auto' ? null : parsed })
      return `mode=${parsed === 'auto' ? state.route?.mode || 'weak' : parsed}; override=${parsed === 'auto' ? 'no' : 'yes'}; next request applies`
    }
  })

  register({
    name: 'dshbooster_subagent', description: 'Run a task in a fresh, mode-isolated model context without mutating this session route.',
    parameters: { mode: { type: 'string', required: true, description: 'spec, weak, mixed, react, or deep-react' }, task: { type: 'string', required: true, description: 'isolated task' }, maxTokens: { type: 'number', description: 'output cap; default 1024' } }, output,
    async execute(args = {}) {
      const parsed = parseMode(args.mode)
      if (!parsed || parsed === 'auto') return `invalid mode "${args.mode}"`
      const agent = currentAgent()
      if (!agent?.options?.provider || !agent.options.model) return 'dshbooster: no active model route'
      let text = ''
      let reasoningChars = 0
      try {
        const stream = ctx.llm.stream({ provider: agent.options.provider, model: agent.options.model, system: personaFor(parsed, agent.options.model), messages: [{ role: 'user', content: [{ type: 'text', text: String(args.task || '') }] }], maxTokens: Number(args.maxTokens || 1024) })
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') text += chunk.text
          if (chunk.type === 'reasoning-delta') reasoningChars += chunk.text.length
        }
      } catch (error) { return `subagent error: ${error?.message || String(error)}` }
      return `[mode-subagent ${parsed} | reasoning ${reasoningChars} chars]\n${text.slice(0, 3000)}${text.length > 3000 ? '\n...(truncated)' : ''}`
    }
  })

  register({
    name: 'dshbooster_audit', description: 'Audit outgoing text for restricted notation, unsupported verification claims, and repetition; never rewrites it.',
    parameters: { text: { type: 'string', required: true, description: 'candidate outgoing text' } }, output,
    execute(args = {}) { return JSON.stringify(auditOutgoing(args.text), null, 2) }
  })

  register({
    name: 'dshbooster_seam', description: 'Record a durable lifecycle seam and return the refreshed anchor.',
    parameters: { reason: { type: 'string', description: 'why this seam matters' } }, output,
    execute(args = {}) {
      const session = currentSession()
      if (!session) return 'dshbooster: no active session'
      const state = persist(session, recordSeam(stateFor(session), String(args.reason || 'seam')))
      return renderStateAnchor(state)
    }
  })

  register({
    name: 'dshbooster_resume', description: 'Enter recovery explicitly and return a full durable re-entry anchor.',
    parameters: {}, output,
    execute() {
      const session = currentSession()
      if (!session) return 'dshbooster: no active session'
      const state = persist(session, recordSeam({ ...stateFor(session), phase: 'recover' }, 'resume'))
      return renderStateAnchor(state, { longGap: true })
    }
  })

  register({
    name: 'task_router_checkpoint', description: 'Persist a compatibility lifecycle checkpoint at a seam.',
    parameters: { phase: { type: 'string', description: 'intake, plan, execute, verify, or recover' }, goal: { type: 'string', description: 'goal' }, core: { type: 'string', description: 'load-bearing constraint' }, verified: { type: 'string', description: 'verified fact' }, open: { type: 'string', description: 'open question' }, settledBy: { type: 'string', description: 'cheapest refuting test for the open question' }, next: { type: 'string', description: 'next bounded action' }, checkpoint: { type: 'string', description: 'seam note' } }, output,
    execute(args = {}) {
      const session = currentSession()
      if (!session) return 'dshbooster: no active session'
      try {
        let state = updateCheckpoint(stateFor(session), args)
        state = recordSeam(state, args.checkpoint || 'checkpoint')
        state = persist(session, state)
        return JSON.stringify({ ok: true, phase: state.phase, next: state.next, checkpointCount: state.checkpoints.length }, null, 2)
      } catch (error) { return JSON.stringify({ ok: false, error: error.message }, null, 2) }
    }
  })

  register({
    name: 'task_router_verification', description: 'Declare a completion requirement or record verifier coverage.',
    parameters: { action: { type: 'string', description: 'declare or record' }, item: { type: 'string', description: 'verification item' }, result: { type: 'string', description: 'passed, partial, or failed' }, verifier: { type: 'string', description: 'verifier' }, coverage: { type: 'string', description: 'coverage' }, evidence: { type: 'string', description: 'evidence' } }, output,
    execute(args = {}) {
      const session = currentSession()
      if (!session) return 'dshbooster: no active session'
      try {
        const state = persist(session, updateVerification(stateFor(session), args))
        return JSON.stringify({ ok: true, phase: state.phase, verification: verificationSummary(state) }, null, 2)
      } catch (error) { return JSON.stringify({ ok: false, error: error.message }, null, 2) }
    }
  })
}
