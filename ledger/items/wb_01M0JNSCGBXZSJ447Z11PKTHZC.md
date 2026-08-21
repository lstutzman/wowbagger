---
schema_version: 2
id: wb_01M0JNSCGBXZSJ447Z11PKTHZC
number: 132
title: "Publish the Wowbagger machine contract for host-routed consumers"
kind: task
priority: 1
status: backlog
created: 2026-08-21
updated: 2026-08-21
provenance:
  source: "orca-ledger-workbench-contract-audit"
  recorded_at: "2026-08-21T17:27:09.989Z"
depends_on: [ wb_01M0JNS31AKVMDBVH86J156RBR, wb_01M0JNS61XWMN8ZPDQKCFD9Q9R, wb_01M0JNS9DQEGYFS2M2WB2PXAMN ]
related: [ wb_01KZVSW8F6VWX3CJGC4DMA38FP, wb_01M057Q7ATYMR2DD5V62KHRNA0, wb_01KZHX3E00RRK3X1WYTFCW70D4 ]
decisions:
  - action: accept
    date: 2026-08-21
    summary: "Accept the Wowbagger host-consumer machine contract as a P0 release gate."
    rationale: "The enriched scope now separates portable Wowbagger capabilities, limits, schemas, launch requirements, and failure semantics from Orca-owned consent, workspace identity, routing, and process enforcement. Dependencies on #129–#131 make the release gate explicit without duplicating #59 or #92."
---

## Problem

A host-routed plugin needs one supported way to resolve, launch, bound, and validate the Wowbagger CLI on the workspace-owning host. The npm package exposes a `bin` mapping, but no documented package export or launch descriptor for a shell-free host. The existing adapter internally proves a portable pattern — absolute Node executable plus absolute `bin/wowbagger.js`, argument array, `shell:false` — without publishing it as the direct-core plugin contract.

Mutation input is strict JSON from stdin or a file. An invocation primitive that literally carries argv only cannot call `transition` without an extra temporary-file channel. Core query output has no bound; `inspect` can exceed any fixed host limit because oversized legacy items remain inspectable and the response carries both full base64 source and body. Machine schemas are prose and fixtures rather than published JSON Schema. Public version prose also disagrees: `SPEC.md` still says core contract 2, the mutation-contract status says 3, runtime and the envelope fixture say 4, and the SPEC lifecycle table omits `deferred`.

Items #59 and #92 already shipped contract documents and documented the namespace-first envelope rule. This item extends those completed seams; it does not reopen their decisions or wrap the intentionally bare `validate` and `ready` results.

## Required contract

Publish one direct-core host invocation contract for UI plugins and other non-agent consumers. It must define:

- a supported, shell-free way to resolve the installed core script and its required Node executable on macOS, Linux, Windows, and WSL;
- the exact process tuple: executable, argv array, working directory, bounded stdin, captured stdout and stderr, process-tree containment, cancellation, timeout, and output-limit observations;
- owning-host path semantics for worktrees, plain folders, direct SSH, and paired runtimes, with no cross-runtime path guessing;
- the requirement that JSON mutation requests use bounded stdin or a secure host-created request file, never shell source or inline unbounded argv JSON;
- advertised response-size behavior for every command, including an honest strategy for full `inspect`;
- packaged JSON Schemas for core envelopes, bare validation/ready results, item summaries and snapshots, transition requests and results, ledger-mutation fence refusals, and stable errors; and
- authoritative version and lifecycle vocabulary across package metadata, capabilities, SPEC, mutation contract, fixtures, and installed skill.

Launcher failure remains a host transport result because a missing executable cannot emit Wowbagger JSON. Core failures that do run continue to use their documented response domains.

## Acceptance criteria

- A package consumer can resolve the direct-core entrypoint through a documented supported package seam without searching global npm directories or parsing platform-specific command shims.
- Native tests launch the resolved tuple without a shell on macOS, Linux, and Windows; WSL uses its owning runtime's Node and path.
- The contract requires bounded stdin, stdout, stderr, timeout, cancellation, and process-tree containment and states mutation recovery after timeout or signal.
- Every shipped JSON Schema validates all normative fixtures in its domain and rejects representative cross-domain or extra-member errors according to that domain's exactness rules.
- `capabilities` advertises applicable semantic and transport limits under the negotiated workbench core version; no consumer must infer limits from an adapter implementation.
- `SPEC.md`, `docs/mutation-contract.md`, package metadata, the envelope-domain fixture, and the skill agree on the emitted core contract version and include `deferred` consistently.
- The section-2 response-domain rule from #92 remains intact, including the two bare results and legacy ledger-mutation fence domain.
- Tests run on current Node and Node 20, with native platform evidence before a support claim moves from unverified.

## Non-goals

Orca consent UI, remote routing, credential forwarding, workspace event listeners, automatic transitions, mirrored ledger state, and a new daemon or RPC service are host concerns or rejected product behavior. Do not add them to Wowbagger.

## Evidence

`package.json` publishes only the `wowbagger` bin; `src/adapter/entrypoint-main.js:launchCoreProcess` contains the evidenced Node-plus-script launch; `src/cli.js:requestSource` requires stdin or a file and applies no transition input transport bound; direct core has no output or timeout limit. Found during the 2026-08-21 Orca ledger-workbench contract audit.

## Orca triage enrichment and ownership boundary — 2026-08-21

Maintainer disposition: accept as a P0 integration release gate (`priority: 1`). This item depends on #129, #130, and the narrowed #131 contract. It retains relations to #59, #92, and prior bounded-output evidence instead of reopening completed packaging or response-domain decisions.

### Wowbagger-owned scope

- Advertise contract-v5 capabilities for bounded list, pagination, transition affordances, bounded workbench projections, and exact semantic limits.
- Publish stable command, argv, bounded-stdin, result, envelope-namespace, exit-code, and compatibility schemas and fixtures.
- Document the shell-free launch requirement: Node.js 20 or later, absolute Node executable, absolute `wowbagger.js`, argument array, and `shell: false`.
- State explicitly that a missing executable is a host-level result, not malformed Wowbagger JSON.
- State that the host owns executable discovery, working directory selection, timeout, cancellation, process-tree containment, routing, and stream caps; Wowbagger documents requirements and outcomes but does not claim those facilities.
- Incorporate #129 through #131 by reference and keep #59's packaged-contract and #92's namespace-first envelope rules intact.

### Explicitly Orca-only scope

Exclude these from Wowbagger implementation and acceptance:

- panel-to-worker invoke-own-command bridging;
- opaque workspace tokens, focus generation, and focus invalidation;
- workspace-relative binding storage and containment;
- `process:exec` consent and declared-tool policy;
- native, WSL, SSH, and paired-runtime routing or relay negotiation;
- process spawning, host caps, cancellation, audit records, and no-local-fallback enforcement.

Orca source evidence, reported by the Orca architecture agent:

- `src/main/plugins/plugin-panel-controller.ts`: `PluginPanelController.execute` routes panel actions only to host methods.
- `src/main/plugins/plugin-service.ts`: `PluginService.invokeCommand`; the invoke-own bridge remains Orca work.
- `src/main/runtime/rpc/methods/plugins.ts`: `PLUGIN_METHODS` exposes invocation to authenticated clients, not sandboxed panels.
- `src/main/plugins/plugin-panel-sessions.ts`: `PluginPanelSessions` binds panel identity and transport ownership, not workspace identity.
- `src/main/plugins/plugin-host-service-bindings.ts`: `PluginRuntimeDelegate`, `bindPluginHostServices`; no process runner is exposed.
- `src/shared/plugins/plugin-capabilities.ts`: `PLUGIN_CAPABILITY_KINDS`, `pluginCapabilitySchema`; scoped `process:exec` is reserved for a later Orca phase.
- `src/shared/plugins/plugin-consent-fingerprint.ts`: `canonicalizePluginConsent`.
- `src/shared/wsl-login-shell-command.ts`: `buildWslExecArgs`, `buildWslCapturedLoginShellCommand`.

This boundary keeps Wowbagger's public machine contract portable while leaving authority, routing, and execution policy with the host that can actually enforce them.
