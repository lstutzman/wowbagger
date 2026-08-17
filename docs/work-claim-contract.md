# Work-claim contract

Status: accepted protocol design. The standalone Wowbagger CLI implements the
version 2 claim operations and the merge-coordinated Git-journal profile for
provisioned Git-backed ledgers. The no-I/O reference model and conformance
fixtures remain the oracle for the strict fenced protocol.

This document defines version 2 of the transport-neutral work-claim and
claimed-publication API, plus the merge-coordinated capability profile. The
words MUST, MUST NOT, SHOULD, and MAY are normative. JSON examples show objects
before compact serialization; a CLI prints exactly one compact JSON object
followed by LF.

Work-claim version negotiation uses
`result.operations.work_claim.api_version` from
`claim capabilities --ledger <dir> --json`. The top-level
`contract_version: 1` remains the legacy claim-envelope marker. It does not
move with the API version, it is not the core mutation contract version, and it
MUST NOT be compared with the `contract_version` from core
`capabilities --json`.

Generic consumers migrate without a wire change: they first identify the
work-claim envelope by `namespace: "work-claim"`, then require the advertised
`api_version`.

### Version 2

Version 2 retains every version 1 request, response, state, exit, fencing, and
recovery rule except for this one delta, which is the complete difference
against published version 1 (`0.1.0-alpha.6`):

- **`publish-claimed` names an oversized candidate.** A candidate that decodes
  to more than 8,388,608 bytes returned exit 2 `invalid-request` with message
  `The candidate source is not canonical base64.` and
  `details.field: "candidate_source_base64"`. It now returns exit 2
  `item-source-too-large` (section 6). The accepted publication set does not
  narrow — the same candidates are accepted and the same candidates are refused
  — but a version 1 consumer that pinned the old code, message, or details for
  that input is wrong about a real response, so the version moves and such a
  consumer fails closed.

Malformed base64 keeps its version 1 `invalid-request` unchanged: without
canonical base64 there is no item source to measure, so spelling still decides
first. The serialized-request transport bound is unchanged.

This contract owns three `namespace` values, and all three carry
`contract_version: 1`: `work-claim` for claim lifecycle operations,
`ledger-publication` for claimed publication and publication reads, and
`ledger-mutation` for the legacy write refusals in section 7. A response in any
of the three is a work-claim response, whichever command the caller invoked.
The [mutation contract](mutation-contract.md) section 2 states the single
dispatch rule across both contracts, and
`spec/fixtures/envelope-domains/manifest.json` pins it.

## 1. Safety boundary

A claim is a durable lease for one work item in one ledger. It is not a Git
branch, file lock, lifecycle field, assignment, or proof that a later write
succeeded. Git history can retain evidence, but Git cannot atomically compare a
claim at a ledger publication boundary.

There are four state classes:

| State | Authority |
|---|---|
| ledger bytes and revision | durable ledger store |
| claim, epoch high-water mark, clock floor | durable coordinator |
| publication outcome by operation identity | durable coordinator |
| preflight, retry, and self-fencing cache | disposable process memory |

A backend is safely fenced only if one transactional coordinator serializes
claim decisions, the monotonic clock floor, every write path that can mutate a
claimed item, the ledger publication, and its idempotency outcome. A separate
claim service plus an ordinary file rename is advisory.

The shipped Git-journal profile is intentionally weaker. It serializes
cooperating claim decisions and records publication intent before the item
write. Git history and `claim-verify` then finalize or reject the outcome. It
does not make the claim decision and Git commit one atomic transaction, so it
MUST report `safe_exclusive_dispatch: false`.

### The commit-per-mutation invariant

Because Git history is what finalizes an outcome, the merge-coordinated profile
carries one operating rule that binds every caller:

**Commit each mutation to Git before running the next mutating command.**

A merge-coordinated backend validates recorded revisions against Git `HEAD`,
never against working-tree bytes. An uncommitted mutation is an unreconciled
mutation. The next `create`, `transition`, `patch`, or `publish-claimed`
therefore refuses with exit 6 `claim-store-unavailable` and
`details.reason: "publication-reconciliation-required"` rather than writing on
top of work that is not yet durable.

`claim-verify` is the reconciliation procedure for that refusal. The loop is
write, commit, `claim-verify`, next write. Section 6 defines `claim-verify`,
section 7 defines the refusal the legacy write paths emit, and section 8
defines the error envelope. The [mutation
contract](mutation-contract.md) section 12 states the same rule for
`create`, `transition`, and `patch` callers, together with the
considered-and-rejected alternative of validating against working-tree bytes.

The optional `--auto-commit` flag performs that whole loop inside one
invocation on a provisioned ledger: it runs the pre-mutation `claim-verify`,
runs the mutation unchanged, commits exactly the item and at most one
reconciliation log, and runs `claim-verify` again before returning. It changes
no claim rule and no envelope a caller already receives, so the work-claim API
stays version 1. The invariant is unchanged; only the ceremony moves. When its
Git commit fails after the item is published, the named recovery command is:

~~~sh
wowbagger mutation-finalize --ledger <dir> --recovery-token <token> --json
~~~

`mutation-finalize` answers in this domain because it changes Git
reconciliation state and no item byte. `test/work-claim-reference.js` derives
the same operation independently: writing no item byte, the only durable change
it can make is moving a ledger record's committed surface onto bytes the
writer's own surface already holds. It re-derives every path from the ledger
and the provisioned namespace, creates the exact commit if it is absent, then
runs `claim-verify`. Repeating it creates no second commit. [Mutation
contract](mutation-contract.md) section 13 defines the flag, its strict
preflight, its commit sets, its failure envelopes, and this command.

## 2. Ledger namespace and identity

Every claim key is the immutable tuple `(ledger_namespace, item_id)`. No state,
request, fence, read-back, or publication may omit either member.

`ledger_namespace` is a provisioned ASCII identifier matching exactly:

    wbns_[a-f0-9]{32}

It is not inferred from a path, repository URL, clone, worktree, display name,
or item ID. Provisioning creates a namespace once and binds it to one logical
ledger. Moving or cloning that same logical ledger retains the binding; making
an independent logical ledger requires a new namespace. Rebinding a namespace
to different ledger history is forbidden. A shared endpoint MUST use an
explicit allowlist or equally strong durable mapping and MUST reject an
unprovisioned namespace before consulting claim state.

`item_id` retains Wowbagger's canonical `wb_` identity syntax. Equal item IDs
in different ledger namespaces are unrelated: their claims, epoch counters,
clock floors, publications, and idempotency outcomes cannot collide.

`owner_id` identifies one worker run and matches
`[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`. A fresh collision-resistant value is
required for every run. It is not a credential.

`epoch` is a canonical unsigned 64-bit decimal string. `"0"` is only the
unallocated high-water mark. Active epochs match `[1-9][0-9]{0,19}` and are at
most `18446744073709551615`. Epochs never wrap, decrement, or get reused.

## 3. Capability discovery and write-path closure

`work-claim.capabilities` accepts exactly `{}`. A strictly fenced response is:

```json
{
  "ok": true,
  "namespace": "work-claim",
  "command": "capabilities",
  "contract_version": 1,
  "result": {
    "backend": {
      "name": "example-backend",
      "coordination_scope": "shared-transactional-coordinator",
      "ledger_binding": {
        "mode": "explicit-allowlist",
        "namespaces": ["wbns_11111111111111111111111111111111"]
      },
      "write_serialization": {
        "scope": "shared-coordinator-writers",
        "blocks_until": "coordinator-transaction-complete"
      }
    },
    "operations": {
      "work_claim": {
        "supported": true,
        "api_version": 2,
        "mode": "fenced",
        "claim_protected_publication": true,
        "fencing_enforced_at": "ledger-publication-commit-boundary",
        "safe_exclusive_dispatch": true,
        "write_paths": {
          "alternate": "none",
          "claimed_publication_v1": "atomic-fence",
          "legacy_create_v1": "reject-claimed-id",
          "legacy_transition_v1": "reject-active-claim"
        }
      }
    }
  }
}
```

The work-claim capability envelope reports one ledger's provisioned claim
profile. Its `namespace: "work-claim"` member and ledger-bound `backend`
identify this capability context. It is distinct from the unbound default claim
profile in the core `capabilities --json` response. A caller MUST use
`claim capabilities --ledger <dir> --json` and MUST gate `publish-claimed` on
that ledger-specific response.

`backend.write_serialization` is required. It names the writers that one
recorded write blocks, and what ends the block. `coordination_scope` says where
the coordination state lives; `write_serialization` says who pays for it.

| `scope` | A recorded write blocks |
|---|---|
| `none` | nobody; writers do not serialize |
| `shared-coordinator-writers` | every writer bound to the coordinator |
| `all-worktrees-of-one-repository` | every worktree that shares one Git common directory |

| `blocks_until` | The block ends when |
|---|---|
| `not-applicable` | there is no block |
| `coordinator-transaction-complete` | the coordinator transaction finishes |
| `peer-commit-visible-in-this-checkout` | the writing commit is visible in the blocked checkout |

A caller MUST NOT infer write serialization from `coordination_scope` alone,
and MUST NOT read the core envelope's
`limits.cross_worktree_coordination: false` as a promise that worktrees write
independently. That member reports that the core never synchronizes checkouts.
It does not report who blocks whom. `write_serialization` does.

`safe_exclusive_dispatch` may be `true` only when all of the following hold:

1. claim state, epoch high-water marks, clock floors, and operation outcomes
   are durable;
2. acquire, renew, release, expiry, and takeover obey this contract;
3. `publish-claimed` fences and publishes atomically;
4. legacy transition rejects an active claimed item inside the same
   coordinator transaction;
5. legacy create rejects an identity with claim history inside that
   transaction; and
6. every other mutation entry point is absent or participates in the same
   atomic fence.

The coordinator scope MUST be `shared-transactional-coordinator`, the ledger
binding MUST be an explicit non-empty allowlist, and the advertised binding
must cover the provisioned namespaces. A `local-filesystem` scope or an empty
allowlist is advisory even when the four write-path values otherwise match.

For a strictly fenced capability, the backend MUST enumerate every entry point.
An unknown, uncoordinated, plugin, maintenance, import, alternate, or
direct-write path is a bypass. Any bypass prevents `mode: "fenced"` and
`safe_exclusive_dispatch: true`.

A provisioned Git-journal backend MAY instead report:

```json
{
  "backend": {
    "name": "local-filesystem-git-journal",
    "coordination_scope": "shared-git-common-dir-serialized-journal",
    "ledger_binding": {
      "mode": "explicit-allowlist",
      "namespaces": ["wbns_11111111111111111111111111111111"]
    },
    "write_serialization": {
      "scope": "all-worktrees-of-one-repository",
      "blocks_until": "peer-commit-visible-in-this-checkout"
    }
  },
  "operations": {
    "work_claim": {
      "supported": true,
      "api_version": 2,
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

`merge-coordinated` means that one shared Git common-directory journal
serializes cooperating claim decisions, publication intents, and terminal
outcomes. `publish-claimed` MUST validate the active fence and expected
revision under that journal lock before it writes the item. It MUST record the
intent durably before the item write. `claim-verify` MUST reconcile the working
tree and Git history before a later fenced operation proceeds.

This profile does not control direct writes, hostile processes, other clones,
or alternate tools. A caller MUST NOT use it for exclusive dispatch. A
Git-backed ledger without a provisioned namespace remains advisory:
`mode: "advisory"`, `claim_protected_publication: false`,
`fencing_enforced_at: "none"`, and `safe_exclusive_dispatch: false`.
An advisory endpoint MUST reject `publish-claimed`; a caller must never upgrade
an advisory capability locally.

### 3.1 One journal serializes every worktree of one repository

The journal lives in the Git common directory. Every worktree of one
repository shares that directory, so every worktree shares one journal, and
one journal serializes them all. Clones do not share it, so clones stay
independent.

A worktree keeps its own checkout. The journal therefore knows item revisions
that a sibling checkout cannot see. Reconciliation runs before every mutation
on a provisioned ledger and compares the journal's expected revisions against
the local working tree and the local Git HEAD. A revision written in another
worktree is absent in both, so reconciliation reports
`stale-write-detected` and the mutation refuses with exit 6
`claim-store-unavailable`, reason `publication-reconciliation-required`.

The plain statement: **on a provisioned ledger, a recorded write in one
worktree blocks every mutation in the other worktrees of that repository until
the writing commit is visible where the next mutation runs.** `create` records
nothing, so `create` never causes a block; `transition` and `patch` do, and
`create` is the operation most often refused by one.

**Decided: create stays journal-silent.** The asymmetry is intended. Three
reasons hold it:

1. Create already protects its own instant. Publication is atomic, it refuses
   to clobber an existing path, and it verifies the published bytes exactly
   after the write. A journal entry adds no protection to that instant.
2. A journaled create would serialize every worktree on the highest-volume
   mutation. The field reports name create as the most frequent mutation and as
   the most frequent victim of a block. Making create a blocker as well as a
   victim multiplies a cost that consumers already report.
3. The remaining exposure window is real but narrow, and it closes at the
   item's first journal-visible mutation.

**The exposure window, stated honestly.** The journal does not know a created
item until that item's first journal-visible mutation, which is a `transition`
or a `patch`. Until then an out-of-protocol overwrite of the item's bytes is
not detected. A commit alone does not close the window, because reconciliation
compares only the revisions the journal expects, and the journal expects none
for that item. From the first `transition` or `patch`, the ordinary surfaces
cover the item: with the authorized revision committed, an out-of-protocol
overwrite of the working-tree bytes reports `unauthorized-revision` and the
next mutation refuses. Inside the window, only an actor that bypasses this tool
can overwrite the item, and this protocol does not defend against that actor.
It is merge-coordinated, not exclusive.

**`unauthorized-revision` has two remedies, and only one of them is
destructive.** Restoring the authorized revision discards the out-of-protocol
edit. Adopting the committed revision keeps it and moves the coordinator's
authorized revision instead (section 3.3). Every `unauthorized-revision`
`remediation` string MUST name both, and MUST say for each one what happens to
the edit. A refusal that names only the restore path reads as an instruction to
throw the edit away; a field report did exactly that with reviewed, merged work.

Each refusal carries a `reason` that separates the two cases:

| `reason` | Cause | Remedy |
|---|---|---|
| `git-finalization-required` | this worktree wrote the item and has not committed it | commit here, then `claim-verify` |
| `worktree-synchronization-required` | another worktree wrote the item | synchronize this checkout to that commit |
| `unauthorized-revision` | the item was changed outside the protocol | restore the authorized revision and discard the edit, then `claim-verify`; or adopt the committed revision and keep the edit, then `claim-verify` (section 3.3) |

### 3.2 Recovering from a foreign-writer block

1. Stop writing in the blocked worktree. Every retry refuses again and costs a
   reconcile log write.
2. Read the finding. `worktree-synchronization-required` names the item path
   and the revision the journal expects.
3. Wait for the writing worktree to commit and push, or merge its branch.
4. Synchronize the blocked checkout to that commit: pull, merge, or rebase.
5. Run `claim-verify --ledger <dir> --json` in the blocked worktree and require
   exit 0.
6. Resume.

Only step 4 clears a foreign-writer block. Running `claim-verify` in the
writing worktree finalizes that worktree's own state; it does not make the
blocked checkout able to see the item, so the blocked worktree stays blocked.

A refused mutation still writes the per-namespace reconcile log into the
blocked ledger. Git refuses to merge over that untracked file, so remove or
commit it before step 4.

**Do not chase `expected_revision`.** The blocked worktree cannot win that
race. While the sibling keeps working, each new write moves the expected
revision, so any value read from a refusal is already stale by the time the
next command runs.

**Warning — copying the item in does not work.** A field report tried it:
copy the sibling's item file into the blocked checkout, byte-identical, and
retry. The mutation still refuses. Reconciliation reads the local Git HEAD as
well as the working tree, so the copy only changes which refusal you get. The
finding turns from `worktree-synchronization-required` into
`git-finalization-required`, which now asks the blocked worktree to commit
another worktree's item into its own branch. That duplicates the sibling's
work, conflicts on merge, and the sibling's next recorded write blocks the
checkout again at a new revision. Synchronize the checkout instead.

### 3.3 Adopting a committed out-of-protocol revision

`claim-adopt` is the non-destructive remedy for `unauthorized-revision`. It
records that an operator ruled the current committed bytes legitimate, so the
coordinator's authorized revision becomes those bytes. **It writes no item
byte.** `updated`, the body, and every other field the item carries survive
exactly, because the operation changes coordinator state and nothing else.

```sh
wowbagger claim-adopt --ledger <dir> --input <request.json> --json
```

It is a standalone verb in the work-claim domain, a sibling of `claim-verify`,
answering with `namespace: "work-claim"`, `command: "claim-adopt"`, and
`contract_version: 1`. It is not a `ledger-mutation` verb, because no core
mutation runs and no item file changes. It is not a `claim-verify` flag, because
`claim-verify` is the read-mostly reconciliation report every remediation string
names, and one command name must not mean both "tell me the state" and "change
the authorization baseline". It is not a `claim` subcommand, because every claim
lifecycle subcommand refuses with `publication-reconciliation-required` while
reconciliation reports blocking findings, and adoption exists to clear exactly
that state, so it runs while those findings stand.

The request is UTF-8 JSON with exactly these members:

```json
{
  "ledger_namespace": "wbns_11111111111111111111111111111111",
  "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
  "from_revision": "sha256:7bd2…",
  "to_revision": "sha256:d8ba…",
  "adopted_by": "operator-a"
}
```

`from_revision` is the revision the caller believes the journal authorizes.
`to_revision` is the exact revision being adopted. They MUST differ.
`adopted_by` follows the `owner_id` grammar. Adoption is therefore **per item and
per revision explicit**: nothing in this request can adopt a second item or a
revision the caller did not name, and there is no adopt-all.

**Preconditions.** All of them hold before anything is journaled:

| Precondition | Refusal when it fails | Exit |
|---|---|---|
| the request matches the schema above | `invalid-request` | 2 |
| the namespace is provisioned for this endpoint | `ledger-namespace-unbound` | 2 |
| `from_revision` names the revision the journal currently authorizes | `adoption-witness-mismatch` | 4 |
| no unexpired active claim holds the item | `claim-held` | 4 |
| `to_revision` is the item's revision at Git `HEAD` **and** in the caller's own working tree | `adoption-revision-uncommitted` | 4 |
| the complete ledger is valid with `to_revision` | `adoption-ledger-invalid` | 3 |

The witness is the compare-and-swap. An item the journal has never authorized
has no authorized revision, so `from_revision` cannot match it and adoption
refuses; an item whose revision was already adopted refuses a replay of the same
request. `details.authorized_revision` names what the journal holds, and is
`null` when the journal holds none.

Both surfaces matter. Git `HEAD` is what every cooperating checkout can see, so
adopting bytes that are not there would authorize a revision the siblings cannot
reach. The caller's working tree is what the operator is actually looking at, so
adopting past an uncommitted change would authorize bytes nobody reviewed.
`details.observed_surface` names the first surface that disagreed, `git-head` or
`working-tree`, and `details.observed_revision` names what it holds.

**The journal record.** On success the backend appends one entry naming who
ruled, when, and both revisions, so the audit trail says an operator ruled these
bytes legitimate instead of losing the event:

```json
{
  "seq": 12,
  "type": "revision-adoption",
  "ledger_namespace": "wbns_11111111111111111111111111111111",
  "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
  "from_revision": "sha256:7bd2…",
  "to_revision": "sha256:d8ba…",
  "adopted_by": "operator-a",
  "adopted_at": "2030-01-11T09:00:05.000Z",
  "git_commit": "…",
  "item_path": "wb_01Q4837BM01W70T30B184GG1R6.md"
}
```

`adopted_at` is the authoritative instant, never a client clock. The entry is a
journal authorization exactly like a committed claimed publication or a legacy
mutation: reconciliation reads the latest of the three as the item's authorized
revision, and the reconciliation log projects the entry so every sibling
worktree learns the ruling. The successful response repeats the durable facts:

```json
{
  "ok": true,
  "namespace": "work-claim",
  "command": "claim-adopt",
  "contract_version": 1,
  "state": "committed",
  "result": {
    "ledger_namespace": "wbns_11111111111111111111111111111111",
    "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
    "from_revision": "sha256:7bd2…",
    "to_revision": "sha256:d8ba…",
    "adopted_by": "operator-a",
    "adopted_at": "2030-01-11T09:00:05.000Z"
  }
}
```

**Adoption is not a fence hole.** It moves the authorized revision to one named
revision and stops. The next out-of-protocol edit is `unauthorized-revision`
again, measured against the adopted revision, and needs its own explicit
adoption or a restore.

## 4. Durable claim and authoritative time

The normalized durable record is:

```json
{
  "ledger_namespace": "wbns_11111111111111111111111111111111",
  "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
  "last_epoch": "8",
  "active": {
    "owner_id": "agent-example-run-1",
    "epoch": "8",
    "issued_at": "2030-01-11T09:00:00.000Z",
    "expires_at": "2030-01-11T09:05:00.000Z"
  }
}
```

`active` is either that exact object or `null`. Its epoch equals `last_epoch`.
An untouched tuple reads as `last_epoch: "0"` and `active: null`.

Instants use exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`. `lease_duration_ms` is a JSON
integer from 1 through 86,400,000. A lease is active exactly while
`effective_now < expires_at`; equality is expired.

The backend chooses `effective_now = max(physical_utc, durable_clock_floor)`
within the declared namespace scope. Client clocks never authorize a lease.
For every authoritative lease decision—including successful and rejected
acquire, renew, release, takeover, publication fence check, and legacy
active-claim guard—the backend MUST durably persist a clock floor at least as
large as `effective_now` before returning the decision. On success, the floor,
claim or ledger change, and operation outcome commit atomically. On rejection,
the advanced floor and the unchanged claim/ledger result commit atomically.

Restart recovers the floor before deciding anything. A backward wall-clock
step therefore cannot resurrect earlier effective time. If floor persistence
fails or its durability is uncertain, the backend returns exit 6 with
`clock-floor-persistence-failed`, makes no claim or ledger change, and refuses
to guess. It cannot report a lease success or semantic rejection whose time
was not persisted.

When `last_epoch` is `18446744073709551615` (the unsigned 64-bit maximum), a
new acquire or takeover is impossible. After the authoritative decision time
has been persisted, the backend returns exit 6 `epoch-exhausted` with message
`The epoch high-water mark is exhausted.` and details containing the claim
tuple and `last_epoch`. The claim, epoch high-water mark, and ledger remain
unchanged; epochs MUST NOT wrap.

## 5. Claim requests and CAS rules

All public requests are UTF-8 JSON with one top-level object, no duplicate
member at any depth, and exactly the listed members. Unknown members, wrong
types, noncanonical values, and unprovisioned namespaces are exit 2
`invalid-request`; no authoritative lease decision has then occurred.

### Read

`work-claim.read` accepts exactly:

```json
{"ledger_namespace":"wbns_11111111111111111111111111111111","item_id":"wb_01Q4837BM01W70T30B184GG1R6"}
```

If the tuple has never been provisioned, it returns the same successful empty
state with `last_epoch: "0"` and `active: null`; namespaces remain isolated.
It returns `result.read_back` with exactly `ledger_namespace`, `item_id`,
`observed_at`, `last_epoch`, and `active`. A read is evidence, not a future
reservation. It is the recovery operation after a lost claim response: the
caller reads the tuple before retrying an acquire, renew, or release.

`work-claim.read`, capability discovery, and `ledger-publication.read` are
observational. They MUST NOT take the namespace write lock, advance the durable
clock floor, reconcile publications, or change coordinator files.

### Acquire and takeover

`work-claim.acquire` accepts exactly:

```json
{
  "ledger_namespace": "wbns_11111111111111111111111111111111",
  "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
  "owner_id": "agent-example-run-1",
  "lease_duration_ms": 300000,
  "expected": {"last_epoch":"7","active":null}
}
```

`expected` is a CAS witness over the complete `last_epoch` and `active` object.
After persisting the decision time, precedence is:

1. unequal witness: exit 4 `claim-conflict`;
2. equal witness with unexpired active claim: exit 4 `claim-held`;
3. exhausted high-water mark: exit 6 `epoch-exhausted`; or
4. allocate exactly `last_epoch + 1`, replace `active`, atomically commit, and
   return exit 0 with `claim` and `read_back`.

Acquiring an expired record is takeover and always advances the epoch.

### Renew

`work-claim.renew` accepts exactly:

```json
{
  "ledger_namespace": "wbns_11111111111111111111111111111111",
  "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
  "owner_id": "agent-example-run-1",
  "epoch": "8",
  "expected_expires_at": "2030-01-11T09:05:00.000Z",
  "lease_duration_ms": 300000
}
```

Owner, epoch, and expected expiry are one CAS tuple. Mismatch is exit 4
`claim-conflict`; an exactly matching but expired tuple is exit 4
`claim-expired`. Success retains `issued_at` and epoch, sets expiry from the
persisted decision time, and returns `claim` plus `read_back`.

### Release

`work-claim.release` accepts the renew object without `lease_duration_ms`.
It uses the same precedence. Success sets `active` to `null`, retains
`last_epoch`, and returns `released_claim` plus `read_back`. A later acquire
must allocate a greater epoch, preventing ABA even across restart.

Success envelopes for these three commands have exactly `ok`, `namespace`,
`command`, `contract_version`, `state: "committed"`, and `result`. Semantic
failures replace `result` with `error`, use `state: "unchanged"`, and include
the exact normalized read-back in `error.details`.

## 6. Claimed publication API

The public operation is `ledger-publication.publish-claimed` version 2. It
accepts exactly:

```json
{
  "operation_id": "pub_agent-example-run-1_0001",
  "ledger_namespace": "wbns_11111111111111111111111111111111",
  "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
  "expected_revision": "sha256:9160d4be34c8695bd172a76c7c7966587ea5a4d991ad22c87b2b91af54aa9ebb",
  "candidate_source_base64": "YWZ0ZXIK",
  "candidate_sha256": "sha256:7b9a72466d3960eb2aacccfc848939453490db0678bd4725def3f789b891c919",
  "claim_fence": {
    "ledger_namespace": "wbns_11111111111111111111111111111111",
    "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
    "owner_id": "agent-example-run-1",
    "epoch": "8"
  }
}
```

`operation_id` matches `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` and identifies the
entire immutable request. The backend computes `operation_digest` as
`sha256:` plus the SHA-256 of canonical UTF-8 JSON for the complete request
(object keys sorted lexicographically, no insignificant whitespace, and no
duplicate members). It stores that digest with the durable terminal outcome
and compares it before any revision, clock, fence, or candidate-ledger
decision. `expected_revision` and `candidate_sha256` are
lowercase `sha256:` plus 64 hexadecimal digits. `candidate_source_base64` is
canonical padded RFC 4648 base64 without whitespace and decodes to at most
8,388,608 bytes, the same `max_item_source_bytes` the core capability envelope
advertises. Its SHA-256 MUST equal `candidate_sha256`. The candidate is the
complete replacement ledger source, not a patch.

The CLI bounds the complete serialized `publish-claimed` request at 11,534,336
bytes before end-of-stream or JSON parsing. This limit admits every valid
8,388,608-byte candidate plus the bounded envelope fields. Larger input returns
exit 2 `invalid-request`.

Every public commit attempt, including a retry after response loss, MUST carry
the complete request. An operation ID alone is not a retry request and returns
exit 2 `invalid-request` with message `The publish-claimed retry must include
its complete request.`

Validation and decision precedence is normative:

1. strict JSON and exact schema;
2. canonical identifiers, sizes, base64, and candidate digest;
3. provisioned namespace and ledger binding;
4. durable `operation_id` lookup: the same `operation_digest` returns its
   stored terminal envelope; a different digest is exit 4
   `idempotency-conflict`;
5. ordinary candidate-ledger validation;
6. enter the backend's serialized decision boundary and persist authoritative
   decision time;
7. require fence namespace equal request namespace, then fence item equal
   request item, then an active claim, then matching owner, then matching epoch,
   then an unexpired claim;
8. require the durable ledger revision equal `expected_revision`; and
9. publish the exact candidate bytes and store or journal the outcome as the
   selected capability profile requires.

The first failure wins. Publication errors use these exact codes and messages:

Candidate validation MUST parse the complete replacement bytes as a schema
version 1 ledger item and require its canonical `id` to equal the request's
`item_id`. Arbitrary text, a different item, or an invalid schema is exit 3
`ledger-invalid` before a preflight is retained or any publication mutation.

| Step | Exit and code | Message |
|---:|---|---|
| 1 | 2 `invalid-request` | `The request is not unique-key UTF-8 JSON.` |
| 2 | 2 `invalid-request` | `The request does not match publish-claimed version 1.` |
| 2, base64 | 2 `invalid-request` | `The candidate source is not canonical base64.` |
| 2, size | 2 `item-source-too-large` | `The proposed item source exceeds the supported byte limit.` |
| 2, digest | 2 `candidate-digest-mismatch` | `The candidate digest does not match the candidate source.` |
| 3 | 2 `ledger-namespace-unbound` | `The ledger namespace is not provisioned for this endpoint.` |
| 4 | 4 `idempotency-conflict` | `The operation identity is already bound to a different request.` |
| 5 | 3 `ledger-invalid` | `The candidate ledger is invalid.` |
| 6, reconcile | 6 `claim-store-unavailable` | `The durable claim store is unavailable.` |
| 6 | 6 `clock-floor-persistence-failed` | `The authoritative clock floor could not be persisted.` |
| 6 | 6 `publication-outcome-unknown` | `The publication outcome could not be determined.` |
| 7 | 4 `claim-fence-rejected` | `The supplied claim fence is not the active owner generation.` |
| 8 | 4 `ledger-revision-conflict` | `The durable ledger revision no longer matches this publication.` |

An advisory capability has no atomic publication boundary. It MUST reject
`publish-claimed` before preflight or commit with exit 2
`capability-unavailable`, message `Claim-protected publication is unavailable
on an advisory backend.`, and `details.reason: "advisory-capability"`.

The `operation_id` member of that refusal depends on when the backend
refuses. A backend that has read and validated the request — the
`advisory-publication-rejection` reference transcript's coordinator-backed
model — echoes the request's `operation_id`. A backend that refuses
categorically before reading any input, as the unprovisioned local CLI does,
MUST omit `operation_id`: it cannot echo what it never read, and inventing one
would be a guess. A conformance comparison against the reference transcript
therefore excludes `operation_id` when the backend under test refuses before
reading.

The `2, base64` and `2, size` rows are ordered: a candidate that is not
canonical base64 is not an item source, so it can never be measured. Only a
canonical candidate reaches the size decision, and when it does the size
decision precedes the digest, the namespace binding, the durable
`operation_id` lookup, and candidate-ledger validation. `item-source-too-large`
details are exactly `{item_id, size_bytes, limit_bytes}` and the envelope keeps
its top-level `operation_id`.

Steps 1 through 3 use `state: "unchanged"` and deterministic `details` naming
the first invalid JSON pointer or namespace. Step 5 details are the ordered
ledger validation issues. Steps 6 through 8 include `ledger_namespace` and
`item_id`; fence details additionally use the fields and reason defined below,
and revision details contain `expected_revision` then `actual_revision`.

For a strictly fenced backend, steps 6 through 9 are one serialized commit
boundary. No takeover can occur between the fence decision and publication. A
preflight read or candidate validation never authorizes a write. A worker
paused after preflight at epoch N is rejected at commit after epoch N+1 takes
over.

Fence rejection uses exit 4 `claim-fence-rejected`, message `The supplied
claim fence is not the active owner generation.`, and one of these ordered
`details.reason` values: `ledger-namespace-mismatch`, `item-id-mismatch`,
`no-active-claim`, `owner-mismatch`, `epoch-mismatch`, or `claim-expired`.
Wrong owner with the correct epoch and correct owner with the wrong epoch are
both failures. Wrong ledger and wrong item never fall through to another
record. Revision mismatch is exit 4 `ledger-revision-conflict`.

A success envelope contains `operation_id` at top level and result fields
`ledger_namespace`, `item_id`, `committed_revision`, the exact `claim_fence`,
and `claim_read_back`. Publication does not renew or release the claim.

For a merge-coordinated backend, the same public request and decision
precedence apply, but Git commit is outside the journal lock. Under the lock,
the backend returns a stored terminal outcome for a known operation identity,
reconciles the journal, persists the clock floor, rechecks idempotency against
what reconciliation resolved, validates the candidate ledger, checks fence and
revision, then fsyncs a `publish-intent` before writing the candidate item
bytes. Before the first journal append, it fsyncs each new journal-directory
entry and the empty journal file. It then appends a terminal `publish-final`
outcome. The caller commits or merges the resulting item change and runs
`claim-verify`.

The whole of that sequence runs inside the namespace write lock the backend
already holds, and every other cooperative writer of the namespace enters the
same lock before it writes. So merge-coordinated publication relies on that
lock for write serialization and takes no per-item cooperative locks
(`docs/mutation-contract.md`, section 6). It acquires the namespace lock
exactly once per publication. A publication is therefore never refused with
`lock-held`, and a killed publication leaves no per-item lock behind; the
namespace lock it does leave is recovered by the rule in this section, which
recovers an owner only when the OS reports the PID absent.

That reconciliation is unconditional. It is not conditioned on an unresolved
`publish-intent`, because the commit-per-mutation invariant (section 1) binds
`publish-claimed` exactly as it binds `create`, `transition`, and `patch`, and
an uncommitted legacy mutation leaves no publish-intent behind. When
reconciliation produces any blocking finding, `publish-claimed` MUST refuse
with exit 6 `claim-store-unavailable`,
`details.reason: "publication-reconciliation-required"`, and
`details.findings` set to those findings. `state` MUST be `unchanged`: the
refused publication wrote no item byte. Reconciliation itself still writes —
a clock entry, the terminals it resolved, and the finalizations it observed —
because those record what was already true, never a new item revision. This is
the identical refusal section 7 defines for a legacy write, so one uncommitted
mutation blocks every mutating command alike, and one `claim-verify` clears
them all.

That refusal also outranks step 5. The numbered precedence orders a backend
that judges a candidate against an authoritative ledger; a merge-coordinated
backend has no authoritative ledger until reconciliation says so, and reporting
`ledger-invalid` from an unreconciled snapshot would send the caller after a
validation error that Git `HEAD` need not carry. So on this profile an
unreconciled journal outranks an invalid candidate: exit 6
`claim-store-unavailable` wins over exit 3 `ledger-invalid`. Step 4 still
outranks both — a completed operation's recorded terminal outcome never depends
on later ledger state — and every other pair keeps the listed order.

That refusal is never `publication-outcome-unknown`. That code answers for a
publication whose own commit boundary is indeterminate. A publication refused
before it appends its intent has no commit boundary to be uncertain about, and
`unchanged` is the honest state even when the blocking finding is another
operation's unknown outcome.

The namespace lock records its process owner before publication. A later
process MAY recover the lock only when the operating system reports that owner
process as absent. A live or malformed lock remains `claim-store-unavailable`;
elapsed time alone never authorizes lock recovery.

`claim-verify` takes the ledger path and no request body. Under the namespace
lock, it replays the journal, advances and persists the clock floor, and
reconciles pending intents against the exact item revision. It also compares
successful publications with Git `HEAD`. When `HEAD` contains the committed
revision, it appends one idempotent `publish-finalization` entry that records
the Git commit. It writes a per-namespace reconciliation log outside the shared
journal; that log is a derived audit artifact, not authority.

The log projects only journal entries that record a decision. `clock` and
`publish-finalization` entries are never projected. A command therefore writes
the log only when it records a decision, and it writes it before returning, so
the post-mutation commit set is the changed item file plus that log. A refused
legacy mutation and a clean `claim-verify` record no decision and leave the log
byte-identical; a caller MUST NOT need a commit after either. The one exception
is a `publish-claimed` refusal that reaches a durable `publish-final` terminal:
that terminal binds the operation identity permanently, so the log changes
although no item did.

`claim-verify` also reports ledger validity, because it is the verb every
remediation string names and the caller runs it to learn why the next mutation
is blocked. `result.ledger_validation` is always present. It carries `valid`
and `errors`, the same members and the same deterministic SPEC.md error
sequence the bare `validate` result carries. When `valid` is `false` it also
carries `remediation`, naming the repair and `claim-verify`; a valid ledger has
nothing to remedy and carries neither extra member. Reporting costs no extra
ledger read: reconciliation already loads the ledger it judges.

This member widens a version 1 envelope and the version does not move. The
legacy claim-envelope `contract_version` stays `1`, matching the
`write_serialization` precedent: an added `result` member is additive, no root
member changes, and a version 1 consumer that reads `findings`, `state`, and
`publications` is unaffected. The version to negotiate remains
`result.operations.work_claim.api_version`.

`ledger_validation` never changes the claim answer. `findings`, `state`, and
the exit status describe claim state alone: an invalid ledger with a consistent
journal still returns exit 0, `state: "committed"`, and `findings: []`. It is
not a claim finding, and a caller MUST NOT treat it as one. It is the honest
statement that a clean claim answer is not a clear road, and the caller must
repair validation before the next mutation will run.

A clean verification returns exit 0 and `state: "committed"`. Findings named
`pending-intent-resolved` are clean recovery. Any
`legacy-mutation-outcome-unknown`, `publication-outcome-unknown`,
`revision-regression`, or `stale-write-detected` finding returns exit 6 and
`state: "unknown"`. A caller MUST stop publication work and inspect those
findings. Repeating verification MUST NOT duplicate a publication
finalization.

Every finding that blocks a mutation MUST carry a `remediation` string, and
that string MUST name both the action to take and `claim-verify`. It MUST also
carry `expected_path` when the journal or current ledger identifies the item
path, and the `remediation` string names that path. A clean
`pending-intent-resolved` finding carries neither member; it blocks nothing and
there is nothing to remedy. The blocking codes remediate as follows:

| Code | Remediation names |
|---|---|
| `stale-write-detected` | the action for its `reason` below, then `claim-verify` |
| `revision-regression` | restoring the authorized revision at `expected_path`, then `claim-verify` |
| `legacy-mutation-outcome-unknown` | restoring `expected_path` to the expected or candidate revision recorded for `attempt_id`, then `claim-verify` |
| `publication-outcome-unknown` | inspecting the named publication for `expected_path`, completing its documented recovery, then `claim-verify` |

Every `stale-write-detected` finding contains `actual_revision`,
`expected_revision`, and `observed_surface`. It also contains a stable `reason`
and `remediation`. `expected_path` is present when the journal or current
ledger identifies the item path. The reasons are:

- `unauthorized-revision`: the observed bytes do not match an authorized
  legacy mutation, claimed publication, or operator adoption. A missing
  working-tree item is also unauthorized when Git `HEAD` contains the authorized
  revision. Two remedies clear it and the `remediation` string names both:
  restore the named authorized path, which discards the edit, or adopt the
  committed revision with `claim-adopt` (section 3.3), which keeps it. Repeat
  verification after either.
- `git-finalization-required`: the current worktree contains the authorized
  revision, but Git `HEAD` does not. Commit the named path, then repeat
  verification.
- `worktree-synchronization-required`: another cooperating worktree contains
  the authorized revision. Synchronize this worktree to the commit that wrote
  the named path, then repeat verification. Verifying in the writing worktree
  does not clear this finding.
- `claimed-publication-pending`: a claimed publication remains unresolved.
  Inspect the publication tuple and complete its documented recovery.

Legacy mutation journal entries record their derived `item_path`. Mutation
requests never supply this value. This lets verification name the exact
configured path without converting the journal into a second path authority.

The top-level `state: "committed"` describes durable reconciliation state, not
Git finalization of every successful publication. A caller MUST gate Git
completion on each `result.publications` entry's `git_finalized` and
`git_commit` values. `git_finalized: false` with `git_commit: null` means the
publication outcome is durable but the committed revision is not yet present
in Git `HEAD`.

`ledger-publication.read` accepts exactly
`{"operation_id":"...","ledger_namespace":"...","item_id":"..."}`
and returns the durable operation identity, `operation_digest`, and terminal
`outcome`. A missing operation returns exit 2 `operation-not-found` with
message `The publication operation outcome was not found.` and unchanged
state. If a commit response is lost, the caller MUST read this operation
outcome before retrying; an identical request then returns the stored envelope
without a second ledger write.

## 7. Legacy and alternate writes

Every refusal in this section answers in the `ledger-mutation` namespace with
`contract_version: 1` and `command: "<core command>-v1"`, even though the caller
invoked the core `create`, `transition`, or `patch` command. This is a pinned
version 1 consumer surface; it is not the core mutation envelope and MUST NOT be
re-wrapped in one.

For a fenced or merge-coordinated capability, legacy transition MUST check the
active claim under the same namespace lock and return exit 4
`active-claim-write-refused` before changing an active claimed item. Legacy
create MUST reject any item identity whose tuple has claim history with exit 4
`claimed-item-write-refused`; this prevents recreation from bypassing an epoch
high-water mark. Both checks persist authoritative decision time before their
response.

Before a merge-coordinated backend permits a legacy transition or patch to
write bytes, it MUST fsync a `legacy-mutation-intent` with the expected and
candidate revisions. Under the same namespace lock, it MUST reserve journal
capacity for that intent, one recovery clock entry, and one terminal entry. A
committed write appends `legacy-mutation`; an unchanged write appends
`legacy-mutation-abort`. Reconciliation resolves a pending intent to the
committed terminal when the candidate revision is present, or to the abort
terminal when the expected revision remains. Any third revision produces
`legacy-mutation-outcome-unknown`. The latest committed terminal is the
authorized expected revision. A later unrecorded revision remains a stale
write.

A merge-coordinated backend MUST reconcile before it authorizes a legacy write,
and section 6 states the same requirement for `publish-claimed`.
When reconciliation produces any blocking finding, the legacy command MUST
refuse with exit 6 `claim-store-unavailable`,
`details.reason: "publication-reconciliation-required"`, and
`details.findings` set to those findings. `state` MUST be `unchanged`: the
refused command wrote nothing.

An uncommitted prior mutation is the ordinary cause. Its finding is
`stale-write-detected` with `observed_surface: "git-head"`, `reason:
"git-finalization-required"`, `actual_revision: null` when the authorized
revision is absent from `HEAD`, and a `remediation` string naming the path to
commit and `claim-verify`. The caller commits each named path, runs
`claim-verify` until it returns exit 0, and only then repeats the mutating
command. `spec/fixtures/mutation-refusals/uncommitted-prior-mutation/manifest.json`
is the normative envelope for the create path.

An implementation may instead route a legacy write through `publish-claimed`,
but it cannot silently omit a fence. Administrative repair, bulk import,
plugins, direct database writes, and filesystem writers count as alternate
mutation paths. Their presence prevents a strict fenced capability. A
merge-coordinated backend may still operate for cooperating writers, but it
MUST report `safe_exclusive_dispatch: false`.

## 8. Errors, exits, and recovery

Error envelopes contain exactly `ok: false`, namespace, command,
`contract_version: 1`, state, and `error` with `code`, `message`, and `details`.
Publication envelopes also contain `operation_id` once schema validation has
accepted it.

| Exit | Meaning | Required state |
|---:|---|---|
| 0 | committed success | `committed` |
| 2 | invalid syntax, schema, canonical value, digest, binding, capability, missing operation, or missing fence | `unchanged` |
| 3 | candidate ledger invalid | `unchanged` |
| 4 | CAS, held, expired, fence, revision, idempotency, or legacy refusal | `unchanged` |
| 5 | authentication or authorization refusal | `unchanged` |
| 6 | durable floor/result unavailable or epoch exhausted | `unchanged` or `unknown` as the code defines |

Stable messages used by the reference vectors are part of version 1. A backend
must not substitute free-form prose for the specified codes and details.

Claim-operation semantic messages are likewise exact:

| Code | Message |
|---|---|
| `claim-conflict` (acquire) | `The observed claim state no longer matches this request.` |
| `claim-conflict` (renew/release) | `The active claim tuple no longer matches this request.` |
| `claim-held` | `The item has an unexpired active claim.` |
| `claim-expired` | `The matching claim has expired.` |
| `clock-floor-persistence-failed` | `The authoritative clock floor could not be persisted.` |
| `active-claim-write-refused` | `Legacy transition cannot write an item with an active claim.` |
| `claimed-item-write-refused` | `Legacy create cannot write an item identity with claim history.` |
| `epoch-exhausted` | `The epoch high-water mark is exhausted.` |
| `capability-unavailable` | `Claim-protected publication is unavailable on an advisory backend.` |
| `operation-not-found` | `The publication operation outcome was not found.` |
| `idempotency-conflict` | `The operation identity is already bound to a different request.` |
| `publication-outcome-unknown` | `The publication outcome could not be determined.` |
| `claim-store-unavailable` | `The durable claim store is unavailable.` |
| `adoption-witness-mismatch` | `The adoption witness no longer names the authorized revision.` |
| `adoption-revision-uncommitted` | `The adopted revision is not committed at Git HEAD.` |
| `adoption-ledger-invalid` | `The complete ledger is invalid with the adopted revision.` |

The three adoption codes were added with `claim-adopt` (section 3.3), after the
version 1 vectors were written. They are additive: they name conditions the
original text did not model, change no existing code, message, or envelope, and
no earlier reference vector emits them. `adoption-ledger-invalid` is the
work-claim domain's only exit 3, and it means the same thing exit 3 means
everywhere in this contract — the ledger the operation would authorize is
invalid, so nothing changed.

`claim-store-unavailable` is exit 6 with `state: "unchanged"`. It means the
backend could not reach the durable store that holds claims, epoch high-water
marks, and the clock floor, so no authoritative decision was possible and
nothing changed. It is not a statement about the request, which may be
perfectly valid.

The condition is deliberately generic: a backend whose coordinator is
unreachable and a backend that cannot locate its store at all both use it.
`details.reason` names the specific cause and is backend-defined — for example
`git-directory-not-found` where a backend keeps claim state inside a git
directory. A caller distinguishes causes through `details.reason`, never
through the message.

`details.reason: "publication-reconciliation-required"` is the reason a
merge-coordinated backend returns when reconciliation found blocking findings,
and it is the reason an uncommitted prior mutation produces. **`claim-verify`
is its reconciliation procedure.** The envelope also carries
`details.findings`; act on each finding's `remediation` string, then run
`wowbagger claim-verify --ledger <dir> --json` and require exit 0 before
repeating the refused command. Nothing else reconciles the journal, and no
other verb is needed.

This code was added after the version 1 vectors were written. It is additive:
it names a condition the original text did not model, changes no existing code,
message, or envelope, and no reference vector emits it.

For a strictly fenced backend, the publication outcome and ledger change are
one atomic record. If the commit succeeds but the response is lost, retrying
the identical `operation_id` and request returns the stored success without
writing twice. Reusing the identity with different bytes or fence fails. If
failure occurs before the atomic commit, ledger and outcome remain unchanged.
If an implementation cannot establish which side of its commit boundary
occurred, it returns exit 6 `publication-outcome-unknown`; the caller reads the
outcome by operation ID before attempting anything else.

## 9. Reference vectors and backend conformance

[`spec/fixtures/work-claims`](../spec/fixtures/work-claims/README.md) contains
version 2 normative reference-model vectors. Each manifest declares explicit
durable and process-local initial state, exact source bytes and SHA-256 digests,
the clock authority and floor, ordered CAS/barrier/fault/restart actions, every
exact envelope, and the exact final state.

The no-I/O state-machine runner executes those committed manifests in tests.
The fixture loader separately requires every manifest and source to be a real
regular file beneath the fixture root, using `lstat` and no-follow open; it
rejects traversal, symlinks, directories, and special files.

A passing reference-model vector proves that the normative model and committed
expected transcript agree. Independent hand-authored goldens and invariant /
tamper tests check critical safety properties without using the model's
expected transcript as an oracle. It does **not** prove that a future storage backend
is conformant. Backend conformance requires running the same public requests,
barriers, restarts, and fault schedule against that backend and comparing its
envelopes, durable read-back, and exact ledger bytes to the manifest.

## 10. Current compatibility

`claim-adopt` (section 3.3) is additive at this version. It adds one command,
one journal entry type, and three error codes; it changes no existing request
shape, response shape, or error code, and a caller that never invokes it sees
the same surface as before. The only visible change to an existing surface is
that every `unauthorized-revision` `remediation` string now names both remedies,
which the contract already required to be prose a caller reads rather than a
value a caller matches.

This contract adds no members to schema version 1 Markdown items and changes no
create or transition request shape. Existing parsers continue to reject
unknown claim members. The shipped CLI implements the merge-coordinated
Git-journal profile for provisioned ledgers and reports
`safe_exclusive_dispatch: false`. Unprovisioned Git ledgers remain advisory,
and non-Git ledgers remain claim-unsupported.
