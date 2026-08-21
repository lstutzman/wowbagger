---
schema_version: 2
id: wb_01M0JNS31AKVMDBVH86J156RBR
number: 129
title: "Add a bounded machine-readable item-list query"
kind: task
priority: 1
status: backlog
created: 2026-08-21
updated: 2026-08-21
provenance:
  source: "orca-ledger-workbench-contract-audit"
  recorded_at: "2026-08-21T17:27:09.989Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-21
    summary: "Accept the bounded item-list contract as a P0 workbench blocker."
    rationale: "Wowbagger v4 cannot enumerate non-ready items through a supported machine seam. Orca source evidence confirms bounded transport, snapshot, and N+1 constraints; the enriched contract keeps policy and authoritative state in Wowbagger."
---

## Problem

An Orca ledger workbench must list and filter every item in the ledger bound to the focused workspace. Core contract version 4 exposes only the ready queue as ordered item IDs; `inspect` requires a known ID or number. No public CLI operation enumerates triage, blocked, active, deferred, archived, killed, or done items. Consumers must otherwise parse Markdown or deep-import implementation modules, both outside the supported contract.

Existing `inspect` output is also unsuitable as a list projection: it includes full source bytes and body, has no output bound, and remains valid for oversized legacy items.

## Required contract

Add one versioned machine-readable list operation to the existing core CLI JSON domain. It must:

- require explicit `--ledger`; this item adds no ledger discovery or implicit path binding;
- load and validate the complete ledger and return no partial list for an invalid ledger;
- return bounded summaries containing at least immutable ID, number when present, title, kind, status, priority when present, created, updated, and exact item revision;
- define closed filter semantics sufficient for the workbench, including status, kind, readiness as of an explicit date, number, and title text;
- define deterministic sort keys and tie-break every order by immutable ID;
- use bounded cursor pagination rather than an unbounded array or offset over mutable data;
- return a ledger-snapshot witness and refuse a continuation cursor after the underlying ledger changes;
- advertise maximum page size and response-size limits in `capabilities`; and
- omit body and `source_base64` from list rows; callers retrieve one item through `inspect`.

The response is a live projection from Wowbagger on every invocation. Orca may cache it only as transient UI data and must never become another ledger state store.

## Acceptance criteria

- Contract prose and machine schemas define request flags, filters, ordering, cursor, snapshot-conflict refusal, limits, and exact response members.
- Normative fixtures cover empty, mixed-status, filtered, multi-page, stale-cursor, invalid-ledger, and maximum-page cases.
- Every valid item appears exactly once across an unchanged full traversal.
- A ledger mutation between pages produces the documented stale-snapshot refusal rather than duplication or omission under the old cursor.
- `capabilities` advertises the operation and exact limits under a new negotiated core contract version.
- Current `ready` and `inspect` bytes remain unchanged for their existing invocations.
- Tests run on current Node and Node 20.

## Non-goals

No daemon, database, search index, mirrored ledger, report parsing, automatic refresh event, or lifecycle change belongs in this item.

## Evidence

`src/cli.js:KNOWN_COMMANDS` has no list operation; `src/ready.js:selectReady` returns only ready IDs; `src/mutation.js:inspectedItem` returns an unbounded full snapshot. Found during the 2026-08-21 Orca ledger-workbench contract audit.

## Orca triage enrichment — 2026-08-21

Maintainer disposition: accept as a P0 read-workbench blocker (`priority: 1`). This item is independent of #130 and #131; #132 depends on it as an integration release gate.

Orca-specific constraints refine the contract without setting Wowbagger's numeric limits:

- Orca's sandboxed panel ingress is bounded today. Its 64 KiB panel message ceiling is evidence that the core must advertise exact page and response limits, not a proposed Wowbagger page limit. A consumer uses the lower of host and core budgets.
- `ready` cannot substitute for list: expanding ready IDs would omit every non-ready lifecycle state and create an N+1 inspect loop.
- A snapshot conflict requires restarting pagination. Orca must never combine pages from different ledger states.
- Rows need stable item IDs and exact revisions so selection and later inspect can correlate without treating number or path as identity.

Orca source evidence, reported by the Orca architecture agent:

- `src/shared/plugins/plugin-panel-bridge.ts`: `PANEL_MESSAGE_MAX_BYTES`, `PANEL_MESSAGE_RATE_LIMIT`.
- `src/shared/plugins/plugin-host-protocol.ts`: `pluginWorkerCommandResultSchema`, `PLUGIN_WORKER_INVOKE_TIMEOUT_MS`.
- `src/main/plugins/plugin-panel-controller.ts`: `PluginPanelController.execute`.

These files are Orca evidence only. Their implementation and limits do not become Wowbagger dependencies.
