# Handoff — wowbagger, dogfood queue cleared (2026-08-07, later)

**Worktree:** `/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/compressed-skipping-dongarra`
**Branch:** `worktree-compressed-skipping-dongarra` (this repo has no `staging`; `main` is default)
**Status:** clean tree; four commits ahead of `origin/main`, **not pushed**

> Read this file, then `./bin/wowbagger.js ready --ledger ledger --as-of <today>`.
> It now prints a readable table. Items are numbered — say "item 34", not the ULID.

---

## What happened

**All eight items at the top of the queue are done.** Items 26 through 33.

Four commits, none pushed:

- `e0be632` — ADR 0006, ADR 0007, `CHANGELOG.md`, `CONTEXT.md` (items 30, 31, 32)
- `ff3825c` — seven items closed, four filed
- `286ca74` — `mint-id`, readable `ready`, guarded `patch` (items 26, 27, 28, 29, 33)
- `637182b` — item 33 closed, item 34's number allocated by patch

**558 tests**, green on Node 26 and Node 20 (532 at the start). Ledger validates.
`node spec/run-adapter-vectors.js` reports `reference-pass` on every case.

## Authoritative facts (do not re-derive)

Everything in `docs/handoffs/2026-08-07-project.md` under this heading still holds,
**except** the line about `ready --json`. Amended and added:

- **Canonical test command:** `TMPDIR=/tmp node --test test/*.test.js`. The short
  `TMPDIR` is required — macOS caps `sockaddr_un.sun_path` at 104 bytes.
- **Node 20 lives at `/opt/homebrew/opt/node@20/bin/node`.** Both runtimes must pass.
- **Never `git stash` here.** Worktrees share one stash stack.
- **`src/` must never import from `test/` or `spec/`.** The oracles are independent
  on purpose.
- **`ready --json` is still byte-compared and still must not drift.** Bare `ready`
  now prints a human table; that surface is free to change, `--json` is not. The
  `--json` bytes are proven identical to
  `spec/fixtures/adapters/03-ready-forwarding/expected-core-stdout.jsonl` by digest.
- **`item.core` is a fixed view, not all frontmatter.** It does not carry `priority`
  or `number`. That is item 37, and it is real.
- **A task cannot go `backlog` → `done`.** It must pass through `in-progress`.
- **`create` does not allocate a `number`.** Supply one in the request, or set it
  afterwards with `patch`.

## New surfaces

```sh
./bin/wowbagger.js mint-id                    # canonical ID for today
./bin/wowbagger.js mint-id --date 2026-08-07  # ID whose encoded date is that day
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-07        # human table
./bin/wowbagger.js patch --ledger ledger --input patch.json --json
```

`patch` changes exactly `priority`, `number`, `parent`, `depends_on`, `title`. It
requires `expected_revision` and a decision with a summary and rationale. `status`
stays with `transition`. Full request shape in `docs/mutation-contract.md` §8A.

## Decisions taken, and by whom

Lee decided all four of these; the reasoning is in the ADRs and the items.

- **Priority's removal has no known cause**, and is recorded as unknown rather than
  guessed. ADR 0006 also states the rule: a contract field is never removed inside a
  documentation commit.
- **Ownership stays absent.** Claims meet the practical need. ADR 0007 keeps the
  claim-versus-ownership distinction explicit rather than pretending it away. Lee
  raised ownership and believed it was required; he decided against it after the
  distinction was stated plainly, and the ADR records that so it is not misread later.
- **`inspect` promotes nothing.** `item.id` was removed.
- **`patch` is advertised to the adapter**, widening the command list in five places
  including the independent oracle and two byte-compared fixtures. ADR 0008. A test
  proves the list stayed exact.

## Two things a reviewer should know

**Item 26's accepting decision contained a false statement.** It claimed the assigned
status was recoverable only by base64-decoding `source_base64`, "confirmed firsthand".
It was in `item.core.status` all along, visible in the pre-existing create fixture, so
its first acceptance criterion was already met when the item was filed. The completion
decision records the correction. An implementation that added an `assigned_status`
member was rejected: `create` always assigns triage, so the member could hold exactly
one value.

**Item 33's first run stopped without writing code**, correctly, because advertising
`patch` required changing an independent oracle and its brief forbade that. The block
was lifted deliberately after Lee decided. The distinction that matters, and that still
binds: editing an oracle so it stops catching a wrong implementation is forbidden;
extending an oracle because the contract itself gained a command is required. Never
relax a check — extend it and keep it exact.

## The queue now

| # | pri | Title |
|---:|---:|---|
| 34 | 5 | Pin the PropertyCompass extension profile, starting with the priority inversion |
| 37 | 5 | Carry priority and number in the core view, or say why they are absent |
| 35 | 10 | Settle the PropertyCompass migration rulings before the first import |
| 36 | 20 | Adopt per-kind item templates and the durability doctrine |

Then the planned items in creation order.

**Item 34 is the sharpest.** PropertyCompass `priority_score` is a float where higher
is better; wowbagger `priority` is an integer where lower sorts first. Copying one into
the other reverses the queue while validating clean, and the 993 float values fail
`invalid-priority`. The correct source is `priority_rank`. It is the only gap found in
the whole comparison that fails silently. Everything else fails loudly.

The PropertyCompass2 comparison behind items 34 to 36 found 1473 items governed by
`.claude/rules/backlog-format.md`, with four per-type templates and a sequential-ID
claim script. The systems agree on more than expected: identical status vocabulary
including the archived-versus-killed distinction, `depends_on` as live blockers only,
`related` as the graveyard for satisfied dependencies, and `snoozed_until`. Wowbagger
already permits and preserves unknown frontmatter, so most of the PropertyCompass
schema can ride as extension fields with no core change.

## Blockers, unchanged

- **Fenced work claims (item 17)** still carry an unresolved design question, not just
  unwritten code. Settle with Lee before implementing. Statement in
  `ledger/2026-08-06-fenced-work-claims-coordinator.md`.
- **The full PropertyCompass migration is unauthorized** and stays `triage` (item 2).

## Housekeeping

- Six stale merged branches remain. Deleting them was never authorised — ask first.
- The main checkout at `/Users/leestutzman/Documents/GitHub/wowbagger` is behind and
  needs a pull.
- **The plugin marketplace install is still unverified.** Nobody has installed it.
  That is item 23 and it may fail at step one. Note that `patch` now appears in the
  advertised command list, so a stale installed core will be detected rather than
  silently mismatched — which is the point of the version check.

## Prompt for next session

```
Context: continuing wowbagger from 2026-08-07. Work happens in the wowbagger
repository only — not PropertyCompass2.

Read docs/handoffs/2026-08-07-dogfood-queue.md first, then
docs/handoffs/2026-08-06-adapter-plan-1.md if touching the adapter.

Four commits are unpushed. Check with Lee before pushing or merging to main.

Read the queue with:
  ./bin/wowbagger.js ready --ledger ledger --as-of <today>

Before any test run: TMPDIR=/tmp node --test test/*.test.js, on both Node 26
(`node`) and Node 20 (`/opt/homebrew/opt/node@20/bin/node`).
Never git stash in this repository.

Item 34 is first and it is a silent-corruption hazard. Start there unless Lee
redirects.
```
