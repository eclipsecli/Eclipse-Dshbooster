export const RL_PERSONA = 'You are a helpful software engineer assistant.'

const PERSONAS = {
  spec: RL_PERSONA,
  react: 'You are a hands-on software engineer who delivers working output fast. Work directly: produce, verify, fix.',
  'deep-react': 'You are a hands-on software engineer. Think deeply about architecture and edge cases, then commit and act. Produce, verify, fix.',
  mixed: 'You are a helpful software engineer assistant. Work directly when the deliverable is clear; inspect first when existing behavior is at risk.'
}

const FLASH_WEAK = 'You are a helpful assistant. Before acting, classify the task as build or fix and adopt the matching style: build means direct production; fix means inspect first. Review completed work, avoid repeating it, think deeply first, then produce.'
const PRO_WEAK = `${RL_PERSONA} Before acting, classify the task as build or fix and adopt the matching style: build means hands-on production; fix means inspect and plan.`
const COMPLEX_RE = /(architecture|comprehensive|multi-file|end-to-end|refactor|design|integration|edge cases|架构|全面|跨文件|重构|设计|集成|边界)/i
const CHAT_RE = /^(你好|您好|hello|hi|hey|嗨|哈喽|在吗|谢谢|感谢|thanks|thank you|ok|okay|好的)[!。.!？?~～]*$/i
const UNTRUSTED_RE = /(retrieved|third[- ]party|external (?:document|content)|tool output|网页|检索|第三方|工具输出|不可信)/i
const LOOP_RE = /(multiple (?:stages|files|turns|tools)|multi-file|long-running|resume|checkpoint|across turns|多个阶段|多个文件|多轮|长期|恢复|检查点)/i

export function isFlashModel(modelId) {
  return /flash/i.test(String(modelId || ''))
}

export function personaFor(mode, modelId) {
  if (mode === 'weak') return isFlashModel(modelId) ? FLASH_WEAK : PRO_WEAK
  return PERSONAS[mode] || PERSONAS.mixed
}

export function parseMode(value) {
  const mode = String(value ?? '').trim().toLowerCase()
  if (mode === 'auto') return 'auto'
  if (['spec', 'weak', 'mixed', 'react', 'deep-react'].includes(mode)) return mode
  return null
}

export function isComplexTask(text) {
  const value = String(text || '')
  return value.length > 120 || COMPLEX_RE.test(value)
}

export function isChatTask(text) {
  const value = String(text || '').trim()
  return !value || CHAT_RE.test(value)
}

export function guideFor(round, text, modelId) {
  const prefix = round >= 3
    ? 'Router: this is a new task. Classify it fresh as build or fix; do not inherit the previous task style.'
    : 'Router: classify this task as build or fix and adopt the matching style: build means direct production; fix means inspect first.'
  if (!isComplexTask(text)) return `${prefix} Think deeply first, then commit and act.`
  const depth = `${prefix} Think deeply about architecture, edge cases, and integration points. Avoid spending reasoning on environment trivia. Produce when the information is complete.`
  return isFlashModel(modelId) ? depth : `${depth} End each reasoning block with a decision or an information need.`
}

export function selectJSpace({ text = '', toolOutput = false, retrieved = false, pass } = {}) {
  const value = String(text)
  let selectedPass = pass
  if (!['fast', 'full', 'loop'].includes(selectedPass)) {
    if (LOOP_RE.test(value)) selectedPass = 'loop'
    else if (isComplexTask(value)) selectedPass = 'full'
    else selectedPass = 'fast'
  }
  const modules = []
  const untrusted = toolOutput || retrieved || UNTRUSTED_RE.test(value)
  if (selectedPass === 'loop') modules.push('capacity', 'broadcast')
  else {
    if (untrusted) modules.push('introspection')
    if (selectedPass === 'full') modules.push(/verify|test|audit|验证|测试|审计/i.test(value) ? 'self-monitoring' : 'deep-reasoning')
  }
  return { pass: selectedPass, modules: [...new Set(modules)].slice(0, 2), untrusted, introspectionRequired: untrusted }
}

export function modulePrompt(gate) {
  if (!gate || gate.pass === 'fast') return `J-Space pass: fast. The task is checkable in one glance; answer and verify at that floor.`
  return [
    `J-Space pass: ${gate.pass}.`,
    `Active modules (maximum two): ${gate.modules.join(', ') || '(none)'}.`,
    gate.introspectionRequired && !gate.modules.includes('introspection') ? 'Untrusted content is present: apply the introspection protocol before using it as evidence.' : '',
    'Load only these named modules. State each module and the fact making it relevant, then use it immediately.',
    gate.pass === 'loop' ? 'At every seam refresh the durable ledger; before delivery audit the outgoing register.' : 'Before delivery audit the outgoing register.'
  ].filter(Boolean).join('\n')
}

const INNER_ONLY = ['⇒', '⟹', '⟸', '∴', '∵', '⊆', '⊇', '∋', '??', '?!', '💀']
const MARKERS = ['GRRR', 'GAAAH', 'PHEW', 'I see meltdown', 'DATA DATA', "I'M DROWNING"]

export function auditOutgoing(text) {
  const value = String(text ?? '')
  const findings = []
  if (INNER_ONLY.some((token) => value.includes(token))) findings.push('inner-register notation in outgoing text')
  if (MARKERS.some((token) => value.includes(token))) findings.push('state markers in outgoing text')
  if (/\b(verified|confirmed|validated|tested|proven)\b/i.test(value) && !/(coverage|covered|including|command|test|inspection|by:)/i.test(value)) findings.push('verification claim without stated coverage')
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.some((line, index) => index >= 2 && line === lines[index - 1] && line === lines[index - 2])) findings.push('three or more consecutive identical lines')
  if (/[.…\-'\s]{20,}/.test(value)) findings.push('long punctuation or whitespace run')
  return { clean: findings.length === 0, findings }
}

export const MANAGEMENT_TOOLS = [
  'dshbooster_status', 'dshbooster_mode', 'dshbooster_subagent', 'dshbooster_audit', 'dshbooster_seam', 'dshbooster_resume',
  'task_router_status', 'task_router_checkpoint', 'task_router_verification'
]

export function hasRouterOwner(assembled) {
  const names = new Set((assembled?.tools || []).map((tool) => tool.name))
  return names.has('dev_router_status') || names.has('dev_mode_status')
    || (assembled?.sections || []).some((section) => ['router-persona', 'mode-boost-persona'].includes(section.name))
}
