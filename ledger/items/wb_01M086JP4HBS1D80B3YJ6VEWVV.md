---
schema_version: 2
id: wb_01M086JP4HBS1D80B3YJ6VEWVV
number: 122
title: "Run the provisioned-performance program"
kind: task
status: backlog
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T15:48:54Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Ideation survivor: the only program attacking the two measured provisioned-scale costs; instrument-first per the Sol enrichment; v4 bundled with #126."
---

Ideation survivor 1 of 5 (2026-08-17). Full design basis: docs/ideation/2026-08-17-open-ideation.md and the Sol enrichment at docs/ideation/enrichments/2026-08-17-perf.md - the enrichment is the authoritative scope; this body is its summary.

The provisioned-performance program, staged with measurement gates:

- Stage 0 (mandatory first): instrument bench/mutation-latency.bench.js with deterministic phase counters (item-lock acquisitions/fsyncs, HEAD tree entries, blobs/bytes read, namespace-lock acquisitions) and phase wall times. The current bench cannot attribute lock-vs-HEAD-read dominance; the ordering of the next two stages is DECIDED BY THIS MEASUREMENT, not assumed.
- Stage lock-coarsening: publish-claimed drops its per-item lock closure (currently every item ID - src/mutation.js publish-claimed lockIds) and relies on the namespace process lock it already holds (withClaimLock spans the whole publish). No timed lease. Per-item journal entries, refusals, envelopes stay byte-identical. Kill-point crash tests at every barrier. Known absorbed defect: lockSource writes operation publish-claimed while validLockOwner accepts only create/transition/patch (src/mutation.js:1941), so concurrent observers misclassify live publish locks as invalid-shape today - removing the per-item locks erases it; if this stage is deferred, that mismatch deserves its own small fix.
- Stage filename contract: two-tier identity - a basename exactly <id>.md claims that ID (frontmatter mismatch = new deterministic validation error), non-conforming names stay legal via a specified full-scan fallback; readGitHeadLedger takes a requested-ID set and narrows its reads. The tree search must NOT be layout-scoped (misplaced items must stay discoverable - see the misplaced-item fixtures). Requires core contract v4 (accepted-ledger semantics change); bundle with the item-source-bound item's v4 need - one bump, one release. Migration: this repo has 25 human-named item files (rename + same-commit reference sweep, quiesced); the consumer's ledger needs an inventory first.
- Stage 3: re-measure module AND fresh-process CLI paths; a read cache exists only as a decision point gated on a maintainer-stated SLO.

Open maintainer decisions (from the enrichment): mixed-version writer policy (quiesced all-writer upgrade vs compatibility fence) - coarse locking is only safe after one of them; the SLO that gates stage 3; whether consumer migration is an upgrade prerequisite.

Acceptance: the enrichment's stage-by-stage criteria verbatim (docs/ideation/enrichments/2026-08-17-perf.md section 5), including the counter-based guards (one namespace acquisition, zero item-lock creates on publish; requested-ID blob counts; C=1 vs C=N benchmarks) and byte-parity of every journal/envelope surface.
