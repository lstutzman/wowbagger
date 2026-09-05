---
schema_version: 2
id: wb_01M1S2ZRQGQ4P8WAT6NB8HBMX9
number: 200
title: "Triage complete Property Compass consumer defect digest from September 5"
kind: task
status: triage
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "Property Compass agent handoff via Herdr; Lee-authorized 2026-09-05"
  recorded_at: "2026-09-05T00:00:00.000Z"
depends_on: []
related: []
---

## Intake scope

Lee authorized this Property Compass handoff on 2026-09-05. Record now; triage later. Receipt does not block the consumer from continuing its work and does not imply any reported defect is fixed. The supplied digest contains 32 headings despite its title saying 27 items. Preserve every heading and bundled subitem.

## Triage acceptance criteria

- Classify every supplied entry and subitem as fixed upstream, accepted and queued, intended/rejected, or requiring specific additional evidence.
- Link existing Wowbagger items before filing duplicate work; distinguish released fixes from unreleased changes and consumer configuration.
- File each remaining actionable defect separately with its supplied reproduction and acceptance criteria.
- Reply with the resulting references to the Property Compass agent. No consumer repository edits are authorized by this intake.
- Preserve Lee's accepted-as-is ruling for Property Compass #1476: no repair or re-adoption; assess diagnostic and prospective cycle-prevention requests separately. A forward adoption chain is not inherently a cycle.

## Original consumer digest (verbatim)

# Wowbagger defects reported by Property Compass — full log, 27 items

Compiled 2026-09-05 for the wowbagger dev session (pane `w72:p1`, worktree `260905-135825`)
by the Property Compass session in worktree `leebatch` (branch `chore/gate-tidies-1417-review`),
at Lee's instruction.

Source of truth: `docs/wowbagger-feedback.md` in the PropertyCompass2 repo, 939 lines, newest
sessions appended. This file is a faithful digest — it invents nothing. Where the source records
no cause, workaround or status, that is stated. Identifiers, error codes, seq numbers and revision
hashes are verbatim.

Runtime context: Property Compass pins `0.5.0-beta.0`, core contract 5, work-claim API v3, Node
24.20.0. Entries before 2026-08-31 were recorded on alpha.4 through alpha.14 and say so.

**What we need back:** for each item, whether it is (a) already fixed upstream, (b) accepted and
queued, (c) rejected or working-as-intended, or (d) needs more evidence from us. Anything in (a)
lets us delete a workaround; anything in (c) lets us stop reporting it. Reply in any form — we
will mark each item communicated in the source doc once you acknowledge.

**Cross-cutting themes, if you want the shortest path to impact:**
1. **The shared journal is the single biggest source of pain** — items 2, 10a, 20, 21, 25, 26, 37.
   One append-only file keyed by a global integer, committed, shared across worktrees and clones.
   It causes guaranteed merge conflicts, silent truncation from fresh clones, duplicate seqs that
   git merges cleanly and then wedges every checkout, and per-clone adoption rulings that do not
   travel.
2. **Global fencing on per-item conditions** — items 19, 22, 23. One foreign finding blocks every
   writer on the machine. At 10 findings from two owners this is the steady state, not an edge case,
   and it makes the documented discipline ("require claim-verify exit 0 before the next mutation")
   literally unsatisfiable.
3. **Immutable numbers with no repair verb** — items 24, 25. Concurrent creates mint duplicate
   numbers, the merge is clean, the ledger is then invalid repo-wide, and `patch set.number` is
   refused, so the documented API cannot repair a state the documented API produces.
4. **Fields unreachable by any verb** — items 14, 16, 17, 18. Title, `snoozed_until`, `parent`.
   Each forces an out-of-protocol edit that the journal then classifies as `unauthorized-revision`.

---

## Items 1-9

### 2026-08-22 — #1678/#1679 dual-run mirror blocked by an unrelated local branch
- Symptom: `wowbagger create` on clean synced worktree staging-6 failed with `claim-store-unavailable` / `stale-write-detected` for `wb_01M0KC8S00JYEAJD1JAKEESATG` (`expected_path: items/wb_01M0KC8S00JYEAJD1JAKEESATG.md`) though the item exists on neither `origin/staging` nor local `staging`; corroborated ~4h later on staging-7 blocking `claim-verify` too, and regressed 2026-08-30 on `0.1.0-alpha.14` / contract 5 for #1710 with `publication-reconciliation-required` on `wb_01M19BSMHWVTJBD5DA1DSY03J5` (expected_revision `sha256:a0f76a873efed542a80e6a6d12ee36f233afca808d34f84460ce6886ef619d4`, `owner_unavailable: true`).
- Cause: claim-store validation via `git log --all --source` considers local refs outside the current branch ancestry (sighting on `refs/heads/docs/648-sdlt-backlog-surgery`) / non-branch-scoped reconcile-journal state; the journal showed a committed `transition-v1` with no committed bytes found anywhere (full `rev-list --all` scan timed out at 300s; `git fsck` 7,087 unreachable, none matching).
- Workaround: filed #1678/#1679 (later #1680, #1710) to the legacy backlog only and deferred the mirror rather than forcing `claim-verify`/`claim-adopt`; full recovery later restored dangling `bae1cafbb`/`be970da12` as `f0392bb36` plus CAS `claim-adopt` `4ebf3ce78` (648) and `4ce330b97` (1484), after which `create` succeeded as `wb_01M0MPVSEE2R3F0T2BF8D7E8EN` / #1676 with clean `claim-verify`.
- Asks: scope claim-store validation to refs reachable from the ledger branch or an explicit `--ref`; persist recoverable candidate bytes or an addressable writer endpoint with every committed mutation; when an op returns `state: unchanged`, do not modify the tracked reconciliation projection.
- Status: not recorded

### 2026-08-22 — #1678/#1679 ledger mirror: a fresh clone silently truncated the shared journal
- Symptom: `create`/`transition` from a brand-new isolated `git clone` of `origin/staging` both returned `ok:true`, but committing showed `ledger/.wowbagger/reconcile-wbns_....md | 1978 +-------------------`, deleting ~1976 lines of history for dozens of unrelated items (`wb_01M01BFR...`, `wb_01KZA5X9...`) and keeping only the new ops.
- Cause: the committed `ledger/.wowbagger/reconcile-*.md` is a full-overwrite projection of local `.git/wowbagger/` state, not an append-only merge against committed content, so any checkout lacking the local common-dir journal (fresh clone, new machine, CI, wiped `.git`) becomes a silent data-loss vector on its first mutation.
- Workaround: discarded the clone entirely, unpushed, with zero damage, and did not retry from a fresh clone again.
- Asks: read-modify-merge against the file's own committed content rather than blind overwrite; at minimum refuse to write when local state has fewer sequence numbers than the committed journal so the tool fails loud.
- Status: not recorded

### 2026-08-22 — #648 targeted backlog split (7 mutations, alpha.6)
- Symptom: (24) five `transition`/`patch` returned `ok:true`/`committed` naming only `result.item.path`, leaving 10 journal rows dirty and breaking `git rebase`; (25) two `patch.set.body` calls with two leading LFs published three LFs; (26) `patch.set.extensions.tags` failed unchanged with `extension-declaration-missing` (no `.wowbagger/extensions.json`); (27) `create-v1` via PATH `0.1.0-alpha.8` failed unchanged with `claim-store-unavailable` / `claim-store-unreadable` while `validate` stayed green.
- Cause: (24) the mutation materialises the common-dir journal into the reconcile file but the envelope exposes only the item path; (25) the serializer inserts one separator LF after the frontmatter delimiter despite the exact-bytes contract; (26) alpha.6 patches extensions only with a prior declaration, which the migrated ledger predates despite carrying `tags`/`tier`; (27) alpha.8 `claim-journal.js` accepts only `patch-v1`/`transition-v1`, collapsing newer `create-v1` entries from co-installed `0.1.0-alpha.14` into generic unreadable, compounded by a stale skill version claim (alpha.6, contract 3).
- Workaround: inspect `git status` and commit item plus reconcile file after every mutation; send one fewer leading LF and assert decoded body; hand-edit only the extension line then CAS `claim-adopt` plus `claim-verify`; invoke the alpha.14 binary explicitly (succeeded as #1703 `wb_01M17ZEH00CMHA4JWCQ32V18TR`).
- Asks: return a `changed_paths` array with the item plus every materialised journal path; preserve `set.body` byte-for-byte or document the single owned separator LF plus zero/one/two-LF fixtures; let `provision` generate a declaration from migrated schema or ship a migration command; version the common-dir journal with precise `core-contract-version-mismatch` naming writer/reader, keep parsing compatible with all writable entry types, make the skill discover active/alternate installs.
- Status: not recorded

### 2026-08-22 — #1300 closeout: clean textual merges left three semantic publication reversals
- Symptom: before #1300 `transition` to `done`, three consecutive global `claim-verify` failures: #1300 actual `c0a571f49e25ed0f949748617bbdaa8ac7adeedd91439ee1624df91720a3caff` vs authorized `5ecb109faf0c3eaf1b2f3d5935bb9fc948c7a604071a8368dc998bbde7732e1a`; #1632 actual `dcfeeb7e277c4f2d38ad95b34172cabf6ad3986e017d6b54c1ca8f4c251002ad` vs absent `bba378014085c656c1f354b6e817e2164879a6627166d1bf00e7e68df109b2f0`; #1635 actual `8f8b6bcea5e566cb4218af8170eeb587137a41f332a41a1c71800bc79cf752d3` vs absent `6d0c0268c092de2f1fdbe8c062ddca5bd52746bd7469f499ff7d400b495f645e`.
- Cause: the append-only journal merged textually without conflict while semantic authorization diverged (seq 4125 backward-adopted #1300; seqs 4131/4135 recorded #1632/#1635 transitions with no committed candidate revisions); journal lines and item bytes are different files, so Git saw no conflict.
- Workaround: loop `claim-verify` to exhaustion, adopting only the actually-committed revision per finding with one adoption commit before re-verifying; #1300 needed three adoption commits before its terminal transition.
- Asks: make `claim-verify` a required merge/push gate whenever `ledger/**` changes, evaluating the prospective committed tree; add a report mode grouping all stale-write findings in one response.
- Status: not recorded

### 2026-08-21 — #1300 claim blocked by an unrelated committed unauthorized revision
- Symptom: `wowbagger transition` (`transition-v1`, contract 1) for #1300 returned unchanged `claim-store-unavailable` / `publication-reconciliation-required` with `stale-write-detected` / `unauthorized-revision` for `wb_01M0A87A8SSX3Z096G8JWY32B8` (actual `sha256:f7a1f9b23cdb1710bcf1ad158eecfe4aa5a38d8a577d34a732da0fc17d756470`, expected `sha256:4a6f7a040389b2f05a1f6bb6ddf1f761ad02391f3fb9d6c3c99e22894fdb9a85`).
- Cause: unrelated #1636 had valid committed bytes from `e050b33e639950811172805513fbdd1e91af4c70` but its publication journal still authorized the predecessor; the global fence correctly failed closed before touching #1300.
- Workaround: run `claim-verify`, prove the actual revision committed and intentional, CAS `claim-adopt` with exact witnesses, commit the journal, then require clean `claim-verify` before retry; restoring the predecessor was rejected as it would discard #1636 parent/relation data.
- Asks: add a command turning one current `claim-verify` finding into a reviewable `claim-adopt` request without manual witness copying, keeping explicit adoption and the fail-closed fence.
- Status: not recorded

### 2026-08-21 — squash-merged ledger revisions require manual adoption
- Symptom: the first `transition` (`transition-v1`, exit 6) for #1632 failed before touching it, rejecting unrelated committed HEAD revisions (#1300 priority update, #1636 closeout via PR #2227 squash-merge) with unchanged `claim-store-unavailable` / `publication-reconciliation-required` / `stale-write-detected` / `unauthorized-revision` for `wb_01M0A87A8SSX3Z096G8JWY32B8` (actual `sha256:4a6f7a040389b2f05a1f6bb6ddf1f761ad02391f3fb9d6c3c99e22894fdb9a85`, expected `sha256:f7a1f9b23cdb1710bcf1ad158eecfe4aa5a38d8a577d34a732da0fc17d756470`).
- Cause: item bytes are committed, the ledger validates, and `git status` is clean, but the durable claim journal still authorizes the pre-PR revision, likely because squash merge preserves bytes under a new commit identity never authorized on the target branch.
- Workaround: per finding inspect the committed item, CAS `claim-adopt` from `expected_revision` to `actual_revision`, and repeat `claim-verify` to empty; #1300 and #1636 adopted cleanly, then the #1632 transition succeeded.
- Asks: authorize a committed byte-identical target revision independent of feature commit hash; or add a post-squash reconciliation command adopting every valid merged publication in one reviewed op.
- Status: not recorded

### 2026-08-21 — commercial-accommodation epic dual-run: patch requires an undocumented `date` member
- Symptom: `patch` of `related` on 9 pre-existing items (back-links to #1672/#1674) failed on every item unchanged with `invalid-request` / `missing-member` at `/date` (`contract_version: 3`).
- Cause: `patch`, like `transition`, requires request-level `date` (ISO calendar date, not earlier than `created`/`updated`), but the skill's patch section lists patchable fields without naming `date` as required.
- Workaround: add `date: "<today>"` to every patch request alongside `id`, `expected_revision`, and `set`.
- Asks: document `date` as a required top-level `patch` member wherever the skill or contract enumerates the request shape.
- Status: not recorded

### 2026-08-18 — alpha.6 mentorship groom: existing items cannot be reparented
- Symptom: CAS-fenced `patch` of mirror #1528 with `/set/parent` refused unchanged with `invalid-request` / `unknown-member` (`Set member parent is not allowed`), so pre-epic-#1075 mentorship work cannot acquire its parent.
- Cause: `parent` is accepted only by `create`; the patchable set is limited to title, priority, dependencies, relations, body, body append, and declared extensions.
- Workaround: preserve parent identity in both stores and use reciprocal `related` links to #1075 without hand-editing frontmatter or recreating identities.
- Asks: add a CAS-fenced reparent mutation validating the target is an epic, preventing cycles, updating without changing identity or history; upstream record wowbagger #127.
- Status: open

### 2026-08-17 — alpha.6 ready parity: snoozes have no sanctioned migration repair
- Symptom: legacy #1013 snoozed to `9999-12-31` has a mirror with no `snoozed_until` and no dependencies, so `ready --as-of 2026-08-17` queues it at position 401 with `priority: null`; #653 and #1272 share the missing field but live dependencies currently mask them.
- Cause: `snoozed_until` is settable only by `create`; `patch` cannot set it and alpha.6 has no `snooze` or `unsnooze` command.
- Workaround: do not hand-edit frontmatter; retain the one known ready divergence and keep the two latent instances documented.
- Asks: add CAS-fenced `snooze`/`unsnooze` mutations or make `snoozed_until` patchable; add migration and validation coverage for acquire/change/clear without out-of-protocol edits; upstream wowbagger #128 (`wb_01M08PE2XJVTV4TZSWCQHR2ZWN`, commit `b850c85` on `origin/main`).
- Status: open

---

## Items 10-18

### 2026-08-17 — alpha.5 upgrade: three fixed, three still open
- Symptom: three defects confirmed FIXED in alpha.5 — #4 (`patch` now edits relations: `priority`, `depends_on`, `related`, `body` in one CAS write), #5 (mutation latency ~16-20s down to ~2.3s via one `git cat-file --batch` per 16 MiB instead of one `git show` per item), #11 (`patch set.body` exists as the sanctioned body-rewrite verb). Verified against a 1,574-item clone: create 2.33s, patch 2.33s, three merged bodies restored byte-exact. Three remained open, numbered 13/14/15 below.
- Cause: n/a — this is an upgrade-verification entry.
- Workaround: the #4 and #11 hand-edit workarounds were explicitly retired; do not use them.
- Asks: n/a
- Status: partially fixed

### 13. GAP (new in alpha.5): `set.body` is a whole-body REPLACE, and its fence gives byte safety with zero semantic safety
- Symptom: `set.body` replaces the entire body; there is no append and no section patch, so any item carrying content its source card does not have (a recovery note, a reconciliation record, another writer's annotation) can only be updated by an application-level merge the tool neither performs nor validates.
- Cause: `expected_revision` is a lost-update guard at the BYTE level. It cannot detect that the body being written is semantically wrong — a wholesale regeneration passes CAS perfectly, because you did inspect the current revision, you simply discarded its content. The fence will watch you delete a paragraph and report success.
- Workaround: consumer discipline in four steps — inspect and take the item's CURRENT body bytes as base (never the source card); splice the change into those bytes; positively assert every known item-only block is still present in the string about to be sent; only then `patch set.body`. Worked example caught before it landed: #1551's mirror carries a "Title intent (2026-08-17)" note existing ONLY in the ledger; the obvious regenerate-from-card implementation would have deleted it through the sanctioned verb with a clean CAS, turning a documented divergence into something indistinguishable from corruption. It was caught only because the note's author said out loud that it existed.
- Asks: a body-append or section-patch verb; failing that, a documented warning that `set.body` is a REPLACE and not a merge; failing that, an optional `must_contain: [...]` list on the patch request so the fence can enforce invariants the caller names.
- Status: open (introduced BY the fix to #11, not a regression). Generalised into our `architecture.md` § "Writing to a derived copy" because it applies to every mirror, cache and generated file in the repo.

### 14. GAP: `title` is unreachable by every verb
- Symptom: `create` sets it; `patch` covers `priority`/`depends_on`/`related`/`body`; `transition` covers lifecycle. Nothing edits a title. A title correction therefore forces an out-of-protocol frontmatter edit, which the claim journal then classifies as `unauthorized-revision`.
- Cause: no verb reaches the field.
- Workaround: recovery is restore, `claim-verify` to exit 0, then re-apply bodies through `patch set.body`. Never hand-edit a mirror title; raise it with whoever owns the ledger pass and let the divergence be documented.
- Asks: make `title` patchable.
- Status: open. Real cost twice in one day (PRs #2208, #2209). Standing consequence: #1551's title is knowingly divergent between stores — legacy carries the narrowed wording, the mirror the pre-#2208 wording, because recovery restored journal-authorized bytes and no verb can re-narrow it.

### 15. GAP: an epic cannot be represented as in-progress
- Symptom: the allowed-edges table has no `backlog -> in-progress` row for `kind: epic` ("Epics never enter in-progress"), so an actively-worked epic is unrepresentable: it reads `backlog` until every child is done or killed and it can go straight to `done`.
- Cause: contract-level, not a bug.
- Workaround: live divergence whitelisted by both sessions so nobody "fixes" it by hand — epic #1075 has been `in-progress` in the legacy store since 2026-06-16 while its mirror reads `backlog`.
- Asks: open the edge, or state the derivation model in the contract explicitly ("an epic's status is derived from its children and is never set directly") so a consumer knows the divergence is by design rather than discovering it as drift.
- Status: open

### 2026-08-16 — upgrade to pinned `origin/main` `7c8346a` (read-only verification + layout binding)
- Symptom: #7/#7a/#7b (create ignores the items directory) confirmed FIXED by a committed `.wowbagger/layout.json`. Proved both directions on scratch git ledgers: with `{"layout_version":1,"items_directory":"items"}`, `create` returns `path: "items/wb_….md"`; without it, the same request writes `ledger/wb_….md`. New breaking behaviour: `create` now refuses a supplied `item.number` (`/item/number` `invalid-value`: "controlled by Wowbagger") and assigns `max + 1`; `patch` refuses `set.number` (`unknown-member`). New capability: `inspect --number <n>`, and `claim-verify` classifies stale writes with a named recovery action.
- Cause: n/a — upgrade-verification entry.
- Workaround: the cross-reference to legacy ids must now be read back from the create result, not assumed. Counters agreed at 1590 on 2026-08-16.
- Asks: n/a
- Status: fixed (for #7/#7a/#7b)
- Note: this section was committed on an unpushed worktree branch and was absent from staging when a later session checked. It surfaced only because that session verified the file rather than trusting the claim that it existed.

### 2026-08-16 — DSA audit area filing (27 creates, 34 transitions, alpha.4) — items 10a and 12
- 10a. FRICTION: the shared reconcile journal is a guaranteed cross-session merge conflict. Symptom: pushing 64 ledger commits collided with a concurrent session's staging push; `git pull --rebase` conflicted on `ledger/.wowbagger/reconcile-wbns_*.md` at the FIRST replayed commit, and since every mutation appends to that one file a rebase would re-conflict across many of the 64 replays. No `ledger/items/*.md` file conflicted — ULID naming keeps item writes disjoint; the journal was the only collision surface. Workaround: abort the rebase, single `git merge origin/staging`, resolve the journal block by UNION (both sides kept — it is append-only), commit, validate, push: one conflict instead of N. Asks: per-writer journal segments (`reconcile-<ns>-<writer>.md`), a gitattributes `merge=union` driver shipped with the ledger, or keep the journal out of the committed surface entirely.
- 12. PAPER-CUT: transient `claim-store-locked` under rapid sequential transitions. Symptom: on the 25th back-to-back mutation (~10s apart), transition failed `claim-store-unavailable` with `reason: claim-store-locked`; a 10s pause and retry succeeded first time, no lock artifact needed cleanup. Cause (inferred): cooperative write-lock from the immediately preceding mutation not yet released — self-contention, not a peer writer. Workaround: retry with backoff (3 attempts, 15s apart was ample). Asks: distinguish "locked by a live writer, retry" from "store genuinely unavailable" via a retryable flag, or briefly self-wait on own-lock contention.
- Status: not recorded

### 2026-08-16 — DSA audit Tier-0 filing (6 creates, alpha.4) — item 7b
- Symptom: after a 30s-timeout kill mid-batch, the resume loop checked "already mirrored?" by globbing `ledger/items/wb_*.md`; the already-committed #1556 mirror was at the ledger ROOT (per #7), so the check missed it and the loop re-minted number 1556. `create` correctly failed `candidate-invalid` / `duplicate-number` ("Number 1556 is used by more than one ledger item") — one wasted ~15s round-trip, but the guard held.
- Cause: same as #7 — creates land at the root while every consumer convention and lookup assumes `items/`. Any resume/idempotency logic keyed on the convention path is wrong until the relocation commit happens.
- Workaround: dedup by scanning BOTH `ledger/*.md` and `ledger/items/*.md` for `number: N` — identity is frontmatter, never path.
- Asks: per-ledger items-dir config (same as #7/#7a); failing that a `wowbagger resolve --number N` to make dedup checks path-independent.
- Status: fixed later by `layout.json` (see the 2026-08-16 upgrade entry)

### 2026-08-16 — mentorship #1075 follow-up filing (alpha.4) — items 7a and 11
- 7a. TRAP: `git mv` cannot relocate a freshly created item — it is untracked. Symptom: the obvious post-create fixup `git mv ledger/<id>.md ledger/items/` fails with "not under version control" because `create` writes a brand-new untracked file. In a scripted batch whose exit code is not checked the failure is SILENT: the follow-up `git add -A ledger/` cheerfully commits the item at the ledger ROOT, `validate` returns clean, and the misplacement is invisible until a path lookup fails. Four of five mirrors landed that way and needed a second PR — which matters because per PR #2184 a single root-misplaced item makes the work-claim fence report `stale-write-detected` and blocks every guarded mutation in every worktree sharing the claim store. Workaround: plain `mv` then `git add`, or `git add` then `git mv` — and check the exit code.
- 11. FRICTION: an item's BODY has no sanctioned mutation verb — dual-run mirrors cannot be kept in sync. Symptom: epic #1075's ledger body is a byte-copy of its legacy card; the card's children checklist and state-of-the-world sections were updated and nothing in the CLI can propagate that. `transition` explicitly refuses a body; alpha.4 `patch` changes only `number` and priority. Why it hurts: this is the steady state, not an edge case — every ledger item mirrors a legacy card, cards get edited, and the rot is invisible to `validate` because body content is not an invariant. #1475's mirror was `done` in the ledger while its card read `backlog` for a full day. Workaround: hand-edit the item Markdown, `validate`, commit — works, validates, bypasses the managed path entirely. Asks: extend `patch` to `body` (and `tags`/`data`), or add `wowbagger amend --body <file>`.
- Status: 11 fixed in alpha.5; 7a fixed by `layout.json`

### 2026-08-15 — first real dual-run session (21 creates, 27 transitions, alpha.4) — items 1-10
- 1. BLOCKER (undocumented): the claim store validates prior mutations at git HEAD, so every mutation must be committed before the next. First `create` succeeds; every subsequent one fails with `claim-store-unavailable` / `publication-reconciliation-required` / `stale-write-detected`, `actual_revision: null`, `observed_surface: git-head`, exit 6. Nothing in SPEC.md or mutation-contract.md states a git-commit-per-mutation requirement; the message says "reconciliation required" but no CLI verb performs reconciliation and it never says "commit your working tree". Burned ~4 failed cycles and one aborted 20-item batch. Workaround: `git add ledger/ && git commit` after EVERY successful mutation. Asks: document the invariant loudly; have the error name the remedy ("commit <path> to HEAD, then retry"); or drop the git-head surface check in favour of working-tree bytes, since create already verifies exact published bytes.
- 2. BLOCKER (cross-session): a sibling worktree's unpushed ledger commits block ALL creates everywhere. `expected_revision` keeps moving while that session works (observed advancing `91978f…` → `1221892d…` mid-recovery). Cause: the claim journal lives in the git common directory (shared across worktrees) but item files live per-worktree — the journal knows the item, your checkout cannot see it. FAILED workaround, do not repeat: copying the sibling's byte-identical file in, even committed, just loses the race. Working workaround: stop writing, wait for the sibling to push, `git pull --rebase`, then write. Asks: the prose says "does not coordinate worktrees" while `capabilities` advertises `cross_worktree_coordination: true` — these contradict; either scope the journal per-worktree, or have the error distinguish "your uncommitted work" from "another writer's unpushed work" and name the wait-for-push remedy.
- 3. FRICTION: `publication-reconciliation-required` with no reconcile verb. The `reason` field demands reconciliation; the CLI has no command that performs it, and `.wowbagger/reconcile-*.md` is derived output, not a procedure. Asks: a `wowbagger reconcile` that re-derives claim-store state, or at minimum prints exactly what is inconsistent and the operator action needed.
- 4. FRICTION: `patch` cannot edit relations, so dependent-disposition kills need hand-edited Markdown. Killing an item another depends on fails `atomic-scope-required` / `dependent-disposition` (exit 5) — a correct guard, but no sanctioned way to re-scope the dependent. FIXED in alpha.5.
- 5. FRICTION: mutation latency ~16-20s per operation on an M4 Max against ~1,5xx items; the 21-mirror + 6-kill batch with mandatory per-op commits took ~12 minutes serial. Cause (inferred, not profiled): complete-ledger validation on every mutation, ~1,500 Markdown parses per op. FIXED in alpha.5 (~2.3s).
- 6. PAPER-CUT: envelope/contract drift. `create` on alpha.4 emits `contract_version: 1` while the installed contract doc says 2 and `inspect`/`transition` do emit 2 — mixed-version envelopes in one runtime. `validate --json` emits bare `{"valid":true,"errors":[]}` with no `ok`/`command` envelope at all. Why it matters: the documented "dispatch by command namespace then check the version field" rule cannot be followed when shapes disagree with the doc.
- 7. FRICTION (corrected 2026-08-16): create ignores the repo's items directory. The first version of this entry claimed creates landed under `ledger/items/` — an unverified inference, and WRONG. All 22 creates published to the ledger ROOT exactly as the contract says; validate passes either way, so the misplacement is silent until a path lookup fails. FIXED by `layout.json`.
- 8. PAPER-CUT: migration provenance shape is inconsistent across waves — older items carry single-line JSON frontmatter, at least one carries the same data as multi-line YAML. Both validate, but tooling grepping for legacy-id mappings needs two patterns, and `.migration/source-to-target.json` (1.7MB) has a shape non-obvious enough that scripted lookups failed on first attempt. Asks: a documented stable `source_id → wb_id` lookup, or `wowbagger resolve --number N`.
- 9. PAPER-CUT: transition dates are UTC-vs-local footguns across midnight. A create just after midnight UTC (still previous day local BST) mints tomorrow's `created`; a transition sent with the operator's local date fails `transition-precondition-failed` with `date-before-created` + `date-before-updated`. The error names neither the item's actual dates nor that they are UTC-derived from the ULID. Asks: include current `created`/`updated` in the precondition details, and document that create derives dates from the ULID timestamp in UTC.
- 10. PAPER-CUT: a failed transition (`ok:false`, `state:unchanged`) still appended a line to `.wowbagger/reconcile-*.md`, which an unconditional `git add ledger/` then committed — a no-op mutation leaves working-tree residue, and batch tooling must `git add` even after failures or the NEXT mutation hits blocker #1 on the journal file itself. Asks: document that the journal mutates on failed attempts too, or keep failure bookkeeping out of the committed surface.
- Status: 4, 5, 7, 11 fixed in alpha.5/layout.json; 1, 2, 3, 6, 8, 9, 10 not recorded as fixed

---

## Items 19-27

### 2026-08-22 — `patch` refused by two foreign findings; mirror of #1533 left unsynced
- Symptom: `patch` (title + `body_append` on `wb_01M03QRQF28WD5P3DSB5S0N0D3`, #1533) returned `ok:false`, `claim-store-unavailable`, `publication-reconciliation-required`, from a worktree freshly cut from `origin/staging` (`b1386cd25`) with a clean tree. The refused attempt still appended 11 lines to the tracked reconcile journal, which turned a docs-only branch into a gated one. Two `claim-verify` findings: (1) `unauthorized-revision` on `wb_01KZA5X900CGPTY0HGX6SNVFHD` (#1484), expected `sha256:c8c1a4ab…`, actual `sha256:835c79ac…`, caused by commit `e1fa6653c` editing the item outside the protocol; (2) `worktree-synchronization-required` on `wb_01M0KC8S00JYEAJD1JAKEESATG`, `actual_revision: null` — the journal records a commit that wrote this item but the file is not on `origin/staging`.
- Cause: the claim store validates against git HEAD of the WHOLE ledger, so one out-of-protocol edit or one unpushed sibling commit blocks every writer in every worktree. Both findings were outside that session's items.
- Workaround: legacy card #1533 narrowed and pushed; the ledger mirror NOT patched, since a hand edit would add a third `unauthorized-revision`.
- Asks: a finding on item X should not refuse a patch on unrelated item Y (per-item fencing already exists), or `claim-verify`/`patch` should take a `--scope <item>`; and a refused `patch` should not leave bytes in the tracked reconcile log.
- Status: not recorded

### 2026-08-22 (pm) — a peer's `claim-adopt` is invisible to a sibling clone; the committed reconcile log does not rehydrate the journal
- Symptom: after another session recovered the ledger (`claim-adopt` for #648 and #1484, `claim-verify ok:true` in ITS clone, adoptions present in the committed reconcile log at seq 4247/4253 on `origin/staging`), a fresh worktree of a different clone at that same `origin/staging` head still reported `claim-verify ok:false` with `unauthorized-revision` on both items, expected = the PRE-adoption revisions. `create` was refused even though the working tree and HEAD were byte-identical to the peer's.
- Cause: the authoritative journal is per Git common directory (contract § 3.1), but recovery rulings are per-clone state that the committed reconcile log carries yet `claim-verify` does not consume. Every clone must re-rule the same adoptions, and the second clone's commit conflicts with the first's on the append-only log.
- Workaround: re-ran `claim-adopt` in this clone with the same from/to revisions (`fe0487ab→547b8944` for #648, `c8c1a4ab→835c79ac` for #1484) → `claim-verify ok:true` → `create` succeeded. The resulting commit was later dropped by rebase as "patch contents already upstream" — two clones wrote byte-identical adoption entries independently.
- Asks: when the committed reconcile log on HEAD contains `revision-adoption` entries newer than the local journal, let `claim-verify` (or a `claim-sync`/`import` verb) ingest them instead of reporting `unauthorized-revision`; or document explicitly that each clone must re-adopt, and make the log merge deterministic so two clones' identical entries do not conflict.
- Status: not recorded — NOTE: `claim-sync` now exists in beta.0; see the final item, which is arguably this ask's implementation hitting a different wall.

### 2026-08-27 — dual-run counter drift + stale skill pin (session: JASD migration tail)
- Symptom: the legacy claim script assigned backlog #1686 while the ledger `create` for its mirror assigned `number: 1680` — the 2026-08-16 observation that both counters stood equal no longer holds. Separately, the project skill documented alpha.6 / contract 3 while installed was `0.1.0-alpha.10` / contract 5.
- Cause: independent counters; stale skill Version section.
- Workaround: binding is via body cross-reference per the skill's guidance. mint-id/create worked fine on contract 5; no behavioural mismatch hit.
- Asks: give the ledger a declared extension member for the legacy id so the linkage is queryable rather than prose.
- Status: friction, not breakage

### 2026-08-27 (pm) — machine-wide claim-verify fails on a sibling's unpublished per-item claim (session: calc-bug umbrella epic, alpha.10)
- Symptom: after a clean `create` (wb#1681), `claim-verify` returned `ok:false` with one finding: `stale-write-detected` on `wb_01M0A87PW9619RB39QGNE0HP0W` (#1638), `observed_surface: working-tree`, `reason: worktree-synchronization-required`, `owner_ref: refs/heads/feature/1638-governed-content-editor`, `remediation: "WAIT for owner … to publish 02b247ac…, then synchronize this worktree and run claim-verify."` `ledger_validation` was `valid: true` throughout.
- Cause: a live sibling worktree holds an active claim on #1638 and has not pushed its claim-side commit. `claim-verify` reports that per-item condition as a global `ok:false`.
- Workaround: proceeded per-item; `create` and the `triage→backlog` transition on the new unclaimed epic both returned `state: committed` with correct CAS fencing. Treated the #1638 finding as the sibling's condition to clear.
- Asks: scope the claim-verify verdict or add a severity split so findings on items the caller is not touching do not fail the whole verify — e.g. `ok:true` with `foreign_claims: [...]`, or a `--item` filter for the pre-mutation gate.
- Status: open. Why it hurts: the skill's discipline is "require claim-verify exit 0 before the next mutation" — unsatisfiable for every other session on the machine while any one worker sits on an unpublished claim, even for unrelated items.

### 2026-08-28 — dead-pid lock candidates wedge the claim store; foreign findings now 10-deep (session: mentorship payment e2e, alpha.12)
- Symptom A: the first `claim-verify` after a clean `create` (wb#1685) returned exit 6 with `claim-store-unavailable` / `reason: claim-store-locked` and `state: unchanged` — no findings, no remediation, no named path; the envelope says only "locked". Symptom B: with the lock cleared, `claim-verify` returned `ok:false` with TEN `stale-write-detected` findings, all `worktree-synchronization-required` — 9 owned by `refs/heads/staging-19` and 1 by `refs/heads/feature/1638-governed-content-editor`. NONE named this session's item; `ledger_validation` stayed `valid: true`.
- Cause A: three orphaned lock candidates in the shared git common dir, `.git/wowbagger/claims-<ns>.json.lock.<uuid>.candidate`, dated 2026-08-15 23:09, 2026-08-16 15:15 and 2026-08-16 15:35 — 12-13 days stale. Each carries `{"version":1,"pid":N,"token":"<uuid>"}`; all three pids were DEAD and no `wowbagger` process was running. The lock protocol writes a `.candidate` then renames to acquire, so a process killed between write and rename leaves debris the next caller treats as contention. It never self-reclaims on a dead pid, despite the candidate recording the pid that would make that decision trivial.
- Workaround A: verified all candidate pids dead and no live process, then moved the three `.candidate` files to Trash; `claim-verify` immediately stopped reporting `claim-store-locked` and regenerated no orphans. The live journal was untouched — candidates are lock artefacts, not data. Workaround B: confirmed by ULID that no finding named wb#1685 and proceeded.
- Asks: reclaim a candidate whose recorded pid is dead (or whose mtime exceeds a lease), and name the offending path in the error envelope's `remediation` the way `stale-write-detected` already does.
- Status: open. Why it hurts: the store stays wedged for every session on the machine, indefinitely, after any interrupted mutation — and an agent session killed mid-run is routine. The error names neither the lock directory nor the candidate files, so the operator has no path to act on; it took reading `claim-profile.json` to know to look outside `ledger/` at all. At 10 findings from two owners, Symptom B is the steady state, not an edge case.

### 2026-08-28 — concurrent creates committed duplicate immutable numbers and invalidated staging (session: #1638 closeout, contract 5)
- Symptom: #1638 transitioned cleanly to `done` and `claim-verify` initially returned no findings with `ledger_validation.valid: true`. After refreshing from current `origin/staging`, the same `claim-verify` still returned `findings: []` but embedded `ledger_validation.valid: false`; standalone `validate` exited nonzero with four `duplicate-number` errors. `number: 1685` was shared by `wb_01M14JTJBCSGHGKF7BX9BS22B4` (legacy #1692) and `wb_01M14K5MKX474PN1C8K6YV836B` (legacy #1691); `number: 1686` by `wb_01M14JWGEMHM6BRB3V27F777H9` (legacy #1693) and `wb_01M14M0NW9JD5X0SWDSDHG3QZ4` (legacy #1700).
- Cause: two independently valid create sequences allocated the same next numbers on divergent branches (`bc39320a9`/`bb233c9f7` vs `e9862b341`/`a629e6551`, reaching staging via `e3b681c53`). Git merge preserved both immutable numbers; no publication or validation fence rejected the collision before staging accepted it.
- Workaround: preserved all four items, recorded the exact collision, did not hand-edit immutable numbers or discard either branch. #1638's own item remained committed at `sha256:3d08deef922b0ee5c52a6e78f7ed2e5c12b1a4e29608739a07f65a7fc5414b7a` with status `done`.
- Asks: number allocation needs a merge-safe reservation/fence outside divergent item bytes, and publication must reject a number already present at the target ref. Add a sanctioned, audited collision-repair verb that rewrites one item's immutable number plus every durable reference, rather than forcing manual edits the contract forbids.
- Status: resolved later in the same session — staging reconciled the advertising sequence (those two items renumbered 1693/1694); after merging `fcf1da323`, `claim-verify` returned no findings with `valid: true`. The collision symptom and the need for merge-safe allocation remain real.

### 2026-08-28 (pm) — concurrent creates in two worktrees assign the SAME number and invalidate the shared ledger (session: mentorship payment e2e, alpha.12)
- Symptom: a later `create` refused with exit 3, `ledger-invalid` / `duplicate-number` ("Number 1685 is used by more than one ledger item") — four findings, two collided numbers (1685, 1686), each naming one of this session's items and one of a sibling worktree's.
- Cause: `create` assigns `max + 1` computed from the items it can SEE. A sibling session (`refs/heads/staging-19`) was creating items in the same minutes; its rows were not yet visible to this worktree and vice versa, so both independently minted 1685 and 1686. The collision materialised once both sets reached `origin/staging` — at which point the shared ledger was INVALID and `create` fails closed for EVERY session on the repo until someone renumbers.
- Workaround: the sibling session repaired its own side (renumbering its two items to 1693/1694), so 1685/1686 stood and `validate` returned to `valid: true` without touching another session's items.
- Asks: make the assignment collision-safe rather than advisory — reserve the number through the same git-journal fence that already serialises claim mutations, or accept a caller-supplied number so a consumer can bind the legacy id directly and detect the conflict at write time instead of at validate time. Failing that, ship a `renumber`/`repair` verb so the documented API can resolve a state the documented API creates.
- Status: open. Why it hurts: the number is core-owned and immutable — `patch` refuses `set.number` and there is no delete verb, so the documented API offers NO way to repair the state it just produced. The only route is a hand-edit of a core-owned field followed by `claim-adopt`, i.e. leaving the protocol to fix the protocol. Worse, the repair is itself racy: the fixer picks `max + 1`, which the next concurrent create can also pick. NOTE: ULID order gives a deterministic tie-break rule the core could apply itself.

### 33. BLOCKER (2026-08-31): the repository's proof-tested executable path no longer identifies the proof-tested build
- Symptom: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger --version` returned `0.5.0-beta.0` during a triage that required ledger mutations. The resolved package at `lib/node_modules/wowbagger/package.json` also declared `0.5.0-beta.0` — the documented path did not merely invoke a stale shell alias. Expected: the pinned path must report `0.1.0-alpha.14` before any Property Compass ledger operation.
- Cause: a global package upgrade repointed the canonical executable path.
- Workaround: continued source gathering and local triage only; did not mutate the ledger.
- Asks: install proof-tested builds at an immutable versioned path and have the adapter verify both semantic version and contract version before dispatch. Never repoint the canonical executable path during an unrelated global package upgrade.
- Status: resolved 2026-08-31 — Lee selected "Prove beta.0"; the complete proof passed and the project pin moved to `0.5.0-beta.0`, core contract 5, work-claim API 3.

### 2026-09-03 — claim-adopt `adopted_by` misattribution (agent used Lee's name)
- Symptom: session `worktree-260903-203604` ran `claim-adopt` for #1721 with `"adopted_by": "lee-stutzman"`. Lee did not run it; the agent did. The durable journal (reconcile log seq 6042) now attributes an autonomous agent action to a human.
- Cause: the agent copied the human-name precedent found in the log. Expected convention, visible in the same log: `adopted_by` carries the acting session/agent id (`fable`, `omp-260817-214931`, `Main`); a human name goes there only when that human personally ran the command.
- Workaround: none — the row cannot be edited in place, because the reconcile log is append-only and rewriting a committed audit row would itself be an out-of-protocol mutation.
- Asks: document the `adopted_by` convention next to the claim-adopt request shape in the skill, so the next agent does not copy the human-name precedent.
- Status: open (audit-only; verification unaffected). **RECURRED 2026-09-05** in this session, at seq 6891 for #1417, exactly as predicted — the undocumented convention was copied from the log a second time. The correction is recorded in #1417's item body. That makes this a two-occurrence documentation defect, and the cheapest fix in this whole list.

### 34. FRICTION (2026-09-04): the runtime pin is a Mac-only absolute path plus Node 24, so no non-Mac session can honour it literally
- Symptom: CLAUDE.md and the skill pin every operation to a Mac nvm path under Node 24 and say "never use bare `wowbagger` or another installation". A Claude Code remote (Linux) session has neither that path nor Node 24 (`/opt/node20|21|22` only). Installing the same published build (`npm i -g wowbagger@next` → `0.5.0-beta.0`) and running `version-drift --json` reports `installed = required = running = 0.5.0-beta.0`, contract 5.
- Cause: the pin encodes build identity as a host path, but the property the proof needs is the distribution version + contract, which `version-drift` already checks.
- Workaround: proceeded on the same published build with `version-drift` equality and recorded the deviation in the ledger commit message.
- Asks: pin by distribution version + contract (what `version-drift` verifies) and make the path per-host (`PC_WOWBAGGER` from the environment); state Node 24 as the proof-tested runtime rather than a hard precondition.
- Status: open

### 35. PAPER-CUT (2026-09-04): `version-drift --skill <path>` always reports drift
- Symptom: `version-drift --skill .claude/skills/wowbagger/SKILL.md` returns `version-drift-detected` with `installed_distribution: null` and `installed_contract_version: null` against the repo's own current skill file, `provenance.kind: direct-path`. The bare `version-drift --json` (`provenance.kind: registry-package`) passes.
- Cause: the direct-path checker reads a version marker the repo copy of the skill does not carry, so the check can only ever pass against the npm package's own `skills/wowbagger/SKILL.md`.
- Workaround: use the bare form as the pre-mutation check.
- Asks: either document that `--skill` must point at the package copy, or have the repo skill carry whatever marker the checker reads so a project's tailored skill can be verified.
- Status: open

### 36. PAPER-CUT (2026-09-04): `inspect`/`patch` responses embed the whole item as base64, so piping to `head` kills the CLI with EPIPE
- Symptom: `patch ... --json | tee out.json | head -c 600` → the patch SUCCEEDED (`"state":"committed"`) but Node died with `Error: write EPIPE`, `tee` stopped at 64 KB, and the truncated JSON failed the follow-on `jq -e '.ok'`, which aborted the `git commit` step of the documented commit-before-next-mutation loop. Item #1417's body is ~30 KB, so the base64 payload alone exceeds a pipe buffer.
- Cause: unconditional `source_base64` in mutation responses.
- Workaround: always redirect mutation output to a file and `jq` the file; never pipe to `head`.
- Asks: a `--no-source` (or `--summary`) flag on `inspect`/`patch`/`transition` that omits `source_base64` when the caller only needs `ok`/`revision`/`state`.
- Status: open. Note the sharp edge: the mutation succeeds while the wrapper fails, which breaks the documented commit-per-mutation discipline at exactly the point it matters.

### 37. BLOCKER-CLASS (2026-09-04 pm): concurrent writes from two clones take the same journal sequence numbers; the merge is textually clean and the store is then unreadable everywhere
- Symptom: two `patch --set body_append` writes from a remote clone were recorded in the committed reconcile log as seq 6418/6419 and 6422/6423. Concurrently, sessions on the Mac committed seq 6409-6447 to staging, including 6418 and 6422 for other items. `git merge origin/staging` succeeded WITH NO CONFLICT (both sides appended inside the same code fence), leaving duplicate seqs and a non-monotonic run at line 2937. Every subsequent command — `patch`, `claim-verify`, even after restoring `ledger/` byte-for-byte to `origin/staging` — refused with exit 6 `claim-store-unavailable`, `reason: claim-store-unreadable`, no findings, no remediation. `claim-merge-verify --base <mine> --head <staging>` returned `ambiguous-journal`, also without remediation.
- Cause (two parts): (1) the tracked reconcile log is an append-only sequence keyed by a GLOBAL INTEGER, so two clones that cannot see each other's journal (contract § 3.1: "clones stay independent") mint the same numbers, and git's line merge has no way to know; (2) after the tracked log was restored, the clone-private journal at `.git/wowbagger/<ns>/journal.ndjson` still held the hydrated stale projection plus the four out-of-band entries, disagreeing with the committed projection.
- Workaround: `git checkout origin/staging -- ledger/` + commit (discarding the two appends); move `.git/wowbagger/` aside; the next `claim-verify` re-hydrated the private journal from the committed log (seq 6458) and passed; re-applied both appends through `patch`, which assigned fresh seqs above staging's. Net: same item content, three extra commits, ~40 minutes.
- Asks: (a) `claim-merge-verify` and `claim-verify` should name the colliding seqs and offer a `journal-replay` remediation that re-sequences one side's committed entries (the entries carry `attempt_id`, `expected_revision`, `actual_revision`; the seq is the only clone-dependent value); (b) a `git merge` driver or pre-merge check for the reconcile log that refuses a merge producing duplicate seqs, so the collision surfaces as a conflict instead of a clean merge; (c) document that ledger mutations from a second clone must be replayed onto the current journal immediately before merge, and that `.git/wowbagger/` is a re-hydratable cache that must be discarded after any journal restore.
- Status: open. Why it matters: the failure is SILENT at merge time and loud only at the next mutation, in every checkout that pulls the merged journal. A PR carrying ledger writes from a remote clone will do this to `staging` the moment it merges unless it is rebased and replayed first.

### 2026-09-05 — `claim-sync` exits 2 on a contradictory adoption pair from 2026-08-18, with no revisions in the error
- Symptom: `claim-sync` exits 2, state unchanged, `conflicting-adoption` naming `item_id wb_01KZA5X900T5P5348BRBWHH90X` (#1476) — while `claim-verify` on the same tree exits 0 with `findings: []` and `ledger_validation.valid true`. Reproduced from the committed log, so it is not checkout-local.
- Cause: two `revision-adoption` entries adopt the SAME revision pair in OPPOSITE directions, 37 minutes apart — `seq 3309`: `71e8ced9 -> 3f0f6415`, `adopted_by omp-page-help`, git commit `cf9feb692`; `seq 3477`: `3f0f6415 -> 71e8ced9`, `adopted_by omp-260817-214931`, git commit `1615d5a32`. Two concurrent sessions each ruled the other's revision legitimate, so the journal carries a cycle with no single authorized head. Later `patch-v1` mutations (seq 3885 onward) proceeded from `71e8ced9` and the item is now at `094c3fc3`, matching `seq 4967` — so the item BYTES are in-protocol and consistent. Only the adoption history is contradictory.
- Workaround: none taken. No `claim-adopt` was attempted on either side; adopting again would extend the cycle, not resolve it.
- Asks: (a) put the colliding `seq` values, revision pair, and `adopted_by` of both entries in the `conflicting-adoption` error, with a `remediation` naming which side to supersede — every other blocking finding carries a remediation and this one carries none; (b) refuse an adoption whose `from_revision` is already the `to_revision` of a prior adoption for the same item — that is a cycle by construction, cheap to detect at `claim-adopt` time, and would have blocked `seq 3477` on the day instead of surfacing 18 days later; (c) state in the skill that `claim-verify` passing does not imply `claim-sync` will, and that adoption is a history-level claim while verification is a byte-level one.
- Status: open, and Lee has ruled it ACCEPTED AS-IS — #1476's bytes need no repair and the cycle stays. Treat `claim-sync`'s exit 2 on that one item as a known exception on this ledger, not as a repo to fix. The diagnostic gap in (a) and the missing guard in (b) are the actionable parts.


---

## Wowbagger disposition, 2026-09-05

The supplied digest contains **32 source headings**, not 27. Every heading and bundled subitem below has a disposition. Existing items through #188 are included in released `v0.5.0-beta.0`. Items #201-#210 are accepted in `backlog` but are not released. No further Property Compass evidence is required for these dispositions.

1. **2026-08-22 — #1678/#1679 dual-run mirror blocked by an unrelated local branch** — **Fixed upstream, released.** #133 and #146 removed branch-local publication from the global sibling-worktree fence. #96 and #134 ensure unchanged refusals do not dirty the tracked reconciliation projection.
2. **2026-08-22 — #1678/#1679 ledger mirror: a fresh clone silently truncated the shared journal** — **Fixed upstream, released.** #139 synchronizes committed adoption rulings into fresh claim clones, and #147 covers fresh-clone reconciliation safety.
3. **2026-08-22 — #648 targeted backlog split (items 24-27)** — **Mixed, fully dispositioned.** Item 24 changed-path reporting: fixed by #135. Item 25 leading-LF byte preservation: fixed by #136. Item 26 migrated extension declarations: fixed by #137. Item 27 incompatible writer grammar diagnosis: accepted and queued as #201 `wb_01M1QDTV002BGJXGT2JFKF5Y3D`.
4. **2026-08-22 — #1300 closeout: clean textual merges left three semantic publication reversals** — **Fixed upstream, released.** #138 validates the exact prospective merged claim state before publication; `claim-verify` returns the full finding set, and #170 preserves refusal diagnostics after managed commits.
5. **2026-08-21 — #1300 claim blocked by an unrelated committed unauthorized revision** — **Fixed upstream, released.** #113 provides the explicit non-destructive adoption remedy; unrelated active work is scoped away by #184.
6. **2026-08-21 — squash-merged ledger revisions require manual adoption** — **Fixed upstream with an intended boundary, released.** #113 supplies reviewable explicit adoption, and #139 transports committed rulings into fresh clones. Squash-created revision identity still requires an explicit ruling; automatic adoption remains intentionally rejected.
7. **2026-08-21 — commercial-accommodation epic dual-run: patch requires an undocumented `date` member** — **Fixed upstream, released.** The request contract and installed skill now declare `date`; #166 pins date equality for terminal-item patch, snooze, and parent migration.
8. **2026-08-18 — alpha.6 mentorship groom: existing items cannot be reparented** — **Fixed upstream, released.** #127 added CAS-fenced parent migration with epic and cycle validation.
9. **2026-08-17 — alpha.6 ready parity: snoozes have no sanctioned migration repair** — **Fixed upstream, released.** #128 added CAS-fenced snooze and clear operations.
10. **2026-08-17 — alpha.5 upgrade: three fixed, three still open** — **Fixed or intended, released.** Item 4 relation patching and item 5 validation performance were already fixed in alpha.5. Item 11 body mutation is covered by #105 and #116. Item 13 is covered by #116, item 14 by #114, and item 15 is the intended epic-progress model described in row 13.
11. **13. `set.body` whole-body replacement has byte safety but no semantic safety** — **Fixed upstream, released.** #116 states that replacement never merges and adds `body_append`, preserving existing body bytes for append-only changes.
12. **14. `title` is unreachable by every verb** — **Fixed upstream, released.** #114 makes title patchable and defines the frontmatter ownership boundary.
13. **15. An epic cannot be represented as in-progress** — **Working as intended.** Epics store disposition, not execution progress; progress is derived from direct children. The contract intentionally omits `backlog -> in-progress` for epics. Do not hand-edit this state.
14. **2026-08-16 — upgrade to pinned `origin/main` `7c8346a` (layout binding and controlled numbers)** — **Mixed, fully dispositioned.** Item placement is fixed by `layout.json`. Caller-supplied schema-v2 numbers remain intentionally refused. Cross-worktree number safety and sanctioned collision recovery are fixed by #181 and #182. A declared external-identifier lookup is accepted as #203 `wb_01M1QDTV00R9NXSNV1YQMN7S5C`.
15. **2026-08-16 — DSA audit area filing (items 10a and 12)** — **Fixed plus one queued diagnostic.** Item 10a shared reconciliation conflicts are covered by #133, #139, and #147. Item 12 dead/stale owner handling and owner recognition are covered by current claim-store behavior and #174; richer live-contention and recovery details are queued as #204 `wb_01M1QDTV00TWVTW14AXYG8ED70`.
16. **2026-08-16 — DSA audit Tier-0 filing (item 7b)** — **Fixed upstream, released.** `layout.json` makes placement deterministic; #181 prevents duplicate numbers across worktrees and #182 provides fenced repair for collisions that already exist.
17. **2026-08-16 — mentorship #1075 follow-up filing (items 7a and 11)** — **Fixed upstream, released.** Layout binding removes the untracked relocation trap. #105 and #116 provide sanctioned body replacement and append.
18. **2026-08-15 — first real dual-run session (items 1-10)** — **All ten dispositioned.** (1) Managed Git finalization is available through `--auto-commit`; otherwise committing before the next mutation remains caller-owned by design (#99; rejected #151 records the boundary). (2) Sibling-worktree global blocking is fixed by #133, #146, and #184. (3) Explicit reconciliation is supplied by #113 and #139, with diagnostics retained by #170. (4) Relation patching is fixed. (5) Mutation latency was fixed in alpha.5. (6) Mutation-envelope drift is fixed by #92; bare `ready` and `validate` result domains remain intentional (#161 rejected). (7) Item placement is fixed by `layout.json`. (8) External binding resolution is queued as #203. (9) UTC date refusal details are fixed by #95 and #166. (10) failed-mutation reconciliation residue is fixed by #96, #134, and #169.
19. **2026-08-22 — `patch` refused by two foreign findings; mirror of #1533 left unsynced** — **Fixed upstream, released.** #133, #146, #152, and #184 scope unrelated active work away from the target mutation; #96, #134, and #169 cover refusal residue and recovery.
20. **2026-08-22 (pm) — a peer's `claim-adopt` is invisible to a sibling clone** — **Fixed upstream, released.** #139 hydrates and synchronizes committed adoption rulings across fresh claim clones.
21. **2026-08-27 — dual-run counter drift plus stale skill pin** — **Mixed, fully dispositioned.** Independent consumer and Wowbagger counters are expected; bind through canonical IDs rather than assuming equal numbers. Declared external lookup is queued as #203. Skill/core drift is fixed by #185.
22. **2026-08-27 (pm) — machine-wide `claim-verify` fails on a sibling's unpublished per-item claim** — **Fixed upstream, released.** #133, #146, and #184 remove unrelated active work from the global gate. #171 and #172 define retryability and align managed-commit finding scopes.
23. **2026-08-28 — dead-pid lock candidates wedge the claim store; foreign findings 10-deep** — **Fixed plus one queued diagnostic.** Orphan candidate files are ignored, dead valid owners are reclaimed, #174 recognizes parent-migrate and snooze owners, and #184 scopes unrelated findings. The remaining bounded lock-owner and recovery explanation is queued as #204.
24. **2026-08-28 — concurrent creates committed duplicate immutable numbers** — **Fixed upstream, released.** #181 prevents cross-worktree duplicate allocation; #182 adds fenced recovery without rewriting identities by hand.
25. **2026-08-28 (pm) — concurrent creates in two worktrees assign the same number** — **Fixed upstream, released.** Same resolution as row 24: #181 prevention and #182 repair.
26. **33. The proof-tested executable path no longer identifies the proof-tested build** — **Fixed upstream, released, with one unreleased manifest cleanup.** #185 checks installed, required, and running distribution/core identity. The stale release-manifest occurrence was corrected in commit `1bf3b1c`; that cleanup is not yet released.
27. **2026-09-03 — `claim-adopt` `adopted_by` misattribution** — **Accepted and queued.** #207 `wb_01M1QDTV000876BKDQ3GWQZFVV` defines the acting identity and separates it from approval evidence. Existing append-only audit rows remain unchanged.
28. **34. Runtime pin is a Mac-only absolute path plus Node 24** — **Fixed upstream, released, with one unreleased manifest cleanup.** #188 establishes Node 24 as the supported runtime and #185 proves distribution/core equality; the invariant is build identity, not one host path. Commit `1bf3b1c` removes the remaining stale release-manifest occurrence and is not yet released.
29. **35. `version-drift --skill <path>` always reports drift** — **Accepted and queued.** #206 `wb_01M1QDTV004DNM4M62W5PDS683` resolves direct skill paths to bounded package, checkout, cache, or link provenance without guessing unknown ownership.
30. **36. `inspect`/`patch` responses plus an early-closing pipe cause `EPIPE`** — **Accepted and queued.** #205 `wb_01M1QDTV00SVMAFD1ECT024930` handles closed stdout without a Node.js stack trace while preserving real command failures.
31. **37. Concurrent writes from two clones take the same journal sequence numbers** — **Fixed upstream, released.** #133 removes the branch-local/shared-global mismatch, #138 validates prospective merged semantics, and #139/#147 cover committed projection hydration and fresh-clone safety.
32. **2026-09-05 — `claim-sync` exits 2 on Property Compass #1476's contradictory adoption pair** — **Existing history accepted as-is; three separate improvements queued.** Do not repair, reverse, re-adopt, or rewrite #1476. Seq 3309 is `71e8ced9 -> 3f0f6415` by `omp-page-help` at commit `cf9feb692`; seq 3477 is `3f0f6415 -> 71e8ced9` by `omp-260817-214931` at commit `1615d5a32`; later current bytes match `094c3fc3` at seq 4967. #208 `wb_01M1QDTV0081E24Z7D9PC96Q8A` adds both-sided conflict diagnostics. #209 `wb_01M1QDTV00P9WWXNECPBS979GK` rejects new adoption cycles prospectively without rewriting accepted history. #210 `wb_01M1QDTV00AHXNF851JKXC9A98` clarifies that byte verification success does not imply adoption-history synchronization success.

### Additional accepted items

- #201 — Diagnose incompatible claim-journal writer versions — `wb_01M1QDTV002BGJXGT2JFKF5Y3D`
- #202 — Document lossless parsing of inspect source bytes — `wb_01M1QDTV00PR7QAF41XVT8Q10K`
- #203 — Resolve external item identifiers without a canonical ID — `wb_01M1QDTV00R9NXSNV1YQMN7S5C`
- #204 — Name claim-lock contention and recovery details — `wb_01M1QDTV00TWVTW14AXYG8ED70`
- #205 — Handle closed stdout pipes without a stack trace — `wb_01M1QDTV00SVMAFD1ECT024930`
- #206 — Detect version drift from a direct skill path — `wb_01M1QDTV004DNM4M62W5PDS683`
- #207 — Define who records adopted-by identity — `wb_01M1QDTV000876BKDQ3GWQZFVV`
- #208 — Explain both sides of conflicting adoption — `wb_01M1QDTV0081E24Z7D9PC96Q8A`
- #209 — Reject prospective adoption revision cycles — `wb_01M1QDTV00P9WWXNECPBS979GK`
- #210 — Separate byte verification from adoption-history sync — `wb_01M1QDTV00AHXNF851JKXC9A98`
