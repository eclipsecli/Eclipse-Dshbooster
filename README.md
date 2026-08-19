# Eclipse Dshbooster

Eclipse Dshbooster is a DeepSeek Harness routing preset with a strict first-turn surface, durable one-time promotion, task-mode routing, and verifiable task-state management.

This package combines two independently attributable ideas: mode-aware routing and near-field guidance derived from `dsh-mode-boost`, plus Dshbooster-native task state, verification, and recovery. Vendored J-Space material is retained for provenance and comparison only; it is reference-only and is not a default runtime policy or performance claim.

Version 0.3 adds an optional compatibility row for the latest Odyssey plugin
bundle. The integration is intentionally narrow: Dshbooster keeps ownership of
the router/J-Space lifecycle, while the bundle's own `@odyssey/dsh-adapter`
provides its lightweight agent-plane execution tools. See
`integrations/odyssey/README.md`.

## Runtime contract

- `standard` is the default. The first request contains exactly the platform shell (`bash` or `pwsh`) and `str_replace_editor`, with the exact persona `You are a helpful software engineer assistant.` Other prompt contexts and management tools are hidden.
- The first durable `session.events` entry whose type is `tool/call` promotes the session permanently. Promotion is persisted in workspace-local schema-v2 state, so reload and resume restore the full tool catalog.
- `spec` keeps classified read-first/write-first routing for operators who need it. Maintenance, research, and audit route to `spec`; greenfield work routes to `react` or `deep-react`; mixed evidence uses the model-specific `weak` band.
- Every real weak-band user message receives one deduplicated near-field guide. Rounds three and later force fresh classification. Simple work gets a commit guide; complex work gets depth guidance and a non-Flash closure guide.
- Outside the dedicated preset, greeting-only sessions stand down. Existing router ownership also causes a no-op to avoid double injection.

## Execution Policy

After promotion, the native execution policy selects a bounded pass:

| Pass | Use | Native controls |
| --- | --- | --- |
| `fast` | one step, checkable at a glance | none |
| `full` | several dependent steps with one bounded deliverable | verification or dependency control |
| `loop` | multiple files/stages/turns/tools or durable state | state refresh and dependency map |

Retrieved and tool-provided content is treated as untrusted data and receives source review before it is used as evidence. Controls are prompt-level task guidance, not model-internal probes. The default runtime does not load `vendor/j-space`; it remains a pinned reference-only copy for provenance and comparison.

## Durable state

State defaults to `.router-state/<session-id>.json` in the session workspace and is written by temp-file plus atomic rename. Schema v2 retains Goal/Core/Verified/Open/Next, stable `vNN`/`oNN`/`cNN` identifiers, bounded history, phase, pass, route, active modules, promotion, mode override, and verification coverage. Schema v1 files migrate on read. Corrupt or unsupported files are rejected rather than silently reset.

Compaction and resume events move the lifecycle to `recover`. A seam after a gap longer than 30 minutes also enters recovery. Recovery anchors reprint durable state and never persist or reconstruct private reasoning text.

## Management tools

These tools are registered at startup but hidden until promotion:

- `dshbooster_status`: effective route, promotion, pass/modules, state, and drift telemetry
- `dshbooster_mode`: durable `auto/spec/weak/mixed/react/deep-react` override
- `dshbooster_subagent`: fresh model call with an isolated mode persona; it does not mutate the parent route
- `dshbooster_audit`: reports restricted notation, marker leakage, unsupported verification claims, and repetition without rewriting text
- `dshbooster_seam`, `dshbooster_resume`: persist seam history or force a full recovery re-entry anchor
- `task_router_status`, `task_router_checkpoint`, `task_router_verification`: compatibility APIs retained after promotion

## Configuration

```yaml
- id: task-router-bootstrap
  name: ./preset/router-bootstrap.mjs
  config:
    routerMode: standard       # standard | spec
    dedicatedPreset: true
    llmClassifier: off        # off | ambiguous-only | always
    llmTimeoutMs: 1200
    llmMinConfidence: 0.7
    # stateDirectory: /path/to/router-state
```

The optional classifier reuses the session provider/model, runs with reasoning off, no tools, a short output cap, and a timeout. Invalid or low-confidence output falls back to the local classifier.

## Routing Suite companion

The `dsh-routing-suite` source is referenced at suite commit
`a09eb0ade28e6ec3b8e5eb22985a14f6bfa1fbe5`. It includes:

- `dsh-router-standard` presets and tests
- `dsh-mode-boost` host plugin and routing core
- `dsh-super-injector`, including runtime injection, install/reload, persistent
  registry, watch/self-heal, scaffold/build/release, status, and client patch

The main Eclipse Dshbooster bootstrap integrates the router and mode-boost
behavior directly. The super-injector remains a separate companion component
because it crosses a privileged runtime boundary; installation is explicit.

In this repository the source for the privileged `dsh-super-injector` is kept
in a lightweight reference form under `vendor/dsh-routing-suite` for local
provenance only (the public repo does not vendor the full injector, because
activating it can load local code and mutate profile assembly). The pinned
upstream commit is recorded in `vendor/dsh-routing-suite/UPSTREAM.json`.

## Verification

```bash
npm test
npm run eval
npm run verify:reference-jspace
find vendor/dsh-routing-suite/preset/preset -type f -name '*.mjs' -print0 | xargs -0 -n1 node --check
find src preset scripts test -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
git diff --check
```

The Odyssey integration is a composition check only. Its adapter behavior and
wire contract are owned by the latest external bundle; this repository does
not duplicate that worker or run a stale contract canary.

The evaluation corpus is a wiring smoke test, not a production accuracy benchmark. Community feedback about mode-boost is recorded as observed evidence, not as a causal proof. No performance claim from the vendored J-Space material is inherited by Dshbooster.

## Security boundary

The default Dshbooster preset does not install or activate the vendored
super-injector. Its bootstrap only narrows/restores an assembled catalog,
injects bounded prompt sections, writes workspace-local state, and makes
explicitly requested isolated model calls. Activating the companion injector
can load local code, create links, mutate profile package assembly, watch and
reload packages, and rebuild plugin fibers. Treat that activation as a separate
privileged installation step and test it in an isolated DSH home first.

The Odyssey host-plane console/rebrand/restart/vision plugins remain opt-in.
Do not silently append them to the default Dshbooster preset.
