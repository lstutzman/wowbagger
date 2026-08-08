# Prompt for a session in `/Users/leestutzman/Documents/GitHub/tinydancer`

Update this project's wowbagger setup to the current version and fix what the
upgrade exposes.

## Start here: you are running an old wowbagger

`README.md` invokes the backlog tool as:

```bash
node ../wowbagger/bin/wowbagger.js ready --ledger ledger --as-of $(date -u +%F) --json
```

That path resolves to `/Users/leestutzman/Documents/GitHub/wowbagger`, whose
working copy is behind. Verified: it advertises `create`, `inspect`,
`transition`, `work_claim` — and **not** `patch`. `mint-id` prints a usage error.

The current code is on the branch `worktree-compressed-skipping-dongarra`,
pushed to `origin`, 21 commits ahead of `main`. **Nothing below works until you
point at it.** Do one of these first, and say which you chose:

```bash
# Option A — update the sibling checkout (ask Lee before switching its branch)
cd /Users/leestutzman/Documents/GitHub/wowbagger
git fetch origin && git checkout worktree-compressed-skipping-dongarra

# Option B — install it, and stop depending on a sibling directory entirely
npm install -g github:lstutzman/wowbagger#worktree-compressed-skipping-dongarra
```

Confirm before continuing:

```bash
wowbagger capabilities --json | python3 -c "import sys,json;print(sorted(json.load(sys.stdin)['result']['operations']))"
# must include: create, inspect, patch, transition, work_claim
wowbagger mint-id --date 2026-08-08   # must print wb_...
```

## Good news first: nothing here is broken

Checked against the new binary before writing this prompt:

- `validate --ledger ledger --json` → `{"valid":true,"errors":[]}`
- `ready` returns all 8 tasks, unchanged

Two breaking changes shipped and **neither affects this repo**, because nothing
here reads mutation JSON programmatically:

- `item.id` is gone from every `inspect`/mutation result. Read `item.core.id`.
- `patch` was added to the advertised adapter command list.

Read `CHANGELOG.md` in the wowbagger repo for the full list before you start.

## What to actually fix

This repo filed the dogfood report that produced most of these fixes. They are
all shipped now, and this ledger has not taken advantage of any of them.

### 1. Every item is unprioritised — fix this first

`ready` currently prints:

```
number  priority  title
-       -         Average the existing checkpoints and measure the result
-       -         Swap the hand-written attention for fused scaled_dot_product_attention
...
```

Eight ready tasks, no ordering except creation date. **This was the exact
complaint this project filed** — the report noted the two friction items landed
at 15 and 16 of 16, furthest from the attention they were filed to attract.
`priority` is restored: a non-negative integer, lower sorts first, core never
calculates it.

Set a priority on every ready item. Use the ranking already argued in
`eval/TECHNIQUES.md` rather than inventing a new one — that file exists to rank
these experiments, so the ledger should agree with it. Where the ranking is
silent (the three tasks with no parent: the billion-token run, the checkpoint
backup, the reranking temperature), decide deliberately and say why in the
decision record.

### 2. No item has a `number`

Items are referable only by 26-character ULID. A `number` field now exists: a
positive integer, unique within one ledger, validated, explicitly **not**
identity — publication, references and filenames still use the ULID. Allocate
1–9 in a defensible order (epic first, then its children, then the loose ends).

### 3. Use `patch`, not a text editor

Both of the above are frontmatter changes. Until now the only way to make one
was to hand-edit YAML, which bypasses validation, the per-ID lock, and the
compare-and-swap. `patch` fixes that and is the operation to use:

```bash
wowbagger inspect --ledger ledger --id <ULID> --json   # take .result.item.revision
cat > /tmp/p.json <<'JSON'
{
  "id": "<ULID>",
  "expected_revision": "sha256:<from inspect>",
  "patch": { "priority": 10, "number": 3 },
  "date": "2026-08-08",
  "decision": {
    "summary": "Rank the RoPE experiment third.",
    "rationale": "eval/TECHNIQUES.md measures it below Muon and fused attention on this hardware."
  }
}
JSON
wowbagger patch --ledger ledger --input /tmp/p.json --json
```

**Gotchas that will bite you, in order of likelihood:**

- **`create` refuses `priority` and `number`.** They are controlled members like
  `status`. Create the item, then patch it. The refusal names `patch`.
- Patchable fields are exactly `priority`, `number`, `parent`, `depends_on`,
  `title`. `status` stays with `transition`.
- Every patch needs a `decision` with a non-empty `summary` and `rationale`.
- Integer spelling is strict: `7.0`, `1e2`, `05`, `+5` and `-0` are all refused.
  Send `7`.
- `expected_revision` is a compare-and-swap. Re-inspect between patches; a stale
  revision returns `revision-conflict` at exit 4.
- A patch whose requested values already hold returns success with
  `state: "unchanged"`, exit 0, and publishes nothing. That is not an error.

### 4. Stop writing a ULID generator

The dogfood report recorded writing one by hand to file the first item. Don't.

```bash
wowbagger mint-id                    # canonical ID for today
wowbagger mint-id --date 2026-08-08  # ID whose encoded date is that day
```

The encoded timestamp must match the item's `created`, which `--date` handles.
Accepted range is 1970-01-01 to 9999-12-31; anything outside is refused.

### 5. Update `README.md` and `CONTEXT.md`

- The README invocation should match whichever option you chose above. If you
  installed globally, drop the `../wowbagger` relative path — it is the reason
  this project silently ran an old version.
- The README says "Nine items". Verify that is still true and keep it accurate.
- Show the human `ready` output as well as `--json`. Bare `ready` now prints a
  number/priority/title table; `--json` is unchanged and byte-compared by
  conformance vectors, so it is still the right form for scripts.
- `CONTEXT.md` defines **Ready** as "a backlog item with no live blockers". That
  is still true but no longer complete: ready is now ordered by priority-bearing
  items first, then ascending priority, then created date, then ULID. Add
  **priority** and **number** as glossary terms — `CONTEXT.md` is this project's
  ubiquitous-language file and both are now part of the vocabulary.

## Verify, then commit

```bash
wowbagger validate --ledger ledger --json      # must be {"valid":true,"errors":[]}
wowbagger ready --ledger ledger --as-of $(date -u +%F)
```

The table must show a number and a priority on every row, in the order you
intended. Commit the ledger changes and the doc updates separately from each
other, with messages explaining the ranking rather than restating the diff.

## If something refuses and you cannot see why

`validate --json` reports the whole ledger; one structural error invalidates all
of it and `ready` refuses to print a partial queue. That is deliberate.

Do not hand-edit YAML to get around a refusal — the refusal is the tool doing
its job, and hand-editing is what `patch` exists to replace. If a refusal looks
wrong, that is a wowbagger bug worth reporting back: this project's last dogfood
report produced eight fixes.
