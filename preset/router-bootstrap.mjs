import { classifyTask } from '../src/classifier.mjs'
import { DriftProbe } from '../src/drift-probe.mjs'

export const name = 'task-router-bootstrap'
export const inject = ['systemPrompt', 'tools', 'llm']

const PERSONAS = {
  spec: 'You are a helpful software engineer assistant.',
  react: 'You are a hands-on software engineer who delivers working output fast. Work directly: produce, verify, fix.',
  'deep-react': 'You are a hands-on software engineer. Think deeply about architecture and edge cases, then commit and act. Produce, verify, fix.',
  weak: 'You are a helpful software engineer assistant.'
}

function textFromEvent(data) {
  const payload = data?.message && typeof data.message === 'object' ? data.message : data
  const content = Array.isArray(payload?.content) ? payload.content : []
  return content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join(' ')
}

function jsonSchema(parameters = {}) {
  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(parameters)) {
    properties[key] = { type: value.type, description: value.description }
    if (value.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

const ROUTER_MODES = new Set(['off', 'ambiguous-only', 'always'])

function routerMode(config) {
  const value = String(config?.llmClassifier ?? 'off').trim().toLowerCase()
  return ROUTER_MODES.has(value) ? value : 'off'
}

function parseClassifierJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0])
    if (!['spec', 'react', 'deep-react', 'weak'].includes(value.mode)) return null
    if (typeof value.confidence !== 'number') return null
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
      provider,
      model,
      reasoningEffort: 'off',
      maxTokens: 160,
      temperature: 0,
      system: 'Classify the task. Return JSON only: {"mode":"spec|react|deep-react|weak","confidence":0.0,"reason":"short"}. Never explain.',
      messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
      signal: controller.signal
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (output.length > 1200) break
    }
    return parseClassifierJson(output)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function apply(ctx, config = {}) {
  const classifications = new Map()
  const llmClassifications = new Map()
  const agents = new Map()
  const firstUserText = new Map()
  const probes = new Map()
  const llmMode = routerMode(config)

  ctx.on('session/event', (session, event) => {
    const probe = probes.get(session.id) ?? new DriftProbe()
    probes.set(session.id, probe)
    probe.observeEvent(event)
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'user') return
    const text = textFromEvent(event.data).trim()
    if (!text || firstUserText.has(session.id)) return
    firstUserText.set(session.id, text)
    classifications.set(session.id, classifyTask(text))
    probe.setExpectedMode(classifications.get(session.id).mode)
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (!agent) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    let classification = classifications.get(session.id) ?? classifyTask(firstUserText.get(session.id) ?? '')
    const shouldAskLlm = llmMode === 'always' || (llmMode === 'ambiguous-only' && classification.abstain)
    if (shouldAskLlm && !llmClassifications.has(session.id)) {
      const refined = await classifyWithLlm(ctx, agent, firstUserText.get(session.id) ?? '', config.llmTimeoutMs ?? 1200)
      llmClassifications.set(session.id, refined)
    }
    const refined = llmClassifications.get(session.id)
    if (refined && refined.confidence >= (config.llmMinConfidence ?? 0.7)) {
      classification = {
        ...classification,
        ...refined,
        abstain: false,
        source: 'llm-off'
      }
    }
    classifications.set(session.id, classification)
    const probe = probes.get(session.id) ?? new DriftProbe()
    probes.set(session.id, probe)
    probe.setExpectedMode(classification.mode)

    const hasToolCall = session.events.some((event) => event.type === 'tool/call')
    if (hasToolCall) {
      probe.observeAssembly({ mode: classification.mode, hasPersona: true, hasExpectedTools: true, promoted: true })
      return assembled
    }

    const available = new Set(assembled.tools.map((tool) => tool.name))
    const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
    if (!shell) throw new Error(`${name}: no platform shell in catalog`)

    const core = new Set([shell])
    if (classification.mode === 'spec') {
      for (const tool of ['read', 'edit', 'glob', 'grep']) core.add(tool)
    } else if (classification.mode === 'react' || classification.mode === 'deep-react') {
      for (const tool of ['read', 'write', 'edit']) core.add(tool)
    } else {
      core.add(available.has('str_replace_editor') ? 'str_replace_editor' : 'edit')
    }

    const persona = PERSONAS[classification.mode] ?? PERSONAS.weak
    const sections = (assembled.sections ?? []).filter((section) => !/persona/i.test(section.name))
    sections.push({ name: 'task-router-persona', text: persona, order: 0 })
    const routed = {
      ...assembled,
      sections,
      contexts: [],
      tools: assembled.tools.filter((tool) => core.has(tool.name))
    }
    probe.observeAssembly({
      mode: classification.mode,
      hasPersona: routed.sections.some((section) => section.name === 'task-router-persona'),
      hasExpectedTools: routed.tools.some((tool) => core.has(tool.name)),
      promoted: false
    })
    return routed
  })

  const registerTool = (tool) => ctx.effect(() => ctx.tools.register({
    ...tool,
    parameters: jsonSchema(tool.parameters)
  }))

  registerTool({
    name: 'task_router_status',
    description: 'Show the first-turn task classification, confidence, evidence, abstain status, and selected behavior mode.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute() {
      const agent = ctx.get('agent') ?? [...agents.values()].at(-1)
      const session = agent?.session
      if (!session) return 'task-router: no active session'
      const classification = classifications.get(session.id) ?? classifyTask(firstUserText.get(session.id) ?? '')
      return JSON.stringify({
        classifier: 'dsh-task-router-v0',
        task: firstUserText.get(session.id) ?? '',
        classification,
        llmClassifier: llmMode,
        driftProbe: probes.get(session.id)?.snapshot() ?? null
      }, null, 2)
    }
  })
}
