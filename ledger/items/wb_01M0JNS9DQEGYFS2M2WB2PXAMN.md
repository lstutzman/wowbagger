---
schema_version: 2
id: wb_01M0JNS9DQEGYFS2M2WB2PXAMN
number: 131
title: "Define response-loss recovery for native transitions"
kind: task
status: triage
created: 2026-08-21
updated: 2026-08-21
provenance:
  source: "orca-ledger-workbench-contract-audit"
  recorded_at: "2026-08-21T17:27:09.989Z"
depends_on: []
related: [wb_01KZW6PA0033YQ4GER7S86N6VJ, wb_01M086JPRKRHXNW5YB0GND09ZX]
---

## Problem

Native `transition` has exact-byte compare-and-set but no operation identity or outcome lookup. A caller that loses the response after publication cannot safely replay the request: a successful first call changed the revision, so a second call normally returns `revision-conflict`. Inspecting current bytes can show current state but cannot always correlate a later state with the lost operation after another legitimate mutation.

This is a product boundary for direct SSH and paired runtimes, where the owning host may complete a mutation after the UI-side connection disappears. Automatic retry risks appending duplicate evidence or misreporting another writer's result.

## Required decision

Define the native-transition response-loss contract before an Orca plugin exposes remote mutation. The preferred shape is a caller-supplied operation ID bound to the complete transition request plus a read/replay path, reusing the established publication-operation discipline where its semantics fit. An alternative is acceptable only if it gives the same mechanical at-most-once and correlation guarantees without requiring a mirrored ledger.

The contract must state behavior for both plain-folder local mutation and provisioned merge-coordinated ledgers. If one backend cannot support replay-safe recovery, capability discovery must say so and the plugin must refuse remote transition rather than guess.

## Acceptance criteria

- The request and capability contract state whether native transition accepts an operation ID and how a caller reads a durable outcome after response loss.
- Repeating the complete same request with the same operation ID cannot append a second decision or publish a second successor.
- Reusing an operation ID with different request bytes is a deterministic unchanged refusal.
- Success, ordinary refusal, pre-publication failure, committed-recovery state, unknown publication state, process death before an envelope, and later unrelated mutation each have an unambiguous recovery procedure.
- Outcome correlation binds at least command, item ID, expected revision, target status, date, decision evidence, and resulting revision when known.
- Stored operation evidence is bounded and core-owned; it is not a second copy of ledger item state. Retention and exhaustion behavior are explicit.
- Crash-point tests prove no duplicate lifecycle decision across response-loss retry on current Node and Node 20.
- Existing transition invocations without the new opt-in keep their current bytes and CAS semantics.
- No retry path bypasses claim fencing, reconciliation, candidate validation, or the single-item atomicity limit.

## Non-goals

No automatic retry policy, background daemon, event-driven transition, cross-clone lock, or Orca-owned outcome database belongs here. The caller still chooses whether and when to retry after reading the core outcome.

## Evidence

`TransitionRequest` accepts only ID, expected revision, target status, date, and decision. `mutation-finalize` is idempotent only for auto-commit recovery tokens; work-claim publication has a separate operation-ID contract. The gap was found while evaluating native transitions over Orca host-routed SSH and paired runtimes on 2026-08-21.
