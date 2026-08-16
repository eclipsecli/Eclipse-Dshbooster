import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, classifyWithLlm } from '../preset/router-bootstrap.mjs'

function harness(config = {}, chunks = []) {
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
  return { handlers, registered, session, agent, ctx }
}

const assembled = {
  sections: [{ name: 'persona', text: 'default' }, { name: 'plan-mode', text: 'keep' }],
  contexts: [{ source: 'runtime' }],
  tools: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'str_replace_editor', 'web_search']
    .map((name) => ({ name }))
}

test('applies maintenance classification before the first tool call', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '修复当前项目的启动错误' }] }
  })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'edit', 'glob', 'grep'])
  assert.match(result.sections.at(-1).text, /helpful software engineer/)
  assert.equal(result.contexts.length, 0)
})

test('applies greenfield classification and exposes status evidence', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '从零创建一个网页小游戏' }] }
  })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'write', 'edit'])
  const status = h.registered.find((tool) => tool.name === 'task_router_status')
  const payload = JSON.parse(status.execute())
  assert.equal(payload.classification.label, 'greenfield')
  assert.equal(payload.classification.mode, 'react')
})

test('restores the full assembled surface after a durable tool call', async () => {
  const h = harness()
  h.session.events.push({ type: 'tool/call' })
  const result = await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.equal(result, assembled)
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
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read', 'edit', 'glob', 'grep'])
  await h.handlers.get('system-prompt/assemble')({}, { agent: h.agent }, async () => assembled)
  assert.equal(h.ctx.llmCalls, 1)
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
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'str_replace_editor'])
})
