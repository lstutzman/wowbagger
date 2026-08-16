# Work-claim contract

Status: accepted protocol design. The standalone Wowbagger CLI implements the
version 1 claim operations and the merge-coordinated Git-journal profile for
provisioned Git-backed ledgers. The no-I/O reference model and conformance
fixtures remain the oracle for the strict fenced protocol.

This document defines version 1 of the transport-neutral work-claim and
claimed-publication API, plus the merge-coordinated capability profile. The
words MUST, MUST NOT, SHOULD, and MAY are normative. JSON examples show objects
before compact serialization; a CLI prints exactly one compact JSON object
followed by LF.

Work-claim version negotiation uses
`result.operations.work_claim.api_version` from
`claim capabilities --ledger <dir> --json`. The top-level
`contract_version: 1` remains the legacy claim-envelope marker. It is not the
core mutation contract version and MUST NOT be compared with the
`contract_version` from core `capabilities --json`.

Generic consumers migrate without a wire change: they first identify the
work-claim envelope by `namespace: "work-claim"`, then require the advertised
`api_version`. Existing version 1 consumers can keep exact-member validation.

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
      }
    },
    "operations": {
      "work_claim": {
        "supported": true,
        "api_version": 1,
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
    }
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

The public operation is `ledger-publication.publish-claimed` version 1. It
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
8,388,608 bytes. Its SHA-256 MUST equal `candidate_sha256`. The candidate is
the complete replacement ledger source, not a patch.

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
| 2, digest | 2 `candidate-digest-mismatch` | `The candidate digest does not match the candidate source.` |
| 3 | 2 `ledger-namespace-unbound` | `The ledger namespace is not provisioned for this endpoint.` |
| 4 | 4 `idempotency-conflict` | `The operation identity is already bound to a different request.` |
| 5 | 3 `ledger-invalid` | `The candidate ledger is invalid.` |
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
the backend reconciles prior intents, persists the clock floor, checks
idempotency, fence, and revision, then fsyncs a `publish-intent` before writing
the candidate item bytes. Before the first journal append, it fsyncs each new
journal-directory entry and the empty journal file. It then appends a terminal
`publish-final` outcome.
The caller commits or merges the resulting item change and runs
`claim-verify`.

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
  legacy mutation or claimed publication. A missing working-tree item is also
  unauthorized when Git `HEAD` contains the authorized revision. Restore the
  named authorized path before repeating verification.
- `git-finalization-required`: the current worktree contains the authorized
  revision, but Git `HEAD` does not. Commit the named path, then repeat
  verification.
- `worktree-synchronization-required`: another cooperating worktree contains
  the authorized revision. Verify in the writing worktree after commit, or
  synchronize this worktree to that commit.
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

A merge-coordinated backend MUST reconcile before it authorizes a legacy write.
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

This contract adds no members to schema version 1 Markdown items and changes no
create or transition request shape. Existing parsers continue to reject
unknown claim members. The shipped CLI implements the merge-coordinated
Git-journal profile for provisioned ledgers and reports
`safe_exclusive_dispatch: false`. Unprovisioned Git ledgers remain advisory,
and non-Git ledgers remain claim-unsupported.
