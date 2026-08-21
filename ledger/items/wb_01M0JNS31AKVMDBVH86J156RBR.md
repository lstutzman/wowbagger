---
schema_version: 2
id: wb_01M0JNS31AKVMDBVH86J156RBR
number: 129
title: "Add a bounded machine-readable item-list query"
kind: task
status: triage
created: 2026-08-21
updated: 2026-08-21
provenance:
  source: "orca-ledger-workbench-contract-audit"
  recorded_at: "2026-08-21T17:27:09.989Z"
depends_on: []
related: []
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
