import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyMessage, classifyTask } from '../src/classifier.mjs'

test('routes a clear maintenance task to spec', () => {
  const result = classifyTask('排查当前项目启动时报错的原因，修复回归并运行测试。')
  assert.equal(result.label, 'maintenance')
  assert.equal(result.mode, 'spec')
  assert.equal(result.abstain, false)
})

test('routes a clear greenfield task to react', () => {
  const result = classifyTask('从零创建一个网页小游戏，直接实现并运行验证。')
  assert.equal(result.label, 'greenfield')
  assert.equal(result.mode, 'react')
  assert.equal(result.abstain, false)
})

test('routes broad greenfield architecture to deep-react', () => {
  const result = classifyTask('从零设计并实现一个跨文件的插件架构，考虑边界和集成点，交付可运行版本。')
  assert.equal(result.label, 'greenfield')
  assert.equal(result.mode, 'deep-react')
})

test('routes research and audit to spec', () => {
  assert.equal(classifyTask('调研三个方案并对比它们的原理和可行性。').mode, 'spec')
  assert.equal(classifyTask('对当前代码做安全审计，找出漏洞和风险。').mode, 'spec')
})

test('abstains on conflicting intent', () => {
  const result = classifyTask('同时从零实现一个新模块并修复现有兼容问题。')
  assert.equal(result.abstain, true)
  assert.equal(result.mode, 'weak')
  assert.equal(result.label, 'mixed')
})

test('treats research as a prelude when the final delivery is a fix', () => {
  const result = classifyTask('先调研当前插件架构，再修复路由误判并运行回归测试。')
  assert.equal(result.label, 'maintenance')
  assert.equal(result.mode, 'spec')
  assert.equal(result.abstain, false)
})

test('abstains on vague input', () => {
  const result = classifyTask('帮我看看这个。')
  assert.equal(result.abstain, true)
  assert.equal(result.mode, 'weak')
})

test('accepts DSH-like content messages', () => {
  const result = classifyMessage({ content: [{ type: 'text', text: '修复这个 bug 并运行测试' }] })
  assert.equal(result.label, 'maintenance')
})
