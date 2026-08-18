# Latest Odyssey adapter integration

This integration deliberately mounts only the adapter from the latest
`odyssey-dsh-plugins` bundle:

```text
Eclipse Dshbooster router/J-Space
        + @odyssey/dsh-adapter agent row
```

The adapter is an agent-plane plugin. It uses the DSH-native `subagents` and
`timer` services and exposes the bundle's `odyssey_run_unit` and
`odyssey_run_remote` tools. It is not replaced by a second worker
implementation in this repository.

## Deployment boundary

1. Install the latest Odyssey bundle into the target DSH profile using its
   own package/install procedure.
2. Add `integrations/odyssey/agent-row.yml` to the profile's agent preset, or
   use the ready row already present in the root `agent.cordis.yml`.
3. Keep the bundle's host-plane `odyssey-console`, `odyssey-rebrand`,
   `odyssey-restart`, and `dsh-vision` plugins out of the default Dshbooster
   preset unless they are explicitly needed and separately reviewed.
4. Keep `odyssey.config.json`, ECS endpoints, and token files outside this
   repository. Do not put them in model parameters or committed examples.

The adapter's own contract, lightweight subagent execution, and
`claim`/`heartbeat`/`receipt`/`manifest`/`report` behavior remain owned by the
latest Odyssey bundle. This repository only supplies the compatible preset
composition and Dshbooster lifecycle.
