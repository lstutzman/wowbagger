# Advisory work claims in the core CLI — design

Date: 2026-08-06
Status: approved for implementation
Ledger item: `wb_01KZAZW75CWEG3R4BH4MZJAA7G` — Implement fenced work claims in the core CLI

## Purpose

The fenced work-claim contract and its no-I/O reference model are complete, but
the core CLI implements none of it. This design delivers the claim operations —
`acquire`, `renew`, `release`, `read` — against real storage, plus honest
capability reporting and an explicit refusal of claim-protected publication.

## The contradiction this resolves

The ledger item is titled "Implement fenced work claims in the core CLI".
Taken literally that is impossible. `docs/work-claim-contract.md` section 3
requires `coordination_scope: "shared-transactional-coordinator"` for a fenced
backend and states that a `local-filesystem` scope is advisory "even when the
four write-path values otherwise match". Section 1 is more direct: a backend is
fenced only if one transactional coordinator serializes claim decisions, the
clock floor, every write path, the ledger publication, and its idempotency
outcome — and "a separate claim service plus an ordinary file rename is
advisory."

The core CLI writes Markdown files. It cannot commit a claim decision and a
ledger publication in one transaction, so it cannot be fenced.

This design therefore implements the **advisory** mode the contract already
defines, and reports it as advisory. Fencing needs a transactional coordinator
and is a separate, larger decision.

## Decisions this rests on

1. **Advisory first.** Build the claim operations and honest capability
   reporting now. Do not build a transactional coordinator.
2. **Claim state is shared across worktrees.** An agent in one worktree must be
   able to see that another worktree holds a claim. Nothing enforces it — a
   non-cooperating writer still wins — but cooperating agents get real
   coordination.
3. **Git is required for claim commands.** Wowbagger coordinates development
   work, which happens in git repositories. Requiring git removes the
   silent-degradation failure mode where two agents believe they are
   coordinating and are not.
4. **Require the git layout, not the git binary.** The core stays
   subprocess-free.

None of this lifts the PropertyCompass gate. Advisory claims give no safe
exclusive dispatch; that still needs fencing. Decision 1 is the reason, and no
later decision here changes it.

## What ships

- `provision` — creates the ledger namespace, once.
- `claim acquire`, `claim renew`, `claim release`, `claim read`.
- `claim capabilities` — the contract-shaped capability response.
- `publish-claimed` — present, and always refuses.
- `capabilities` — reports the advisory backend truthfully.

## What does not ship

Fencing, any transactional coordinator, a working `publish-claimed`,
PropertyCompass migration, and the Claude Code skill.

## Namespace

Every claim key is the tuple `(ledger_namespace, item_id)`. The namespace is a
provisioned ASCII identifier matching `wbns_[a-f0-9]{32}`. The contract forbids
inferring it from a path, repository URL, clone, worktree, display name, or item
ID.

It lives in a committed file at the repository root:

```
.wowbagger/namespace
```

One line, the namespace value, LF-terminated. It is committed because
provisioning binds a namespace to one logical ledger, and moving or cloning that
ledger retains the binding.

It cannot live in `ledger/`: `CONTRIBUTING.md` restricts that directory to
Wowbagger ledger-item Markdown files.

`provision` generates 32 lowercase hexadecimal characters from a
cryptographically secure source and writes the file with exclusive create. **It
refuses to overwrite an existing namespace file**, because rebinding a namespace
to different ledger history is forbidden by the contract. Re-running it on a
provisioned repository is a no-op returning the existing value, not an error.

## Claim state

### Location

Claim state is runtime coordination state, not ledger content. It lives under
the git common directory:

```
<git-common-dir>/wowbagger/claims-<ledger_namespace>.json
```

Resolution reads the filesystem, never a subprocess:

1. Find `.git` at the repository root, walking up from the ledger directory.
2. If `.git` is a directory, that is the common directory.
3. If `.git` is a file, it contains `gitdir: <path>`. Read that directory's
   `commondir` file; its contents are a path **relative to that gitdir** (in
   practice `../..`). Resolve it to get the common directory.
4. If `.git` is absent, every claim command fails. See Errors below.

Empirically verified in this repository: the main checkout's `.git` is a
directory; a worktree's `.git` is a file reading
`gitdir: /…/wowbagger/.git/worktrees/<name>`, whose `commondir` contains `../..`.

Two consequences of this location are deliberate. Every worktree of a repository
resolves to the same common directory, which is what makes claims visible across
worktrees. And the git directory is not itself version-controlled, so claim state
never enters a commit and no `.gitignore` change is required.

The namespace is part of the filename so that a repository whose namespace
changed cannot silently read another namespace's claims.

### Format

```json
{
  "schema_version": 1,
  "ledger_namespace": "wbns_0123456789abcdef0123456789abcdef",
  "clock_floor": "2026-08-06T09:00:00.000Z",
  "claims": [
    {
      "item_id": "wb_01Q4837BM01W70T30B184GG1R6",
      "last_epoch": "8",
      "active": {
        "owner_id": "agent-example-run-1",
        "epoch": "8",
        "issued_at": "2026-08-06T09:00:00.000Z",
        "expires_at": "2026-08-06T09:05:00.000Z"
      }
    }
  ]
}
```

`active` is either that exact object or `null`. Its epoch equals `last_epoch`.
An untouched tuple reads as `last_epoch: "0"` and `active: null`. Instants use
exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`. Claims are sorted by `item_id` so the file is
byte-stable.

The clock floor is stored once per file because the file is per namespace, and
the contract scopes the durable floor to the ledger namespace.

### Write discipline

Every mutation takes the existing `O_EXCL` cooperative lock, then writes through
the existing temporary-file-plus-rename path with an fsync before publication —
the same discipline `create` and `transition` already use. This serializes
concurrent writers on one machine. It does not make them fenced: a
non-cooperating writer that ignores the lock still wins, which is precisely why
this backend reports advisory.

## Authoritative time

`effective_now = max(physical_utc, stored_clock_floor)`. Client clocks never
authorize a lease.

For **every** lease decision — successful and rejected acquire, renew, and
release alike — the backend persists a clock floor at least as large as
`effective_now` **before returning the decision**. On success the floor and the
claim change commit together. On rejection the advanced floor and the unchanged
claim commit together.

If the floor cannot be persisted, the command returns exit 6
`clock-floor-persistence-failed` with message `The authoritative clock floor
could not be persisted.` and makes no claim change. It never reports a lease
decision whose time was not persisted.

A lease is active exactly while `effective_now < expires_at`; equality is
expired. `lease_duration_ms` is an integer from 1 through 86,400,000.

## Operations

All requests are UTF-8 JSON with exactly the listed members. Unknown members,
wrong types, noncanonical values, and an unprovisioned namespace are exit 2
`invalid-request`, with no lease decision taken.

### `claim read`

Accepts exactly `ledger_namespace`, `item_id`. Returns `result.read_back` with
exactly `ledger_namespace`, `item_id`, `observed_at`, `last_epoch`, `active`. A
tuple never claimed returns the empty state rather than an error. A read is
evidence, not a reservation.

### `claim acquire`

Accepts exactly `ledger_namespace`, `item_id`, `owner_id`, `lease_duration_ms`,
`expected`. `expected` is a CAS witness over the complete `last_epoch` and
`active`. After persisting the decision time, precedence is:

1. unequal witness → exit 4 `claim-conflict`
2. equal witness with an unexpired active claim → exit 4 `claim-held`
3. `last_epoch` at `18446744073709551615` → exit 6 `epoch-exhausted`
4. otherwise allocate exactly `last_epoch + 1`, replace `active`, commit, exit 0

Acquiring an expired record is takeover and always advances the epoch. Epochs
never wrap, decrement, or get reused.

### `claim renew`

Accepts exactly `ledger_namespace`, `item_id`, `owner_id`, `epoch`,
`expected_expires_at`, `lease_duration_ms`. Owner, epoch, and expected expiry are
one CAS tuple. Mismatch is exit 4 `claim-conflict`; an exactly matching but
expired tuple is exit 4 `claim-expired`. Success retains `issued_at` and epoch
and sets expiry from the persisted decision time.

### `claim release`

Accepts the renew object without `lease_duration_ms`, with the same precedence.
Success sets `active` to `null` and retains `last_epoch`, so a later acquire must
allocate a greater epoch. This prevents ABA across restart.

### Envelopes

Success envelopes contain exactly `ok`, `namespace: "work-claim"`, `command`,
`contract_version: 1`, `state: "committed"`, and `result`. Semantic failures
replace `result` with `error`, use `state: "unchanged"`, and include the exact
normalized read-back in `error.details`.

## `publish-claimed` refuses

An advisory backend has no atomic publication boundary. `publish-claimed` is
implemented as a command that rejects every request before any preflight or
commit:

- exit 2, code `capability-unavailable`
- message `Claim-protected publication is unavailable on an advisory backend.`
- `details.reason: "advisory-capability"`

It ships as a real command rather than being absent, so the refusal is
observable and testable, and so a caller receives the contract's exact refusal
instead of an unknown-command error.

## Capabilities

`work_claim` stops reporting `supported: false, reason: "not-implemented"` and
starts describing the backend truthfully:

```json
"work_claim": {
  "supported": true,
  "api_version": 1,
  "mode": "advisory",
  "claim_protected_publication": false,
  "fencing_enforced_at": "none",
  "safe_exclusive_dispatch": false
}
```

`limits.cross_worktree_coordination` becomes `true`, because claims are shared
across worktrees. `limits.noncooperating_writer_protection` stays `false`.
`backend.coordination_scope` becomes `shared-git-directory-cooperative-writers`,
which is neither of the contract's fenced values and reads as advisory to any
caller applying the contract's rules.

No field may let a caller conclude that claims are safe for exclusive dispatch.

### Two capability surfaces, one resolver

The existing `capabilities` command and the contract's `work-claim.capabilities`
operation have different response shapes. The existing command returns
`{ok, command, contract_version, result:{backend, operations, durability,
limits}}`. The contract's operation returns
`{ok, namespace:"work-claim", command:"capabilities", contract_version,
result:{backend, operations:{work_claim}}}` and accepts exactly `{}`.

Both ship. A contract-following caller must be able to discover that this backend
is advisory through the operation the contract names, and existing callers must
not have their response shape changed.

**One resolver computes the capability facts and both commands render it.**
Neither command may state a capability fact the other does not, and no fact is
computed twice. Adding a second reader of the same fact is the failure this
project exists to prevent.

`claim capabilities` is the contract-shaped surface.

## Errors and exits

| Exit | Meaning |
|---:|---|
| 0 | committed success |
| 2 | invalid syntax, schema, canonical value, unprovisioned namespace, or advisory capability refusal |
| 4 | CAS conflict, held, or expired |
| 6 | clock floor could not be persisted, epoch exhausted, or claim store unavailable |

Exact messages are fixed by the contract and reproduced verbatim:

| Code | Message |
|---|---|
| `claim-conflict` (acquire) | `The observed claim state no longer matches this request.` |
| `claim-conflict` (renew/release) | `The active claim tuple no longer matches this request.` |
| `claim-held` | `The item has an unexpired active claim.` |
| `claim-expired` | `The matching claim has expired.` |
| `epoch-exhausted` | `The epoch high-water mark is exhausted.` |
| `clock-floor-persistence-failed` | `The authoritative clock floor could not be persisted.` |
| `capability-unavailable` | `Claim-protected publication is unavailable on an advisory backend.` |
| `claim-store-unavailable` | `The durable claim store is unavailable.` |

**Absent git** returns exit 6 `claim-store-unavailable`, message `The durable
claim store is unavailable.`, `state: "unchanged"`, and
`details.reason: "git-directory-not-found"`.

The contract did not name this condition, because it does not know about git.
Rather than reuse `invalid-request` — which would blame a caller whose request
was valid — the code was added to the contract as an additive version 1 change
(`docs/work-claim-contract.md`, section 8). It is generic on purpose: any
backend whose durable store is unreachable uses it, and `details.reason` carries
the backend-specific cause.

It fails loudly rather than falling back to a narrower coordination scope,
because a silent fallback would let two agents believe they are coordinating
when they are not.

## Testing

TDD throughout: one failing test per behaviour before its implementation.

**The reference model is the oracle.** `test/work-claim-reference.js` is already
independently verified by literal hand-authored goldens, so using it to produce
expected envelopes for the new implementation is sound — the code under test is
the implementation, not the model. Each claim operation gets a test that runs the
same public request against both and compares envelopes with deep equality.

**Conformance scope.** The reference model's claim operations do not consult the
backend's coordination scope; only publication does. So the committed fixtures'
`work-claim.*` actions are replayable against an advisory backend and are in
scope. Their `ledger-publication.*` actions are out of scope, except the advisory
refusal cases (`advisory-unfenced`, `advisory-publication-rejection`), which are
in scope and must match exactly.

**Cross-worktree coordination gets a real test**, not a mocked one: create a
temporary repository, add a second worktree, acquire a claim from one, and assert
the other observes it through `claim read`.

**Absent git gets a test**: run a claim command in a directory with no `.git` and
assert the exact refusal envelope.

Both Node 20 and Node 26 must pass, with a short `TMPDIR` — the default macOS
temporary path exceeds the 104-byte `sun_path` limit and fails
`test/mutation-hardening.test.js` with `EINVAL`.

## Known adjacent issue, not fixed here

`.gitignore` contains only `node_modules/`, so the existing
`<ledger>/.wowbagger-locks/` directory is not ignored and a crash that strands a
lock file would surface it as untracked. That predates this work and is left
alone. New claim state is unaffected: it lives under the git directory, which is
never version-controlled.

## Ledger bookkeeping when this lands

The item this design implements, `wb_01KZAZW75CWEG3R4BH4MZJAA7G`, is titled
"Implement fenced work claims in the core CLI". This delivers advisory claims,
not fenced ones. Closing it as written would assert that fencing exists, which is
the exact failure corrected on 2026-08-06 when an item marked done had no
implementation behind it.

So, as part of this work:

- Retitle the item to `Implement advisory work claims in the core CLI`, with a
  `record` decision explaining the narrowing.
- File a new item, `Implement fenced work claims with a transactional
  coordinator`, parented to the v0 epic. It carries the unanswered question this
  design deliberately did not settle: what the coordinator is, and whether ledger
  bytes must live inside it for publication to be atomic with the fence check.
- The PropertyCompass gate moves to that new item.

## Documentation

`README.md` currently states that fenced work claims "are not available from the
core CLI". That becomes wrong in one direction and right in another: claim
operations arrive, fencing does not. It is updated to say the core implements
advisory claims and that fenced claims still require a transactional coordinator.
