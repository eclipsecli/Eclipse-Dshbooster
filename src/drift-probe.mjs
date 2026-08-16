/**
 * Observable routing-drift probe. It deliberately ignores reasoning text.
 * The output is diagnostic telemetry, not a claim about internal model state.
 */
export class DriftProbe {
  constructor() {
    this.expectedMode = null
    this.events = 0
    this.toolCalls = 0
    this.assistantMessages = 0
    this.assistantChunks = 0
    this.compactions = 0
    this.resumes = 0
    this.assemblies = 0
    this.anchorMisses = 0
    this.signals = []
  }

  setExpectedMode(mode) {
    this.expectedMode = mode
  }

  observeEvent(event) {
    this.events += 1
    switch (event?.type) {
      case 'tool/call': this.toolCalls += 1; break
      case 'assistant/message': this.assistantMessages += 1; break
      case 'assistant/chunk': this.assistantChunks += 1; break
      case 'compaction/start':
      case 'compaction/summary':
      case 'compaction/end':
      case 'compaction/prune':
        this.compactions += 1
        this.addSignal('compaction-boundary')
        break
      case 'agent/resume':
      case 'session/resume':
        this.resumes += 1
        this.addSignal('resume-boundary')
        break
      default: break
    }
  }

  observeAssembly({ mode, hasPersona, hasExpectedTools, promoted }) {
    this.assemblies += 1
    if (mode !== undefined && mode !== this.expectedMode) this.addSignal('mode-changed')
    if (!promoted && !hasPersona) {
      this.anchorMisses += 1
      this.addSignal('anchor-missing')
    }
    if (!promoted && !hasExpectedTools) this.addSignal('tool-surface-mismatch')
  }

  addSignal(signal) {
    if (!this.signals.includes(signal)) this.signals.push(signal)
  }

  snapshot() {
    return {
      expectedMode: this.expectedMode,
      events: this.events,
      toolCalls: this.toolCalls,
      assistantMessages: this.assistantMessages,
      assistantChunks: this.assistantChunks,
      compactions: this.compactions,
      resumes: this.resumes,
      assemblies: this.assemblies,
      anchorMisses: this.anchorMisses,
      signals: [...this.signals]
    }
  }
}
