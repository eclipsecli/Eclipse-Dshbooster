# Installing DSH Task Router for Agents

Install the router in an isolated DSH home first. It changes the first-turn Persona and tool list, so inspect the resulting request before using it with an existing setup.

## Requirements

- Node.js 20 or newer
- a compatible DeepSeek Harness installation
- the complete project directory
- a configured provider and model for the live canary

The package has no runtime npm dependencies.

## 1. Check the package

Run these commands from the project root:

```bash
node --version
npm test
npm run eval
node --check src/classifier.mjs
node --check src/drift-probe.mjs
node --check src/router-state.mjs
node --check preset/router-bootstrap.mjs
```

The evaluation corpus is a wiring check, not a production benchmark. Also check that the directory contains no credentials, session data, or unrelated files.

## 2. Create an isolated copy

Copy the whole project into the local preset directory used by the installed DSH version. Do not copy `preset/router-bootstrap.mjs` by itself; it imports files from `src/`.

Use a separate home for the first run:

```bash
export DSH_HOME="$PWD/.dsh-task-router-test-home"
mkdir -p "$DSH_HOME"
```

Preset discovery paths differ between DSH versions. Check the local DSH installation instead of guessing a production path.

## 3. Start with local classification

The relevant preset options are:

```yaml
llmClassifier: 'off'
llmTimeoutMs: 1200
llmMinConfidence: 0.7
# stateDirectory: '/path/to/durable/router-state'
```

Keep `llmClassifier: 'off'` for the first run. This uses the local rule classifier and does not add another model request.

When `stateDirectory` is omitted, state is written to `.router-state/` in each session workspace. Set it only when state must live elsewhere. Files are separated by session id and may contain task text, so do not commit them.

The optional modes are:

- `ambiguous-only`: call the session model when local classification abstains
- `always`: call the session model for every first task

The optional call reuses the current provider, model, and stored credentials. It runs with reasoning disabled, a short output limit, no tools, and a timeout. Invalid output or low confidence falls back to the local result.

## 4. Check the mount

Before sending a prompt, confirm that:

1. the preset is discovered and not marked broken;
2. a blank session can be created with the expected preset id;
3. no model request or tool call was made during the check.

Do not copy credentials into the project. Do not change OpenClaw or Gateway configuration as part of this test.

## 5. Run one canary

Send one small task in the isolated session, then inspect:

- the provider, model, and reasoning setting in `request/header`;
- the assembled Persona and first-turn tool list;
- the route and state returned by `task_router_status`;
- the location of the `.router-state` file;
- the first durable tool call and the restored tool list after promotion.

The router does not select a provider, model, or reasoning effort. Verify those values from the request rather than the preset name.

For a multi-step canary, declare an acceptance item with `task_router_verification`, record its verifier and coverage, and confirm with `task_router_status` that it is complete only after every declared item passes.

## 6. Check drift signals

`task_router_status` reports observable signals such as a missing Persona anchor, mode changes, tool-list mismatches, repeated prompt assembly, and compaction or resume events. It does not inspect or store chain-of-thought.

## Rollback

Stop the isolated DSH process and remove only the isolated preset copy and test home. Do not remove an existing DSH home, credentials, session history, or unrelated presets.

## Test report

Record at least:

```text
DSH version:
Router commit:
OS:
Isolated home:
Preset discovered: yes/no
Session created: yes/no
Canary sent: yes/no
Observed provider/model:
Observed reasoning setting:
First-turn route:
First tool call:
Promotion verified: yes/no
Drift signals:
Failures and evidence paths:
```

Do not report the smoke corpus score as routing accuracy. Real routing benefit still needs held-out task results.
