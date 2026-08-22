# Named Custom Report Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate separate self-contained HTML reports for named, server-filtered ledger views while preserving the base report and full-ledger readiness semantics.

**Architecture:** Report configuration version 2 normalizes named view definitions and typed grouped filters. The report model computes readiness and field projections over the complete ledger, filters projected items once, then derives every report section from the retained subset while carrying a complete-ledger number index for excluded references. CLI selection, capability advertisement, publication, and HTML criteria presentation remain extensions of the existing `report` seam.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, strict JSON parsing, generated self-contained HTML/CSS/JavaScript, existing atomic report publication.

**Spec:** `docs/superpowers/specs/2026-08-21-custom-report-views-design.md`

## Global Constraints

- Configuration version 1 and base report generation remain supported and byte-compatible.
- Configuration version 2 adds at most 64 named views matching `^[a-z][a-z0-9-]{0,63}$`.
- View filters use OR within one group and AND across readiness, status, kind, and mapped-field groups.
- Readiness is computed against the complete ledger before filtering; excluded blockers never make work ready.
- Excluded items contribute only ID-to-number label lookup, never hidden rows, bodies, graph nodes, history entries, or payloads.
- Base and named output paths are pairwise distinct and outside the canonical ledger path.
- One invocation generates one artifact; no batch `--all-views`, browser-saved view, URL state, or mutation path.
- Named view output adds `result.view`; base success bytes remain unchanged.
- Fixtures are normative. `spec/adapter-reference.js` remains an independent oracle and never imports production code.
- Every test command uses `TMPDIR=/tmp`.
- Strict RED-GREEN-REFACTOR, one observable behavior per cycle.

---

### Task 1: Normalize report configuration version 2

**Files:**
- Create: `src/report-view.js`
- Modify: `src/report.js:24-45,285-364`
- Test: `test/report-config.test.js`

**Interfaces:**
- Consumes: existing `ReportError`, `resolvePointer`, `isObject`, `isNonEmptyString`, and output-containment behavior.
- Produces:
  ```js
  export const REPORT_VIEW_NAME = /^[a-z][a-z0-9-]{0,63}$/;
  export function normalizeReportViews(value, fieldMappings);
  export function matchesReportView(item, filters);
  export function reportViewCriteria(filters);
  ```
- `loadReportConfig(ledgerDirectory, outputOverride, viewName = null)` returns:
  ```js
  {
    reportVersion,
    repository,
    title,
    outputPath,
    fields,
    swarm,
    view: null | { name, title, outputPath, filters }
  }
  ```

- [ ] **Step 1: Write the failing version-2 normalization test**

Add a test that writes:

```js
{
  report_version: 2,
  repository: { name: 'Example' },
  title: 'Base report',
  output: '../../base.html',
  fields: { area: '/area', class: '/class', security: '/security' },
  views: {
    'security-blockers': {
      title: 'Security blockers',
      output: '../../security.html',
      filters: {
        readiness: ['blocked'],
        status: ['backlog', 'in-progress'],
        kind: ['task'],
        fields: { class: ['bug'], security: ['high', 'critical'] }
      }
    }
  }
}
```

Call `loadReportConfig(ledger, undefined, 'security-blockers')` and assert the normalized selected name, title, absolute output, and typed filter values.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
TMPDIR=/tmp node --test --test-name-pattern='normalizes a selected version 2 report view' test/report-config.test.js
```

Expected: FAIL because `report_version: 2`, `views`, or the third argument is rejected.

- [ ] **Step 3: Implement exact view parsing**

In `src/report-view.js`, implement scalar identity without string coercion:

```js
function scalarKey(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}
```

Validate name, exact view members, exact filter members, non-empty unique arrays, finite numbers, supported readiness/status/kind values, configured field names, typed scalar uniqueness, and 64-view maximum. Return fresh arrays/objects.

Update `src/report.js` so version 1 keeps the current key set and version 2 permits `views`. Resolve and containment-check the base output and every view output before selection. Reject pairwise path collisions. Select the requested view after the complete configuration validates; throw:

```js
new ReportError(
  'report-view-not-found',
  'The requested report view was not found.',
  { view: viewName },
);
```

- [ ] **Step 4: Run GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Add validation cycles one behavior at a time**

Add and RED/GREEN these named tests separately:

```text
keeps version 1 report configuration byte-compatible
rejects malformed report view names and excess views
rejects empty duplicate or unknown built-in filter values
rejects mapped-field filters whose field is not configured
preserves scalar types when matching mapped-field filter values
rejects colliding base and named output paths
accepts an output override without ignoring configured path validation
returns report-view-not-found for version 1 or an unknown name
```

Run each with `--test-name-pattern` before and after its minimum implementation.

- [ ] **Step 6: Run the focused configuration file**

```bash
TMPDIR=/tmp node --test test/report-config.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/report-view.js src/report.js test/report-config.test.js
git commit -m "feat(report): normalize named report views"
```

### Task 2: Filter the complete-ledger projection consistently

**Files:**
- Modify: `src/report.js:87-174`
- Modify: `src/report-html.js:315-365`
- Test: `test/report-model.test.js`
- Test: `test/report-attention.test.js`
- Test: `test/report-graph.test.js`
- Test: `test/report-html.test.js`

**Interfaces:**
- Consumes: `matchesReportView(projectedItem, filters)` from Task 1.
- Produces: `buildReportModel(items, config, asOf)` with:
  ```js
  {
    ...existingMembers,
    view: null | { name, title, criteria },
    itemNumbers: { [itemId]: number | null }
  }
  ```
- `config.view.filters` is applied after full-ledger readiness and field projection, before stats, ranking, attention, evidence, graph, drill-down, history, and swarm derivation.

- [ ] **Step 1: Write the failing grouped-filter model test**

Build a ledger containing ready and blocked tasks across two areas/classes. Supply a selected view with:

```js
{
  readiness: ['ready', 'blocked'],
  status: ['backlog'],
  kind: ['task'],
  fields: { area: ['api', 'auth'], class: ['bug'] }
}
```

Assert OR within `area`, AND against `class`, and exclusion of nonmatching items from `model.items`, `model.stats`, `model.workNext`, `model.attention`, and graph input.

- [ ] **Step 2: Run RED**

```bash
TMPDIR=/tmp node --test --test-name-pattern='filters every report section through one grouped view' test/report-model.test.js
```

Expected: FAIL because all projected items remain.

- [ ] **Step 3: Implement full-ledger readiness then subset derivation**

Refactor `buildReportModel` in this order:

```js
const readinessById = projectReadiness(items, asOf);
const allProjected = items.map((item) => projectItem(
  item,
  config.fields,
  readinessById.get(item.data.id),
));
const projected = config.view === null
  ? allProjected
  : allProjected.filter((item) => matchesReportView(item, config.view.filters));
```

Build `itemNumbers` from `allProjected`. Derive all current report sections from `projected` only. Carry normalized criteria from the selected view.

- [ ] **Step 4: Run GREEN**

Run the same test. Expected: PASS.

- [ ] **Step 5: Add the excluded-blocker readiness cycle**

Create an included backlog item blocked by an excluded backlog item. Assert the included item stays blocked, its reason retains the excluded ID, and rendered labels use the excluded item's number from `itemNumbers`.

Run RED, implement full-number lookup in `renderReportHtml`, then run GREEN.

- [ ] **Step 6: Add cross-section consistency cycles**

Add separate RED/GREEN tests proving:

```text
view statistics and evidence count only retained items
view attention and work-next contain only retained items
view graph drops excluded nodes and every incident link
view history contains only retained terminal items
an empty view succeeds with explicit empty sections
```

Do not recompute readiness on the filtered subset.

- [ ] **Step 7: Run focused model/report tests**

```bash
TMPDIR=/tmp node --test \
  test/report-model.test.js \
  test/report-attention.test.js \
  test/report-graph.test.js \
  test/report-html.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/report.js src/report-html.js \
  test/report-model.test.js test/report-attention.test.js \
  test/report-graph.test.js test/report-html.test.js
git commit -m "feat(report): derive named views from one filtered projection"
```

### Task 3: Expose named views through the CLI and capabilities

**Files:**
- Modify: `src/cli.js:147-159,577-694,749-838,1214-1364`
- Modify: `src/adapter/core-probe.js`
- Modify: `spec/adapter-reference.js`
- Modify: `spec/fixtures/mutations/capabilities/expected.json`
- Modify: `spec/fixtures/envelope-domains/manifest.json`
- Test: `test/report-cli.test.js`
- Test: `test/report-publication.test.js`
- Test: `test/adapter-reference-strict.test.js`
- Test: `test/envelope-dispatch.test.js`

**Interfaces:**
- Consumes: `loadReportConfig(ledger, outputOverride, viewName)` and filtered model from Tasks 1–2.
- Produces:
  ```text
  wowbagger report --ledger <dir> --view <name> --as-of YYYY-MM-DD [--out <file>] --json
  ```
- Named success adds `result.view`; base success does not.
- `capabilities.result.operations.report` advertises:
  ```js
  {
    supported: true,
    write_scope: 'derived-output',
    config_versions: [1, 2],
    named_views: true
  }
  ```

- [ ] **Step 1: Write the failing named-view CLI test**

Invoke `report` with `--view security-blockers`. Assert exit 0, selected output file, filtered counts, `result.view`, and absence of excluded title text from HTML.

- [ ] **Step 2: Run RED**

```bash
TMPDIR=/tmp node --test --test-name-pattern='renders one selected named report view' test/report-cli.test.js
```

Expected: FAIL with unknown `--view` argument.

- [ ] **Step 3: Add CLI parsing and response behavior**

Add `--view` to report's value flags. Validate a non-empty value through the existing argument issue sequence. Pass it to `loadReportConfig`. In `runReportCommand`, add `view` only when selected:

```js
result: {
  report_version: config.reportVersion,
  as_of: model.asOf,
  output: config.outputPath,
  item_count: model.items.length + model.terminalItems.length,
  ready_count: model.stats.ready,
  ...(config.view === null ? {} : { view: config.view.name }),
}
```

Map `report-view-not-found` to stable structured failure without touching prior output.

- [ ] **Step 4: Run GREEN**

Run the same test. Expected: PASS.

- [ ] **Step 5: Add publication preservation cycles**

Add separate tests for unknown view, invalid v2 config, output collision, empty subset, deterministic rerender, and `--out` override. Prewrite sentinel HTML and assert every refused command preserves it.

- [ ] **Step 6: Add capabilities through independent seams**

Write a failing exact-capability test first. Update production probe and independent oracle separately; do not import shared constants into `spec/adapter-reference.js`. Update normative capability and envelope fixtures.

- [ ] **Step 7: Prove base result compatibility**

Add a test that captures base report result and HTML without `--view`, then asserts the same exact members and bytes under config version 1.

- [ ] **Step 8: Run focused CLI/capability tests**

```bash
TMPDIR=/tmp node --test \
  test/report-cli.test.js \
  test/report-publication.test.js \
  test/adapter-reference-strict.test.js \
  test/envelope-dispatch.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/cli.js src/adapter/core-probe.js spec/adapter-reference.js \
  spec/fixtures/mutations/capabilities/expected.json \
  spec/fixtures/envelope-domains/manifest.json \
  test/report-cli.test.js test/report-publication.test.js \
  test/adapter-reference-strict.test.js test/envelope-dispatch.test.js
git commit -m "feat(report): generate selected named views"
```

### Task 4: Render view identity and criteria

**Files:**
- Modify: `src/report-html.js`
- Test: `test/report-html.test.js`
- Test: `test/report-ready-contract.test.js`

**Interfaces:**
- Consumes: `model.view = null | { name, title, criteria }` and already-filtered `model.items`/`terminalItems`.
- Produces: named-view masthead/criteria markup only when `model.view !== null`.

- [ ] **Step 1: Write the failing criteria-render test**

Assert named HTML contains:

```html
<section class="view-context" aria-label="Custom report view">
  <p class="eyebrow">Custom view</p>
  <h2>Security blockers</h2>
  <code>security-blockers</code>
  <!-- read-only grouped criteria chips -->
</section>
```

Assert base HTML contains no `view-context` and remains byte-identical to its current fixture.

- [ ] **Step 2: Run RED**

```bash
TMPDIR=/tmp node --test --test-name-pattern='identifies a named view and its fixed criteria' test/report-html.test.js
```

Expected: FAIL because no view context renders.

- [ ] **Step 3: Implement conditional view context**

Render escaped, read-only criteria grouped with the existing chip vocabulary. State: `Filtered subset of <repository name>. Interactive filters below can narrow this view further.` Do not mark fixed criteria as interactive controls.

- [ ] **Step 4: Run GREEN**

Run the same test. Expected: PASS.

- [ ] **Step 5: Add subset-boundary interaction test**

Use the existing report DOM harness to click **Clear filters** after narrowing a named view. Assert all retained view items return and no excluded base item exists in the document or graph model.

- [ ] **Step 6: Run focused HTML tests**

```bash
TMPDIR=/tmp node --test test/report-html.test.js test/report-ready-contract.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/report-html.js test/report-html.test.js test/report-ready-contract.test.js
git commit -m "feat(report): identify custom view criteria"
```

### Task 5: Document, package, and verify named views

**Files:**
- Modify: `README.md`
- Modify: `docs/mutation-contract.md`
- Modify: `skills/wowbagger/SKILL.md`
- Modify: `package.json` only if schema/contract packaging requires another shipped path
- Test: `test/report-config.test.js`
- Test: `test/report-cli.test.js`
- Test: `test/packaging.test.js`

**Interfaces:**
- Consumes: final config, CLI, result, and capabilities from Tasks 1–4.
- Produces: installed consumer guidance with one complete config example and one exact command.

- [ ] **Step 1: Write failing documentation guards**

Assert README, mutation contract, and installed skill contain:

```text
report_version: 2
views
security-blockers
report --ledger <dir> --view <name> --as-of YYYY-MM-DD --json
OR within one filter group; AND across groups
```

- [ ] **Step 2: Run RED**

```bash
TMPDIR=/tmp node --test --test-name-pattern='documents named custom report views' test/report-config.test.js test/report-cli.test.js
```

Expected: FAIL because installed guidance has no named-view contract.

- [ ] **Step 3: Write exact documentation**

Document version 1 compatibility, complete version 2 config, typed mapped values, full-ledger readiness, subset-wide sections, output collision rules, empty subset, `--out`, and non-security-boundary warning. Do not recommend parsing HTML or human output.

- [ ] **Step 4: Run GREEN and packaging test**

```bash
TMPDIR=/tmp node --test test/report-config.test.js test/report-cli.test.js test/packaging.test.js
```

Expected: all tests pass and shipped docs remain in `npm pack` contents.

- [ ] **Step 5: Browser verification**

Generate base and named reports from one fixture ledger. In Chromium verify:

```text
base contains every fixture item
named HTML source excludes every nonmatching title/body
named stats/work-next/attention/graph/drill-down/history agree on retained count
criteria context names the view and fixed filters
client facets narrow and Clear restores only the named subset
graph status filters never reveal excluded items
desktop 1440x900 and mobile 390x844 have no horizontal overflow
```

- [ ] **Step 6: Run current-Node and Node-20 focused report suites**

```bash
TMPDIR=/tmp node --test test/report-*.test.js test/packaging.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/report-*.test.js test/packaging.test.js
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/mutation-contract.md skills/wowbagger/SKILL.md \
  package.json test/report-config.test.js test/report-cli.test.js test/packaging.test.js
git commit -m "docs(report): publish named view contract"
```

## Final project gate

After all task reviews are clean, the orchestrator runs:

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
```

Then generate one base and one named report, browser-drive both, run the final whole-branch review, and only then close the implementation ledger work.
