---
schema_version: 2
id: wb_01M1RWN4P3CVAAEHP6T7B2WRE7
number: 194
title: "Share typed report filters and quick-view selection"
kind: task
priority: 20
status: in-progress
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-09-05T13:41:31.794Z"
depends_on: [ wb_01M1RWN4EHW20BP63XB2J8M03J ]
related: []
parent: wb_01M1RWN4BWJZX6RCCZ9Z6HKYXA
decisions:
  - action: accept
    date: 2026-09-05
    summary: "Accept the approved report redesign work."
    rationale: "Lee approved the report design and requested independently specified, dependency-linked ledger work on 2026-09-05. Scope, ownership, interfaces, acceptance criteria, and verification are recorded in this item; start only when ready and assigned."
---

## Assignment

Implement T2: Share typed report filters and quick-view selection. This is one standalone child of report epic #190. Scope and contracts are embedded here; the source plan is background, not a prerequisite for understanding the assignment. Parent ownership does not authorize taking another child's work.

## Required predecessors

- #191 — Preserve report tags and expose metadata coverage.

Dependencies are encoded in depends_on. Wait for their completed artifacts; do not duplicate or stub their implementations. The repository Orchestration Agent assigns the worktree, coordinates integration, and owns shared-resource validation. Claims in this ledger are merge-coordinated, not exclusive dispatch locks.

## Exclusive writable paths

- `src/report-selection.js`
- `test/report-selection.test.js`

These paths are the complete ownership boundary for this item and take precedence over a task's loose reference to direct callers. Read other source as necessary. If a required change lies outside this set, report the concrete integration need to the coordinator rather than editing another worker's file. No changes in other repositories.

## Approved product design

Build one report with three main sections, presented as accessible view navigation:

1. **Items**, the default, containing compact summaries, an area/status matrix, quick views, one item list, and item details.
2. **Flow**, containing scoped cumulative flow, arrivals, completions, closures, age distribution, acceptance-to-completion durations, and the existing forecast with honest closure terminology.
3. **Dependencies**, containing the existing ledger graph and roster, connected to the shared selection and item details.

Put search and controls at the top, before any long content. Keep them available during scrolling on desktop and mobile. Preserve grouping, sorting, Basic/Standard/Detailed modes, Show history, Expand all, and Collapse all. Offer long facet lists through accessible expandable controls rather than a permanently expanded wall of chips.

Replace the separate Work next list with a quick view of the canonical list. Other quick views are In progress, Blocked, Needs triage, and All open. Recommendation reasons remain next to the item. Use a desktop list/detail split and narrow-screen inline details. Inspecting an item must not clear the user's search, filters, or list position.

Expose status and readiness independently. Expose configured metadata, including area and multi-value tags. Missing metadata must be visible as missing or invalid, not guessed from titles. Area/status concentrations describe recorded work, not measured customer pain.

Every summary and chart must state its scope and offer a route to its contributing items when the displayed value has item-level contributors. Forecast probabilities have no individual contributing-item set and must not pretend otherwise.

### Explicit exclusions

- No Beads or Jira API integration and no copying their implementation code or branding.
- No new ranking algorithm, opaque importance score, automatic reprioritization, or ledger mutation.
- No invented historical in-progress, blocked-duration, ownership, or feature-area transitions.
- No new lifecycle event storage. Full historical workflow bands require a separate approved change.
- No cross-repository edits, release, npm publication, or deployment in this plan.
- No general dashboard builder, saved browser views, account system, or framework migration.
- No prerequisite to run `/design`; the design is already approved. A generated browser artifact is still a required execution deliverable.

## Shared data and API contracts

### Metadata

Preserve scalar values for every existing mapping. Add one multi-value slot:

```js
// Projected item fields. All entries except tags retain the scalar contract.
// A scalar tags source is accepted as a one-tag set.
fields: {
  area: 'Payments',
  tags: ['customer-visible', 'regression'],
  severity: 'high',
}
```

`tags` accepts a nonempty string or an array containing only nonempty strings. Deduplicate exact strings and sort deterministically. Do not split commas, lowercase values, coerce objects, or partially accept a mixed-type array. An empty array is missing. An invalid value is omitted from `fields` and counted as invalid metadata. `area` remains scalar; do not invent multi-area allocation rules.

Add model `fieldCoverage`, an array ordered by field name:

```js
{ name: 'tags', mapped: true, present: 8, missing: 2, invalid: 1 }
```

Calculate coverage over the retained named-report population. Include `area` and `tags` with `mapped: false` when not configured, plus every configured field. For an unmapped field, all retained items count as missing. Never print raw rejected extension values. A visible missing mapping notice must distinguish unconfigured mappings from missing item values.

Use a tagged filter selection, not the literal string `Unclassified`, to represent missing values:

```js
{ kind: 'missing' }
{ kind: 'value', value: 'Unclassified' } // a real consumer value
```

For tags, selected values use any-member matching. OR within a facet group, AND across groups. Count each item at most once for a given tag. Named view tag filters use the same membership rule, without changing existing scalar filter semantics.

### Selection and navigation

Create `src/report-selection.js` for pure report selection functions. It must not import Node-only APIs or DOM code. Follow the existing browser-source serialization pattern, and test the emitted source against the direct functions.

```js
export function selectReportItems(items, scope);
export function selectListItems(items, state, workNextIds);
export function countReportFacets(items, scope, dimensions);
export function reportSelectionBrowserSource();
```

Inputs and outputs:

```js
// items = projected open AND terminal items retained in the artifact.
// selectReportItems returns references to matching items in input order.
const scope = {
  search: '',
  facets: {}, // dimension => array of tagged selections defined above
};
const state = {
  scope,
  section: 'items', // items | flow | dependencies
  quickView: 'work-next', // work-next | in-progress | blocked | triage | all-open
  showHistory: false,
  groupBy: 'none',
  sortBy: 'recommended',
  richness: 'standard',
  selectedId: null,
  drilldown: null, // null or { label: string, itemIds: string[] }
  range: { from: '2026-06-15', to: '2026-09-05' },
};
// workNextIds is model.workNext.map(entry => entry.id).
// selectListItems returns the selected scope narrowed by quick view or drilldown.
// countReportFacets returns [{ dimension, options: [{ selection, count }] }].
```

Facet dimensions are `status`, `readiness`, `priority`, `kind`, and `field:<name>`. Preserve scalar type identity, including false, zero, and numeric versus string values. Search matches number, immutable ID, title, and normalized mapped values, case-insensitively. Search does not need to search full bodies.

Scope applies to summaries, flow cohorts, and graph nodes. Quick views, Show history, sorting, grouping, and detail level are list presentation controls, not analytical scope. Put them in a visibly labeled Items controls group. Flow and Dependencies show the active scope independently of the list quick view. A status facet in Flow means current-status cohort, not historical status selection.

Initial quick view is Work next. Selecting a quick view changes neither scope nor the main section's retained data. Show history includes terminal items in All open under a separately labeled History group; in other quick views it exposes that group's scoped history without changing recommendation membership. A terminal status facet must produce an explanation and a Show history action when history is hidden, never a misleading claim that there are no matching items.

A drilldown overrides list quick-view membership and history visibility while active, but still intersects the shared scope. Display its label and a Clear drilldown action. This lets a chart show historically accepted items that are now terminal without losing the current quick view. Clearing it restores the previous list view. Changing scope clears the drilldown. Selecting a relation for detail does not set a drilldown or clear filters.

`selectedId` may refer to an item outside the current browser scope but inside the artifact. Show an Outside current filters notice in its detail. Excluded named-view items remain number-only references labeled Not included in this report. Never fetch them or smuggle their content into the file.

### Historical evidence

Extend the existing evidence seam rather than adding a second calculator:

```js
export function buildEvidence(openItems, terminalItems, asOf, range = null);
export function reportEvidenceBrowserSource();
// range = null preserves the existing default twelve-calendar-week window.
// range = { from, to } uses inclusive UTC calendar dates, to <= asOf.
```

The source serializer embeds the same functions and dependencies used by Node. Test direct/runtime parity. Do the same for SVG rendering with `reportSvgBrowserSource()` in `src/report-svg.js`. Do not hand-maintain an alternative browser formula.

Weekly output must use `arrivals`, `closures`, `done`, and `rolling` instead of the misleading `completions` name. `rolling` remains the closure-rate mean used by the existing forecast. Migrate all callers in the same task. Preserve the deterministic forecast algorithm and label it as a closure-based estimate, not a feature-delivery commitment. Range edges use actual inclusive dates; partial weeks are explicitly marked in the display. Use four complete weeks for a four-week rolling mean, otherwise null. Calculate throughput using actual window duration rather than assuming every custom range contains twelve weeks.

Cumulative flow retains `triage`, `accepted`, and `terminal`. UI names them Untriaged, Accepted open work, and Closed. Explain that Closed includes done, killed, deferred, and archived. Do not relabel the underlying core lifecycle. Missing acceptance history must be described as reconstruction uncertainty, not proof that an accepted item was historically in triage. Keep data-gap counts visible. Current metadata and the current retained item population define the historical cohort. State that deleted items and unrecorded transitions cannot be recovered from the snapshot.

Age remains age since creation as of report generation, not time in status. Acceptance-to-completion samples include only done items with recorded acceptance. Do not infer a start date from `updated`.

### Dependency impact

Keep the existing transitive-leverage recommendation order unchanged. Change misleading visible wording from unblocks to downstream items where the count is merely transitive reachability.

Add report-only immediate-unlock analysis: which retained items would become ready if candidate X became done, with every other ledger fact unchanged. Compute against the complete ledger, then retain only IDs allowed into the named artifact. Never count an item that still has another blocker, is snoozed, has an ineligible kind/status, or has an unsatisfied ancestor. A killed prerequisite does not satisfy a dependency. Completing an ancestor can also change eligibility, so ancestor relationships cannot be ignored.

Produce per-candidate `{ downstreamIds, readyIfDoneIds }` using report IDs, not display numbers. `downstreamIds` describes the existing named-artifact dependency graph, with no changed ranking. `readyIfDoneIds` is the counterfactual result filtered to the artifact. Label both scopes. Browser filters narrow displayed affected-item lists and counts; they never recompute readiness from an incomplete graph.

## Browser integration contract

Initial Items view, persistent controls, one canonical list/detail implementation, and stable controller hooks:

```js
// Internal browser controller, owned by reportClientSource.
// Store on window.wowbaggerReport only for graph integration, not a plugin API.
{
  getScopeItems(),             // projected items matching current shared scope
  subscribeScope(listener),   // invokes listener with matching items; returns unsubscribe
  inspectItem(id),             // opens detail without changing scope or list position
  showItems({ label, itemIds }) // sets a visible drilldown and switches to Items
}
```

T4 owns script ordering: install `window.wowbaggerReport` before running `graphClientSource`. `subscribeScope` calls its listener immediately with the current scoped items and on each later scope change. The graph section remains `#graph`; graph code observes its visibility locally rather than requiring another shared controller mutation. T5B will add the immutable `impactById` map to the controller before T7 starts.

The immutable controller impact map has exactly the model's `impactById` shape. T4 installs the controller before graph startup; T5B adds that map before T6/T7. Graph uses `#graph`, which already exists, and observes visibility locally. T6 owns HTML/SVG integration; T7 owns graph code/tests only.

## Local implementation and acceptance

## T2: Implement the shared selection model

**Owner:** Selection worker. **Depends on:** T1.

**Files:** Create `src/report-selection.js` and `test/report-selection.test.js`. Consume `reportFieldValues` from `src/report-view.js`. Do not edit HTML, evidence, graph, or the DOM helper.

**Produces:** The four selection exports and state behavior defined in Shared contracts. Browser serialization must include the same typed field helper, not another matcher with different coercion rules.

- [ ] Start with one test of `selectReportItems` at the public selection seam:

```js
const scope = { search: '', facets: {
  'field:tags': [{ kind: 'value', value: 'regression' }],
  status: [{ kind: 'value', value: 'backlog' }],
} };
const items = [
  { id: 'a', number: 1, title: 'A', status: 'backlog', fields: { tags: ['regression', 'ui'] } },
  { id: 'b', number: 2, title: 'B', status: 'in-progress', fields: { tags: ['regression'] } },
];
assert.deepEqual(selectReportItems(items, scope).map(x => x.id), ['a']);
```

- [ ] Confirm RED, then implement typed scope matching and tokenized search. Preserve input item references.
- [ ] Repeat one cycle at a time for zero/false values, missing values, facet counts that exclude their own group, quick-view ordering, and drilldown/history behavior.
- [ ] Execute `reportSelectionBrowserSource()` in `node:vm` and compare observable selections with direct calls for the same fixtures. Do not assert source-string contents.
- [ ] Index normalized search and facet values once per artifact in the consuming runtime. Do not parse card JSON or traverse Markdown on every keystroke.
- [ ] Run `test/report-selection.test.js` and `test/report-config.test.js`, then commit.

**Exit:** Typed filters and quick views have one deterministic implementation that works both server-side and as an inline browser runtime.

## Required observable results

| ID | Observable acceptance | Original plan owners |
| --- | --- | --- |
| A04 | In-progress status and readiness are separately visible and filterable | T1, T2, T4 |
| A05 | Area and tags render, search, filter, and support named-view selection; missing/invalid data is explicit | T1, T2, T4 |

Only the assigned task's contribution to a cross-task criterion belongs here. Prerequisites provide their stated contracts; downstream UI or final acceptance work belongs to its own item. T5 in the original acceptance labels means T5A plus T5B.

## Verification and completion evidence

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-selection.test.js test/report-config.test.js
```

Coordinate focused RED/GREEN/REFACTOR validation slots. Concurrent authoring workers do not run shared suites, formatters, or builds while other edits are in flight. Never skip the failing behavioral reproduction to achieve concurrency. The coordinator runs the full Node 24 gate after integration; each worker records focused commands and their actual output.

For UI work, exercise the actual standalone HTML in a browser, including the stated no-result/error/keyboard cases, rather than claiming DOM or source-text assertions prove usability. For pure modules, exercise exported seams with adversarial behavior cases. Preserve existing valid behavior tests and replace obsolete implementation assertions rather than pinning new source text.

A completion report must identify changed files, acceptance evidence, commands/results, and any browser artifact paths. No stubs, compatibility fallback to duplicated layout, silent metadata invention, dispatch-semantic changes, release, push, or consumer configuration changes.

## Worker charter

- Read repository `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `HANDOFF.md`, its active handoff, and matching rules before execution. This plan does not override newer repository instructions.
- Use Node 24, with `/opt/homebrew/opt/node@24/bin/node` on this machine. Use `TMPDIR=/tmp` for every test command. Node 26 is excluded.
- Before changing an exported symbol, use LSP references when available. Resolve source ranges again; line numbers from planning are not edit anchors.
- Preserve report configuration versions 1 and 2 and CLI result envelopes. Add `tags` as an optional mapping in both versions. Do not increment the core contract for an HTML presentation change.
- HTML bytes and internal report structures necessarily change. Preserve existing configurations and public CLI behavior, not old visual snapshots.
- Keep one self-contained file. Preserve CSP, escaping, safe links, safe embedded JSON, deterministic generation, output containment, and atomic replacement.
- Never import or alter `spec/adapter-reference.js` or `test/work-claim-reference.js` to satisfy the implementation.
- Never use `git stash`, change credentials, mutate the consumer ledger, or overwrite the supplied reference artifact.
- **Agents MUST NOT create, update, change, delete, revoke, roll over, or rotate any credential in staging or production without express approval given by Lee directly.**
- Use `/usr/bin/trash` for agent-initiated file deletion. Managed tool lifecycle cleanup follows repository rules.
- Use OMP-native workers only. Do not launch external coding-agent CLIs. Worker approval mode must satisfy the runtime's full-access gate.
- Resolve the repository Orchestration Agent before protected work. That agent owns item assignment, ledger lifecycle changes, Git integration, and shared-resource coordination. Workers perform assigned claim operations directly under the current wowbagger skill.
- Ledger filing follows this plan's initial approval. The ledger epic and its standalone children are the execution authority for assignment and dependency state; no claim is acquired merely by filing work.
- A worker edits only its assigned worktree and task-owned files. A planning reference to PropertyCompass2 is not permission to enter that repository.
- One failing behavioral test, then minimal implementation, then the relevant suite. Repeat one behavior at a time. Do not write a batch of tests followed by a batch of implementation.
- Keep tests that defend behavior. Replace obsolete layout-specific assertions with the newly approved behavior. Do not preserve CSS/source-string assertions merely by changing their expected text.
- Do not build an increasingly realistic fake browser in `test/report-dom.js`. Use the existing helper for logic it supports and real browser checks for layout, focus, tabs, and SVG interactions.
- Every stage reports exact changed paths, RED/GREEN evidence, unresolved acceptance criteria, and its generated artifact path when applicable.

## Background reference

`docs/superpowers/plans/2026-09-05-decision-focused-report.md` (committed in `7dd4d90`). The embedded contracts and local acceptance above are sufficient to execute this assignment independently.
