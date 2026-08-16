const PATTERNS = {
  maintenance: [
    ['修复', 3], ['修一下', 3], ['调试', 3], ['排查', 3], ['报错', 3],
    ['错误', 2], ['崩溃', 3], ['故障', 3], ['异常', 2], ['回归', 3],
    ['兼容', 2], ['迁移', 2], ['升级', 2], ['重构', 3], ['维护', 2],
    ['审查', 2], ['review', 2], ['fix', 3], ['debug', 3], ['refactor', 3],
    ['bug', 3], ['broken', 3], ['regression', 3], ['repair', 3]
  ],
  greenfield: [
    ['从零', 4], ['新建', 3], ['新项目', 4], ['创建', 3], ['开发', 2],
    ['实现', 2], ['构建', 3], ['搭建', 3], ['做一个', 3], ['写一个', 3],
    ['生成', 2], ['网页', 2], ['网站', 2], ['游戏', 2], ['脚本', 2],
    ['应用', 2], ['build', 3], ['create', 3], ['develop', 3], ['implement', 3],
    ['generate', 2], ['make a', 3], ['new project', 4]
  ],
  research: [
    ['调研', 4], ['调查', 3], ['查资料', 3], ['对比', 2], ['综述', 3],
    ['分析', 2], ['研究', 3], ['评估', 3], ['可行性', 3], ['survey', 3],
    ['research', 3], ['compare', 2], ['evaluate', 3], ['investigate', 3],
    ['分析一下', 2], ['为什么', 2], ['原理', 2]
  ],
  audit: [
    ['审计', 4], ['安全检查', 4], ['安全审查', 4], ['安全问题', 3], ['漏洞', 3], ['风险', 2],
    ['权限校验', 3], ['威胁模型', 4],
    ['review code', 3], ['security audit', 4], ['security review', 4],
    ['audit', 4], ['vulnerability', 3], ['vulnerabilities', 3],
    ['privilege escalation', 4], ['threat model', 4]
  ]
}

const STRUCTURAL = {
  existing: [
    ['现有', 2], ['当前', 1], ['已有', 2], ['这个项目', 2], ['仓库', 1],
    ['代码库', 2], ['现状', 2], ['in the repository', 2], ['existing code', 2],
    ['current project', 2]
  ],
  deliverable: [
    ['直接给我', 2], ['交付', 2], ['落地', 2], ['可运行', 2], ['能运行', 2],
    ['working', 2], ['production', 2], ['deliver', 2], ['ship', 2]
  ],
  inspect: [
    ['先看', 2], ['先检查', 2], ['定位', 2], ['找出', 1], ['确认原因', 3],
    ['inspect', 2], ['locate', 2], ['trace', 2], ['find the cause', 3]
  ],
  breadth: [
    ['全面', 3], ['详细', 2], ['系统性', 3], ['跨文件', 2], ['多个模块', 2],
    ['架构', 3], ['全链路', 3], ['comprehensive', 3], ['architecture', 3],
    ['multi-file', 2], ['end-to-end', 3]
  ]
}

const CONFLICTS = [
  ['从零', '现有'], ['创建', '修复'], ['开发', '排查'], ['build', 'fix'],
  ['research', 'implement'], ['调研', '实现']
]

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function collectHits(text, patterns) {
  const hits = []
  let score = 0
  for (const [phrase, weight] of patterns) {
    if (text.includes(phrase.toLowerCase())) {
      hits.push({ phrase, weight })
      score += weight
    }
  }
  return { score, hits }
}

function conflictHits(text) {
  return CONFLICTS.filter(([a, b]) => text.includes(a) && text.includes(b))
}

function hasFinalDeliverySignal(text) {
  return [
    '然后修复', '再修复', '并修复', '最后修复', '之后修复',
    '然后实现', '再实现', '并实现', '最后实现', '之后实现',
    '然后创建', '再创建', '并创建', '最后创建', '之后创建',
    'then fix', 'then implement', 'then build', 'and fix', 'and implement'
  ].some((phrase) => text.includes(phrase))
}

function isResearchPrelude(text) {
  return [
    '先调研', '先研究', '先分析', '先调查', '先对比',
    'first research', 'first investigate', 'first analyze', 'before implementing'
  ].some((phrase) => text.includes(phrase))
}

function rank(scores) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1])
}

/**
 * Classify only the user's task text. The result is deliberately explainable:
 * each score is recoverable from matched phrases and structural signals.
 */
export function classifyTask(input, options = {}) {
  const text = normalize(input)
  const minConfidence = options.minConfidence ?? 0.22
  const minMargin = options.minMargin ?? 0.18
  const minTopScore = options.minTopScore ?? 2

  if (!text) {
    return result('unknown', 'weak', 0, true, 'empty-input', {}, [])
  }

  const scores = { maintenance: 0, greenfield: 0, research: 0, audit: 0 }
  const evidence = {}
  for (const [label, patterns] of Object.entries(PATTERNS)) {
    const found = collectHits(text, patterns)
    scores[label] += found.score
    evidence[label] = found.hits
  }

  const structure = {}
  for (const [label, patterns] of Object.entries(STRUCTURAL)) {
    const found = collectHits(text, patterns)
    structure[label] = found
  }

  if (structure.existing.score > 0 || structure.inspect.score > 0) scores.maintenance += 1
  if (structure.deliverable.score > 0) scores.greenfield += 1
  if (structure.breadth.score >= 3) {
    scores.research += 1
    scores.audit += text.includes('安全') || text.includes('security') ? 1 : 0
  }

  // Explicit security intent is narrower than generic review/create wording.
  // Let it dominate unless the request also contains a genuine build/fix task.
  if (evidence.audit.length > 0 && scores.audit >= 3) scores.audit += 2

  const conflicts = conflictHits(text)
  const stagedDelivery = isResearchPrelude(text) && hasFinalDeliverySignal(text)
  // A research verb can describe a preparation phase rather than the user's
  // final objective. Preserve the evidence, but let the final deliverable win.
  if (stagedDelivery) {
    scores.research *= 0.35
    scores.maintenance += text.includes('修复') || text.includes('fix') ? 2 : 0
    scores.greenfield += text.includes('实现') || text.includes('implement') || text.includes('创建') ? 2 : 0
  }
  if (conflicts.length) {
    for (const label of Object.keys(scores)) scores[label] *= 0.85
  }

  const ranked = rank(scores)
  const [topLabel, topScore] = ranked[0]
  const secondScore = ranked[1]?.[1] ?? 0
  const total = ranked.reduce((sum, [, value]) => sum + value, 0)
  const confidence = total ? Math.min(1, topScore / total) : 0
  const margin = total ? (topScore - secondScore) / total : 0
  const ambiguous = topScore < minTopScore
    || (!stagedDelivery && conflicts.length > 0)
    || confidence < minConfidence
    || margin < minMargin

  let label = ambiguous ? 'mixed' : topLabel
  let mode = 'weak'
  if (!ambiguous && label === 'maintenance') mode = 'spec'
  if (!ambiguous && label === 'greenfield') mode = structure.breadth.score >= 3 ? 'deep-react' : 'react'
  if (!ambiguous && label === 'research') mode = 'spec'
  if (!ambiguous && label === 'audit') mode = 'spec'

  const reason = ambiguous
    ? conflicts.length ? 'conflicting-intent-signals' : 'low-margin-or-low-evidence'
    : stagedDelivery ? 'final-delivery-overrides-research-prelude' : 'clear-intent-signal'
  return result(label, mode, Number(confidence.toFixed(3)), ambiguous, reason, scores, evidence, structure, conflicts)
}

function result(label, mode, confidence, abstain, reason, scores, evidence, structure = {}, conflicts = []) {
  return { version: 1, label, mode, confidence, abstain, reason, scores, evidence, structure, conflicts }
}

export function classifyMessage(message, options) {
  if (typeof message === 'string') return classifyTask(message, options)
  if (!message || typeof message !== 'object') return classifyTask('', options)
  const content = Array.isArray(message.content) ? message.content : []
  const text = content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join(' ')
  return classifyTask(text, options)
}
