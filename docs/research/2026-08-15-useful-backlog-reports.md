# Research — what makes a backlog report useful (2026-08-15)

Commissioned because the current wowbagger HTML report "is not that useful."
This captures internet research on high-signal backlog/flow reporting and maps
it onto wowbagger's existing data so the recommendations are actionable, not
generic.

## 1. What the current report is (verified from source)

`src/report.js` + `src/report-html.js` produce a **static snapshot**:

- A masthead + an `--as-of` date.
- A **stats grid**: counts by state (total, open, terminal, ready, blocked,
  ineligible, triage, in-progress, snoozed, done, killed, deferred, archived).
- **Item cards** (open items, sorted by priority then created) with badges,
  relations, decision records, and a body excerpt.
- A **terminal table** (done/killed/deferred/archived).
- **Swarm batches**: area-diverse ready items for parallel agent dispatch.

It answers exactly one question well: *"what items exist and what state are they
in right now?"* Everything is a count or an item dump. That is the problem.

## 2. Why it reads as "not useful" (the diagnosis)

Every industry source on report quality says the same thing: a useful report is
**actionable** — a metric earns its place only if moving it triggers a decision.
Counts of items by state are close to **vanity metrics**: they "go up and to the
right" and make you feel informed without informing a decision. [secoda,
amplitude, quickbase] The report has:

- **No time dimension.** No trend, no "what changed since last report," no
  arrival-vs-completion. You cannot see whether the backlog is growing faster
  than it is being cleared. [ruhanirabin, chortek]
- **No aging.** Nothing surfaces the item that has sat in backlog for 40 days or
  the in-progress item that is stuck. Aging is the single highest-signal backlog
  metric and it is absent. [teamoclock, agileambition, brokenbuild]
- **No flow / delivery-rate metrics.** No throughput, cycle time, or WIP, so it
  cannot answer "how fast are we going" or "when will this be done."
  [vacanti/theburndown, scrum.org]
- **No forecast.** No "N items left, ~M/week → done around date X."
- **No decision surface.** No executive summary, no risks/blockers-to-act-on, no
  RAG health, no "what needs your attention." A reader must derive all of that
  by eye from the cards. [amoeboids, quickbase, canva]

It optimizes for completeness (show every item) over decision support (show me
what to do).

## 3. The canon — what high-signal backlog reports contain

### 3.1 The four flow metrics (Kanban / Vacanti)
Track a few, not everything. [kollabe, theburndown]

- **Work In Progress (WIP)** — items started but not finished. Leading
  indicator; uncontrolled WIP destroys predictability. [dzone, businessmap]
- **Work item age** — elapsed time an *unfinished* item has been in progress.
  **Leading** indicator; the daily-standup question shifts from "what did you
  do?" to "what's aging?" Flag items past the 85th percentile of historical
  cycle time. [brokenbuild, agileambition]
- **Cycle time** — start→done elapsed time for *finished* items. **Lagging.**
  Visualize as a **scatterplot** (per-item, with percentile lines) — this is the
  workhorse chart. [theburndown, kollabe]
- **Throughput** — count of items finished per period. **Lagging.** Visualize as
  a run chart / histogram. Count-based, so no story points needed. [wrike,
  scrum.org, getnave]

**Little's Law** ties them: `avg WIP = avg throughput × avg cycle time` — cutting
WIP cuts cycle time without working harder. [gembaacademy, kollabe]

### 3.2 Backlog-health metrics
- **Backlog aging / freshness** — age distribution of open items; red-flag items
  lingering for months. Group into age buckets and show the shape. [teamoclock,
  allankelly]
- **Ready ratio** — fraction of backlog that is actually workable now. wowbagger
  already computes readiness (`ready`/`blocked`/`ineligible`); the *ratio and its
  trend* is the signal, not the raw count. [agile-tools, anagilemind]
- **Backlog size trend** — total open items over time. Growing faster than
  throughput = over-scoping; shrinking = about to run dry. [ruhanirabin,
  scrumalliance]

### 3.3 Flow visualizations
- **Cumulative Flow Diagram (CFD)** — stacked bands per state over time; band
  width = WIP, "done" slope = throughput, horizontal gap = cycle time. Widening
  bands = a bottleneck. The one chart that shows all three at once. [wrike,
  logrocket, adobe]
- **Cycle-time scatterplot** and **aging chart** as above.

### 3.4 Probabilistic forecasting (throughput → "when")
Prefer **Monte Carlo** over average-velocity extrapolation. Resample historical
throughput thousands of times to output a **date range with probabilities**
("85% by week 11, 50% by week 8") instead of a false single date. It is
count-based (no story points), data-driven, and harder to game — a natural fit
for wowbagger. [vacanti "When Will It Be Done?", 55degrees, observablehq,
scrum.org] Average velocity gives a deterministic single point that "creates a
false sense of certainty" and invites story-point gaming. [linearb, getdx]

### 3.5 Report-design principles (what makes it *land*)
- **Lead with an executive summary / decision surface**: status, what changed,
  top 2–3 risks, next actions. Must stand alone. [asana, instituteprojectmgmt]
- **Actionable > vanity**: every number tied to a decision. [secoda, amplitude]
- **RAG (red/amber/green) health** for one-glance status. [quickbase, amoeboids]
- **Show what changed** since the last report — specific, measurable deltas.
- **Action orientation**: end with prioritized next steps / "needs your
  attention," with owners. [quickbase, canva]
- **Tailor to audience**: exec = high-level; worker = detail. wowbagger has TWO
  audiences — a human reading for decisions and agents reading for dispatch — so
  the summary layer and the machine queue layer are both first-class.

## 4. wowbagger already has the data (key finding)

None of this needs new capture infrastructure. Every wowbagger item carries the
event history in its own fields:

- `created` (arrival), and terminal dates `completed`/`killed`/`deferred`/
  `archived` (departure).
- **Decision records** carry `action` + `date` — `accept` (triage→backlog),
  `complete`, `defer`, etc. — a timestamped lifecycle log per item.
- `status`, `priority`, `parent`/`depends_on`, and custom `area`/`complexity`.

Because each item timestamps its own arrivals and departures, a **single
snapshot reconstructs the full history** — CFD, throughput run chart, aging
distribution, and cycle-time scatter are all derivable from the current ledger
at report time. No stored snapshots required.

Derivations (all from existing fields):
- **Backlog age** = `as_of − created` (bucket into <7d / 7–30d / 30–90d / >90d).
- **Lead time** = `completed − created`; **cycle time** = `completed −`
  accept-decision date.
- **Throughput** = completed count per week from terminal dates.
- **Arrivals vs completions** per week = created dates vs terminal dates → CFD +
  net backlog-growth trend.
- **Ready ratio** = ready / open (already computed; add the trend).
- **Forecast** = Monte Carlo resample of weekly throughput over remaining open
  count → probabilistic completion date.

Gaps to note honestly:
- **[VERIFIED 2026-08-16]** `backlog→in-progress` records **no** decision
  (`transitionEdge` sets `requiresDecision:false`), so the *in-progress* start
  is not separately timestamped — only `updated` moves. Precise "in progress"
  cycle time is therefore coarse; use `accept→complete` as the reliable cycle
  time, or start timestamping the in-progress transition if finer flow is wanted.
- wowbagger has **no story points** — which is fine; the whole flow/Monte-Carlo
  canon is count-based and considers that *better*.

## 5. Recommended report shape for wowbagger (prioritized)

Restructure from "list of everything" to "decision surface, then evidence."

**P0 — highest signal, all from existing data**
1. **Executive summary band** at top: open count + net change since last report,
   throughput (last 4 weeks), ready ratio, a RAG health dot, and the single
   line "≈N items open, ~M/week → likely done <date range>."
2. **Attention list**: oldest-aging open items, blocked items with their blocker,
   and anything in-progress/claimed past the 85th-percentile age. This replaces
   the undifferentiated card wall as the thing you read first.
3. **Aging distribution** of open items (age buckets), so staleness is visible.

**P1 — trend/flow (still from a single snapshot)**
4. **Throughput run chart** (completed/week) + **arrivals-vs-completions** (is the
   backlog winning or losing?).
5. **Cycle-time summary** (median / 85th percentile from `accept→complete`).
6. **Monte Carlo forecast** for "remaining open work" → date range with 50/85/95%
   confidence.

**P2 — richer visuals**
7. **CFD** from reconstructed daily state counts.
8. **Cycle-time scatterplot** with percentile lines.

**Keep**: the item detail cards and swarm batches — but demote them *below* the
decision surface. They are the drill-down, not the headline.

**Two-audience note**: keep the machine-readable projection (the JSON model +
swarm batches) for agents; add the human decision surface (summary + attention +
forecast) for Lee. Same data, two layers.

## 6. Sources
Flow metrics: theburndown.com/flow-metrics, dzone (4 metrics), businessmap.io,
getnave.com/aging-chart, brokenbuild.net (WIP aging), wrike Kanban guide,
gembaacademy (Little's Law), scrum.org (throughput). Backlog health:
teamoclock.com, agileambition.com/Essays/Work-Item-Age, allankelly.net
("how fresh is your backlog"), agile-tools.io, ruhanirabin.com, scrumalliance
(large-backlog anti-pattern). Forecasting: Daniel Vacanti *When Will It Be Done?*
/ *Actionable Agile Metrics*, 55degrees.se, observablehq (Troy Magennis intro),
scrum.org/monte-carlo, linearb (velocity risks). Report design: amoeboids.com,
quickbase.com, canva.com, asana.com (executive summary), secoda.co / amplitude
(vanity vs actionable metrics).

---

# Part 2 — the sequencing lens (re-research, 2026-08-16)

The maintainer sharpened the purpose: the report is not a dashboard *of* work,
it is a dashboard that shows **what needs to be worked, in order** — by user
ask, by security, by enabling other large items. Flow metrics (Part 1) become
the evidence layer; the headline is a **ranked work-next list where every entry
carries its reason**. Re-research on ordering:

## 7. Sequencing canon

### 7.1 WSJF / Cost of Delay (the economics of order)
SAFe's Weighted Shortest Job First: `WSJF = Cost of Delay / Job Size`. Cost of
Delay decomposes into exactly the maintainer's three axes:
**user-business value** ("user ask"), **time criticality**, and **risk
reduction / opportunity enablement** ("security" and "enabling other items").
Highest value-per-unit-of-size goes first. [productplan, blackswanfarming,
simpliaxis] The insight to keep is the *decomposition*, not the ceremony: order
is a function of value, urgency, risk, and enablement — divided by size.

### 7.2 Kanban classes of service (the "why" vocabulary)
The canonical queue-jump taxonomy [businessmap, scrum.org, agilevelocity]:
- **Expedite** — actively-harming issues, security incidents; jumps everything,
  WIP limit 1. Security fixes with real exposure live here.
- **Fixed date** — real external deadline; cost of delay spikes at the date.
- **Standard** — the default; FIFO-ish within priority.
- **Intangible** — tech debt / hardening / enablers; low visible urgency, must
  not starve. Risk-based security ordering (RBVM) uses business risk, not raw
  severity, to place items in these classes. [paloaltonetworks]
A report that shows *class* next to each recommended item explains "why this
jumps the queue" in one word.

### 7.3 Dependency leverage — prioritize what unblocks (the graph)
- **Elevate unblocking tasks**: an item inherits the urgency of what it
  enables; a plumbing task carrying a user-facing feature carries that
  feature's value. [grasp.study, planisware]
- Dependencies shrink scheduling freedom and stretch lead time — "each added
  dependency can halve the options for when work can start." [medium/agile-otb]
- **Critical path / slack**: items whose delay delays everything get priority;
  network-diagram thinking applies to a `depends_on` DAG directly. [atlassian,
  wrike]
- **Enablers** (SAFe): architectural-runway work is first-class, prioritized by
  what it opens up, not its own visible value. [agileseekers]

## 8. Mapping to wowbagger (what is computable today)

The ledger already carries a real dependency DAG (`depends_on`, cycle-checked)
and a parent/epic tree. So the two *structural* orderings are computable now,
with zero new data:

- **Unblocking leverage** = transitive count of open items whose `depends_on`
  chain passes through this item (reverse edges of the DAG). "Do #38 → unblocks
  4 items including epic #21."
- **Epic enablement** = for each ready item, which parent epic it advances and
  how close that epic is to done (siblings terminal / total). Finishing the
  last child of a 90%-done epic is high leverage.
- **Age** (created → as_of) and **priority** already exist.
- **Job-size proxy**: the `complexity` extension field already flows through
  report field mappings — usable as the WSJF denominator when present.

The *value* dimensions ("user ask", "security", "fixed date") are **not** in
the schema — and should not be core fields. They ride the existing extension
field + report `fields` mapping mechanism (exactly like `area`/`complexity`):
a documented `class` convention (`expedite|fixed-date|standard|intangible`)
plus optional `due` date. The core stays policy-free; the report renders the
policy.

**Design boundary (matters):** the core deliberately "never invents,
recalculates, or persists" a priority (`src/validate.js`, `src/ready.js`
comments) — `ready` is the deterministic queue (priority → created → id). The
**recommended order therefore belongs in the report layer**: a derived,
explainable ranking with reasons, never a mutation of items and never a change
to `ready`'s contract. Report proposes; human/agent disposes.

## 9. Revised recommendation (supersedes §5's P0 framing)

The report leads with **"Work next" — a ranked list of ready items, each with
its reasons**, e.g.:

> 1. **#85 Report revamp** — user ask · unblocks 0 · age 1d
> 2. **#38 linux/win32 support** — unblocks epic #21 (85% done) · age 12d
> 3. **#77 …** — expedite/security · age 30d ← class from extension field

Ranking inputs, in the order they should dominate: expedite class → fixed date
proximity → unblocking leverage (transitive) → epic enablement → priority →
age (tiebreak). Every factor is shown, not hidden in a single opaque score —
the reasons ARE the report. Below that: the attention list (aging/blocked/
stuck), then Part 1's flow/forecast evidence layer, then the existing cards and
swarm batches as drill-down.

## 10. Additional sources (Part 2)
WSJF/CoD: productplan.com, blackswanfarming.com (Cost of Delay), simpliaxis,
airfocus. RICE (rejected for wowbagger: needs reach/impact estimates the ledger
does not carry): centercode. Classes of service: businessmap.io, scrum.org,
agilevelocity, teamhood; RBVM: paloaltonetworks. Dependency leverage/critical
path: atlassian CPM, wrike, planisware, agileseekers (dependency mapping),
scrumalliance (deps → PO reorders backlog).

---

# Part 3 — the visualization layer (2026-08-16)

Maintainer additions: humans need heatmaps / Monte Carlo charts / graphs to
*see* the evidence, and a Three.js piece would serve marketing.

## 11. Constraint verified from source

The report is deliberately a **single self-contained HTML file**: styles and
client script are inlined by `renderReportHtml`, and even the logo is embedded
as a data URL (`readLogoDataUrl`). No external requests at view time. That
property is worth protecting — it is what makes the report attachable,
archivable, and (for marketing) trivially shareable.

## 12. Two-tier visualization architecture

- **Tier 1 — in the report, dependency-free.** All Part 1/2 evidence rendered
  as hand-rolled **inline SVG** (no chart library): aging heatmap, throughput
  run chart, arrivals-vs-completions, CFD, cycle-time scatter with percentile
  lines, Monte Carlo forecast fan (50/85/95 bands). SVG from the embedded JSON
  model keeps the file self-contained and small.
- **Tier 2 — the marketing showpiece, opt-in.** A 3D force-directed dependency
  graph of the ledger (nodes = items colored by status/readiness, sized by
  unblocking leverage; edges = depends_on/parent). `3d-force-graph`
  (vasturiano), built on Three.js, is the established library; bundled with
  three.js it is ≈300 KB gzipped [github 3d-force-graph#695], and inlining the
  bundle into a single HTML file is a supported offline pattern [vasturiano
  docs]. Three.js alone is ≈125–154 KB gzipped [bundlephobia,
  stephan-brumme]. Too heavy to force on the daily report; right-sized for a
  separate generated artifact that stays one shareable file.
- **Supply chain rule:** vendor a pinned three.js/3d-force-graph build into the
  repo (checksummed), inline at generation time. Never a CDN fetch at view
  time — that would break both self-containment and supply-chain hygiene.
- **Degradation:** no-WebGL environments get a plain message plus the 2D
  dependency table; the decision content never lives only in 3D.
