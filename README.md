# DSH Task Router v0

An early, explainable task classifier for DeepSeek Harness routing experiments.

This is intentionally not a claim that the model has named internal "chain-of-thought modes". It classifies the user's task intent and maps it to an experimentally testable DSH behavior mode:

| Task label | Default mode | Intended behavior |
| --- | --- | --- |
| `maintenance` | `spec` | inspect, understand, plan, then modify |
| `greenfield` | `react` | produce, verify, fix |
| broad `greenfield` | `deep-react` | think about architecture, then converge and act |
| `research` / `audit` | `spec` | evidence-first and inspect-first |
| `mixed` / low confidence | `weak` | abstain from hard routing and use a fallback |

## Why this shape

The first version uses weighted intent evidence instead of a single keyword counter. It returns:

- `label`
- `mode`
- `confidence`
- `abstain`
- matched evidence phrases
- per-class scores
- conflict signals

When the request contains conflicting intents or the winning class has a low margin, the classifier abstains. A wrong hard route is more expensive than falling back to a stable default while collecting a labeled example.

This package also includes an experimental DSH preset entry at `agent.cordis.yml` and a thin adapter under `preset/`. Copy the whole project directory as one preset; the adapter imports the shared classifier core from `src/`. It is not a production-ready installer. The adapter does not select a model route or reasoning effort; those remain separate DSH session settings and must be verified independently.

## Run

```bash
npm test
npm run eval
npm run classify -- "排查当前项目启动时报错的原因，修复回归并运行测试。"
```

For an isolated DSH test, copy this directory into the target preset workspace or install it according to the DSH version's local preset rules. Do not point it at a production DSH home until the first-turn request, promotion event, and actual model route have been inspected.

The adapter's first version uses these routes:

- `spec`: maintenance, research, and audit tasks;
- `react`: small or direct greenfield tasks;
- `deep-react`: broad greenfield architecture tasks;
- `weak`: mixed or low-confidence tasks, with the smallest first-turn surface.

## Optional LLM classifier

The rule classifier is the default. The preset can optionally ask the same
session route for a short classification call before the main request:

```yaml
- id: task-router-bootstrap
  name: ./preset/router-bootstrap.mjs
  config:
    llmClassifier: 'ambiguous-only'
    llmTimeoutMs: 1200
    llmMinConfidence: 0.7
```

Modes:

- `'off'` (default): no extra model call;
- `'ambiguous-only'`: ask only when local classification abstains;
- `'always'`: ask for every first task.

The optional call runs at most once per session, reuses the current session's provider, model, and stored
credentials. It sends `reasoningEffort: 'off'`, a short output cap, and a
timeout. A result below `llmMinConfidence` is ignored. It has no shell, filesystem, or web tools. Invalid JSON, timeout, or
missing route falls back to the local result, whose ambiguous case remains
`weak`. This option adds first-turn latency and should be measured before
being enabled broadly.

## Drift probe

`src/drift-probe.mjs` exposes low-risk telemetry through `task_router_status`.
It records only observable facts: tool-call count, assistant-message/chunk
count, prompt assembly count, compaction/resume boundaries, expected mode, and
missing-anchor or tool-surface mismatch signals. It does not retain reasoning
text and does not claim to observe an internal chain-of-thought or expert
route. A signal means “the externally observable contract changed,” not “the
model switched internal reasoning modes.”

## Current limitations

- It is a rule-based v0, not a trained classifier.
- The phrase lists are bilingual but incomplete.
- It classifies the first user request only; it does not yet use repository metadata or conversation state.
- It has no measured routing benefit yet. The next stage is a labeled task collection and held-out evaluation.
- `deep-react` is a hypothesis-backed experimental target, not a production recommendation.

## Public testing protocol

Anyone testing this version should record:

1. the original task text;
2. the classifier JSON result;
3. whether the selected mode was actually used;
4. task completion and acceptance-test result;
5. whether a different mode would have been better.

Do not report wording such as `We` or `Let me` as an ability score. The useful label is the task outcome.

See `FEEDBACK.md` for a sanitized issue template. `examples/tasks.jsonl` is a development smoke corpus, not an independent benchmark; its score must not be advertised as real-world accuracy.
