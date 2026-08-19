# Installing Eclipse Dshbooster for Agents

Use an isolated DSH home for the first canary because the preset changes the initial persona and visible tools.

## Requirements

- Node.js 20 or newer
- Python 3.7 or newer only if you intentionally verify the vendored reference copy
- a compatible DeepSeek Harness installation
- the complete project directory

The npm package has no runtime dependencies.

## 1. Verify the package

From the package root:

```bash
npm test
npm run eval
npm run verify:reference-jspace
find src preset scripts test -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
git diff --check
```

Do not copy only `preset/router-bootstrap.mjs`; it imports `src/` and the complete project provides provenance and reference material.

## 2. Install in isolation

Copy the whole project into the local preset location used by the installed DSH version. Use a separate home for the canary:

```bash
export DSH_HOME="$PWD/.dsh-dshbooster-test-home"
mkdir -p "$DSH_HOME"
```

Do not copy credentials into this project and do not change an existing production home.

## 3. Choose the first-turn mode

Keep the default first:

```yaml
routerMode: standard
dedicatedPreset: true
llmClassifier: off
```

`standard` must expose exactly shell plus `str_replace_editor` on the first request. `spec` is the compatibility route that exposes classified read/write tools while still hiding all router management tools until promotion.

Inspect `agent.cordis.yml` and confirm `routerMode` and `dedicatedPreset` are under the `task-router-bootstrap` row's `config`, not under the persona row. Otherwise the plugin will receive neither option.

Set `dedicatedPreset: false` only when mounting the plugin into another host preset; greeting-only sessions then stand down. Coexistence detection also stands down when another router owns the session.

## 4. Run the canary

Inspect the first request and confirm:

1. Persona is exactly `You are a helpful software engineer assistant.` in standard mode.
2. Visible tools are exactly platform shell plus `str_replace_editor`.
3. No `dshbooster_*` or `task_router_*` management tool is visible.
4. The first durable `tool/call` is present in session history.
5. The next assembly restores the complete host catalog and exposes management tools.
6. `.router-state/<session-id>.json` is schema v2 and contains `promoted: true`.
7. Reloading the session with the same workspace remains promoted.

For loop work, inspect `dshbooster_status` after promotion and confirm `executionPass=loop`, no more than two active controls, and `state-refresh,dependency-map` for durable task-state work.

## 5. Recovery and audit

Use `task_router_checkpoint` at meaningful seams. Compaction, resume, and a seam after a gap over 30 minutes move state to `recover`; the next prompt gets the durable recovery anchor.

Before final delivery, pass the candidate text to `dshbooster_audit`. Findings are advisory and do not modify the text. Record acceptance requirements and verifier coverage through `task_router_verification`.

## Rollback

Stop the isolated DSH process and remove only the isolated preset copy, test home, and its workspace-local `.router-state` directory. Do not remove shared credentials, session history, or unrelated presets.

This preset is not a privileged plugin manager. It does not provide arbitrary injection, profile mutation, or process hot reload.
