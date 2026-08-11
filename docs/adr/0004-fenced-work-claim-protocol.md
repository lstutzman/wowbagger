# ADR 0004: Fenced work claims use a separate coordination namespace

Status: accepted protocol design; amended by the merge-coordinated Git-journal
profile implemented in the standalone CLI.

## Context

Wowbagger schema version 1 deliberately keeps work claims, leases, revisions,
and lock metadata out of portable Markdown items. The implemented local
mutation runtime is honest about its scope: it can cooperatively compare exact
item bytes in one working copy, but it cannot coordinate claims across a
durable clock and a ledger publication boundary.

A useful claim needs more than a friendly owner label. A paused worker can pass
ordinary ledger validation, lose its lease, then resume after another worker
has taken over. The later write must be rejected even when the stale worker
does not self-fence. That requires a monotonically advancing fencing token and
an atomic backend check where the ledger change becomes visible.

## Decision

Adopt [the fenced work-claim contract](../work-claim-contract.md) as a separate
versioned `work-claim` backend namespace. It defines capability discovery,
read, acquire, renew, release, durable read-back, effective backend time, and
claim recovery independently from current mutation requests.

Claims are keyed by the immutable tuple `(ledger_namespace, item_id)`, where
the namespace is explicitly provisioned and cannot be inferred from a path or
repository. Each tuple has a durable, never-reused decimal epoch high-water
mark. Successful acquisition, release followed by reacquisition, and expiry
takeover allocate a higher epoch; exhaustion at the unsigned 64-bit maximum
fails without mutation. Renewal keeps the active epoch. A claimed
publication carries the namespace, item, owner, epoch, expected ledger
revision, exact candidate bytes and digest, and an idempotent operation
identity; a fenced backend atomically checks that exact active generation at
the ledger-publication commit boundary.

Every successful or rejected authoritative lease decision persists a monotonic
clock floor before responding. The floor, claim/ledger result, and publication
outcome are atomic where applicable. A restart recovers the floor; persistence
failure is fail-closed.

The existing local mutation command API does not gain an optional fence field.
A future claimed-mutation API uses a new command or request version. This
prevents an old backend from ignoring a field that callers could mistake for
enforcement.

Backends that cannot provide strict transactional fencing may expose a lower
merge-coordinated profile when they durably serialize claim decisions, protect
the claimed publication path, reconcile Git history, close the named legacy
paths, and report `safe_exclusive_dispatch: false`. The shipped provisioned
Git-journal profile uses that bar. Unprovisioned Git ledgers remain advisory and
reject claim-protected publication. Strictly fenced backends still require the
shared transactional coordinator defined by the contract. Git is audit and
reconciliation history in the shipped profile; it is not an exclusive lock.

A fenced backend also closes all other mutation entry points: legacy
transition rejects active claimed items, legacy create rejects an identity with
claim history, and every alternate writer is absent, atomically fenced, or
refused. An uncoordinated path downgrades the whole capability to advisory.

## Alternatives considered

### Add optional claim members to version 1 create and transition requests

Rejected. Existing strict request parsing would reject the members, while a
less strict future parser could ignore them. Either outcome makes compatibility
and safety unclear. Claim leases also have a different lifetime and recovery
model than a one-shot mutation request.

### Persist claim ownership in Markdown frontmatter

Rejected. A file edit cannot provide a portable lease clock, CAS takeover, or
atomic fencing against a separate publication. It would also make core readers
invent claim semantics and create merge noise for run-local coordination.

### Use Git branches, commits, or push as the claim lock

Rejected. Git records snapshots and conditionally advances refs. It does not
perform an atomic owner-and-epoch comparison on one ledger item at publication,
and concurrent clones can each create valid local histories.

### Reuse the local mutation lock file as a long-lived lease

Rejected. The local lock is diagnostic and short-lived. Age is unsafe under
clock skew, suspension, crashes, and slow storage. A lock file also cannot
fence a stale writer at an independent Markdown rename boundary.

### Separate claim coordinator with explicit capabilities

Accepted. It makes the safety boundary observable, lets unsupported backends
fail closed, keeps Markdown portable, and allows a future transactional backend
to state its real scope without changing the current local runtime.

## Consequences

- Schema version 1 and deterministic ready selection remain claim-blind.
- A claim is not proof of lifecycle completion or authorization to bypass
  mutation preconditions.
- An adapter must generate a fresh per-run owner ID, honor capabilities, and
  self-fence before writes, but backend fencing remains the enforcement point.
- The committed no-I/O reference-model vectors define expected protocol state,
  but a future implementation must separately execute them against real
  storage—including namespace isolation, legacy bypass, clock failure,
  restart, response loss, and the paused-writer boundary race—before
  advertising fenced dispatch.
- The decision whether an unexpired claim changes ready output remains
  deferred. It needs a separate schema and user-facing policy decision.
