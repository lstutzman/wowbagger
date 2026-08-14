# Generic HTML Ledger Report Implementation Plan

> **For Lee:** Execute this plan with strict Red-Green-Refactor cycles. Write and run one failing behavior test before each production change.

**Goal:** Add `wowbagger report` as a read-only, deterministic HTML projection of any valid wowbagger ledger, with repository-specific presentation supplied only by `<ledger>/.wowbagger/report.json`.

**Architecture:** `src/ready.js` remains the readiness authority. `src/report.js` owns configuration, semantic projection, report-model construction, and atomic publication. `src/report-html.js` emits one self-contained accessible document. `src/report-markdown.js` supplies a dependency-free safe Markdown renderer that can run in Node tests and be serialized into the browser document. `src/cli.js` owns arguments and JSON envelopes. No template engine or runtime report dependency is added.

**Tech Stack:** Node.js 20+ ESM, `node:test`, existing `yaml`, browser-native HTML/CSS/JavaScript.

---

## Task 1: Expose authoritative detailed readiness

**Files:**
- Modify: `src/ready.js`
- Create: `test/ready-projection.test.js`
- Verify: `test/ready-priority.test.js`, `test/scale.test.js`, `test/ready-cli.test.js`

**Seam:** `projectReadiness(items, asOf)` returns a `Map` keyed by immutable item ID. Each value is `{ state, reasons }`. `state` is `ready`, `blocked`, or `ineligible`. Each reason is `{ code, item_id? }`. `selectReady(items, asOf)` consumes this projection and keeps its existing ID-array result.

**TDD slices:**

1. RED: Add one test for a backlog task with no blockers. Expect `ready` and no reasons. Run `TMPDIR=/tmp node --test test/ready-projection.test.js` and confirm failure because the export does not exist.
2. GREEN: Add the smallest projection function and route `selectReady` through it. Run the full relevant readiness suite.
3. RED: Add one test for `kind-not-task`, `status-not-backlog`, and `snoozed` one case at a time. Confirm each new test fails before implementation.
4. GREEN: Add each ordered ineligibility reason without duplicating selection rules.
5. RED: Add dependency and ancestor cases one at a time. Assert dependency order follows `depends_on` and ancestor order runs direct parent outward.
6. GREEN: Reuse `isDependencySatisfied` and the existing parent index. Preserve the current ready ordering exactly.
7. REFACTOR: Remove the old boolean-only readiness path. Run:
   - `TMPDIR=/tmp node --test test/ready-projection.test.js test/ready-priority.test.js test/scale.test.js test/ready-cli.test.js`

## Task 2: Load and validate report configuration

**Files:**
- Create: `src/report.js`
- Create: `test/report-config.test.js`
- Modify: `test/support.js` only if a general temporary-directory helper is needed

**Seams:**
- `loadReportConfig(ledgerDirectory, outputOverride, scenario)` returns normalized configuration and absolute paths.
- `resolvePointer(frontmatter, pointer)` implements RFC 6901 decoding against parsed frontmatter only.
- Report failures use an internal error carrying `code`, `message`, and optional `details`; `src/cli.js` maps it later.

**TDD slices:**

1. RED: Missing `.wowbagger/report.json` returns `report-config-invalid`. Confirm failure.
2. GREEN: Read and parse only that ledger-bound file. Resolve config-relative logo paths and caller-relative `--out` paths.
3. RED/GREEN one test at a time for malformed JSON, root `null`, root array, missing/invalid `report_version`, missing repository/name/title/output, unknown keys at every level, invalid field slot names, and invalid swarm configuration.
4. RED/GREEN one test at a time for RFC 6901 root pointer, `/` segments, `~0`, `~1`, and invalid `~` escapes.
5. RED/GREEN for output containment with: direct child output, lexical `..`, existing symlink ancestor, and a not-yet-created output directory below a symlink.
6. RED/GREEN for logo extension normalization and MIME selection: `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, uppercase variants, unsupported extension, and unreadable supported file.
7. REFACTOR: Keep the validator table-driven and explicit. Do not add a general schema library. Run `TMPDIR=/tmp node --test test/report-config.test.js`.

## Task 3: Build the deterministic report model

**Files:**
- Modify: `src/report.js`
- Create: `test/report-model.test.js`

**Seam:** `buildReportModel(ledger, config, asOf)` returns plain JSON data for rendering. It receives a validator-valid ledger and never mutates source items.

**TDD slices:**

1. RED/GREEN: Project all nonterminal items and separate `done`, `killed`, `deferred`, and `archived` history.
2. RED/GREEN: Project configured scalar and finite-number slots. Assert `null`, empty strings, objects, arrays, and non-finite numeric values become absent. Assert numbers use `String(number)`.
3. RED/GREEN: Implement the exact nonterminal ordering tuples from the design. Cover equal rank with present versus missing priority, priority-only order, and immutable-ID final tie-break.
4. RED/GREEN: Sort terminal rows by the status-specific terminal date descending and ID. Select the first matching terminal decision in frontmatter order.
5. RED/GREEN: Add counts for all items, nonterminal, ready, blocked, triage, in-progress, snoozed, and each terminal status. Assert snoozed and in-progress items are not blocked.
6. RED/GREEN: Add area-diverse candidate batches. Cover exact case-sensitive complexity matching, missing/non-string area exclusion, six-item cap, eight-batch cap, one exact area per batch, and stable remainder order.
7. REFACTOR: Keep model values presentation-ready and JSON-serializable. Do not put HTML into the model. Run `TMPDIR=/tmp node --test test/report-model.test.js test/ready-projection.test.js`.

## Task 4: Add the safe Markdown renderer

**Files:**
- Create: `src/report-markdown.js`
- Create: `test/report-markdown.test.js`

**Seam:** `renderMarkdown(source)` returns safe HTML. Keep every helper inside the exported function or otherwise make the exact renderer serializable into the generated document without a second implementation.

**TDD slices:**

1. RED/GREEN one construct at a time: escaped paragraphs, headings, unordered lists, ordered lists, blockquotes, tables, fenced code, inline code, emphasis, strong text, and links.
2. RED/GREEN hostile cases: raw HTML, `</script>`, encoded and mixed-case unsafe schemes, malformed links, code fences containing markup, and C0 controls.
3. Assert only absolute HTTP(S) links survive and every safe link has `rel="noopener noreferrer"`.
4. Assert Mermaid and unknown-language fences remain inert escaped source.
5. REFACTOR: No dependency and no DOM requirement. Run `TMPDIR=/tmp node --test test/report-markdown.test.js`.

## Task 5: Render the self-contained browser document

**Files:**
- Create: `src/report-html.js`
- Create: `test/report-html.test.js`

**Seams:**
- `renderReportHtml(model, assets)` returns complete deterministic UTF-8 HTML.
- The server-rendered document contains useful identities, status, and summaries without JavaScript.
- The inlined browser app enhances search, grouping, filters, detail modes, and lazy body rendering.

**TDD slices:**

1. RED/GREEN: Emit one top-level `h1`, semantic landmarks, server-rendered item summaries, terminal tables, and horizontal table containers.
2. RED/GREEN: Embed model JSON after escaping `<`, U+2028, and U+2029. Assert `</script>` cannot terminate the data block.
3. RED/GREEN: Embed logos only as MIME-specific base64 `data:` URLs in an `img` source.
4. RED/GREEN: Add labelled native controls for search, group, filters, and Basic/Detailed/Full richness. Add visible result count and native `details` cards.
5. RED/GREEN: Add deterministic card data attributes and browser functions for search, core groupings, mapped groupings, filters, and detail modes.
6. RED/GREEN: Lazy-render Markdown on first card open and retain the rendered body after close.
7. RED/GREEN: Add desktop sticky controls, narrow-screen non-sticky controls, compact three-row summaries, visible focus indicators, AA text contrast, and narrow-screen table overflow containment.
8. REFACTOR: Keep CSS and app JavaScript fixed. Do not accept templates, custom CSS, or custom JavaScript. Run `TMPDIR=/tmp node --test test/report-html.test.js test/report-markdown.test.js`.

## Task 6: Publish atomically and add the CLI command

**Files:**
- Modify: `src/report.js`
- Modify: `src/cli.js`
- Modify: `test/cli.test.js`
- Create: `test/report-publication.test.js`

**Seams:**
- `publishReport({ ledgerDirectory, asOf, outputOverride, scenario })` validates, builds, renders, and atomically replaces the target.
- `runCli(["report", ...])` prints exactly one compact JSON object plus LF.

**TDD slices:**

1. RED: Add the CLI help/inventory test for `report` and the exact usage line. Confirm failure.
2. GREEN: Add command summary, command help, dispatch, `--ledger`, `--as-of`, optional `--out`, required-argument checks, and duplicate/unknown option rejection using existing CLI helpers.
3. RED/GREEN: Add success envelope and exit-0 assertions.
4. RED/GREEN one code at a time: `invalid-request`, `report-config-invalid`, `ledger-invalid`, `report-read-failed`, and `report-write-failed`. Assert one compact envelope and no prose on stdout.
5. RED/GREEN: Validate the ledger before projection. Assert invalid ledger leaves an existing output unchanged.
6. RED/GREEN with injected filesystem scenarios for write, close, and rename failures. Assert old bytes remain, cleanup is attempted, and a leftover temporary artifact is named when cleanup itself fails.
7. RED/GREEN: Run twice with identical ledger bytes, config, logo bytes, and `--as-of`; compare complete output bytes.
8. REFACTOR: Keep the temporary file in the output directory, create it exclusively, flush and close it, recheck canonical containment, then rename. Run:
   - `TMPDIR=/tmp node --test test/cli.test.js test/report-publication.test.js test/report-config.test.js test/report-model.test.js test/report-html.test.js`

## Task 7: Ship the command and skill guidance

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `skills/wowbagger/SKILL.md`
- Modify: `package.json` only if a test script or shipped file list needs an actual change; `src/` is already packaged

**Steps:**

1. Add the exact command: `wowbagger report --ledger <dir> --as-of YYYY-MM-DD --json [--out <file>]`.
2. Add one compact `.wowbagger/report.json` example with generic repository values.
3. State that the report is derived, read-only, and not ledger authority.
4. Document configuration-relative logo/output paths, caller-relative `--out`, deterministic input set, JSON-only stdout, failure codes, and the no-template boundary.
5. Extend the shipped skill with when to run `report`, required version/capability preflight, output handling, and the instruction not to infer readiness or claims from report batches.
6. Add a concise changelog entry.
7. Run `git diff --check` after the documentation edits.

## Task 8: Verify the complete feature

**Files:**
- No new source files unless a defect is found through verification

**Automated gates:**

1. `TMPDIR=/tmp node --test test/*.test.js`
2. `TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js`
3. `TMPDIR=/tmp node spec/run-adapter-implementation.js`
4. `node bin/wowbagger.js validate --ledger ledger --json`
5. `node --check bin/wowbagger.js`
6. `npm pack --dry-run`
7. `git diff --check`

**Behavior smoke:**

1. Build a temporary valid ledger with nonterminal, blocked, snoozed, and terminal items plus hostile Markdown and a supported logo.
2. Run `node bin/wowbagger.js report --ledger <temp-ledger> --as-of 2026-08-14 --json` twice and compare bytes.
3. Open the generated file in Chromium.
4. Verify search, every core grouping, mapped area grouping, filters, all three detail modes, lazy Markdown, terminal history, and visible result count.
5. Disable JavaScript and verify useful identities, statuses, and summaries remain.
6. Verify keyboard operation, accessible names, focus indicators, and WCAG AA contrast.
7. Verify desktop and 390 px layouts have no page-level horizontal overflow; terminal tables may scroll inside their containers.
8. Compare the visible behavior with the PropertyCompass report only as evidence. Do not copy its branding, fields, or false collision claims.

**Acceptance:** `wowbagger report` produces one branding-neutral, deterministic, self-contained HTML file from a valid configured ledger; all named failure modes preserve the current report; core readiness remains the only readiness rule source; all project gates pass on current Node and Node 20.
