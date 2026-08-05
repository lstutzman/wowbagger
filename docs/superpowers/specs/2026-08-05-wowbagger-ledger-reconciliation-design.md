# Wowbagger ledger reconciliation — design

Date: 2026-08-05
Status: approved for implementation

## Purpose

Four PropertyCompass2 backlog items describe wowbagger work. They must become
part of wowbagger's own ledger without creating duplicate items. This is the
first deliberate dogfooding step: wowbagger's ledger becomes the single truthful
source for wowbagger work, and the new item is filed through wowbagger's own CLI
rather than hand-written.

This design covers only that reconciliation. It does not build the Claude Code
skill, does not implement work claims, and does not migrate PropertyCompass2.

## Decisions this rests on

1. PropertyCompass2 will eventually migrate fully to wowbagger, but not yet.
   PropertyCompass2 is left alone apart from retiring the four moved items.
2. Fenced work claims must be implemented in the core CLI before any
   PropertyCompass2 migration. PropertyCompass2 writes its backlog from many
   concurrent worktrees; the current mutation runtime is scoped to cooperative
   writers in one working copy and enforces no fencing.
3. Reconcile rather than copy. Three of the four items are already covered by
   existing ledger items; copying them would create a second epic and two
   overlapping items — the divergent-source failure this project exists to stop.

## Source classification

Seven PropertyCompass2 backlog items mention wowbagger. Only four are wowbagger
work:

| PC2 item | Disposition |
|---|---|
| 1419 — epic, extract the backlog system into a portable tool | Covered by `standalone-v0-epic` |
| 1420 — config layer for backlog scripts (paths, branch, branding) | No equivalent; becomes one new item |
| 1421 — scoring mechanism out of Property Compass policy | Enriches `optional-policy-contract` |
| 1422 — repo scaffold, harness adapters, PC2 as first consumer | Largely delivered; live remainder enriches `propertycompass-adoption` |

Items 1434, 1436, and 1454 are PropertyCompass2's own dark-factory work that
merely cites wowbagger. They stay in PropertyCompass2 and are not touched.

## Ledger changes

### `wb_01KZ77NSW8PNA4S48NYT26AGMH` — Deliver standalone Wowbagger v0

No body change. Append one decision recording that PC2 #1419 describes this same
epic and is superseded here.

### `wb_01KZ77NSW8A25Q593G7RTX7TAH` — Define the optional policy-input contract

The body gains the mechanism/policy seam that PC2 #1421 describes, stated
generically:

- Mechanism belongs to the core: the weighted three-factor rubric, bonus and
  partition ordering, confidence signals, tie-breaks, mode workflows, and
  per-type templates.
- Policy belongs to the consuming repository: scoring anchors that name a
  consumer's own features, its area and tier vocabularies, and its source globs.

The consuming repository's *specific* vocabulary is deliberately excluded. This
item's existing text states it is "not a place to add consumer-specific policy",
so the seam comes across and the policy does not.

Append one decision citing PC2 #1421 as the source.

### `wb_01KZ77NSW8363H1V6QG1HZRG11` — Evaluate PropertyCompass adoption

Status stays `triage`. Append one decision capturing the live remainder of PC2
#1422 — that PropertyCompass2 retires its in-repo copies and consumes an adapter
— and naming fenced work claims in the core CLI as the gate. Adoption intent is
recorded; adoption is not authorized. The item's own text requires an explicit
consumer-adoption decision before it leaves triage.

### New item — `wb_01KZA1V3HN29SK5BS0P7RHS96R`

Covers PC2 #1420.

- Title: `Define the consumer configuration layer`
- Kind: `task`
- Parent: `wb_01KZ77NSW8PNA4S48NYT26AGMH`
- Status when this change is complete: `backlog`
- Body: how a consuming repository supplies its own paths, branch names, and
  branding to the core without forking it, so the tooling is portable across
  repositories.

PC2 #1420 is phrased around that repository's backlog scripts. The wowbagger-side
requirement is the configuration seam itself, so the item is generalized.

## How the new item is filed

The new item is created through the core CLI, because exercising the mutation
runtime on real work is the point of this step.

```sh
./bin/wowbagger.js create --ledger ledger --input request.json --json
./bin/wowbagger.js transition --ledger ledger --input transition.json --json
```

The create request supplies `id`, `item.title`, `item.kind`, `item.parent`,
`item.provenance`, `item.depends_on`, `item.related`, and `body`. It must not
supply `schema_version`, `id` inside `item`, `status`, `created`, `updated`, or
`decisions`; create inserts those itself.

Two consequences of the documented contract shape the steps:

1. **Create always files to `triage`.** Reaching `backlog` requires the
   `triage → backlog` transition, which appends an accept decision. So filing
   this item is two commands, not one.
2. **Create always writes `<ledger>/<id>.md`** and refuses a caller-supplied
   path. Every existing ledger file uses a `2026-08-04-slug.md` name, so the CLI
   default diverges from the directory's convention. The mutation contract states
   the filename is a portable default and not identity, and validation resolves
   identity from frontmatter, so the file is renamed to
   `2026-08-05-consumer-configuration-layer.md` with an ordinary `git mv` after
   creation.

That second point is a genuine friction discovered by dogfooding: the tool cannot
produce a file that matches its own repository's naming convention. It is
recorded here rather than silently worked around, and is a candidate for a
follow-up ledger item.

The three enrichments to existing items are ordinary reviewed git edits. They
change body text and append decisions, which `transition` cannot do —
`transition` cannot edit identity, title, relations, parent, snooze, body, or
extension fields. `CONTRIBUTING.md` already directs that such changes remain
reviewable git changes.

## PropertyCompass2 changes

Items 1419, 1420, 1421, and 1422 move to `status: killed`, each body gaining one
line naming the surviving wowbagger ID.

`duplicate_of` is left empty. That field is typed as the numeric id of a
surviving PropertyCompass2 item and cannot hold a wowbagger ULID. The repository
has no "moved to another repository" terminal: `killed` asserts an item was wrong
or dead, and `archived` is reserved for a gated staleness sweep. `killed` plus an
explicit prose pointer is the closest honest fit, and inventing a numeric
survivor id would corrupt the field's meaning.

This is the entire PropertyCompass2 touch: four frontmatter edits and four
one-line body additions, all under `docs/backlog/`.

## Verification

- `./bin/wowbagger.js validate --ledger ledger --json` returns
  `{"valid":true,"errors":[]}`.
- `./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json` returns
  six ids: the current five plus `wb_01KZA1V3HN29SK5BS0P7RHS96R`. Selection
  requires `kind: task`, `status: backlog`, and a parent epic that is itself
  `backlog`; the new item satisfies all three, and its parent
  `wb_01KZ77NSW8PNA4S48NYT26AGMH` is `backlog`. If the item is left in `triage`,
  the count stays at five — that is the check that the transition step ran.
- The full suite passes on Node 20 and Node 26. No `src/` change is made, so this
  is a regression guard rather than new coverage. Run with a short `TMPDIR`; the
  default macOS temporary path exceeds the 104-byte `sun_path` limit and fails
  `test/mutation-hardening.test.js` with `EINVAL`.
- PropertyCompass2's change is confined to `docs/backlog/`, which takes that
  repository's documentation skip-list path: no CI gate and no pull request.

## Out of scope

- The Claude Code skill that consuming projects will install.
- Implementing fenced work claims in the core CLI.
- Any PropertyCompass2 change beyond the four kill markers.
- PC2 items 1434, 1436, and 1454.
