---
schema_version: 2
id: wb_01M05787D42WQ2KDPWGFP9ZHZ0
number: 87
title: "Ship a Three.js 3D ledger graph as a marketing showpiece"
kind: task
status: triage
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: [wb_01M05787BCDWD5WDV6JXVCB8RG]
related: [wb_01M056Z54S740925V6AFVXWV22]
---
A visually striking, interactive 3D view of a wowbagger ledger - the artifact you show people. A force-directed 3D graph of the dependency DAG: nodes are items (colored by status/readiness, sized by unblocking leverage from #85, labeled #N), edges are `depends_on` and `parent`; orbit/zoom/hover interaction. Built on `3d-force-graph` (vasturiano) over Three.js. Research: `docs/research/2026-08-15-useful-backlog-reports.md` Part 3.

Architecture decisions (already researched, keep them):

- **Separate opt-in artifact, not the daily report.** The bundled library is ~300 KB gzipped (~1 MB inline text) - right-sized for a showpiece, wrong-sized to force on every report open. Generate via an explicit flag or config (e.g. `report --flair` or a `showpiece` config key) to a second output file next to the report.
- **Still one self-contained file.** Inline the vendored bundle so the showpiece keeps the report family's defining property: attach it, open it offline, share it. That property is the marketing value.
- **Supply chain:** vendor a pinned, checksummed three.js/3d-force-graph build into the repository; inline at generation time; never fetch from a CDN at view or generation time. Record the exact upstream version and checksum next to the vendored file.
- **Degradation:** without WebGL, show a plain explanation and the item list; no decision-relevant content may exist only in the 3D view.

Acceptance criteria:

- Generating with the flag produces a self-contained HTML file whose only script is the inlined vendored bundle plus inline glue (test: no external URL fetches in the file).
- Nodes render number, title, status color, and leverage-scaled size from a fixture ledger; edges distinguish depends_on from parent visually.
- Clicking or hovering a node shows #N, title, status, age, and its reasons line consistent with the #85 work-next entry.
- The default `report` invocation is byte-identical with and without the showpiece feature present in the codebase (no growth of the daily report).
- Vendored bundle carries a recorded upstream version + sha256; a test pins the checksum.
- Renders a 100+ item ledger (the real one) without console errors; verified in a real browser once during acceptance.
- Four-command gate green on both Node runtimes.