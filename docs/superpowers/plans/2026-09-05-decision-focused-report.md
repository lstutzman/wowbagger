# Decision-focused report implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read this entire plan before accepting a task; the shared contracts are mandatory.

**Goal:** Turn the standalone wowbagger report into a product-manager workspace with one item browser, persistent controls, explainable recommendations, visible metadata, and scoped flow and dependency analysis.

**Architecture:** Preserve the existing report model, core readiness rules, recommendation ordering, atomic publication, and offline HTML distribution. Share one browser selection model across the item browser, summaries, flow charts, and ledger graph. Keep item bodies in one canonical location and reuse existing calculations in Node and the browser instead of introducing a second analytics implementation.

**Tech stack:** Node 24 ESM, `node:test`, generated HTML/CSS/JavaScript, existing inline SVG charts, existing vendored `3d-force-graph`, existing Markdown renderer. No new application framework, service, CDN, or runtime dependency.

**Spec:** The approved design is recorded in the next section of this document. Lee approved the layout and the Beads Viewer/Jira adaptations in this conversation. This document is the complete worker handoff. It does not claim an implemented prototype exists.

## Approved design and boundaries

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

## Evidence and source map

The inspected reference artifact is `/private/tmp/propertycompass2-wowbagger-report.html`. It contained 1,744 items, 563 open items, 346 Work next links all targeting repeated cards below, 152 blocked items, and 12 in-progress items. No open card carried a mapped field. These are observations of that file, not a current consumer-ledger inventory. Its approximately 10.6 MB size is a useful scale reference.

Two native browser attempts timed out during assessment. Markup and embedded data were inspected instead. No visual acceptance has passed yet. Do not repeatedly retry the same blocking browser call. Start verification with a small generated fixture, then a large generated fixture.

Current sources and responsibilities:

| File | Relevant responsibility |
| --- | --- |
| `src/report.js` | `loadReportConfig`, `resolvePointer`, `buildReportModel`, projected fields, named-view boundary, atomic publication |
| `src/report-view.js` | Typed named-view matching, OR within a group and AND across groups |
| `src/ready.js` | Complete-ledger readiness and its reasons; `projectReadiness` and `selectReady` |
| `src/dependencies.js` | Only `done` satisfies a dependency |
| `src/report-sequencing.js` | Existing recommendation factors, transitive leverage, terminal ratio |
| `src/report-attention.js` | Blocked, oldest, and slow-started attention sets |
| `src/report-evidence.js` | Date reconstruction, aging, throughput, cumulative flow, duration, forecast |
| `src/report-svg.js` | Deterministic SVG charts |
| `src/report-html.js` | Markup, styling, escaping, browser runtime, controls, details |
| `src/report-graph.js` | Graph projection, roster, WebGL fallback, independent status filter to replace |
| `src/report-markdown.js` | Safe Markdown renderer and source serialization precedent |
| `test/report-*.test.js` | Model, browser runtime, graph, SVG, publication, CLI, and compatibility coverage |
| `test/report-dom.js` | Small fake DOM for runtime tests; not proof of actual layout |
| `README.md` | Shipped report setup and behavior documentation |
| `docs/host-contract.md` | Shipped host-facing report contract; update only changed contractual facts |
| `skills/wowbagger/SKILL.md` | Installed report usage guidance, not the place for UI internals |

Source findings that bind implementation:

- `FIELD_KEYS` in `src/report.js` is a closed list. It currently includes `area` but no `tags` slot.
- `projectItem` keeps only string, number, and boolean mapped values. Arrays currently disappear.
- `matchesReportView` preserves scalar types. Numeric `1` and string `"1"` must remain different.
- Readiness is calculated before a named view removes items. Excluded items contribute only number labels afterward.
- Current transitive leverage is calculated over the named report's retained open items. Preserve this ordering and scope.
- `buildWeeklyFlow` currently calls all terminal departures `completions`. The UI must distinguish closures from delivered work.
- `buildCumulativeFlow` reconstructs only creation, acceptance, and terminal dates. Existing current data does not establish historical in-progress starts.
- Current cycle samples include only `done` items with an acceptance date. The measurement is acceptance to completion.
- `src/report-html.js` currently clears search and facets when revealing an item. That behavior is intentionally replaced.

Research references:

- [Beads Viewer](https://github.com/Dicklesworthstone/beads_viewer): list/detail navigation, ready filtering, visible labels, explainable triage, and dependency insights.
- [Jira cumulative flow documentation](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-cumulative-flow-diagram/): status inventory over time, accumulation, board/filter scope, and date-range selection.

## Global constraints and worker charter

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

## Ownership and execution schedule

The coordinator is the integration owner. Use one author for each task. Do not assign every task at once.

| Stage | Tasks | Dependencies | File ownership boundary |
| --- | --- | --- | --- |
| Independent foundations | T1 metadata, T3 evidence, T5A impact engine | None | T1 owns report projection/view matching; T3 owns evidence/SVG plus narrow HTML naming migration; T5A owns a new impact module and its tests only |
| Selection | T2 | T1 | New selection module and tests only |
| Browser | T4 | T2, T3 | HTML, HTML tests, and shared DOM helper; installs the controller before graph startup |
| Decisions | T5B | T4, T5A | Report/HTML impact integration, area matrix, and attention summaries; no graph edits |
| Parallel views | T6 Flow, T7 Dependencies | T5B | T6 owns HTML/SVG and their tests; T7 owns graph and graph-only tests; neither edits the other's files |
| Acceptance | T8 | T6, T7 | Final browser/CLI verification, reproducible fixtures, and documentation |

T1, T3, and T5A can begin together in separate assigned worktrees. T2 can begin when T1 lands without waiting for the other roots. T6 and T7 can run together after T5B because T4/T5B own all shared HTML/controller integration in advance. Dependencies express required artifacts, not a blanket stage barrier. A concurrent agent batch must skip validation while edits are in flight; never use that restriction to skip RED. Coordinate focused TDD validation slots before corresponding production edits. Full suites, formatters, shared-resource checks, and Git integration remain coordinator-owned and serialized.

References to T5 elsewhere in the acceptance checklist mean T5A plus T5B. Only the task sections and the dependency table above assign file ownership.

No task may ship a fallback to the old duplicated layout. Stage commits are integration checkpoints, not permission to declare the whole redesign complete.

## Shared contracts


Use these atomic commit subjects after each task's relevant checks pass. The coordinator performs Git integration; worker commits follow the assigned worktree's current authority rules.

| Task | Commit subject |
| --- | --- |
| T1 | `feat(report): preserve tags and expose metadata coverage` |
| T2 | `feat(report): share typed scope and quick-view selection` |
| T3 | `feat(report): scope flow evidence and distinguish closures` |
| T4 | `feat(report): replace duplicate lists with one item workspace` |
| T5A | `feat(report): derive immediate readiness impact independently` |
| T5B | `feat(report): connect area concentrations and dependency impact` |
| T6 | `feat(report): connect scoped flow charts to contributing items` |
| T7 | `feat(report): share scope and details with the dependency graph` |
| T8 | `test(report): add reproducible redesign verification fixtures` |
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

## T1: Preserve metadata and expose gaps

**Owner:** Metadata worker. **Depends on:** none.

**Files:** Modify `src/report.js`, `src/report-view.js`, `test/report-model.test.js`, and `test/report-config.test.js`. Update the mapped-fields section of `README.md` after behavior passes. No HTML or graph edits.

**Consumes:** Existing configuration versions, JSON pointers, complete-ledger readiness, and typed named filters.

**Produces:** Normalized `fields.tags`, retained scalar mappings, and `model.fieldCoverage` as specified above. Export `reportFieldValues(value)` from `src/report-view.js` returning `[]` for absent values, the tag array for tags, or `[value]` for a scalar. Use it in named matching and later selection code.

- [ ] Add one behavior test to `test/report-model.test.js` using its existing `item` helper. Start with a version-1 config whose `fields` maps `area: '/data/area'` and `tags: '/data/tags'`.

```js
const report = await import('../src/report.js');
const model = report.buildReportModel([
  item('wb_a', { data: { area: 'Payments', tags: ['regression', 'customer-visible', 'regression'] } }),
  item('wb_b', { data: { area: 'Accounts', tags: ['regression', 4] } }),
], {
  reportVersion: 1, repository: { name: 'Example', logo: null },
  title: 'Example', outputPath: '/tmp/example.html',
  fields: { area: '/data/area', tags: '/data/tags' }, swarm: null,
}, '2026-09-05');
assert.deepEqual(model.items.find(x => x.id === 'wb_a').fields.tags,
  ['customer-visible', 'regression']);
assert.equal(model.fieldCoverage.find(x => x.name === 'tags').invalid, 1);
```

- [ ] Run the model test and confirm failure comes from absent tag behavior, not imports or malformed fixture data.
- [ ] Add `tags` to the mapping allowlist, normalize its value in projection, and calculate retained-population coverage. Leave unrelated scalar behavior unchanged.
- [ ] Run the model and configuration suites. Then repeat one RED/GREEN cycle for named-view matching of a tag array and one for missing versus literal `Unclassified` metadata semantics where applicable.
- [ ] Verify existing version-1/version-2 configs, numeric and string distinctions, pointer escaping, and output-containment tests still pass.
- [ ] Document the copyable mapping example and missing/invalid semantics. Commit only task-owned files after the relevant suite passes.

**Exit:** An item with two tags can be included by either named tag filter; invalid metadata is visible through coverage instead of silently becoming a valid classification.

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

## T3: Make historical evidence scoped and accurately named

**Owner:** Evidence worker. **Depends on:** none. Existing projected item fields suffice; metadata additions are not a prerequisite.

**Files:** Modify `src/report-evidence.js`, `src/report-svg.js`, `test/report-evidence.test.js`, `test/report-svg.test.js`, and their direct callers found through references. Add runtime-parity cases in the evidence/SVG tests. Any required `src/report-html.js` field-name migration is a narrow, coordinator-serialized change before T4 starts.

**Produces:** Extended `buildEvidence`, `reportEvidenceBrowserSource`, `reportSvgBrowserSource`, and the closure/done distinction. SVG output retains accessible descriptions and numeric alternatives.

- [ ] Begin with a test that a done item and a killed item produce two closures but only one completion. Use the existing `item` and `config` fixtures in `test/report-evidence.test.js`.

```js
const model = buildReportModel([
  item('wb_done', { status: 'done', completed: '2026-08-13' }),
  item('wb_killed', { status: 'killed', killed: '2026-08-13' }),
], config(), '2026-08-14');
const week = model.evidence.weeks.find(x => x.weekStart === '2026-08-10');
assert.equal(week.closures, 2);
assert.equal(week.done, 1);
```

- [ ] Confirm RED. Rename the internal weekly field to `closures`, add `done`, and migrate every consumer without a `completions` compatibility alias. Keep the forecast on closures and change its labels accordingly.
- [ ] Repeat RED/GREEN for an inclusive one-day range, a partial boundary week, missing acceptance history, and a range containing no events. Keep dates UTC and reject invalid browser ranges before recalculation.
- [ ] Extend the existing default-window behavior with the optional explicit range. Preserve default forecast determinism and existing historical behavior except the approved terminology and gap disclosure.
- [ ] Emit the existing calculators and SVG functions for the browser using the established source-serialization pattern. Include their constants and helpers explicitly. Test runtime execution in a VM against Node output, including empty and nonempty evidence.
- [ ] Ensure the selected range retains items created before its start when they contribute to cumulative inventory. Do not implement range filtering by simply removing old items.
- [ ] Keep the existing forecast, aging, throughput, and duration views. Label the closure forecast and current-snapshot reconstruction limits visibly.
- [ ] Run evidence, SVG, attention, model, and HTML suites after migrating consumers. Commit the complete naming cutover.

**Exit:** The same selected cohort and range produce the same numbers in Node and browser, and closures cannot be mistaken for delivered work.

## T4: Replace the duplicated layout with the unified workspace

**Owner:** Browser worker. **Depends on:** T1, T2, and T3's naming cutover.

**Files:** Modify `src/report-html.js`, `test/report-html.test.js`, and only necessary portions of `test/report-dom.js`. No changes to ranking or evidence formulas.

**Consumes:** Existing projected items, recommendation entries, typed selection functions, metadata coverage, and inline evidence/SVG functions.

**Produces:** Initial Items view, persistent controls, one canonical list/detail implementation, and stable controller hooks:

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


Start the first T4 cycle by adapting the existing `revealDom` fixture and behavior test:

```js
const { reportClientSource } = await import('../src/report-html.js');
const dom = revealDom();
runReportClient(reportClientSource(), dom);
dom.search().value = 'ready';
dom.search().dispatch('input');
const visibleBefore = dom.visible();
dom.link('item-12').dispatch('click');
assert.equal(dom.search().value, 'ready');
assert.deepEqual(dom.visible(), visibleBefore);
```

The first assertion fails under the current filter-clearing behavior. Add the separate real-browser assertion that the selected detail is visible even though its list row remains outside the results; the fake DOM alone cannot prove this layout.
- [ ] Begin with a browser-runtime behavior test: selecting an item outside current search opens its detail while the search text and visible list remain unchanged. Replace the old filter-clearing behavior test, not merely its expected markup.
- [ ] Confirm RED. Move controls ahead of long content and use the selection module for Items. Remove the standalone Work next and repeated Attention item lists.
- [ ] Render one list row per visible item and one canonical body per retained item. Move/reuse detail nodes rather than duplicating full bodies into list, drawer, history, and graph.
- [ ] Show rank/reasons in Work next. Other sorts display the selected sort honestly rather than presenting it as the recommendation order. Preserve all existing ranking factors.
- [ ] Add the five quick views, item count, active-filter summary, and Clear filters. Show typed missing values and metadata configuration gaps. Preserve kind, priority, and every configured field in expandable facets.
- [ ] Use a desktop split at 1100px and above. Below that width, show selected details inline. At every width, retain compact sticky search and access to filters and display controls. Long menus scroll internally and can be closed with Escape.
- [ ] Preserve Basic/Standard/Detailed semantics and expand/collapse controls. Expand all acts on visible results only and switches the list to inline-detail presentation; Collapse all returns to compact rows. Do not expand hidden bodies.
- [ ] Keep the selected detail and filters across section changes. Close/return restores keyboard focus to the originating row or control. A relation outside the artifact remains an explicit unavailable reference.
- [ ] Make navigation work with keyboard and screen readers. Use buttons with explicit selected state or a fully implemented tab pattern. Do not add ARIA tab roles without their keyboard behavior.
- [ ] Keep no-JavaScript content readable through normal section anchors and native details. Print only the selected scoped content when scripting is active, with scope labels and numeric chart alternatives. No-script printing may include all artifact sections but must state its fixed scope.
- [ ] Run HTML/runtime tests and inspect a small real generated report at 1440×900, 1024×768, and 390×844. Record the absolute output path before handing off.

**Exit:** Search is available immediately, every item has one canonical detail, and switching or inspecting work never silently resets scope.

## T5A: Derive dependency impact independently

**Owner:** Impact worker. **Depends on:** none.

**Files:** Create `src/report-impact.js` and `test/report-impact.test.js`. Read `src/ready.js`, `src/dependencies.js`, and `src/report-sequencing.js` for semantics. Do not edit `src/report.js`, HTML, graph, sequencing, existing tests, or documentation shared with another worker.

**Interface:**

```js
export function buildReportImpact(allItems, retainedOpenIds, asOf);
// allItems: complete raw ledger items, with each item's parsed core at item.data.
// retainedOpenIds: Set<string> of retained open item IDs in the named artifact.
// returns: plain object keyed ONLY by retainedOpenIds.
// each value: { downstreamIds: string[], readyIfDoneIds: string[] }.
// Both arrays contain only retainedOpenIds, sorted by immutable ID.
```

**Acceptance:**

- [ ] Start with one failing diamond-dependency test: A blocks B, A and C both block D, and B blocks E. Completing A makes B ready but not D or E.

```js
const impact = buildReportImpact(items, new Set([a, b, c, d, e]), asOf);
assert.deepEqual(impact[a].readyIfDoneIds, [b]);
assert.deepEqual(new Set(impact[a].downstreamIds), new Set([b, d, e]));
```

- [ ] Confirm RED, then implement the smallest correct report-only derivation. Use reverse dependency/ancestor indexes to limit work; never recompute it on browser keystrokes.
- [ ] Compare immediate results with `projectReadiness` on a copied complete input where only candidate status becomes done. Include only items transitioning from not-ready to ready. Do not mutate input data or import independent conformance oracles.
- [ ] Repeat one RED/GREEN cycle at a time for multiple blockers, snooze, a candidate also acting as ancestor, killed prerequisites, schema-1 rules, cycles in dependency reach, and a named subset excluding another blocker.
- [ ] Keep downstream reach equal to existing recommendation leverage within the retained open graph. Exclude the candidate itself and deduplicate paths.
- [ ] Run `TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-impact.test.js test/report-ready-contract.test.js test/report-sequencing.test.js`.

**Exit:** A pure, independently tested impact engine is ready for T5B integration. No HTML/model integration belongs to this item.

## T5B: Connect concentration and blocker decisions

**Owner:** Decision UI worker. **Depends on:** T4, T5A.

**Files:** Modify `src/report.js`, `src/report-sequencing.js` only for honest reason labels, `src/report-html.js`, `test/report-model.test.js`, `test/report-sequencing.test.js`, and `test/report-html.test.js`. No edits to `src/report-graph.js` or the impact engine's algorithm.

**Produces:** `model.impactById = buildReportImpact(allItems, new Set(retainedOpenItems.map(item => item.id)), asOf)`, where `allItems` is the complete raw ledger before named filtering. Expose the immutable map as `window.wowbaggerReport.impactById`; graph consumes that contract without HTML edits. Also produce the area/status matrix, attention summaries, and scoped existing-batch membership.

- [ ] Start with a failing model behavior test: a retained dependent still has an excluded unsatisfied blocker, so its candidate prerequisite's `readyIfDoneIds` must not include it.
- [ ] Confirm RED, integrate T5A once at report generation, then verify no excluded IDs or metadata enter `impactById`.
- [ ] Keep existing recommendation ID order unchanged. Label transitive leverage as downstream reach; present ready-if-done separately.
- [ ] Add the area/status matrix over scoped current open work. Each cell reports count and blocked count and opens exact contributing IDs. Missing/invalid areas use the tagged Unclassified selection without colliding with a literal consumer value.
- [ ] Add scoped actions for in-progress, blocked, triage, oldest, and the existing slow-started attention condition. Preserve honest age/duration labels.
- [ ] Intersect existing area-diverse batches with scoped ready IDs, omit empty batches, and preserve original allocation. Show missing mapping guidance instead of inventing eligibility.
- [ ] Keep all browser/controller integration here. T7 changes graph/roster labels and consumes the published controller later; T6 and T7 must not need shared-file edits to start.
- [ ] Run model, sequencing, ready-contract, attention, and HTML tests. Browser-verify matrix and blocker drilldowns.

**Exit:** Concentrations and blockers lead to exact contributing items. Controller and model are complete for concurrent Flow and Dependencies workers.

## T6: Integrate interactive Flow and contributing-item drilldowns

**Owner:** Flow UI worker. **Depends on:** T5B (which includes the integrated T3/T4 prerequisites). May run concurrently with T7.

**Files:** Modify `src/report-html.js`, `src/report-svg.js` only for interactive targets, `test/report-html.test.js`, and `test/report-svg.test.js`. Consume evidence functions without redefining them.

**Produces:** Flow section consuming `getScopeItems()` and `subscribeScope`, with explicit range selection and contributor drilldowns through `showItems`.

- [ ] First test: filtering area to Payments changes both its arrivals count and the item IDs exposed by that arrivals bucket. Include an Accounts item in the same week so an unscoped implementation fails.
- [ ] Confirm RED. Compute Flow from the scoped open and terminal population, not from the current Work next list or Show history toggle.
- [ ] Add inclusive From/To controls with a default matching the existing twelve-calendar-week range. Reject start after end and end after report as-of with a visible, accessible error. Keep the last valid chart while stating that the new range is invalid.
- [ ] Render cumulative flow, arrivals versus done completions and closures, current aging, acceptance-to-completion samples, throughput, and closure forecast with shared scope captions.
- [ ] Make actual weekly bars, aging cells, and completion samples selectable. For cumulative flow, provide a date/band selection and an equivalent accessible table action; do not claim an arbitrary area click identifies a precise day without mapping it.
- [ ] Use the same state reconstruction for cumulative contributors as the chart uses. For each selected date/band, assert exact IDs equal the displayed count. Include items now closed that were accepted on the selected date.
- [ ] Add a visible drilldown pill and clear action. Changing quick view, returning from detail, and clearing the drilldown must not lose the scope or selected date range.
- [ ] Recalculate only when scope or range changes. Defer forecast computation until Flow is opened; cache it by cohort and range for the current artifact. No animation or graph tick should invoke Monte Carlo sampling.
- [ ] Preserve accessible numeric alternatives and text for missing history, zero populations, or no forecast. Label current-metadata cohorts and missing historical events.
- [ ] Run HTML, SVG, selection, and evidence tests. Browser-check at least one chart-to-list-to-detail round trip and one invalid date range.

**Exit:** Visible chart values, contributor lists, and scope captions describe the same selected population and dates.

## T7: Integrate Dependencies without another filter system

**Owner:** Graph worker. **Depends on:** T5B. May run concurrently with T6.

**Files:** Modify `src/report-graph.js`, `test/report-graph.test.js`, and relevant graph-only CLI tests. Do not edit `src/report-html.js`, `src/report-svg.js`, `test/report-html.test.js`, `test/report-dom.js`, or vendored code. T4/T5B supply the controller and model integration before this item starts.

**Produces:** Graph and roster driven by the report controller, using the same current scope and details.

- [ ] First test: an area selection leaves the same scoped IDs in graph nodes and roster. A hidden blocker must not turn a blocked item ready.
- [ ] Confirm RED. Remove the graph-only status selection state and use `subscribeScope`. Replace nodes and induced links together. Keep omitted-reference counts/labels without importing excluded named-view content.
- [ ] Use `inspectItem(id)` for graph and roster selections. Use `showItems` for downstream/immediate-unlock actions. Show distinct labels and counts from `impactById`.
- [ ] Initialize the graph only when Dependencies is first opened. Pause its animation while hidden and stop/release it when the document is disposed. Wait for measurable container dimensions before initial sizing.
- [ ] Preserve the full accessible roster, legend, edge meaning, reduced-motion behavior, and WebGL-unavailable explanation. The graph adds spatial context; it must contain no decision facts unavailable in the roster/detail.
- [ ] Verify a zero-node scope, one node, cross-scope dependency, terminal prerequisite, and unavailable WebGL. Preserve graph vendor verification and offline/CSP tests.
- [ ] Run graph, HTML, named-view model, and ready-contract suites. Browser-check switching sections repeatedly without duplicate canvases or losing scope.

**Exit:** Dependencies is another view of the selected report, not a separate dashboard with contradictory filters.

## T8: Produce reproducible artifacts and complete acceptance

**Owner:** Coordinator with a verification worker. **Depends on:** T6 and T7, transitively including all foundations and T5A/T5B.

**Files:** Create `scripts/report-design-demo.js`; update `README.md` and `CHANGELOG.md`. Update `docs/host-contract.md` only if changed report facts are specified there. Update report usage in `skills/wowbagger/SKILL.md` only for actual consumer-visible configuration or invocation changes and obtain the required skill review. Do not change instruction mirrors or core contract versions for UI copy.

The demo script is the reusable verification tool. It must build synthetic, explicitly labeled report data through `buildReportModel`, load the real vendored graph with `loadGraphBundle`, render through `renderReportHtml`, and publish through `writeReportFile`. It must not patch a previously generated HTML file or use placeholder charts.

Script CLI contract:

```sh
/opt/homebrew/opt/node@24/bin/node scripts/report-design-demo.js \
  --out /private/tmp/wowbagger-report-redesign.html --items 40
/opt/homebrew/opt/node@24/bin/node scripts/report-design-demo.js \
  --out /private/tmp/wowbagger-report-redesign-large.html --items 1744
```

- [ ] Generate fixed-date, deterministic fixtures containing several areas, multi-value tags, missing and invalid mappings, priorities including null, all lifecycle statuses, a diamond dependency, an ancestor, a snoozed item, long titles, a numberless item, and HTML/script-like text.
- [ ] Include done and non-done closures, items created before the default range, missing acceptance history, and sparse date ranges. Provide a small named-view fixture that excludes a blocker while retaining its blocked dependent.
- [ ] Reject an unknown option, a nonpositive/noninteger item count, and output inside the repository ledger. Print the absolute path and synthetic-data label on success. Generate the same bytes for identical arguments and use a fixed as-of date.
- [ ] Open the small generated artifact using the available browser capability. Capture desktop and narrow-screen screenshots. If browser startup fails, inspect the failure and use another supported local browser route rather than retrying the same worker repeatedly. No screenshot means no claim of visual acceptance.
- [ ] Exercise every acceptance row below against the real artifact. Record observed outcomes, not plans to test.
- [ ] Open the large artifact. Record HTML bytes, generation duration, first usable controls, search/filter response, and section-switch behavior on the same machine. Target a 95th-percentile filter-to-render latency below 150 ms over 20 fixed queries after load and a usable initial view within 3 seconds in the test browser. These are proposed acceptance budgets, not previous measurements. If missed, profile the changed path and fix it before closing this stage.
- [ ] Confirm no network requests are required, embedded ledger text does not execute, and only selected/expanded Markdown bodies are rendered. Do not add virtualization unless measured performance remains unacceptable after removing duplicate bodies and hidden graph work.
- [ ] Generate an ordinary base and named report through the real CLI in a permitted fixture ledger. Verify result envelopes, output containment, named-view exclusion, and atomic publication tests remain intact.
- [ ] After smoke proof, remove temporary debugging code using approved cleanup, update the shipped report documentation, and record the changes under the existing changelog convention. Keep the demo generator because workers and reviewers can rerun it.
- [ ] Have the coordinator run the final gate once, then review the full change against this plan. Resolve defects before integration. Do not publish or release as part of this task.
- [ ] Deliver the final report paths, screenshots, verification results, changed-file list, and any missing consumer inputs. Do not call a synthetic artifact a regenerated PropertyCompass2 report.

### Acceptance checklist

| ID | Required observable result | Owning tasks |
| --- | --- | --- |
| A01 | Search and access to all controls are available before scrolling and remain reachable at all three target widths | T4, T8 |
| A02 | Work next uses the canonical list; no second full backlog precedes search | T4 |
| A03 | Work next reasons and deterministic order remain unchanged apart from corrected leverage wording | T4, T5 |
| A04 | In-progress status and readiness are separately visible and filterable | T1, T2, T4 |
| A05 | Area and tags render, search, filter, and support named-view selection; missing/invalid data is explicit | T1, T2, T4 |
| A06 | Grouping, sorting, detail modes, Show history, Expand all, and Collapse all remain usable | T4 |
| A07 | Desktop split and mobile inline details preserve scope, selection, scroll context, and keyboard return | T4, T8 |
| A08 | Area/status and attention summaries open the correct item sets | T5 |
| A09 | Downstream reach and ready-if-done are distinct, correct, and do not alter core readiness/ranking | T5 |
| A10 | Flow cohorts share scope, including terminal history, without being silently limited to Work next | T3, T6 |
| A11 | Date boundaries, closures versus done, gap disclosures, and acceptance-to-completion labels are honest | T3, T6 |
| A12 | Chart drilldowns reproduce exact contributing IDs and can be cleared without resetting scope | T6 |
| A13 | Graph and roster share scope and open canonical details; no WebGL is still useful | T7 |
| A14 | Named reports never expose excluded bodies, metadata, nodes, or impact IDs | T1, T5, T7, T8 |
| A15 | Keyboard, focus, reduced motion, no-script reading, and print alternatives work | T4, T6, T7, T8 |
| A16 | Offline, CSP, safe Markdown/JSON, deterministic output, and atomic publication remain protected | T8 |
| A17 | Small and 1,744-item synthetic artifacts are reproducible, with measured browser performance | T8 |
| A18 | Existing forecast, attention facts, area-diverse batches, graph, and history remain available in the new navigation | T4, T5, T6, T7 |

Area-diverse batches stay in Items as a compact expandable planning summary. Intersect each existing batch with the scoped ready IDs and omit empty batches; do not introduce a new packing algorithm or recompute rankings. Label them Scoped members of existing batches. They must not become another full item-detail list. Preserve existing area/complexity eligibility and explain when mappings are missing. T4 owns placement and T5 owns scoped membership and its behavioral check.

### Verification commands

Run the relevant subset after each completed GREEN/REFACTOR cycle. Do not run every command after every small edit. Example focused commands:

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-model.test.js test/report-config.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-selection.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-evidence.test.js test/report-svg.test.js test/report-attention.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-html.test.js test/report-graph.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/report-sequencing.test.js test/report-ready-contract.test.js
```

The coordinator expands `test/*.test.js` to explicit paths using the runtime or a safe argument-array launcher, then runs the repository's required final commands. Do not pass a quoted wildcard as though Node expanded it:

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --pending-deprecation --throw-deprecation --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node spec/run-adapter-implementation.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node bin/wowbagger.js validate --ledger ledger --json
```

Use `node --check` on changed production JavaScript and the demo script. `package.json` defines no standalone build or lint command; do not invent one. Apply any formatter/linter introduced by newer repository instructions once at the final gate. Preserve commit hooks and do not bypass guards. Git integration and any PR/code-review gate follow the coordinator's current repository instructions.

## Consumer adoption boundary

The supplied PropertyCompass2 HTML contains no mapped fields. This plan fixes wowbagger's ability to report metadata and makes absence visible. It cannot recover tags that were never embedded in that artifact.

To regenerate a classified PropertyCompass2 report, its authorized repository worker must inspect that repository's actual `.wowbagger/report.json` and approved extension fields, choose exact JSON pointers, and run the updated report command there. Do not infer those pointers from this plan's synthetic `/data/area` and `/data/tags` examples. No worker dispatched for this wowbagger plan receives cross-repository authority by implication.

Complete and verify all wowbagger work and synthetic artifacts without waiting on consumer configuration. Report consumer regeneration as a distinct adoption action, not a hidden prerequisite or completed deliverable.

## Worker dispatch template

Copy this section into a native worker brief with the assigned task ID and exact worktree path filled from the coordinator's real state, not invented IDs:

> Read `docs/superpowers/plans/2026-09-05-decision-focused-report.md` completely. Execute only the assigned task and its shared contracts in your assigned worktree. Read current repository instructions first. Do not edit another task's files without coordinator approval. Preserve the credential prohibition in Global constraints. Use one behavioral RED/GREEN/REFACTOR cycle at a time. Do not run formatters, linters, or project-wide suites. Obtain the coordinator's validation slot for focused TDD commands before production edits when a concurrent batch is active. Do not mutate ledger lifecycle, integrate Git branches, publish, release, access another repository, or start shared-resource work. Return changed paths, exact focused verification results, generated artifact paths, contract changes if any, and unresolved acceptance IDs. Stop at your verified task boundary and report to your spawner.

The coordinator reviews the behavior and task boundary before assigning the next task. An agent's successful exit is not acceptance evidence. The coordinator owns the final full-suite and browser gate.

## Planning completion record

The initial eight-task plan is decomposed into nine implementation items by splitting T5 into independent impact derivation (T5A) and UI integration (T5B). All eighteen acceptance checks remain required. Ledger filing records the approved work; production implementation and visual acceptance remain unstarted.
