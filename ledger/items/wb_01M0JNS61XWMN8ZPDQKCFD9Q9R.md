---
schema_version: 2
id: wb_01M0JNS61XWMN8ZPDQKCFD9Q9R
number: 130
title: "Expose native transition affordances per item"
kind: task
priority: 1
status: done
created: 2026-08-21
updated: 2026-08-21
completed: 2026-08-21
provenance:
  source: "orca-ledger-workbench-contract-audit"
  recorded_at: "2026-08-21T17:27:09.989Z"
depends_on: []
related: [ wb_01KZW6PA0044GM0VX1KD0DYD1M, wb_01M058NZK1NK5EDXX2C09K707V, wb_01M0JNS9DQEGYFS2M2WB2PXAMN ]
decisions:
  - action: accept
    date: 2026-08-21
    summary: "Accept native transition affordances as a P0 explicit-transition blocker."
    rationale: "The workbench cannot safely discover actions by copying lifecycle logic or probing a mutating command. Orca evidence confirms that UI events and host methods are separate surfaces; Wowbagger must return an observed, revision-bound affordance projection and retain final authority under lock."
  - action: complete
    date: 2026-08-21
    summary: "Complete the core-owned transition affordance projection."
    rationale: "Commits fd91051 and eb7fe4c add bounded inspect --workbench output, shared lifecycle definitions, complete observed issues/blockers, capability limits, four normative vectors, and differential coverage of all 17 task/epic edges including both no-decision edges. Task review and re-review are clean; focused current-Node and Node-20 gates each pass 76/76."
---

## Problem

A workbench must show which native lifecycle transitions an item can take before asking a person for consent. Core contract version 4 exposes `transition.supported` globally but no per-item affordance query. The allowed edge table and generated decision actions exist only in contract prose and private `src/mutation.js:transitionEdge`.

An Orca plugin currently has two bad options: duplicate Wowbagger lifecycle logic, which creates a second engine that can drift, or submit a transition as a probe, which mutates when the request is valid. Neither is acceptable.

## Required contract

Expose a read-only, versioned affordance projection from the existing inspect/query seam. The design may use an opt-in `inspect` projection or another core read command, but it must not create a second mutation path. From one complete validated ledger snapshot, return:

- the item ID, kind, current status, and exact inspected revision;
- every lifecycle target allowed by the native edge table;
- the generated decision action, if any, and whether caller-supplied summary and rationale are required;
- the minimum legal transition date derived from the item's current dates;
- observed ledger preconditions and blockers, using the same stable issue and blocker vocabulary as `transition`; and
- an explicit semantic distinction between an edge that is lifecycle-allowed, one presently blocked by the observed ledger, and one that may still be refused by a later lock, revision, claim-fence, or reconciliation race.

The projection must never claim that an option remains executable after the returned revision. The actual transition keeps the existing locked reload, exact-byte CAS, claim fence, blocker aggregation, complete candidate validation, and refusal precedence.

## Acceptance criteria

- Contract prose and machine schemas define exact request and response members and the observed-snapshot semantics.
- Normative fixtures cover every task and epic edge, both no-decision edges, terminal items with no targets, live dependencies, epic children, disposition blockers, minimum-date derivation, and invalid ledgers.
- The read operation changes no ledger, claim journal, reconciliation log, lock, or Git state.
- Affordance results and `transition` share one implementation-level lifecycle definition; tests fail if their edge/action/blocker projections diverge.
- Claim and lock races remain honest: the response names what it observed and does not advertise exclusive authority.
- Capability negotiation advertises the feature under the same new core contract version as the workbench list query.
- Current unflagged `inspect` bytes remain unchanged if the feature extends that command opt-in.
- Tests run on current Node and Node 20.

## Non-goals

No Orca-specific status names, automatic transitions, event listeners, claims UI, or mirrored lifecycle state belongs in core.

## Evidence

`src/cli.js:capabilities` advertises only transition support and CAS scope. `src/mutation.js:transitionEdge`, `transitionPreconditions`, and `transitionBlockers` hold the actual vocabulary. No machine-readable transition-discovery surface existed in the 2026-08-21 audit.

## Orca triage enrichment — 2026-08-21

Maintainer disposition: accept as a P0 explicit-transition blocker (`priority: 1`). It is independent of #129. #131 is related as the response-loss behavior contract, and #132 depends on this item.

Required consumer behavior is now explicit:

- The affordance projection includes inspected revision, target status, enabled state, generated action, decision requirement, minimum date, and blockers.
- Orca renders only returned affordances. It never copies `transitionEdge`, blocker, date, or decision logic.
- Orca submits the exact inspected revision as `expected_revision`. Exit 4 invalidates the item and requires re-inspection; it never triggers automatic retry.
- Agent events, worktree events, focus changes, and claim events never trigger a ledger transition. Every transition remains a deliberate user action.
- A returned affordance is an observation, not a lease. The core still rechecks revision, locks, claim fencing, reconciliation, and candidate validity.

Orca source evidence, reported by the Orca architecture agent:

- `src/shared/plugins/plugin-host-api.ts`: `PLUGIN_HOST_API_V0`.
- `src/main/plugins/plugin-host-methods.ts`: `executePluginHostCall`.
- `src/main/plugins/plugin-host-method-bindings.ts`: `HANDLERS`, especially `workspace.readContext` and `terminal.sendText`.
- `src/shared/plugins/plugin-manifest.ts`: `PLUGIN_EVENT_NAMES`.

These surfaces show why the panel must consume a core-owned lifecycle projection and why event delivery must remain separate from transitions.
