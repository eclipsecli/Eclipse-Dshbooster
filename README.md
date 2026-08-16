# Eclipse Dshbooster

An experimental task classifier for DeepSeek Harness routing. It looks at what the user is asking for and picks a behavior mode.

## How it works

| Task type | Default mode | What it does |
|-----------|-------------|--------------|
| maintenance | spec | Understand, plan, then modify |
| greenfield | react | Build, verify, fix |
| broad greenfield | deep-react | Think architecture first, then converge and act |
| research / audit | spec | Evidence-first, inspect-first |
| mixed / low confidence | weak | Don't force a route, fall back to safe default |

## Why this design

The first version uses weighted intent evidence instead of a simple keyword counter. It returns:

- label
- mode
- confidence
- abstain flag
- matched evidence phrases
- per-class scores
- conflict signals

When the request contains conflicting intents or the winning class has a thin margin, the classifier abstains. A wrong hard route costs more than falling back to a stable default while collecting a labeled example.

## Project structure

This package includes an experimental DSH preset entry (`agent.cordis.yml`) and a thin adapter under `preset/`. Copy the whole directory as one preset; the adapter imports the shared classifier core from `src/`. This is not a production installer.

The adapter does not select a model route or reasoning effort; those remain separate DSH session settings and must be verified independently.

The router also keeps a small state file for each session. It records `Goal / Core / Verified / Open / Next`, the current phase, checkpoints, and verification results. Files are written atomically under `.router-state/` in the session workspace unless `stateDirectory` is set. Reasoning text is not stored.

For an agent-oriented installation and verification procedure, see [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md). The guide is deliberately conservative: use an isolated DSH home first and inspect the first request before any production use.

## Run

```bash
npm test
npm run eval
npm run classify -- "排查当前项目启动时报错的原因，修复回归并运行测试。"
```

For an isolated DSH test, copy this directory into the target preset workspace or install it according to the DSH version's local preset rules. Don't point it at a production DSH home until you've inspected the first-turn request, promotion event, and actual model route.

The adapter's first version uses these routes:

- **spec**: maintenance, research, and audit tasks
- **react**: small or direct greenfield tasks
- **deep-react**: broad greenfield architecture tasks
- **weak**: mixed or low-confidence tasks, with the smallest first-turn surface

## Optional LLM classifier

The rule classifier is the default. The preset can optionally ask the same session route for a short classification call before the main request:

```yaml
- id: task-router-bootstrap
  name: ./preset/router-bootstrap.mjs
  config:
    llmClassifier: 'ambiguous-only'
    llmTimeoutMs: 1200
    llmMinConfidence: 0.7
    stateDirectory: '/path/to/durable/router-state'
```

Modes:

- `off` (default): no extra model call
- `ambiguous-only`: ask only when local classification abstains
- `always`: ask for every first task

The optional call runs at most once per session, reuses the current session's provider, model, and stored credentials. It sends `reasoningEffort: 'off'`, a short output cap, and a timeout. A result below `llmMinConfidence` is ignored. It has no shell, filesystem, or web tools. Invalid JSON, timeout, or missing route falls back to the local result, whose ambiguous case remains weak. This option adds first-turn latency and should be measured before being enabled broadly.

## Drift probe

`src/drift-probe.mjs` exposes low-risk telemetry through `task_router_status`. It records only observable facts: tool-call count, assistant-message/chunk count, prompt assembly count, compaction/resume boundaries, expected mode, and missing-anchor or tool-surface mismatch signals. It does not retain reasoning text and does not claim to observe an internal chain-of-thought or expert route. A signal means "the externally observable contract changed," not "the model switched internal reasoning modes."

## Task state and verification

The first user task creates the state file and prompt anchor. The phase moves through `intake`, `plan`, `execute`, `verify`, and `recover` from explicit events and tool records:

- `task_router_checkpoint` records active constraints, verified facts, open risks, the next action, and checkpoints.
- `task_router_verification` declares completion requirements and records `passed`, `partial`, or `failed` results. A result record is rejected unless it names both the verifier and its coverage.
- `task_router_status` returns the route, drift telemetry, ledger, and aggregate verification coverage.

The first durable `tool/call` moves the phase to `execute`. Compaction and resume events move it to `recover`. A task is ready to finish only after at least one requirement has been declared and every requirement has a latest `passed` result.

## Known issues

- It's a rule-based v0, not a trained classifier.
- The phrase lists are bilingual but incomplete.
- It classifies the first user request only. Later events update lifecycle state, but they do not reclassify the route or inspect repository metadata.
- There is no measured routing benefit yet. The next stage is a labeled task collection and held-out evaluation.
- `deep-react` is a hypothesis-backed experimental target, not a production recommendation.

## Testing feedback

If you're testing this, please record:

1. The original task text
2. The classifier JSON result
3. Whether the selected mode was actually used
4. Task completion and acceptance-test result
5. Whether a different mode would have been better

Don't report wording like "We" or "Let me" as an ability score. The useful label is the task outcome.

See `FEEDBACK.md` for a sanitized issue template. `examples/tasks.jsonl` is a development smoke corpus, not an independent benchmark; its score should not be advertised as real-world accuracy.
