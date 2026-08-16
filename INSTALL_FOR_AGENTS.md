# Installing DSH Task Router for Agents

This document is for an AI agent or automation worker installing the router on behalf of a user.

## Safety boundary

The router changes the first-turn Persona and tool surface of a DSH preset. Treat installation as an isolated experiment until the request envelope, selected model, and first tool call have been inspected.

An installing agent must:

- preserve the user's existing DSH home and configuration;
- use a separate `DSH_HOME` or equivalent isolated profile for the first test;
- never copy API keys into this project or commit credentials;
- never change Gateway/OpenClaw configuration or restart services as part of installation;
- never claim that routing improves task results before a held-out evaluation;
- stop and report the exact failure if preset discovery or session creation fails.

## Prerequisites

- Node.js 20 or newer;
- a compatible DeepSeek Harness installation, tested against the version actually in use;
- an existing provider/model configuration in the isolated DSH profile if live requests are later authorized;
- this complete project directory, including `src/`, `preset/`, `agent.cordis.yml`, and `preset.yml`.

The package has no runtime npm dependencies. Do not install extra packages merely to use the classifier.

## Step 1: inspect the package

From the project root, run:

```bash
node --version
npm test
npm run eval
node --check src/classifier.mjs
node --check src/drift-probe.mjs
node --check preset/router-bootstrap.mjs
```

The development smoke corpus is only a wiring check. Its score is not an independent benchmark and must not be reported as production accuracy.

Check that the package contains no credentials, private keys, or unrelated runtime directories. If the source came from an archive or message attachment, inspect the file list before copying it into a preset directory.

## Step 2: create an isolated preset copy

Copy the whole project directory into the isolated preset location expected by the installed DSH version. Do not copy only `preset/router-bootstrap.mjs`: it imports `src/classifier.mjs` and depends on the package configuration.

Use a fresh isolated home, for example:

```bash
export DSH_HOME="$PWD/.dsh-task-router-test-home"
mkdir -p "$DSH_HOME"
```

The exact preset discovery location is DSH-version-specific. Consult the local DSH installation rules rather than guessing a production path.

## Step 3: start with the safe configuration

The default configuration is:

```yaml
llmClassifier: 'off'
llmTimeoutMs: 1200
llmMinConfidence: 0.7
```

Keep `llmClassifier: 'off'` for the first mount. This uses the zero-cost local classifier and avoids an additional model request.

Only after the local route is verified may an authorized operator test:

- `ambiguous-only`: one short classifier request only for local abstentions;
- `always`: one short classifier request for every first task.

The optional classifier reuses the current session route and stored credentials. It requests `reasoningEffort: 'off'`, has a short output cap and timeout, and has no tools. Invalid output, timeout, missing route, or low confidence must fall back without blocking the main session.

## Step 4: perform a no-prompt mount check

Before sending a user task or invoking a paid model, verify that:

1. the preset is discovered;
2. it is not marked broken;
3. a blank session can be created in the isolated home;
4. the session reports the expected preset id;
5. no model request or tool call was generated during this check.

Record the DSH version, preset id, isolated home path, and session id in the local test log. Do not place credentials or full private conversation content in the log.

## Step 5: run one authorized canary task

Only with explicit authorization for a model request, send one small, reversible task in the isolated session. Inspect:

- the first `request/header` provider and model;
- the effective reasoning setting;
- the assembled Persona;
- the first-turn tool schema;
- the classifier result from `task_router_status`;
- the first durable `tool/call`;
- whether the full tool surface is restored after promotion.

The router does not select `deepseek-v4-pro`, `max`, or any other model by itself. The canary must verify the actual request evidence instead of inferring it from a preset name or local configuration.

## Step 6: inspect drift telemetry

Use `task_router_status` to inspect observable routing behavior. Look for:

- missing Persona anchor;
- unexpected mode changes;
- tool-surface mismatch;
- repeated prompt assembly;
- compaction or resume boundaries;
- unusual tool-call repetition or long no-action periods.

The probe intentionally does not retain or classify complete reasoning text. Do not describe its signals as evidence of internal chain-of-thought or MoE expert switching.

## Rollback

Rollback is the reversible operation of stopping the isolated test and removing only the isolated preset copy. Do not delete the user's production DSH home, session history, credentials, or unrelated preset files. If the router was installed into a shared location by mistake, stop before modifying anything and ask the operator to approve the exact cleanup scope.

## Report format

An installing agent should report:

```text
DSH version:
Router version/commit:
OS:
Isolated home:
Preset discovered: yes/no
Blank session created: yes/no
Model request sent: yes/no
Canary authorized: yes/no
Observed provider/model:
Observed reasoning setting:
First-turn route:
First tool call:
Promotion verified: yes/no
Drift signals:
Failures and evidence paths:
```

Do not report the smoke corpus score as routing accuracy. Do not claim production readiness until Windows compatibility, real first-turn timing, and held-out task outcomes have been measured.
