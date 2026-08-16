---
schema_version: 2
id: wb_01M05787BCDWD5WDV6JXVCB8RG
number: 86
title: "Render the report evidence layer as inline SVG charts"
kind: task
status: in-progress
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: [ wb_01M056Z54S740925V6AFVXWV22 ]
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the SVG evidence-chart layer into the backlog."
    rationale: "Maintainer ask: heatmaps, Monte Carlo, and graphs are needed for humans to visualize the evidence. Depends on #85 for the derived metrics; charts stay inline SVG so the report remains one self-contained file."
---
Humans need to *see* the evidence layer, not read tables of it. Render the metrics that item #85 computes as hand-rolled **inline SVG** charts inside the report - no chart library, no external request, preserving the report's verified single-self-contained-file property (styles, script, and even the logo are already inlined; see `renderReportHtml` / `readLogoDataUrl`). Research: `docs/research/2026-08-15-useful-backlog-reports.md` Part 3 (architecture), Parts 1-2 (which charts and why).

Charts (each reads the embedded JSON model already shipped in the report):

1. **Aging heatmap** - open items bucketed by age (<7d / 7-30d / 30-90d / >90d) crossed with status (and area when mapped); cell intensity = count. Staleness visible at a glance.
2. **Throughput run chart** - completed items per week from terminal dates, with a rolling average line.
3. **Arrivals vs completions** - created/week vs terminated/week; the gap is the backlog growing or shrinking.
4. **Cumulative flow diagram** - stacked state bands per day reconstructed from each item's created/accept/terminal dates.
5. **Cycle-time scatterplot** - accept-to-complete days per finished item, with p50/p85 percentile lines.
6. **Monte Carlo forecast fan** - resample weekly throughput against remaining open count; render the 50/85/95 percent completion-date bands behind the one-line forecast from #85.

Constraints:

- Inline SVG generated at report time or by the inline client script from the embedded model - zero external dependencies, works offline, one file.
- Charts degrade to their numeric summaries inside `<noscript>`/no-SVG contexts; the numbers never live only in pixels.
- Deterministic output for a given ledger and as-of date (Monte Carlo seeded deterministically) so report fixtures stay byte-stable.
- Items are labeled by number (#N) in every chart tooltip/axis, never by ULID.

Acceptance criteria:

- All six charts render from a fixture ledger with known dates and are pinned by report fixtures; each chart's SVG carries a stable data-testid.
- The report remains a single file with no external fetches (test: no http(s) URLs in the generated HTML except anchors).
- Seeded Monte Carlo fan matches precomputed percentile bands on a fixture ledger (mutation-guarded: skewing the resampler makes the test go red).
- CFD band totals reconcile with the stats block counts on the same ledger.
- Four-command gate green on both Node runtimes.