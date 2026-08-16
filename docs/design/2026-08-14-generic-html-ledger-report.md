# Generic HTML ledger report

**Status:** approved design; implementation pending

## Decision

Add a deterministic `wowbagger report` command. It renders one validated ledger as one self-contained HTML file. A ledger-bound configuration maps repository-specific frontmatter into fixed report slots. The report remains derived output. It never becomes ledger authority.

This design generalizes the useful parts of the PropertyCompass backlog report. It keeps the command-center layout, filters, grouping, detail modes, lazy Markdown bodies, history, and area-diverse parallel candidates. It removes PropertyCompass field names, branding, copy, and unsafe coordination claims from the implementation.

## Problem

Wowbagger supplies machine-readable primitives:

- `validate` reports ledger health;
- `ready` selects the deterministic queue;
- `inspect` returns one lossless item snapshot;
- claim commands coordinate work;
- `claim-verify` reconciles publication.

It does not supply a reusable human report. The PropertyCompass repository has a useful HTML generator, but that generator hard-codes its repository schema and presentation. Other ledgers cannot use it without copying and editing a large script.

A reusable report must preserve core lifecycle meaning. It must also let a repository map a small set of extension fields without turning configuration into executable code.

## Goals

The first report implementation must:

1. Render all nonterminal items and separate terminal history.
2. Show core status, readiness, priority, relations, decisions, and item bodies.
3. Support search, filtering, grouping, and three detail modes.
4. Support repository identity, an optional logo, and named semantic field mappings.
5. Produce deterministic bytes for identical ledger bytes, configuration, referenced logo bytes, and `--as-of`.
6. Produce one portable HTML file with no external runtime dependency.
7. Refuse an invalid ledger before it changes the current report.
8. Publish the report through atomic replace.
9. Work at the current PropertyCompass scale of about 1,500 items.
10. Stay readable and usable on desktop and narrow screens.

## Non-goals

Version 1 does not:

- modify item lifecycle or metadata;
- replace `validate`, `ready`, `inspect`, or claim commands;
- infer repository-specific semantics from unknown fields;
- accept custom templates, CSS, JavaScript, or arbitrary cards;
- execute Mermaid or code fences;
- prove that parallel candidates do not touch the same files;
- provide a hosted report service;
- provide live updates after the HTML file loads;
- make generated HTML a source of truth.

## Command contract

The command is:

```text
wowbagger report --ledger <dir> --as-of YYYY-MM-DD --json [--out <file>]
```

`--ledger`, `--as-of`, and `--json` are required. Requiring `--json` keeps the command consistent with machine-consumer use of derived artifact generation. The command writes no human prose to stdout.

The command reads this configuration:

```text
<ledger>/.wowbagger/report.json
```

The configuration must contain `output` unless `--out` overrides it. Paths stored in the configuration resolve from the configuration directory. A relative `--out` path resolves from the caller's working directory.

The resolved output path must be outside the resolved ledger directory. This rule prevents a report command from overwriting an item or other ledger state.

The containment check uses canonical filesystem paths. The command resolves the ledger with `realpath`. It finds the nearest existing ancestor of the output directory, resolves that ancestor with `realpath`, appends the non-existent suffix, and rejects a canonical output directory inside the canonical ledger. It repeats this check immediately before publication. A hostile process that changes symlinks between the final check and the rename is outside the cooperative-writer threat model.

The command validates the ledger before it projects or renders any data. Failure leaves an existing output file unchanged.

### Success envelope

Success exits with `0` and prints one compact JSON object followed by LF:

```json
{
  "ok": true,
  "command": "report",
  "contract_version": 3,
  "result": {
    "report_version": 1,
    "as_of": "2026-08-14",
    "output": "/absolute/path/prioritized-backlog.html",
    "item_count": 1501,
    "ready_count": 347
  }
}
```

`item_count` counts every validated ledger item. `ready_count` uses the same readiness projection as `wowbagger ready`.

### Failure envelopes

Every failure prints one compact JSON object followed by LF. A failure envelope contains exactly `ok`, `command`, `contract_version`, and `error`.

| Exit | Code | Meaning |
| --- | --- | --- |
| 2 | `invalid-request` | CLI arguments are missing, repeated, unknown, or invalid. |
| 2 | `report-config-invalid` | Configuration is missing, malformed, unsupported, or structurally invalid. |
| 1 | `ledger-invalid` | The ledger validator rejected the ledger. |
| 1 | `report-read-failed` | The command could not read the configuration or logo. |
| 1 | `report-write-failed` | Atomic output publication failed. |

A missing configuration file (`ENOENT`) is `report-config-invalid`. Permission failures and other configuration read failures are `report-read-failed`.

The error shape is:

```json
{
  "ok": false,
  "command": "report",
  "contract_version": 3,
  "error": {
    "code": "report-config-invalid",
    "message": "The report configuration is invalid.",
    "details": {
      "issues": []
    }
  }
}
```

Configuration issues use the same `{path, code, message}` shape as other request issues. `ledger-invalid` puts the normal validator errors in `details.errors`. Read and write failures identify the failed operation and display path. They do not expose host error objects or stack traces.

## Configuration contract

Example:

```json
{
  "report_version": 1,
  "repository": {
    "name": "Property Compass",
    "logo": "../../../src/PropertyCompass.Web/wwwroot/logos/mark-colour.svg"
  },
  "title": "Prioritized Backlog",
  "output": "../../../docs/backlog-prioritization/prioritized-backlog.html",
  "fields": {
    "area": "/data/migration_synthetic_fields/priority_area",
    "rank": "/data/migration_synthetic_fields/priority_rank",
    "score": "/data/migration_synthetic_fields/priority_score",
    "complexity": "/data/migration_synthetic_fields/complexity",
    "tier": "/data/migration_synthetic_fields/tier",
    "mandate": "/data/migration_synthetic_fields/mandate",
    "severity": "/data/migration_synthetic_fields/severity",
    "confidence": "/data/migration_synthetic_fields/confidence",
    "security": "/data/migration_synthetic_fields/security",
    "priority_base": "/data/migration_synthetic_fields/priority_base",
    "priority_component": "/data/migration_synthetic_fields/priority_component",
    "priority_impact": "/data/migration_synthetic_fields/priority_impact",
    "priority_leverage": "/data/migration_synthetic_fields/priority_leverage",
    "priority_rationale": "/data/migration_synthetic_fields/priority_rationale",
    "completion_reference": "/data/migration_synthetic_fields/commit"
  },
  "swarm": {
    "eligible_complexities": ["xs", "small", "medium"]
  }
}
```

The example shows a migrated consumer ledger. Repositories can point each slot at any frontmatter location.

### Validation rules

The command applies these rules before ledger projection:

- `report_version` is required and must equal integer `1`.
- `repository` is required and must be a non-null JSON object.
- `repository.name` is required and must be a non-empty string.
- `repository.logo` is an optional non-empty string with a supported extension.
- `title` is a required non-empty string.
- `output` is a non-empty string unless `--out` is present.
- `fields` is an optional non-null JSON object.
- Each field value is a non-empty RFC 6901 JSON Pointer.
- `swarm` is an optional non-null JSON object.
- When present, `swarm.eligible_complexities` is a required, non-empty JSON array of unique non-empty strings.
- `swarm` requires mapped `area` and `complexity` slots.
- Unknown keys are invalid at every configuration level.
- Unknown semantic slot names are invalid.

The pointer resolver implements RFC 6901 `~0` and `~1` decoding. It rejects invalid escape sequences. It resolves pointers only against parsed frontmatter. It never reads a path named by ledger data.

### Semantic slots

The report owns a fixed presentation meaning for each slot:

| Slot | Accepted item value | Use |
| --- | --- | --- |
| `area` | scalar | Group, filter, badge, and swarm diversity key. |
| `rank` | finite number | Primary ascending card order. |
| `score` | finite number | Badge and report statistics. |
| `complexity` | scalar | Filter, badge, statistics, and swarm eligibility. |
| `tier` | scalar | Filter, badge, and statistics. |
| `mandate` | scalar | Filter and badge. |
| `severity` | scalar | Filter and badge. |
| `confidence` | scalar | Filter and badge. |
| `security` | scalar | Filter, badge, and statistics. |
| `priority_base` | finite number | Detailed priority explanation. |
| `priority_component` | finite number | Detailed priority explanation. |
| `priority_impact` | finite number | Detailed priority explanation. |
| `priority_leverage` | finite number | Detailed priority explanation. |
| `priority_rationale` | scalar | Detailed priority explanation. |
| `completion_reference` | scalar | Terminal history reference. |

A scalar is a string, finite number, or boolean. `null`, an empty string, an object, and an array are absent. Strings retain their original case and compare by exact Unicode code-point sequence. Numbers use ECMAScript `String(number)` text, including its handling of exponent notation and `-0`. Booleans use `true` or `false`.

A missing mapped value on one item is absent. A non-scalar value is absent for a scalar slot. A non-finite or non-number value is absent for a numeric slot. The report does not stringify objects or arrays into badges.

Swarm eligibility requires non-empty string values for mapped `area` and `complexity`. The complexity must equal one configured `eligible_complexities` string by exact Unicode code-point sequence. Area diversity uses the same exact comparison. A missing or non-string area excludes that item from the swarm block.

A configured slot exists even when some items omit its value. The report adds controls and statistics for configured slots. It groups missing item values under `Unspecified`.

The report ignores all unknown extension fields. A repository must map each field that it wants to present.

## Readiness projection

The report must not duplicate readiness rules. `src/ready.js` will expose one detailed readiness projection. `selectReady` and the report will consume that projection.

Each item receives `ready`, `blocked`, or `ineligible` plus an ordered reason list. The projection evaluates reasons in this order:

1. `kind-not-task`;
2. `status-not-backlog`;
3. `snoozed`;
4. one `dependency-unsatisfied` reason for each failed `depends_on` entry, in frontmatter order;
5. one `ancestor-not-backlog` reason for each failed parent, from the direct parent outward.

An item is `ineligible` when any of the first three reasons applies. Otherwise, it is `blocked` when any dependency or ancestor reason applies. Otherwise, it is `ready`. The report therefore uses **blocked** only for a backlog task that fails dependency or ancestor readiness. It does not call triage, in-progress, snoozed, or epic items blocked.

## Report model

The pipeline is:

```text
validated ledger
-> authoritative readiness projection
-> configured semantic-field projection
-> deterministic report view model
-> escaped self-contained HTML
```

The main list contains every nonterminal item. The terminal sections contain `done`, `killed`, `deferred`, and `archived` items.

### Ordering

The report assigns each nonterminal item one explicit comparison tuple:

1. A finite mapped `rank`: `[0, rank, priorityMissing, priority, created, id]`.
2. No rank and a core `priority`: `[1, priority, created, id]`.
3. No rank and no core priority: `[2, created, id]`.

`priorityMissing` is `0` when core priority exists and `1` otherwise. The placeholder `priority` is `0` when missing; `priorityMissing` decides first. Tuple comparison is ascending from left to right. This places ranked items first, breaks equal ranks with present core priorities before missing priorities, and always ends with immutable `id`.

Terminal rows sort by terminal date descending, then immutable `id`. The terminal date is the core field for the current status: `completed` for `done`, `killed` for `killed`, `deferred` for `deferred`, and `archived` for `archived`.

### Grouping and filtering

The default group is mapped `area` when configured. Otherwise, it is core `status`.

The report always offers:

- search by immutable ID, number, and title;
- grouping by status, readiness, kind, and priority;
- filters for status, readiness, kind, and priority.

It adds mapped grouping and filtering only for the configured slots that support them.

All controls have visible labels or programmatic accessible names. Search and filter changes update a visible item count.

### Detail modes

The report has three global detail modes:

- **Basic:** identity, title, rank or priority, and compact badges.
- **Detailed:** basic fields, readiness reason, blockers, priority detail, and mapped rationale.
- **Full:** detailed fields, all core metadata, relations, decisions, configured mapped fields, and the rendered Markdown body.

Each card is a `<details>` element. The client renders a body only when the user opens the card. Closing a card does not discard the rendered body.

### Lifecycle summaries

The report counts:

- all items;
- nonterminal items;
- ready items;
- blocked items under the narrow definition above;
- triage items;
- in-progress items;
- snoozed items;
- each terminal status.

A terminal row shows identity, title, terminal date, matching terminal decision summary, and mapped completion reference when configured. The matching decision is the first decision in array order whose action and date match the current terminal status and terminal date, which is the same record that core validation accepts. A validated ledger always supplies this record.

### Area-diverse parallel candidates

The optional swarm block uses only ready tasks whose mapped area and complexity are non-empty strings and whose complexity exactly matches `eligible_complexities`.

The algorithm is deterministic:

1. Build a pool in report item order.
2. Start one empty batch and one empty set of used areas.
3. Scan the pool once. Add an item when the batch has fewer than six items and its area is unused. Preserve every other item in a remainder list.
4. Append a non-empty batch.
5. Repeat with the remainder until the pool is empty or eight batches exist.

Items left after the eighth batch are omitted. Each batch contains at most one item for each exact mapped area.

The heading is **Area-diverse parallel candidates**. The report does not claim that these items have no shared-file collisions. Area diversity is a scheduling hint, not an exclusive claim or a conflict proof.

## HTML and browser behavior

The report is one HTML file. It contains its CSS, JavaScript, projected item data, and optional logo.

The document includes:

- one top-level `<h1>`;
- semantic header, main, section, and footer elements;
- native labels for controls;
- keyboard-operable native controls and `<details>` cards;
- visible focus styles;
- sufficient color contrast;
- horizontal scroll containers around terminal tables.

Desktop keeps the sticky control bar. Narrow screens use non-sticky controls and compact three-row card summaries. The page itself must not overflow horizontally at a 390 px viewport.

The report must remain useful when JavaScript fails. The shell, title, generation date, summary counts, and a failure notice remain visible. Interactive cards require JavaScript.

## Markdown and content safety

`src/report-markdown.js` owns a compact renderer derived from the proven PropertyCompass renderer. It supports the Markdown used by current item bodies:

- headings;
- paragraphs;
- unordered and ordered lists;
- blockquotes;
- horizontal rules;
- fenced code blocks;
- pipe tables;
- inline code;
- emphasis and strong text;
- links.

The renderer applies these safety rules:

- Escape raw HTML before adding Markdown markup.
- Permit only absolute `http:` and `https:` link targets.
- Replace all other link targets with `#`.
- Add `rel="noopener noreferrer"` to links.
- Render every code fence as inert escaped source.
- Strip C0 control characters except tab and newline.

The server embeds report data as JSON. Before embedding, it escapes `<`, U+2028, and U+2029. A ledger body that contains `</script>` cannot close the data element.

The optional logo supports files with case-insensitive `.svg`, `.png`, `.jpg`, `.jpeg`, or `.webp` extensions. The normalized extension selects the MIME type. The generator does not inspect a file signature. Malformed or mismatched bytes can produce a broken image but cannot change the embedding context. An unsupported extension is `report-config-invalid`. An unreadable supported path is `report-read-failed`.

The generator base64-encodes the logo bytes into a MIME-specific data URL used only as an `<img>` source. It never inserts raw SVG markup into the document.

No ledger or configuration value enters HTML, CSS, JavaScript, an element ID, or a URL without the relevant encoder.

## Atomic publication

The output writer:

1. Creates the parent directory when absent.
2. Repeats the canonical output containment check.
3. Creates an exclusive temporary file in the output directory.
4. Writes the complete UTF-8 document.
5. Flushes and closes the temporary file.
6. Renames the temporary file over the target.
7. Attempts to remove the temporary file after every recoverable in-process failure before rename.

The temporary file uses the target's directory so the rename stays on one filesystem. Any failure before rename leaves existing target bytes unchanged. A cleanup failure remains `report-write-failed` and names the leftover temporary artifact in `details`. Process termination, machine failure, and a hostile symlink race are outside this cleanup guarantee.

The HTML has no generated wall-clock timestamp. It uses `--as-of` as its report date. Temporary file names do not enter the document.

## Implementation boundaries

- `src/ready.js` supplies detailed readiness and keeps `selectReady` as the canonical ID queue.
- `src/report.js` reads configuration, projects data, computes statistics and candidate batches, and publishes output.
- `src/report-html.js` renders the document shell and browser application.
- `src/report-markdown.js` renders safe item Markdown in the browser.
- `src/cli.js` owns command parsing, help, dispatch, envelopes, and exit status.

The implementation adds no template engine and no runtime report dependency.

## Test seams

Production changes follow Red-Green-Refactor through these observable seams.

### CLI seam

Invoke `runCli(["report", ...])` and verify:

- required arguments;
- one success envelope;
- one failure envelope;
- exact exit statuses;
- configured output;
- `--out` precedence;
- invalid-ledger refusal;
- missing, malformed, null, unknown-key, and unsupported-version configuration;
- RFC 6901 decoding and invalid escape refusal;
- canonical output containment through a symlinked ancestor;
- two consecutive runs with equal inputs produce byte-identical output;

### Artifact seam

Open generated HTML in Chromium and verify:

- search;
- each core grouping mode;
- mapped area grouping;
- filters;
- all detail modes;
- lazy Markdown rendering;
- terminal history;
- desktop layout;
- 390 px layout without page overflow;
- visible fallback content with JavaScript disabled;
- accessible names and keyboard operation for controls and cards;
- computed visible focus indicators and WCAG AA text contrast.

### Security seam

Generate a report from hostile but validator-valid content and verify:

- raw HTML remains inert;
- `</script>` remains data;
- unsafe link schemes become `#`;
- code fences do not execute;
- SVG bytes remain an image data URL;
- C0 control stripping;
- `rel="noopener noreferrer"` on safe links;
- unsupported logo extension refusal.

### Publication seam

Start with an existing report, induce a publication failure, and verify:

- existing bytes remain unchanged;
- temporary-file cleanup is attempted, and no temporary output remains when cleanup succeeds;
- injected write, close, and rename failures preserve the old target;
- each recoverable pre-rename failure attempts temporary-file cleanup;
- a cleanup failure reports the leftover artifact.

Tests assert behavior and data attributes. They do not compare the complete HTML document or inspect source text as a substitute for browser behavior.

## Documentation and package surface

Implementation updates:

- `README.md` with the command and one compact configuration example;
- `CHANGELOG.md` with the new report surface;
- `skills/wowbagger/SKILL.md` with report discovery, generation, outcome handling, and authority rules;
- CLI global help and `wowbagger report --help`.

The shipped skill must say that:

1. Report generation requires the installed core's matching distribution and core contract versions.
2. The ledger configuration lives at `.wowbagger/report.json`.
3. `--as-of` is required.
4. Agents parse the one JSON outcome.
5. Generated HTML is derived output.
6. Agents must use core commands, not report state, for lifecycle and coordination decisions.

## Verification gates

Implementation is complete only after these commands pass on the current Node runtime and Node 20:

```sh
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
npm run prepublishOnly
```

The final verification also generates a report, opens it in Chromium, and exercises the desktop and narrow-screen artifact seams.

## Rejected alternatives

### Keep the report in the consumer repository

This preserves hard-coded behavior but repeats core lifecycle and readiness rules. Every consumer would fork the generator.

### Add only a JSON report command

This keeps the core smaller but does not deliver the requested reusable human report. Consumers would still own duplicate HTML applications.

### Ship a generic template or plugin system

Custom templates, CSS, and JavaScript would maximize flexibility. They would also create an unsafe extension runtime and an unbounded compatibility surface. Fixed semantic slots solve the current need with a smaller contract.

### Render every Markdown body before page load

Eager rendering simplifies the browser script but expands the initial DOM at PropertyCompass scale. Lazy rendering keeps the initial document responsive.

### Infer collisions from mapped area

Area diversity reduces obvious scheduling concentration. It cannot prove file independence. The report therefore labels batches as candidates and leaves exclusive coordination to work claims.
