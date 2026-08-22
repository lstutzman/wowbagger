# Named custom report views

Status: approved design

## Problem

The base HTML report contains the complete validated ledger. Consumers also need separate, self-contained reports whose Work next, Attention, graph, evidence, drill-down, history, and statistics all describe one configured subset. A client-side preset is insufficient: hidden rows remain in the file, top-level report sections still describe the full ledger, and the artifact cannot honestly be shared as a scoped report.

Wowbagger remains the sole source of truth. A custom view is a read-only projection generated from the complete ledger, never a second ledger or stored report state.

## Decisions

1. Each named view generates a separate HTML file.
2. The base report remains available and unchanged when no view is selected.
3. View criteria use the same grouped-facet semantics as the report drill-down: OR within one group, AND across groups.
4. Wowbagger validates and computes readiness against the complete ledger before filtering. Excluding a blocker must never make blocked work appear ready.
5. Excluded items are absent from the generated HTML. Client-side facets may narrow the view further but cannot reveal excluded items.
6. Report configuration version 2 introduces named views. Version 1 remains supported unchanged.
7. One invocation generates one artifact. No batch `--all-views` command ships in this version.

## Configuration

`<ledger>/.wowbagger/report.json` version 2 accepts all version 1 members plus `views`:

```json
{
  "report_version": 2,
  "repository": {
    "name": "Example"
  },
  "title": "Example ledger",
  "output": "../../report.html",
  "fields": {
    "area": "/area",
    "class": "/class",
    "complexity": "/complexity",
    "security": "/security"
  },
  "views": {
    "security-blockers": {
      "title": "Security blockers",
      "output": "../../reports/security-blockers.html",
      "filters": {
        "readiness": ["blocked"],
        "status": ["backlog", "in-progress"],
        "kind": ["task"],
        "fields": {
          "class": ["bug"],
          "security": ["high", "critical"]
        }
      }
    }
  }
}
```

### View names

A view name is a portable identifier matching:

```text
^[a-z][a-z0-9-]{0,63}$
```

Names are case-sensitive. The `views` object may contain at most 64 views.

### View members

Each view accepts exactly:

| Member | Required | Rule |
|---|---:|---|
| `title` | Yes | Non-empty string used as the generated report title. |
| `output` | Yes | Non-empty path resolved relative to `.wowbagger/report.json`. |
| `filters` | Yes | Exact filter object with at least one non-empty group. |

Unknown members fail closed.

### Filter members

`filters` accepts exactly:

| Group | Values | Semantics |
|---|---|---|
| `readiness` | Non-empty unique array of `ready`, `blocked`, or `ineligible` | Match the full-ledger readiness projection. |
| `status` | Non-empty unique array of supported lifecycle statuses | Match stored item status. |
| `kind` | Non-empty unique array of `task` or `epic` | Match stored item kind. |
| `fields` | Non-empty object keyed by configured report field name | Match configured mapped scalar values. |

At least one of `readiness`, `status`, `kind`, or `fields` is required. Arrays use OR. Present groups use AND.

A `fields` key must also exist in the base configuration's `fields` map. Each field filter is a non-empty unique array of JSON strings, finite numbers, or booleans. Matching preserves JSON scalar type and value; stringification is not equality. An item without the mapped field does not match a selected value for that field.

No title-text inference, regular expressions, arbitrary JSON pointers, or body search belongs in a view filter.

### Output safety

The base output and every named view output must be pairwise distinct after path resolution. Every output must remain outside the canonical ledger path under the existing no-follow containment rule. Invalid or colliding output paths make configuration invalid before rendering.

A CLI `--out` value overrides the selected base or view output for that invocation, preserving current one-off behavior. Configuration-level collisions are still invalid even when `--out` is present.

## CLI contract

Base report, unchanged:

```text
wowbagger report --ledger <dir> --as-of YYYY-MM-DD --json
```

Named view:

```text
wowbagger report --ledger <dir> --view security-blockers --as-of YYYY-MM-DD --json
```

Optional output override remains accepted:

```text
wowbagger report --ledger <dir> --view security-blockers --as-of YYYY-MM-DD --out <file> --json
```

`--view` requires report configuration version 2. A missing or unknown name returns a structured core-domain `report-view-not-found` refusal and leaves every existing output unchanged.

Base success keeps its existing result bytes. A named-view success adds only the selected name:

```json
{
  "ok": true,
  "command": "report",
  "contract_version": 5,
  "result": {
    "report_version": 2,
    "as_of": "2026-08-21",
    "output": "/absolute/reports/security-blockers.html",
    "item_count": 12,
    "ready_count": 0,
    "view": "security-blockers"
  }
}
```

`item_count` and `ready_count` describe the filtered view. No `view` member appears on base-report success, preserving the existing shape.

## Projection pipeline

Generation follows this order:

1. Load and validate the complete configured ledger.
2. Compute readiness for every item against that complete ledger and explicit `as_of` date.
3. Project configured mapped fields for every item.
4. Apply the selected view's grouped filters to the projected items.
5. Build view-specific report sections from only the retained items:
   - statistics;
   - Work next ranking;
   - Attention lists;
   - flow and forecast evidence;
   - graph nodes, links, labels, and roster;
   - open-item drill-down;
   - terminal history;
   - swarm candidates.
6. Render and atomically publish the selected output.

Readiness is never recomputed on the subset. Ranking leverage, report evidence, statistics, graph membership, and attention are view-specific and therefore derive from the retained set.

The report keeps a complete-ledger ID-to-number lookup solely for labels. If an included item names an excluded dependency, parent, blocker, or related item, the report still prints the excluded item's number rather than degrading to a raw ULID. The excluded item receives no row, graph node, history entry, or hidden payload.

Graph links are retained only when both endpoints are retained. Missing graph endpoints do not alter the included node's full-ledger readiness reasons.

## Generated HTML

A named report visibly states:

- the view title;
- the stable view name;
- the configured criteria as read-only facet chips;
- the fact that the artifact is a filtered subset of the named repository ledger.

Interactive drill-down facets and graph status filters operate only within the retained subset. **Clear filters** restores the complete custom-view subset, never the base ledger.

The artifact remains one self-contained HTML file with no remote fetches. It stores no mutable view state and authorizes no transitions.

## Failure behavior

The command validates the complete ledger and complete report configuration before touching the selected output.

| Failure | Result |
|---|---|
| Missing or malformed config | Existing `report-config-invalid` behavior. |
| Version 1 config with `--view` | `report-view-not-found`; selected output unchanged. |
| Unknown view name | `report-view-not-found`; selected output unchanged. |
| Invalid filter group/value | `report-config-invalid`; no output changed. |
| View references an unmapped field | `report-config-invalid`; no output changed. |
| Base/view output collision | `report-config-invalid`; no output changed. |
| Output inside ledger | Existing output-containment refusal. |
| Empty matched subset | Successful valid report with zero items and explicit empty-state copy. |
| Publication failure | Existing report publication recovery contract; prior selected output preserved when commit is not established. |

Error messages remain human summaries. Automation branches on stable codes and details.

## Compatibility

- Version 1 configuration and base generation remain supported and byte-compatible.
- Version 2 without `--view` generates the base report using inherited base members.
- Older cores reject version 2 configuration rather than silently ignoring views.
- Core contract remains version 5 because this extends the report request and result only under an explicit new config version and `--view` flag; capability advertisement must state named-view support so consumers never probe by generating an artifact.
- No adapter may advertise or forward named report generation until its own command contract includes the new flag.

## Testing

Strict RED-GREEN-REFACTOR covers:

1. Version 1 remains accepted and unchanged.
2. Version 2 base configuration and normalized views.
3. Unknown members, malformed names, invalid arrays, duplicate values, unmapped fields, excess views, and output collisions.
4. `--view` argument parsing, missing names, unknown names, and `--out` override.
5. OR-within and AND-across filter semantics for readiness, status, kind, and typed mapped values.
6. Readiness remains full-ledger-derived when a blocker is excluded.
7. Every report section uses the same retained set.
8. Excluded referenced items retain number labels but no hidden content.
9. Graph endpoints and roster are filtered consistently.
10. Empty-subset success.
11. Failed generation preserves the prior selected output.
12. Base report byte compatibility.
13. Deterministic repeated named-view generation.
14. Current Node and Node 20 focused suites, then the complete project gate.
15. Browser verification of criteria display, client-side narrowing, Clear-filter subset boundary, graph filtering, desktop layout, and mobile layout.

## Non-goals

- Saving filters from inside the browser.
- URL/hash state.
- Generating every view in one invocation.
- Editing report configuration from the report.
- Mutating ledger item metadata.
- Redaction or access control. A custom view is scoped output, not a security boundary.
- Mirrored ledger state, daemon state, remote fetches, or automatic lifecycle transitions.
