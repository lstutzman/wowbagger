# SDD ledger — plan: docs/superpowers/plans/2026-08-30-duplicate-number-recovery.md

## Preflight consistency scan

| Task(s) | Shared file/interface | Finding |
|---|---|---|
| 1 | `src/claim-request.js`, `src/cli.js`, `src/ledger-repair.js` | Task 1 owns the new `ledger-repair` v1 request/response seams and command registration; later tasks consume the exact functions. |
| 1 → 2 | `ledger-repair` v1 request/response | Task 2 consumes strict request validation and adds read-only proposal output without changing the command shape. |
| 1 → 4 | `src/claim-journal.js` and repair domain | Task 4 adds repair journal entries after Task 1 establishes domain envelopes; no core v5 entry changes are intended. |
| 2 → 3 | proposal snapshot and duplicate groups | Task 3 validates an explicit mapping against Task 2's full snapshot and complete duplicate set. |
| 2 → 5 | invalid-ledger proposal loader | Task 5 consumes raw parseable items and duplicate-only error gating to bypass ordinary valid-ledger mutation refusal. |
| 3 → 5 | candidate bytes and revisions | Task 5 publishes only candidates that Task 3 validated under the current lock. |
| 3 → 4 | candidate revisions | Task 4 stages the exact candidate bytes from Task 3; no candidate is staged before complete validation. |
| 4 → 6 | staged manifest and intent/final records | Task 6 consumes durable candidate staging and resolves all crash states; it must not invent a second recovery store. |
| 5 → 6 | repair publication state | Task 6 recovers the same apply operation after partial publication, response loss, or missing terminal. |
| 5 → 7 | CLI and response domain | Task 7 documents the public commands and exact `ledger-repair` v1 relationship to core v5. |
| 6 → 7 | recovery token and auto-commit | Task 7 documents exact item/log commit sets and `mutation-finalize` behavior after Task 6 proves it. |
| 7 → 8 | shipped docs and package files | Task 8 cuts the reviewed release and must not move version metadata before Task 7. |
| 5 → 8 | final acceptance | Task 8 verifies empirical invalid-ledger bypass, same-clone fencing, and no unsupported recovery claim. |

| Task | Internal consistency | Finding |
|---|---|---|
| 1 | Pass | New request validator, response domain, and schemas are one public surface. |
| 2 | Pass | Proposal is read-only and refuses valid/non-duplicate-invalid ledgers. |
| 3 | Pass | Every mapping witness is checked before bytes are changed; full successor validation remains mandatory. |
| 4 | Pass | Staging precedes intent and intent precedes publication; exact candidate bytes remain recoverable. |
| 5 | Pass | Apply bypasses only duplicate-number invalidity and remains lock/CAS guarded. |
| 6 | Pass | Recovery is idempotent and distinguishes expected/candidate/third revisions. |
| 7 | Pass | Docs correct the published warning and expose repair v1 without changing core v5. |
| 8 | Pass | Release, ledger completion, and push are explicit protected side effects. |

Ruling: Use separate `ledger-repair` contract v1 rather than a core v6 command — Lee selected this option; it keeps existing core v5 and adapter command semantics stable while giving invalid-ledger recovery an explicit domain — cost if wrong: the repair command needs its own discoverability and compatibility story and is not in the core v5 command list.

Ruling: Repair the complete duplicate set in one apply request — a one-item repair cannot produce a valid complete ledger when another duplicate group remains — cost if wrong: multi-item candidate staging and recovery are more complex than sequential repair, but sequential repair cannot satisfy the complete-successor validation requirement.

Ruling: Proposal chooses the lexicographically smallest ULID to retain each duplicated number and assigns replacements above the current maximum; callers may submit different explicit replacements only after under-lock collision and full-ledger validation — cost if wrong: proposal defaults may differ from business preference, but no unsafe number is silently selected.

Ruling: Preserve ULID relations and reject opaque number-bearing foreign references rather than rewriting arbitrary body or extension text — code confirms `depends_on`, `related`, and `parent` store ULIDs; the reported emergency changed numbers only — cost if wrong: consumers with custom numeric references need a separate reference-aware repair instead of an unsafe guess.

Ruling: Use a bounded staging directory under the shared Git common directory — item candidates must survive a process crash and remain visible to sibling worktrees — cost if wrong: abandoned staging requires explicit cleanup and no-follow validation, but request-only recovery cannot safely resume a partial publication.

Ruling: Keep the alpha14 hard-cutover and existing duplicate warning correction as the release baseline; alpha14's normal create fence is bypassed only inside the duplicate-number-only recovery command — cost if wrong: repair must be independently versioned and upgraded with its package, while old cores continue refusing the new journal grammar safely.

Task 1 dispatch attempt 1 failed after reading only the brief and exited without changes or report. Worktree remained clean; no unreviewed residue exists. Re-dispatching with a tighter execution brief.

Task 1 dispatch attempt 2 failed before edits with provider rate-limit `429`; no residue exists. Inline execution is authorized by the ordered user request because native worker capacity is unavailable; retain the same RED-GREEN-review gates.

Ruling: Execute #182 inline after native worker failure — no external worker can currently be scheduled, and the approved design/plan are complete — cost if wrong: controller context carries implementation details, so every cycle still requires explicit RED, focused GREEN, and review before the next task.

Task 1 review worker failed before review with provider rate-limit `429`; no review output was produced. Inline review substitution is required for this task; no external model is available.

Task 1: complete (commits d350b5e..d5f36f1, inline review substituted after reviewer 429; focused current Node 90/90 and Node 24 90/90).
Task 1: inline review found no Critical/Important issue. The task's temporary stage-not-installed refusal is intentional until proposal/apply tasks replace it; schemas/index and existing work-claim differential remain green.

Task 2 dispatch attempt 1 failed before edits with provider rate-limit `429`; no residue exists. Continuing inline after the same worker-capacity failure as Task 1.

Task 2 dispatch attempt 1 failed before edits with provider rate-limit `429`; inline implementation followed.
Task 2: complete (commits d5f36f1..2313dcf, inline review; proposal tests current Node and Node24 pass; duplicate-only gate mutation failed and source restored).
Task 3: complete (stale snapshot/item witnesses, complete duplicate mapping, and replacement collision refusals; current Node and Node24 focused suites pass; inline review substituted after native review rate-limit failure).
