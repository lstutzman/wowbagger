# Wowbagger Ledger Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb four PropertyCompass2 backlog items into wowbagger's own ledger without creating duplicate items, filing the one genuinely new item through wowbagger's own CLI.

**Architecture:** Three existing ledger items are enriched by ordinary git edits (body text and appended `decisions:` entries, which `transition` cannot produce). One new item is filed through the core CLI's `create` → `inspect` → `transition` sequence, then renamed to match the directory's naming convention. Four PropertyCompass2 items are retired with `status: killed` and a prose pointer.

**Tech Stack:** Node.js 20+, the wowbagger core CLI (`bin/wowbagger.js`), plain Markdown + YAML frontmatter, git.

**Spec:** `docs/superpowers/specs/2026-08-05-wowbagger-ledger-reconciliation-design.md`

## Global Constraints

- Node.js 20 or later. Verify on both Node 20 and Node 26.
- **Run all tests with a short `TMPDIR`** (e.g. `TMPDIR=/tmp`). The default macOS temporary path makes the lock socket exceed the 104-byte `sun_path` limit and `test/mutation-hardening.test.js` fails with `EINVAL` on `listen`.
- `ledger/` contains only wowbagger ledger-item Markdown files. Explanatory documentation goes elsewhere (`CONTRIBUTING.md`).
- Decision `action` must be one of: `accept`, `complete`, `kill`, `archive`, `restore`, `replace-dependency`, `waive-dependency`, `reparent`, `record`. Every decision requires `action`, `date`, `summary`, and `rationale`.
- All dates are UTC. Today is `2026-08-05` UTC.
- Never hand-write the new ledger item. It is filed through the CLI; that is the point of the exercise.
- Work happens on branch `feature/ledger-reconciliation` in `/Users/leestutzman/Documents/GitHub/wowbagger`.
- Tasks run **in order, 1 through 4**. Task 2's verification asserts the ready count Task 1 produces, so running them out of order gives a false failure.
- `$SCRATCH` means a scratch directory **outside both repositories** — request JSON must never be committed. Set it once before starting, e.g. `export SCRATCH=$(mktemp -d)`.
- PropertyCompass2 changes are confined to `docs/backlog/`. Do not touch anything else in that repository.

---

### Task 1: File the new consumer configuration layer item through the core CLI

**Files:**
- Create (via CLI, then rename): `ledger/2026-08-05-consumer-configuration-layer.md`
- Scratch (outside the repository): create and transition request JSON

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: ledger item id `wb_01KZA1V3HN29SK5BS0P7RHS96R`, parented to epic `wb_01KZ77NSW8PNA4S48NYT26AGMH`, final status `backlog`. Task 3 cites this id when retiring PropertyCompass2 item 1420.

- [ ] **Step 1: Record the baseline ready queue**

```bash
cd /Users/leestutzman/Documents/GitHub/wowbagger
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json
```

Expected: exactly five ids —
`wb_01KZ77NSW81FXZVAWQ8WT4KDCJ`, `wb_01KZ77NSW8A25Q593G7RTX7TAH`, `wb_01KZ77NSW8CXZRZ8JH2ADYZWH3`, `wb_01KZ77NSW8YFDJXSNTQ8FBB2F7`, `wb_01KZ77NSW8ZP1289HFMN2ECNXD`.

This is the before-value. Task 1 must change it to six.

- [ ] **Step 2: Write the create request**

Write to a scratch path outside the repository (`$SCRATCH/create-config-layer.json`):

```json
{
  "id": "wb_01KZA1V3HN29SK5BS0P7RHS96R",
  "item": {
    "title": "Define the consumer configuration layer",
    "kind": "task",
    "parent": "wb_01KZ77NSW8PNA4S48NYT26AGMH",
    "provenance": {
      "source": "repository-backlog",
      "recorded_at": "2026-08-05T22:48:54Z"
    },
    "depends_on": [],
    "related": []
  },
  "body": "\nA consuming repository must supply its own paths, branch names, and\nbranding to the core without forking it. Specify that configuration seam:\nwhat a consumer declares, where the core reads it from, what happens when it\nis absent, and which values the core refuses to accept because they would\nchange ledger validity or core selection.\n\nThis is the portability precondition for any repository other than the one\nthe core was developed in.\n"
}
```

Do not add `schema_version`, `status`, `created`, `updated`, or `decisions`. Create rejects them and inserts its own.

- [ ] **Step 3: Run create and confirm it files to triage**

```bash
./bin/wowbagger.js create --ledger ledger --input "$SCRATCH/create-config-layer.json" --json
```

Expected: exit 0. The written file is `ledger/wb_01KZA1V3HN29SK5BS0P7RHS96R.md` — create always uses `<ledger>/<id>.md` and refuses a caller-supplied path. Confirm the frontmatter shows `status: triage`, `created: 2026-08-05`, `updated: 2026-08-05`.

- [ ] **Step 4: Verify the ledger is valid and the item is not yet ready**

```bash
./bin/wowbagger.js validate --ledger ledger --json
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json
```

Expected: `{"valid":true,"errors":[]}`, and ready still returns **five** ids. A `triage` item is not selectable — this proves the transition in Step 6 is doing real work.

- [ ] **Step 5: Inspect the item to obtain its revision**

```bash
./bin/wowbagger.js inspect --ledger ledger --id wb_01KZA1V3HN29SK5BS0P7RHS96R --json
```

Copy the exact `sha256:<64 lowercase hex>` revision token from the output. `transition` is a compare-and-set and will refuse a stale or invented value.

- [ ] **Step 6: Write the transition request and promote to backlog**

Write `$SCRATCH/transition-config-layer.json`, substituting the revision from Step 5:

```json
{
  "id": "wb_01KZA1V3HN29SK5BS0P7RHS96R",
  "expected_revision": "sha256:PASTE_THE_REVISION_FROM_STEP_5",
  "to_status": "backlog",
  "date": "2026-08-05",
  "decision": {
    "summary": "Accept the consumer configuration layer.",
    "rationale": "The configuration seam is the portability precondition for any consuming repository."
  }
}
```

```bash
./bin/wowbagger.js transition --ledger ledger --input "$SCRATCH/transition-config-layer.json" --json
```

Expected: exit 0, `status: backlog`, and an appended `action: accept` decision dated `2026-08-05`. The request must not supply `action`, a decision date, or terminal dates — wowbagger derives them.

- [ ] **Step 7: Verify the ready queue grew to six**

```bash
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json
```

Expected: six ids — the five from Step 1 plus `wb_01KZA1V3HN29SK5BS0P7RHS96R`. Selection requires `kind: task`, `status: backlog`, and a parent epic that is itself `backlog`; all three hold.

- [ ] **Step 8: Rename to the directory's naming convention**

```bash
git mv ledger/wb_01KZA1V3HN29SK5BS0P7RHS96R.md ledger/2026-08-05-consumer-configuration-layer.md
./bin/wowbagger.js validate --ledger ledger --json
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json
```

Expected: still valid, still six ids. Identity comes from frontmatter `id`, not the filename — the mutation contract states the filename is a portable default and not identity.

- [ ] **Step 9: Commit**

```bash
git add ledger/2026-08-05-consumer-configuration-layer.md
git commit -m "Add the consumer configuration layer item"
```

---

### Task 2: Enrich the three existing ledger items

**Files:**
- Modify: `ledger/2026-08-04-standalone-v0-epic.md`
- Modify: `ledger/2026-08-04-optional-policy-contract.md`
- Modify: `ledger/2026-08-04-propertycompass-adoption.md`

**Interfaces:**
- Consumes: the ready count of six established by Task 1 Step 7, which Step 4 below asserts is unchanged.
- Produces: the surviving ids that Task 3 cites — `wb_01KZ77NSW8PNA4S48NYT26AGMH` (for PC2 1419), `wb_01KZ77NSW8A25Q593G7RTX7TAH` (for PC2 1421), `wb_01KZ77NSW8363H1V6QG1HZRG11` (for PC2 1422).

These are ordinary git edits, not transitions. `transition` cannot edit body, title, relations, parent, or append a `record` decision — it only walks lifecycle edges.

- [ ] **Step 1: Record the epic's supersession of PC2 1419**

In `ledger/2026-08-04-standalone-v0-epic.md`, change `updated: 2026-08-04` to `updated: 2026-08-05`, and append to the `decisions:` sequence:

```yaml
  - action: record
    date: 2026-08-05
    summary: "PropertyCompass2 backlog item 1419 describes this same epic and is superseded here."
    rationale: "The portable-tool extraction epic is tracked once, in this ledger, so wowbagger work has a single source."
```

Leave `status: backlog` and the body unchanged.

- [ ] **Step 2: Fold the mechanism and policy seam into the policy-input contract**

In `ledger/2026-08-04-optional-policy-contract.md`, change `updated: 2026-08-05` (already correct — leave it) and append to `decisions:`:

```yaml
  - action: record
    date: 2026-08-05
    summary: "The mechanism and policy seam from PropertyCompass2 backlog item 1421 is folded into this item."
    rationale: "1421 held the concrete seam this item described abstractly; recording it here avoids a second overlapping item."
```

Replace the body (everything after the closing `---`) with:

```markdown

Specify how optional consumer policy may rank or decorate valid core readiness
without changing ledger validity or core selection. This is not a place to add
consumer-specific policy.

The seam separates mechanism from policy:

- Mechanism belongs to the core: the weighted three-factor rubric, bonus and
  partition ordering, confidence signals, tie-breaks, mode workflows, and
  per-type templates.
- Policy belongs to the consuming repository: scoring anchors naming that
  consumer's own features, its area and tier vocabularies, and its source
  globs.

A consuming repository's specific vocabulary is never absorbed into the core.
```

The consumer's own vocabulary is deliberately excluded. Importing it would contradict this item's own sentence about consumer-specific policy.

- [ ] **Step 3: Record the adoption remainder without authorizing adoption**

In `ledger/2026-08-04-propertycompass-adoption.md`, change `updated: 2026-08-04` to `updated: 2026-08-05`, and append to `decisions:`:

```yaml
  - action: record
    date: 2026-08-05
    summary: "The live remainder of PropertyCompass2 backlog item 1422 is captured here: PropertyCompass2 retires its in-repo copies and consumes an adapter."
    rationale: "Full migration is intended but not yet authorized; fenced work claims in the core CLI gate it, because PropertyCompass2 writes its backlog from many concurrent worktrees while the mutation runtime covers one working copy."
```

**`status:` stays `triage`.** Do not promote it. The body already states adoption requires an explicit consumer-adoption decision, and none has been authorized.

- [ ] **Step 4: Verify the ledger still validates and selection is unchanged**

```bash
./bin/wowbagger.js validate --ledger ledger --json
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json
```

Expected: `{"valid":true,"errors":[]}` and the same six ids as Task 1 Step 7. No status changed, so the ready set must not move. A change here means an edit went wrong.

- [ ] **Step 5: Commit**

```bash
git add ledger/2026-08-04-standalone-v0-epic.md ledger/2026-08-04-optional-policy-contract.md ledger/2026-08-04-propertycompass-adoption.md
git commit -m "Reconcile the PropertyCompass2 wowbagger items into the ledger"
```

---

### Task 3: Retire the four PropertyCompass2 items

**Files:**
- Modify: `docs/backlog/1419-epic-wowbagger-backlog-plugin-extraction.md`
- Modify: `docs/backlog/1420-wowbagger-config-layer-backlog-scripts.md`
- Modify: `docs/backlog/1421-wowbagger-scoring-mechanism-policy-split.md`
- Modify: `docs/backlog/1422-wowbagger-plugin-scaffold-first-consumer.md`

All paths are in `/Users/leestutzman/Documents/GitHub/PropertyCompass2`.

**Interfaces:**
- Consumes: the four surviving wowbagger ids produced by Tasks 1 and 2.
- Produces: nothing consumed later.

- [ ] **Step 1: Set each item to killed**

In each of the four files, make exactly two frontmatter changes:

- `status: backlog` → `status: killed`
- `killed:` → `killed: 2026-08-05`

Leave `duplicate_of` absent. That field takes the numeric id of a surviving *PropertyCompass2* item and cannot hold a wowbagger ULID; inventing a numeric survivor would corrupt its meaning.

- [ ] **Step 2: Append the survivor pointer to each body**

Append to the end of each file:

`1419-epic-wowbagger-backlog-plugin-extraction.md`:

```markdown

**Moved to wowbagger.** Superseded by wowbagger item `wb_01KZ77NSW8PNA4S48NYT26AGMH`
("Deliver standalone Wowbagger v0"). `duplicate_of` is empty because the surviving
item lives in another repository and has no numeric Property Compass id.
```

`1420-wowbagger-config-layer-backlog-scripts.md`:

```markdown

**Moved to wowbagger.** Superseded by wowbagger item `wb_01KZA1V3HN29SK5BS0P7RHS96R`
("Define the consumer configuration layer"). `duplicate_of` is empty because the
surviving item lives in another repository and has no numeric Property Compass id.
```

`1421-wowbagger-scoring-mechanism-policy-split.md`:

```markdown

**Moved to wowbagger.** Superseded by wowbagger item `wb_01KZ77NSW8A25Q593G7RTX7TAH`
("Define the optional policy-input contract"), which now carries the mechanism and
policy seam. `duplicate_of` is empty because the surviving item lives in another
repository and has no numeric Property Compass id.
```

`1422-wowbagger-plugin-scaffold-first-consumer.md`:

```markdown

**Moved to wowbagger.** The repository scaffold and harness adapter contract are
delivered. The live remainder — Property Compass retiring its in-repo copies and
consuming an adapter — is tracked as wowbagger item `wb_01KZ77NSW8363H1V6QG1HZRG11`
("Evaluate PropertyCompass adoption after standalone release"), which remains in
triage pending fenced work claims. `duplicate_of` is empty because the surviving
item lives in another repository and has no numeric Property Compass id.
```

- [ ] **Step 3: Leave the dangling dependency on 1434 alone, deliberately**

`docs/backlog/1434-foundation-0-dark-factory-vertical-loop.md` carries `depends_on: [1419]`. Killing 1419 leaves a dead blocker there.

Do **not** edit 1434. `.claude/rules/backlog-format.md` states PRIORITIZE demotes any `depends_on` entry whose blocker reached done or killed into `related`, so the documented mechanism resolves this on the next run. 1434 is an epic, and epics are never dispatched, so nothing can be wrongly blocked in the meantime. Verify the file is untouched:

```bash
cd /Users/leestutzman/Documents/GitHub/PropertyCompass2
git status --short docs/backlog/1434-foundation-0-dark-factory-vertical-loop.md
```

Expected: no output.

- [ ] **Step 4: Confirm the change is confined to the four files**

```bash
git status --short docs/backlog/
```

Expected: exactly four modified files, 1419 through 1422.

- [ ] **Step 5: Commit and push**

```bash
git add docs/backlog/1419-epic-wowbagger-backlog-plugin-extraction.md docs/backlog/1420-wowbagger-config-layer-backlog-scripts.md docs/backlog/1421-wowbagger-scoring-mechanism-policy-split.md docs/backlog/1422-wowbagger-plugin-scaffold-first-consumer.md
git commit -m "docs: retire the wowbagger items moved to the wowbagger ledger"
git push
```

This diff is confined to `docs/backlog/`, so it takes the documentation skip-list path: no `all.sh` gate, no pull request.

---

### Task 4: Verify and ship the wowbagger branch

**Files:** none modified.

**Interfaces:**
- Consumes: the commits from Tasks 1 and 2.
- Produces: `feature/ledger-reconciliation` merged to `main`.

- [ ] **Step 1: Run the full suite on Node 20**

```bash
cd /Users/leestutzman/Documents/GitHub/wowbagger
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
```

Expected: 230 tests, 230 pass, 0 fail. No `src/` changed, so this is a regression guard.

- [ ] **Step 2: Run the full suite on Node 26**

```bash
TMPDIR=/tmp node --test test/*.test.js
```

Expected: 230 tests, 230 pass, 0 fail.

- [ ] **Step 3: Confirm the tree is clean and diffs are well formed**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; no unexpected modified or untracked files.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin feature/ledger-reconciliation
gh pr create --repo lstutzman/wowbagger --base main \
  --title "Reconcile the PropertyCompass2 wowbagger items into the ledger" \
  --body "Absorbs PropertyCompass2 items 1419, 1420, 1421, and 1422. One new item filed through the core CLI, three existing items enriched, zero duplicates. Ledger validates; ready grows from five ids to six."
```

- [ ] **Step 5: Merge, then verify main**

```bash
gh pr merge <number> --repo lstutzman/wowbagger --merge
git checkout main && git pull --ff-only
./bin/wowbagger.js validate --ledger ledger --json
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-05 --json
```

Expected: valid, and six ids on `main`.

---

## Known follow-up, not in scope

`create` writes `<ledger>/<id>.md` and refuses a caller-supplied path, so the CLI cannot produce a filename matching this repository's own `YYYY-MM-DD-slug.md` convention. Task 1 Step 8 works around it with `git mv`. That friction deserves its own ledger item once this lands; filing it is not part of this plan.
