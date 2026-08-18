import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, classifyWithLlm } from '../preset/router-bootstrap.mjs'

const allToolNames = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'str_replace_editor', 'web_search', 'dshbooster_status', 'dshbooster_mode', 'dshbooster_subagent', 'dshbooster_audit', 'task_router_status', 'task_router_checkpoint', 'task_router_verification']
const assembled = { sections: [{ name: 'persona', text: 'host persona' }, { name: 'plan-mode', text: 'host plan' }], contexts: [{ source: 'host' }], tools: allToolNames.map((name) => ({ name })) }

test('shipped preset scopes router settings to the bootstrap row', () => {
  const preset = readFileSync(new URL('../agent.cordis.yml', import.meta.url), 'utf8')
  const persona = preset.slice(preset.indexOf('- id: persona'), preset.indexOf('- id: task-router-bootstrap'))
  const bootstrap = preset.slice(preset.indexOf('- id: task-router-bootstrap'), preset.indexOf('- id: tool-bash'))
  assert.doesNotMatch(persona, /routerMode|dedicatedPreset/)
  assert.match(bootstrap, /routerMode: 'standard'/)
  assert.match(bootstrap, /dedicatedPreset: true/)
})

function harness(config = {}, chunks = []) {
  const stateDirectory = config.stateDirectory || mkdtempSync(join(tmpdir(), 'dshbooster-'))
  const handlers = new Map()
  const registered = []
  const appended = []
  const session = { id: config.sessionId || 's1', events: [], header: { cwd: stateDirectory } }
  const agent = { session, options: { provider: 'deepseek-official', model: config.model || 'deepseek-v4-pro' }, inbox: { append(kind, value) { appended.push({ kind, value }) } } }
  const ctx = {
    tools: { register(tool) { registered.push(tool); return () => {} } },
    on(name, fn) { handlers.set(name, fn) }, effect(fn) { return fn() },
    get(name) { return name === 'agent' ? agent : undefined },
    llm: { stream(options) { ctx.lastLlmOptions = options; return (async function* () { for (const chunk of chunks) yield chunk })() } }
  }
  apply(ctx, { ...config, stateDirectory })
  const event = (value) => { session.events.push(value); handlers.get('session/event')(session, value) }
  const assemble = (value = assembled) => handlers.get('system-prompt/assemble')({}, { agent }, async () => value)
  return { handlers, registered, appended, session, agent, ctx, stateDirectory, event, assemble, cleanup: () => rmSync(stateDirectory, { recursive: true, force: true }) }
}

test('standard first request exposes exactly shell and str_replace_editor with exact RL persona', async () => {
  const h = harness()
  h.event({ id: 'u1', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复当前项目错误' }] } })
  const result = await h.assemble()
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'str_replace_editor'])
  assert.deepEqual(result.sections, [{ name: 'dshbooster-persona', text: 'You are a helpful software engineer assistant.', order: 0 }])
  assert.deepEqual(result.contexts, [])
  h.cleanup()
})

test('management tools are registered but hidden before promotion, then full catalog returns', async () => {
  const h = harness()
  assert.ok(h.registered.some((tool) => tool.name === 'dshbooster_mode'))
  assert.ok(h.registered.some((tool) => tool.name === 'task_router_status'))
  assert.deepEqual((await h.assemble()).tools.map((tool) => tool.name), ['bash', 'str_replace_editor'])
  h.event({ id: 't1', type: 'tool/call', data: { name: 'bash' } })
  const promoted = await h.assemble()
  assert.deepEqual(promoted.tools.map((tool) => tool.name), allToolNames)
  assert.ok(promoted.sections.some((section) => section.name === 'dshbooster-lifecycle'))
  h.cleanup()
})

test('promotion is durable across plugin reload and absent session event history', async () => {
  const h1 = harness()
  h1.event({ id: 't1', type: 'tool/call', data: { name: 'bash' } })
  await h1.assemble()
  const h2 = harness({ stateDirectory: h1.stateDirectory, sessionId: 's1' })
  const result = await h2.assemble()
  assert.deepEqual(result.tools.map((tool) => tool.name), allToolNames)
  h2.cleanup()
})

test('spec router mode keeps read-first routing while hiding management before promotion', async () => {
  const h = harness({ routerMode: 'spec' })
  h.event({ id: 'u1', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复当前项目错误' }] } })
  const result = await h.assemble()
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'edit', 'glob', 'grep'])
  assert.equal(result.tools.some((tool) => tool.name.startsWith('dshbooster_')), false)
  h.cleanup()
})

test('weak guidance is deduplicated and rounds three plus force fresh classification text', () => {
  const h = harness()
  const one = { id: 'u1', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看看这个' }] } }
  h.event(one)
  h.handlers.get('session/event')(h.session, one)
  h.event({ id: 'u2', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再看看' }] } })
  h.event({ id: 'u3', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '新的事情' }] } })
  assert.equal(h.appended.length, 3)
  assert.match(h.appended[2].value.content[0].text, /new task/i)
  h.cleanup()
})

test('weak guidance handles and deduplicates an event without an id', () => {
  const h = harness()
  const event = { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看看这个' }] } }
  h.event(event)
  h.handlers.get('session/event')(h.session, event)
  assert.equal(h.appended.length, 1)
  h.cleanup()
})

test('chat stands down outside dedicated preset and coexistence guard avoids double injection', async () => {
  const chat = harness({ dedicatedPreset: false })
  chat.event({ id: 'u1', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } })
  assert.equal(await chat.assemble(), assembled)
  chat.cleanup()
  const owner = harness()
  const owned = { ...assembled, sections: [...assembled.sections, { name: 'router-persona', text: 'owner' }], tools: [...assembled.tools, { name: 'dev_router_status' }] }
  assert.equal(await owner.assemble(owned), owned)
  owner.cleanup()
})

test('mode override persists, status exposes it, and compatibility tools remain callable', async () => {
  const h = harness()
  h.event({ id: 't1', type: 'tool/call', data: { name: 'bash' } })
  await h.assemble()
  const mode = h.registered.find((tool) => tool.name === 'dshbooster_mode')
  assert.match(mode.execute({ mode: 'react' }), /override=yes/)
  const status = h.registered.find((tool) => tool.name === 'task_router_status')
  assert.equal(JSON.parse(status.execute()).effectiveMode, 'react')
  const checkpoint = h.registered.find((tool) => tool.name === 'task_router_checkpoint')
  assert.equal(JSON.parse(checkpoint.execute({ core: 'preserve API', checkpoint: 'seam' })).ok, true)
  const resume = h.registered.find((tool) => tool.name === 'dshbooster_resume')
  assert.match(resume.execute(), /Recovery anchor/)
  h.cleanup()
})

test('mode-isolated subagent uses a fresh system prompt and does not mutate override', async () => {
  const h = harness({}, [{ type: 'reasoning-delta', text: 'abc' }, { type: 'text-delta', text: 'isolated answer' }])
  const subagent = h.registered.find((tool) => tool.name === 'dshbooster_subagent')
  const result = await subagent.execute({ mode: 'react', task: 'build it', maxTokens: 64 })
  assert.match(result, /isolated answer/)
  assert.match(h.ctx.lastLlmOptions.system, /hands-on/)
  const status = JSON.parse(h.registered.find((tool) => tool.name === 'dshbooster_status').execute())
  assert.equal(status.override, null)
  h.cleanup()
})

test('optional classifier is tool-free, reasoning-off, and bounded', async () => {
  const agent = { options: { provider: 'p', model: 'm' } }
  const ctx = { llm: { stream(options) { ctx.options = options; return (async function* () { yield { type: 'text-delta', text: '{"mode":"spec","confidence":0.9}' } })() } } }
  assert.equal((await classifyWithLlm(ctx, agent, 'task')).mode, 'spec')
  assert.equal(ctx.options.reasoningEffort, 'off')
  assert.equal(ctx.options.maxTokens, 160)
  assert.equal('tools' in ctx.options, false)
})

test('persisted state is schema v2 and contains no reasoning text', async () => {
  const h = harness()
  h.event({ id: 'u1', type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复登录' }] } })
  const persisted = JSON.parse(readFileSync(join(h.stateDirectory, 's1.json'), 'utf8'))
  assert.equal(persisted.schemaVersion, 2)
  assert.equal(JSON.stringify(persisted).includes('reasoning'), false)
  h.cleanup()
})
