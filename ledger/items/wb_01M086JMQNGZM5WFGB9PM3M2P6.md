---
schema_version: 2
id: wb_01M086JMQNGZM5WFGB9PM3M2P6
number: 120
title: "Plumb host approvals through the shipped adapter entrypoints"
kind: task
status: backlog
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T15:48:53Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Verified in source: the shipped entrypoints advertise approval support they do not plumb - mutations through every shipped adapter dead-end. Found by the ideation enrichment."
---

Verified defect, found during the 2026-08-17 ideation enrichment (docs/ideation/enrichments/2026-08-17-vectors.md section 2): the shipped adapter entrypoint advertises trusted approval but plumbs none, so a mutation through any shipped entrypoint can never succeed.

Evidence, verified in source at HEAD:
- src/adapter/entrypoint-main.js:73 advertises `trusted_approval: { supported: true, sources: ['consumer'] }` in the host declaration.
- src/adapter/entrypoint-main.js:358-373 (`runAdapterEntrypoint` invoke branch) passes manifest, dynamic, core_probe, platform, package_root, workspaces, and launch to `invokeAdapter` - and none of `approval`, `now`, or `redeemed_nonces`.
- src/adapter/invoke.js:214-221: every mutation command requires `verifyMutationAuthority({ approval: runtime.approval, ... })`; with runtime.approval undefined the gate refuses `consumer-approval-required`.

Net: the contract's approval mechanism (docs/adapter-contract.md section on consumer approval) is structurally unreachable through adapters/claude-code, codex, and opencode entrypoints. Reads work; mutations always refuse. Either the host declaration overstates (mutations should be advertised unavailable) or the entrypoint needs a host-runtime provider for approvals.

Scope:
1. Decide the honest shape: a host-only runtime dependency/provider at the entrypoint boundary through which a real host supplies the approval event, current time, nonce store, and core executable identity (the enrichment's recommendation - approval must NOT ride the model-controlled bootstrap request, per docs/adapter-contract.md's binding rules), OR downgrade the host declaration to trusted_approval absent until a real provider exists (fail-closed honesty).
2. Whichever way: the describe surface, the contract prose, and the actual runtime capability must agree, pinned by a conformance assertion that exercises the shipped entrypoint (not invokeAdapter directly).
3. This is a prerequisite for the end-to-end core-outcome vectors item, which needs real approvals crossing the spawned entrypoint.

Acceptance:
- A conformance-level assertion proves either (a) a host-provided approval lets a mutation through the shipped entrypoint reach the real core, or (b) the entrypoint honestly advertises mutations unavailable and the refusal names the missing capability.
- Oracle mirrored where the adapter surface changed; mutation-guarded both directions; gate green on both runtimes.
