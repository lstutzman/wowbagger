# Fenced work claims via a merge-coordinated git journal — design and adversarial review

**Status: decision recorded; implementation deferred until this doc is approved.**
Item 17. Produced 2026-08-10 by two independent agents (one designing, one
attacking) plus two maintainer decisions that resolve the review's blockers.

The design is deliberately **not** the contract's strict `fenced` /
`safe_exclusive_dispatch: true` backend. It is a new, honest capability:
`mode: "merge-coordinated"`, `safe_exclusive_dispatch: false`. That boundary is
confirmed by the maintainer and recorded at the end; it is what makes the
design buildable without a true single-point transactional atomic commit.

---

## Part 1 — the design

# A git-derived, merge-coordinated work-claim journal (Option 2)

## 1. Decision record (maintainer-confirmed)

- **Trust model:** claims protect *cooperative* agents whose writes converge
  through git. The backend advertises `mode: "merge-coordinated"` and
  `safe_exclusive_dispatch: false`. It is **not** a guarantee against a
  hostile, crashed, or force-pushing writer — the same honest posture the
  repository already takes with `power_loss_guarantee: none` and
  `noncooperating_writer_protection: false`.
- **Coordination layout (option ii):** instantaneous coordination state lives
  in the shared git common dir (so worktrees coordinate fast, as today), and a
  **plaintext, tracked, git-mergeable reconciliation log** is committed with
  the ledger so agents reason over and merge a real diff. Claims never enter
  portable Markdown item fields (ADR 0004 stays intact).
- **No true atomicity is required:** correctness comes from the ability to
  *reconstruct* authoritative state afterward by replaying the journal + the
  committed ledger and reconciling the log. Stale-late-write *detection* is
  post-hoc; it is never a preventive atomic fence.

## 2. The two durable inputs

1. **git-backed ledger** — authoritative published item bytes, already in git.
2. **durable, append-only claim journal** — claims, epoch high-water marks,
   clock floor, and publication outcomes.

Reconstruction is **detective, not preventive**: a stale worker's late write
*can* land on disk, but the reconciler detects it and refuses to treat it as
authoritative.

### Journal location and format

- **Instantaneous state:** `<gitCommonDir>/wowbagger/<namespace>/journal.ndjson`
  (append-only, one JSON object per line). Worktrees already share the common
  dir and `resolveGitCommonDir` already resolves it; no new discovery
  machinery. Appends are fsync'd before any decision is returned.
- **Snapshot/memo:** `<gitCommonDir>/wowbagger/claims-<ns>.json` retained for
  O(1) reads, but **not authoritative** — rebuilt by replay when missing or
  inconsistent with the journal tail.
- **Mergeable reconciliation log (tracked in git):** a plaintext
  `.wowbagger/reconcile-<ns>.md`-style log is committed with the ledger and
  carries the journal tail entries in a diff-mergeable form. This is what
  agents merge when worktrees converge; it gives git a real plaintext diff to
  reconcile instead of binary claim bytes. It is derived from the journal, so
  a fresh clone recovers the log while full coordination state also lives in
  the common dir.

### Entry vocabulary

| type | purpose | key payload |
|---|---|---|
| `clock` | monotonic floor advance on a rejected decision | `now`, `floor` |
| `claim` | acquire / renew / release / takeover | `item`, `op`, `owner`, `lease_ms`, `expected`, `last_epoch`, `active`, `floor`, `outcome` |
| `publish-intent` | claim-protected publication intent (log-first) | `item`, `operation_id`, `operation_digest`, `fence{owner,epoch}`, `expected_revision`, `candidate_sha256`, `floor`, `state:"pending"` |
| `publish-final` | terminal publication outcome | `operation_id`, `outcome`, `committed_revision`, `floor` |

Replay is a pure fold through the existing deterministic transitions in
`src/claim-operations.js`, so replayed state is byte-identical to what the
deciding process computed.

## 3. Acquire / renew / release / takeover

Under the single serializing namespace lock (the existing `withClaimLock`):

1. Replay tail → current state.
2. `effective_now = max(physical_utc, clock_floor)`.
3. Run the existing transition → `S_next`, envelope.
4. Append the `claim` entry (with floor + outcome), fsync. On rejection that
   advanced the floor, still append so the floor is durable. Append/fsync
   failure → fail closed, exit 6 `clock-floor-persistence-failed`.
5. Rebuild the snapshot memo; return the envelope.

Lock order stays global coordinator lock → per-ID ledger locks (the ordering
the multi-item design established), so fencing and normal mutation cannot
deadlock.

## 4. publish-claimed

1. Validate schema/canonical/digest/binding → `unchanged`.
2. Idempotency lookup by `operation_id` inside the lock (fold
   `publish-*` entries). Same digest + terminal `committed` → return stored
   envelope, no second write. Same ID, different digest → exit 4
   `idempotency-conflict`. Dangling `publish-intent` → recover (§5).
3. Persist floor (fail closed on non-durable).
4. Fence check: namespace == item == active claim == owner == epoch ==
   unexpired → else exit 4 `claim-fence-rejected` with the contract's ordered
   `details.reason`.
5. Revision check vs `expected_revision` → else exit 4
   `ledger-revision-conflict`.
6. Append `publish-intent` (pending), fsync.
7. Write candidate bytes via the exact same same-path atomic rename + exact
   read-back already used by mutation. This step is **not** atomic with the
   journal by design.
8. Append `publish-final` (committed, committed_revision), fsync.
9. Return the contract success envelope.

`ledger-publication.read` becomes implemented: fold the journal for
`operation_id` → terminal outcome, or exit 2 `operation-not-found`.

## 5. Crash recovery and reconciliation

`wowbagger claim-verify --ledger <path>` (deterministic, fail-closed):

1. Take the namespace lock; replay the journal → rebuild snapshot
   (clock_floor, claims, operations, pending intents).
2. Load the ledger from the working tree and from git `HEAD`.
3. Resolve pending `publish-intent`s:
   - candidate == actual bytes AND no higher-epoch takeover journaled after →
     roll forward (append `publish-final: committed`).
   - candidate != bytes, or higher-epoch takeover → roll back (append
     `publish-final` rejection).
   - bytes match neither any pending-intent candidate, nor any earlier
     committed candidate, nor the highest-epoch expected → exit 6
     `publication-outcome-unknown`, preserve evidence, require audited manual
     review. This is the one genuinely undetectable power-loss window, matching
     `power_loss_guarantee: none`.
4. Check every tuple: floor monotonicity, `last_epoch` == replayed epoch,
   `active` matches, expected committed revision == actual revision.
5. Detect stale-late-writes and revision regressions (§6).
6. Emit a compact JSON report; exit 0 `committed` when clean, else nonzero
   with `findings` codes (`stale-write-detected`, `revision-regression`,
   `pending-intent-resolved`, `publication-outcome-unknown`).

`claim-verify` runs automatically at the start of any fenced operation that
observes a pending intent, so no decision builds on an ambiguous state.

## 6. Stale-late-write detection via git + journal (no atomic commit)

Worker T takes over item X (epoch N+1) and publishes `R(C_T)`. Stale worker S
(epoch N) resumes and overwrites item X with `R(C_S)`. The reconciler:

1. Expected committed revision for X = candidate of the highest-`seq`
   `publish-final: committed` with the current highest epoch → `R(C_T)`.
2. Actual on-disk bytes → `R(C_S)`.
3. `R(C_S) != R(C_T)` ⇒ drift. If `R(C_S)` matches a lower-epoch committed
   revision/intent and a higher-epoch committed `publish-final` exists →
   `stale-write-detected` with actual vs expected revisions and both fences.
4. Confirm via git: `git status --porcelain -- <item>` /
   `git diff -- <item>` show divergence from `HEAD`;
   `git show HEAD:<path>` gives committed bytes for regression search.

The stale state is refused as authoritative and evidence preserved. Because
ordinary read/fencing operations trip the drift check on their next decision,
they fail closed rather than build on a poisoned ledger.

## 7. Legacy transition/create fencing

Insert a claim fence inside the same coordinator transaction window (namespace
lock), then fall through to the normal mutation:

- `legacy_transition_v1` (+ `patch`, same `mutateExistingItem` engine): active
  unexpired claim on the item → persist floor, exit 4
  `active-claim-write-refused`.
- `legacy_create_v1`: tuple with claim history (`last_epoch > "0"`) → persist
  floor, exit 4 `claimed-item-write-refused`.

Residual check-then-act window is closed by the reconciler on the next
`claim-verify`, the same detective model as §6.

## 8. Capability fields that change

```json
{
  "backend": {
    "name": "local-filesystem-git-journal",
    "coordination_scope": "shared-git-common-dir-serialized-journal",
    "ledger_binding": { "mode": "explicit-allowlist", "namespaces": ["wbns_..."] }
  },
  "operations": {
    "work_claim": {
      "supported": true,
      "api_version": 1,
      "mode": "merge-coordinated",
      "claim_protected_publication": true,
      "fencing_enforced_at": "git-history-reconciliation",
      "safe_exclusive_dispatch": false,
      "write_paths": {
        "alternate": "none",
        "claimed_publication_v1": "git-journal-fence",
        "legacy_create_v1": "reject-claimed-id",
        "legacy_transition_v1": "reject-active-claim"
      }
    }
  }
}
```

`mode` `merge-coordinated`, `fencing_enforced_at`
`git-history-reconciliation`, and coordination scope
`shared-git-common-dir-serialized-journal` are new, explicit enum values that
say exactly what the backend does. `safe_exclusive_dispatch` **must** stay
`false`. Per the contract, that means callers must not treat the backend as
exclusive-dispatch safe; `claim-verify` is the compensating control.

## 9. File / test change map (not written here)

- **new** `src/claim-journal.js` — append (seq, fsync), replay fold, pending
  intent recovery, reconcile.
- **modify** `src/claim-store.js` — journal path helpers; snapshot becomes a
  memo rebuilt from replay; keep `withClaimLock` as the shared coordinator
  lock.
- **modify** `src/claim-operations.js` — publish fence/finalize helpers.
- **modify** `src/claim-capabilities.js` — new capability fields (§8).
- **modify** `src/cli.js` — implement `publish-claimed`; add `claim-verify`;
  route transition/create/patch through the coordinator fence.
- **modify** `src/mutation.js` — insert claim fence calls under lock order.
- **new** `test/claim-journal.test.js`, `test/claim-verify.test.js`; extend the
  existing claim tests. Re-run the full suite + reference model on current node
  and Node 20 (`TMPDIR=/tmp`).

---

## Part 2 — the adversarial review

The attacker's verdict on the pre-decision draft: **Option 2 as stated was not
acceptable.** Five blockers, each recorded, and each now answered by the two
maintainer decisions.

### Findings and their resolution

**B1. A stale write can look valid with no journal trace** — a stale worker's
ledger-bytes write can land while its journal append crashes, leaving git with
nothing naming the overwritten file. This restages the rejected design's
Finding 3.

- *Resolution:* the mergeable reconciliation log + `claim-verify` make the
  window *detectable at git-merge/reconcile time* for cooperative writers, and
  the residual undetectable power-loss window is accepted and advertised
  (`publication-outcome-unknown` → audited manual review, matching
  `power_loss_guarantee: none`). This is the accepted consequence of the
  confirmed "no true atomicity, cooperative only" posture.

**B2. "Replay git history" is not determinate across worktrees/clones/absent
server.**

- *Resolution:* scope is explicitly **single repository, single branch,
  cooperative worktrees converging on git**; cross-clone/serverless/multi-clone
  concurrency is **refused**, as the rejected design's Finding 1 and ADR 0004
  already require. `cross_*` limits stay `false`.

**B3. Git has no canonical total order → epoch high-water mark and floor are
not determinate; same commits, two states.**

- *Resolution:* determinism is relocated to a **single serializing
  coordinator lock per namespace** on top of a **single branch** with strict
  linearization; the journal is the order source, not git's DAG order. Agent
  merge of the plaintext reconciliation log supplies semantic order where git
  alone cannot. This is the confirmed "agents resolve merges" model.

**B4. Idempotency breaks when the ledger commit and journal record are not
atomic** — a response-lost retry can't tell "never wrote" from "wrote, lost the
receipt."

- *Resolution:* accepted and made explicit. `publication-outcome-unknown` is
  the honest answer in that window; the reconciler preserves and surfaces it.
  For cooperative agents, `ledger-publication.read` + `claim-verify` give the
  retry a path to a determined outcome; the undeterminable case is surfaced,
  not guessed.

**B5. History rewritability, floor-durability window, non-durable local
commits, TOCTOU legacy checks.**

- *Resolution:* the floor-append is fsync'd before responding (durable at the
  journal, not waiting on a git push), and **agents must not rewrite history** —
  a stated operating rule of the merge-coordinated model. TOCTOU legacy-write
  races are closed post-hoc by `claim-verify`, not prevented.

### What the attacker endorsed as sound

- **Git as audit history** is sound and is how ADR 0004 already treats it.
- **A single atomic commit + `git update-ref` CAS would largely make the design
  sound for the single-repo/single-branch case** — but that is a stronger
  atomicity coupling than the maintainer chose, and is recorded as the
  alternative.
- **Commit-order staleness detection is correct in the narrow single-linear-
  history case.**

---

## Part 3 — the decision

The maintainer chose the merge-coordinated model over the strict-atomic
alternative:

1. **Trust model:** `mode: "merge-coordinated"`, `safe_exclusive_dispatch:
   false`; protects cooperative agents only. Not claimed as a hostile/crashed-
   writer fence.
2. **Layout:** shared common-dir state + plaintext tracked mergeable
   reconciliation log (option ii). No binary store; git + agent-merge is the
   coordinator.
3. **No true atomicity required;** state derives from replay of the journal +
   committed ledger, and the residual undetectable window is `publication-
   outcome-unknown` → audited manual review.

This satisfies item 17's gate only for **cooperative multi-worktree agents**
(the actual use case: agents working in git worktrees). It deliberately does
not advertise the contract's strict `fenced` bar. Where the contract and this
model conflict (§1, §3 conditions 3–6), the new explicit enum values
(`merge-coordinated`, `git-history-reconciliation`) and `safe_exclusive_dispatch:
false` keep the capability honest rather than false-advertising.

---

## Part 4 — still to decide before implementation

- Whether `mode: "merge-coordinated"` and `fencing_enforced_at:
  "git-history-reconciliation"` are added as new additive enum values to the
  work-claim contract, or kept as a documented backend-local extension in the
  capability envelope (recommend: additive contract values, so a consumer can
  parse them).
- Exact size limits for the journal/reconciliation log (max bytes, max
  entries) to advertise.
- Whether the reconcile log is a per-namespace file or one shared file.
