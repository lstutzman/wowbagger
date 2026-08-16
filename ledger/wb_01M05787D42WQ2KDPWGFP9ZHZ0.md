---
schema_version: 2
id: wb_01M05787D42WQ2KDPWGFP9ZHZ0
number: 87
title: "Ship a Three.js 3D ledger graph as a marketing showpiece"
kind: task
status: in-progress
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: [ wb_01M05787BCDWD5WDV6JXVCB8RG ]
related: [ wb_01M056Z54S740925V6AFVXWV22 ]
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the Three.js 3D ledger-graph showpiece into the backlog."
    rationale: "Maintainer ask: a Three.js visualization would serve marketing. Kept as a separate opt-in self-contained artifact (vendored ~300KB gzip bundle) so the daily report stays lean; depends on #86 for the chart data pipeline."
---

A visually striking, interactive 3D view of a wowbagger ledger - the artifact you show people. A force-directed 3D graph of the dependency DAG: nodes are items (colored by status/readiness, sized by unblocking leverage from #85, labeled #N), edges are `depends_on` and `parent`; orbit/zoom/hover interaction. Built on `3d-force-graph` (vasturiano) over Three.js. Research: `docs/research/2026-08-15-useful-backlog-reports.md` Part 3.

Architecture decisions:

- **REVISED (Lee, 2026-08-16): part of the regular report.** The graph is a section of the daily report - one `report` invocation, one self-contained HTML file, graph included, no flag and no second artifact. This supersedes the original separate-opt-in decision; the accepted cost is the inlined ~300 KB gzipped (~1 MB text) bundle riding every report open. The decision surface (Work next, Attention, Evidence) stays above the graph section.
- **Still one self-contained file.** Inline the vendored bundle; attach it, open it offline, share it. That property is the marketing value.
- **Supply chain:** vendor a pinned, checksummed three.js/3d-force-graph build into the repository; inline at generation time; never fetch from a CDN at view or generation time. Record the exact upstream version and checksum next to the vendored file.
- **Degradation:** without WebGL, the graph section shows a plain explanation; no decision-relevant content may exist only in the 3D view.

Acceptance criteria:

- The plain `report` invocation produces one self-contained HTML file including the graph section; the file makes zero external fetches (test) and two renders of the same ledger at the same as-of are byte-identical (test).
- Nodes render number, title, status color, and leverage-scaled size from a fixture ledger; edges distinguish depends_on from parent visually.
- Clicking or hovering a node shows #N, title, status, age, and its reasons line consistent with the #85 work-next entry.
- Vendored bundle carries a recorded upstream version + sha256; a test pins the checksum.
- Renders a 100+ item ledger (the real one) without console errors; verified in a real browser once during acceptance.
- Four-command gate green on both Node runtimes.
