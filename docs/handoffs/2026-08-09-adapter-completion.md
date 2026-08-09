# Handoff — wowbagger, Claude Code adapter (2026-08-09)

**Worktree:** `/Users/leestutzman/Documents/GitHub/wowbagger`
**Branch:** `main`
**HEAD:** `ac02961`
**Status:** clean checkout, 561 tests green on Node 26 and Node 20. Adapter Plan 1
delivered. **Plans 2 and 3 are not started.** Item 13 stays `in-progress`.

> **Correction notice.** The first version of this file, committed as `ac02961`,
> claimed the adapter was implementation-complete and listed modules and commands
> that do not exist in this repository. It was wrong. Everything below is verified
> against the working tree and against a real run of the conformance runner. Where
> this file states a number, the command that produced it is given.

---

## Goal

Deliver a Claude Code adapter that translates harness requests into core commands
under strict interface validation and byte-for-byte output preservation, proven
against `docs/adapter-contract.md` §10 and the vectors in
`spec/fixtures/adapters/`.

## Verified state

### Conformance run — the acceptance bar

```bash
TMPDIR=/tmp node spec/run-adapter-implementation.js
```

Reports `status: fail`, `implementations.claude-code: fail`,
`evidence_platform: darwin`, with **79 of 183 assertions evidenced** and **1 of
15 cases passing** (`09-platform-declaration`).

That is exactly the position Plan 1's own Definition of Done predicts, and it has
not moved since 2026-08-06. Every assertion requiring `invoke` reports
`evidence: "unimplemented"`.

| Surface | Evidenced by | State |
|---|---|---|
| Negotiation, describe, manifest, core probe, entrypoint path | `src/adapter/describe.js`, `manifest.js`, `core-probe.js`, `entrypoint-path.js` | Done (Plan 1) |
| Invoke, forwarding, paths, limits, process outcomes | — | **Not started (Plan 2)** |
| Approval, context, instructions, handoff | — | **Not started (Plan 3)** |

### Unit suite

```bash
TMPDIR=/tmp node --test test/*.test.js                                  # Node 26
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js    # Node 20
```

561 tests, 561 passing, 0 failing on both runtimes. This number is real, but it
measures the unit suite. It is **not** the acceptance bar — the conformance run
above is. A green suite alongside a failing conformance run is the expected
shape of a partly-built adapter, not a contradiction.

### Modules that exist

`src/adapter/` holds **seven** modules, 1017 lines total:

| Module | Lines |
|---|---:|
| `describe.js` | 382 |
| `core-probe.js` | 237 |
| `entrypoint-main.js` | 116 |
| `entrypoint-path.js` | 103 |
| `manifest.js` | 93 |
| `schema-helpers.js` | 60 |
| `bootstrap.js` | 26 |

There is no `invoke.js`, `paths.js`, `limits.js`, `process-outcome.js`,
`approval.js`, `context.js`, `instructions.js`, or `handoff.js`. Plans 2 and 3
create them.

### Where things actually live

- Adapter entrypoints: `adapters/<harness>/entrypoint.js` for `claude-code`,
  `codex`, and `opencode`. There is no `bin/wowbagger-adapter.js`.
- Adapter manifests: `adapters/<harness>/wowbagger-adapter.json`. There is no
  manifest at the repository root.
- Core CLI: `bin/wowbagger.js`.
- Implementation runner: `spec/run-adapter-implementation.js`, 323 lines, already
  wired into `test/adapter-implementation-runner.test.js`. It already accepts
  `--target <adapter>` and already drives the real entrypoint. It does **not**
  need a new `--adapter` flag, and `spec/run-adapter-vectors.js` should not be
  changed to add one — that file is the reference-model runner and stays that way.

## Open work

The authoritative breakdown is the "Follow-on Plans" section of
`docs/superpowers/plans/2026-08-06-claude-code-adapter-negotiation.md`.

### 1. Plan 2 — invocation and forwarding (in flight)

Create `src/adapter/paths.js`, `limits.js`, `process-outcome.js`, `invoke.js`.
Cases `03`, `04`, `05`, `06`, `10`, `11`, `12` — 41 assertions. Landing them also
flips `api-transport-is-not-tooling` (case `01`) and
`future-invoke-version-is-refused` (case `13`), both stranded by Plan 1.

Target: 120 of 183 evidenced. Run status stays `fail`.

### 2. Plan 3 — authority and context

Create `src/adapter/approval.js`, `context.js`, `instructions.js`, `handoff.js`.
Cases `02`, `07`, `08`, `14`, `15` — 61 assertions. Ends by moving §10's status
table, which must not be touched before then.

Target: 183 of 183, run status `pass`, item 13 closable.

### 3. Platform evidence — item 38

`unverified` on every platform in every adapter manifest is currently correct.
Item 13 needs one native platform; a consumer needs three. Tracked separately.

### 4. Concurrent invokes — item 37

Never exercised. Item 7 covered core mutation concurrency, which is a different
boundary. Tracked separately.

### 5. Downstream

PropertyCompass integration (item 23) and marketplace publication (item 22)
follow, both blocked behind a passing conformance run.

## Authoritative facts

- **Canonical test command:** `TMPDIR=/tmp node --test test/*.test.js`
- **Node 20 location:** `/opt/homebrew/opt/node@20/bin/node` (Homebrew keg, not on PATH)
- **Never `git stash` in this repository** — several worktrees share one stash stack.
- **`spec/adapter-reference.js` is an independent oracle.** Never modify it; never
  import it into `src/`. Importing it would make the vectors tautological.
- **`src/` imports nothing from `test/` or `spec/`.** Verify with
  `grep -rn "from '\.\./\(test\|spec\)/" src/` returning nothing.
- **The fixtures are normative.** Where contract prose and a fixture disagree, the
  fixture wins.
- **§10's status table moves only at the end of Plan 3**, when all 15 cases pass.

## References

- Adapter contract: `docs/adapter-contract.md` (normative)
- Plan: `docs/superpowers/plans/2026-08-06-claude-code-adapter-negotiation.md`
- Plan 1 handoff: `docs/handoffs/2026-08-06-adapter-plan-1.md`
- Vectors: `spec/fixtures/adapters/` (15 cases, 183 assertions)
- Implementation runner: `spec/run-adapter-implementation.js`
- Reference runner: `spec/run-adapter-vectors.js`
- Ledger: item 13 `ledger/2026-08-04-claude-code-adapter.md`, plus items 37 and 38

## Prompt for next session

```
Context: continuing wowbagger. Claude Code adapter Plan 1 is delivered; the
conformance run sits at 79/183 with 1 of 15 cases passing. Plan 2 (invoke and
forwarding) and Plan 3 (authority and context) remain.

Read first:
1. docs/handoffs/2026-08-09-adapter-completion.md (this file)
2. docs/superpowers/plans/2026-08-06-claude-code-adapter-negotiation.md,
   "Follow-on Plans"
3. ledger/2026-08-04-claude-code-adapter.md (item 13 acceptance criteria)
4. docs/adapter-contract.md §3 and §10

First action: run TMPDIR=/tmp node spec/run-adapter-implementation.js and read the
per-case status. Trust that output over any prose, including this file.

Success: 183/183 evidenced, run status pass, §10's Claude Code column off
Unverified, item 13 closed.
```
