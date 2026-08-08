---
schema_version: 1
id: wb_01KZGKSC0SJTGRMMMKMQK9MSZC
number: 35
title: "Deduplicate the core command list across probe, runner, and adapter entrypoint"
kind: task
priority: 30
status: backlog
created: 2026-08-08
updated: 2026-08-08
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-08T12:00:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted: the core command list is declared three times and only one is the authority."
    rationale: "Found by review. The runner and the Claude Code entrypoint are not oracles and should import CORE_COMMAND_ORDER; drift skews the required-core-version probe or makes verifyCoreProbe refuse the adapter's own describe."
---

A code review of the adapter release path found the version 1 core command
list declared three times:

- `src/adapter/core-probe.js` exports `CORE_COMMAND_ORDER`, the authority;
- `spec/run-adapter-implementation.js` re-declares it as `CORE_COMMANDS`
  even though the file already imports from core-probe; and
- `adapters/claude-code/entrypoint.js` hard-codes the same six commands in
  its describe result.

A future core-command change updates one and silently skews the
`required-core-version` probe, or makes `verifyCoreProbe` refuse the
adapter's own describe result with core-contract-version-mismatch.

The runner and the entrypoint are not oracles: unlike `spec/adapter-reference.js`,
nothing requires them to re-derive the list independently, so they should
import `CORE_COMMAND_ORDER`. Whether the reference oracle keeps its own copy
is a deliberate independence decision and out of scope here.

Found by the 2026-08-08 session's review pass; becomes more urgent when the
patch command folds into the adapter contract.
