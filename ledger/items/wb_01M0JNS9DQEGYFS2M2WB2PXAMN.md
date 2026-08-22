---
schema_version: 2
id: wb_01M0JNS9DQEGYFS2M2WB2PXAMN
number: 131
title: "Define response-loss behavior for native transitions"
kind: task
priority: 10
status: in-progress
created: 2026-08-21
updated: 2026-08-21
provenance:
  source: "orca-ledger-workbench-contract-audit"
  recorded_at: "2026-08-21T17:27:09.989Z"
depends_on: []
related: [ wb_01KZW6PA0033YQ4GER7S86N6VJ, wb_01M086JPRKRHXNW5YB0GND09ZX, wb_01M0JNS61XWMN8ZPDQKCFD9Q9R ]
decisions:
  - action: accept
    date: 2026-08-21
    summary: "Accept the narrowed response-loss contract at P1."
    rationale: "Remote process observation can disappear after a native transition dispatch, but permanent no-automatic-transition policy removes the need for operation IDs in the first release. The accepted scope stabilizes honest unknown outcomes and mandates once-only dispatch, no replay, invalidation, reconnect, and re-read."
---

## Problem

An explicit native transition can complete on a workspace-owning host after the UI-side SSH or paired-runtime transport loses the response. Replaying the same request is unsafe: success changed the item revision, and a retry can duplicate intent, race later work, or misreport another writer's result. Inspecting later bytes establishes current ledger state but cannot prove whether the lost request caused it.

The first workbench release permanently forbids automatic transitions and automatic retries. It therefore needs an honest unresolved-outcome contract, not a durable operation-ID subsystem.

## Accepted minimum contract

For explicit user-triggered transitions:

1. Orca dispatches each consented CAS transition once.
2. Only a positively observed complete process result establishes success, refusal, or known failure.
3. Exit 4 invalidates the inspected revision and requires re-inspection; it never triggers automatic retry.
4. Exit 6, signal, timeout, output truncation, or transport loss after dispatch yields an unverifiable result. Orca does not replay the mutation, invalidates its local view, and re-reads the ledger when the owning host becomes observable.
5. A later item state describes only current ledger state. The UI must not claim that it proves the lost transition succeeded or failed.
6. Wowbagger stabilizes and documents its exit-6 `unknown` and reconciliation envelopes, the states that require inspection, and the rule that blind replay is unsafe.
7. `operation_id` and durable outcome lookup are not required for the first explicit-transition release. The permanent no-automatic-transition decision makes them unnecessary unless future product scope introduces automated mutation or a user-approved retry requirement that demands correlation. Such a change requires a new contract decision.

## Acceptance criteria

- The mutation contract and packaged schemas distinguish unchanged, committed-recovery, unknown publication, signaled/timed-out transport, and no-envelope outcomes without inventing success.
- Consumer guidance states the once-only dispatch, no-retry, invalidate, reconnect, and re-read sequence exactly.
- Core and adapter fixtures cover exit 6 with `state: unknown`, committed recovery, incomplete output, signal, timeout, and launch failure at their existing public seams.
- A revision conflict continues to return exit 4 and cannot be reclassified as response loss.
- No new operation store, mirrored item state, automatic retry, or event-driven transition ships under this item.
- If later product scope requires replay-safe correlation, a separate versioned item defines operation identity, request binding, retention, and collision behavior before implementation.

## Orca evidence

The Orca architecture agent reported these owning-host transport surfaces:

- `docs/reference/ssh-execution-boundary.md`.
- `docs/reference/remote-wire-compatibility.md`.
- `src/relay/agent-exec-handler.ts`: `AgentExecHandler.exec`.
- `src/main/providers/ssh-git-provider.ts`: `SshGitProvider.runQueuedNonInteractiveExec`.

These sources establish that remote process observation can be lost independently of Wowbagger's ledger mutation. Orca owns routing and reconnection; Wowbagger owns honest mutation state and recovery semantics.

## Priority and relations

Accepted as P1 (`priority: 10`): a remote-write contract blocker, but not a read-workbench blocker. It is related to #130 and feeds its decision into #132; it does not depend on #129.
