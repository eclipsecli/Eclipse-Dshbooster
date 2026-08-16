import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, classifyWithLlm } from '../preset/router-bootstrap.mjs'

function harness(config = {}, chunks = []) {
  const hasStateDirectory = Object.hasOwn(config, 'stateDirectory')
  const stateDirectory = hasStateDirectory ? config.stateDirectory : mkdtempSync(join(tmpdir(), 'dsh-router-state-'))
  config = { ...config }
  if (stateDirectory) config.stateDirectory = stateDirectory
  else delete config.stateDirectory
  const handlers = new Map()
  const registered = []
  const session = { id: 's1', events: [] }
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }
  const ctx = {
    tools: { register(tool) { registered.push(tool); return () => {} } },
    on(name, fn) { handlers.set(name, fn) },
    effect(fn) { return fn() },
    get(name) { return name === 'agent' ? agent : undefined },
    llm: {
      stream(options) {
        ctx.llmCalls = (ctx.llmCalls ?? 0) + 1
        ctx.lastLlmOptions = options
        return (async function* () { for (const chunk of chunks) yield chunk })()
      }
    }
  }
  apply(ctx, config)
  return {
    handlers,
    registered,
    session,
    agent,
    ctx,
    stateDirectory,
    cleanup: () => { if (stateDirectory) rmSync(stateDirectory, { recursive: true, force: true }) }
  }
}

function workspaceHarness(chunks = []) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-router-workspace-'))
  const h = harness({ stateDirectory: null }, chunks)
  h.agent.session.header = { cwd }
  h.stateDirectory = join(cwd, '.router-state')
  h.cleanup = () => rmSync(cwd, { recursive: true, force: true })
  return h
}

const assembled = {
  sections: [{ name: 'persona', text: 'default' }, { name: 'plan-mode', text: 'keep' }],
  contexts: [{ source: 'runtime' }],
  tools: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'str_replace_editor', 'web_search',
    'task_router_status', 'task_router_checkpoint', 'task_router_verification']
    .map((name) => ({ name }))
}

const routerTools = ['task_router_status', 'task_router_checkpoint', 'task_router_verification']

test('applies maintenance classification before the first tool call', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复当前项目的启动错误' }] }
  })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'edit', 'glob', 'grep', ...routerTools])
  assert.match(result.sections.at(-1).text, /helpful software engineer/)
  assert.match(result.sections.find((section) => section.name === 'task-router-ledger').text, /Phase: plan/)
  assert.equal(result.contexts.length, 0)
  h.cleanup()
})

test('applies greenfield classification and exposes status evidence', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '从零创建一个网页小游戏' }] }
  })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'write', 'edit', ...routerTools])
  const status = h.registered.find((tool) => tool.name === 'task_router_status')
  const payload = JSON.parse(status.execute())
  assert.equal(payload.classification.label, 'greenfield')
  assert.equal(payload.classification.mode, 'react')
  assert.equal(payload.ledger.goal, '从零创建一个网页小游戏')
  assert.equal(payload.ledger.phase, 'plan')
  h.cleanup()
})

test('restores the full assembled surface after a durable tool call', async () => {
  const h = harness()
  h.session.events.push({ type: 'tool/call' })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.equal(result, assembled)
  h.cleanup()
})

test('optional classifier reuses the route with reasoning off', async () => {
  const chunks = [{ type: 'text-delta', text: '{"mode":"spec","confidence":0.91,"reason":"existing code"}' }]
  const h = harness({ llmClassifier: 'ambiguous-only', llmTimeoutMs: 500 }, chunks)
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看看这个' }] }
  })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.equal(h.ctx.lastLlmOptions.provider, 'deepseek-official')
  assert.equal(h.ctx.lastLlmOptions.model, 'deepseek-v4-pro')
  assert.equal(h.ctx.lastLlmOptions.reasoningEffort, 'off')
  assert.equal(h.ctx.lastLlmOptions.maxTokens, 160)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'edit', 'glob', 'grep', ...routerTools])
  await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.equal(h.ctx.llmCalls, 1)
  h.cleanup()
})

test('invalid LLM classification falls back to weak', async () => {
  const agent = { options: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }
  const ctx = { llm: { stream: () => (async function* () { yield { type: 'text-delta', text: 'not json' } })() } }
  assert.equal(await classifyWithLlm(ctx, agent, 'ambiguous task', 500), null)
})

test('low-confidence LLM classification does not override weak', async () => {
  const chunks = [{ type: 'text-delta', text: '{"mode":"spec","confidence":0.4,"reason":"uncertain"}' }]
  const h = harness({ llmClassifier: 'ambiguous-only', llmMinConfidence: 0.7 }, chunks)
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看看这个' }] }
  })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'str_replace_editor', ...routerTools])
  h.cleanup()
})

test('persists checkpoints, phase transitions, and verification coverage', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复登录并补回归测试' }] }
  })
  await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  const checkpoint = h.registered.find((tool) => tool.name === 'task_router_checkpoint')
  const verification = h.registered.find((tool) => tool.name === 'task_router_verification')
  const status = h.registered.find((tool) => tool.name === 'task_router_status')

  assert.equal(JSON.parse(checkpoint.execute({ core: 'preserve current auth API', open: 'root cause unknown', next: 'reproduce the failing login', checkpoint: 'route assembled' })).ok, true)
  assert.equal(JSON.parse(verification.execute({ action: 'declare', item: 'login regression test' })).ok, true)
  h.session.events.push({ type: 'tool/call' })
  h.handlers.get('session/event')(h.session, { type: 'tool/call' })
  assert.equal(JSON.parse(status.execute()).ledger.phase, 'execute')

  const recorded = JSON.parse(verification.execute({
    action: 'record',
    item: 'login regression test',
    result: 'passed',
    verifier: 'node --test test/login.test.mjs',
    coverage: 'valid credentials and rejected invalid credentials',
    evidence: '2 tests passed'
  }))
  assert.equal(recorded.verification.complete, true)
  assert.equal(recorded.phase, 'verify')
  const payload = JSON.parse(status.execute())
  assert.equal(payload.verification.passed, 1)
  assert.equal(payload.ledger.core[0], 'preserve current auth API')
  assert.equal(payload.ledger.checkpoints.length, 1)
  const persisted = JSON.parse(readFileSync(join(h.stateDirectory, 's1.json'), 'utf8'))
  assert.equal(persisted.verification.records[0].verifier, 'node --test test/login.test.mjs')
  h.cleanup()
})

test('compaction and resume boundaries move the ledger to recover', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '审计并修复当前仓库' }] }
  })
  await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  h.handlers.get('session/event')(h.session, { type: 'compaction/end' })
  const status = h.registered.find((tool) => tool.name === 'task_router_status')
  assert.equal(JSON.parse(status.execute()).ledger.phase, 'recover')
  h.cleanup()
})

test('verification refuses records without verifier coverage', async () => {
  const h = harness()
  const verification = h.registered.find((tool) => tool.name === 'task_router_verification')
  const result = JSON.parse(verification.execute({ action: 'record', item: 'build', result: 'passed' }))
  assert.equal(result.ok, false)
  assert.match(result.error, /verifier and coverage/)
  h.cleanup()
})

test('defaults durable state to the session workspace', async () => {
  const h = workspaceHarness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复当前项目的构建错误' }] }
  })
  const persisted = JSON.parse(readFileSync(join(h.stateDirectory, 's1.json'), 'utf8'))
  assert.equal(persisted.goal, '修复当前项目的构建错误')
  h.cleanup()
})
