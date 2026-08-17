---
schema_version: 2
id: wb_01M07V3MP8ZHJ76AEEG25S79Y2
number: 119
title: "Settle the epic-enablement definition and the missing deferred edges"
kind: task
priority: 10
status: in-progress
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T12:28:27Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Two numbers wearing one name; the deferred counter-example is real, and the edge table gap is mechanical."
---

Found during item #115's verification: the report's epic-enablement factor and the contract's epic terminal ratio are DIFFERENT numbers, and the contract now states the divergence plainly rather than papering it. src/report-sequencing.js counts a child as terminal when terminalDate is non-null, which includes archived and deferred; the contract's derivation (shared with the epic complete rollup, verified) counts done or killed only. Measured on the real function: an epic with one done, one archived, one deferred, one backlog child reports enablement 3/4 = 0.75 versus derivation 1/4 = 0.25.

Two defensible reads, decide one: (a) the report measures "children that will never need work again" - but a deferred child undefers (deferred -> backlog exists), so counting it terminal in a progress number overstates; (b) narrow the report factor to done-or-killed so one definition serves the contract, the rollup, and the sequencing layer. Bias (b): one definition, three surfaces, and the deferred counter-example is real. If (a) wins, the report factor gets its own name and the contract's divergence paragraph becomes the permanent record.

Also fold in #115's second finding, same document region: the section 8 allowed-edges table lists no deferred rows although task|epic backlog->deferred and deferred->backlog ship in source (src/mutation.js) and validate treats deferred as a terminal-dated status. Add the two rows and the defer/undefer decision evidence to the table - a real contract gap, mechanical fix.

Acceptance:
- One decision on the enablement definition, recorded; if (b), the report factor changes with its ranking mutation guards updated and fixtures regenerated, and the contract's divergence paragraph is replaced by the shared-definition citation.
- The allowed-edges table carries the deferred rows; the edge docs guard (if any) pins them.
- Gate green on both runtimes.
