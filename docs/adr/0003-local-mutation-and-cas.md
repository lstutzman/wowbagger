# ADR 0003: Local mutation and compare-and-set

Status: accepted design; implementation deferred

## Context

The read-only core has an immutable Markdown ledger and deterministic
validation. The next useful boundary is not a work claim or a Git workflow; it
is a narrowly truthful way to inspect one item, create one item, and make one
lifecycle transition without blindly overwriting a concurrent Wowbagger writer.

Schema version 1 deliberately keeps revision and claim metadata out of item
frontmatter. That remains correct. A revision is transport state for a write
attempt, while a claim needs a separate ownership and expiry model. Neither
belongs in an otherwise portable human-owned Markdown record merely because one
backend can use it.

The first mutation backend will run against a local filesystem. It can
coordinate only cooperative Wowbagger writers that point at the same ledger
directory in the same working copy. It cannot observe another clone, worktree,
machine, editor, Git client, or process that ignores Wowbagger's lock protocol.

## Decision

Define a proposed local-filesystem mutation contract with four separate
operations:

| Operation | Purpose | Local backend position |
|---|---|---|
| capabilities | Describe the exact backend scope. | Supported when this phase is implemented. |
| inspect | Read one validated item and issue its revision token. | Supported when this phase is implemented. |
| create | Publish one new triage item with a generated ID. | Supported when this phase is implemented. |
| transition | Compare and replace one existing item through an allowed lifecycle edge. | Supported only when the whole change writes that one item. |
| work claim | Reserve existing work for a worker. | Unsupported and not implemented. |

The machine interface is specified in
[the proposed mutation contract](../mutation-contract.md). This ADR defines the
storage and coordination model behind that interface.

### Revisions

An item revision is exactly:

    sha256:<64 lowercase hexadecimal characters>

The digest is SHA-256 over the complete raw bytes of that one regular Markdown
file. It is not a digest of parsed YAML, normalized line endings, sorted keys,
the body alone, or a Git blob identifier. Rewriting semantically equivalent
YAML therefore changes the revision, which is intentional: a writer that
inspected old bytes must re-inspect before it overwrites newly written bytes.

The revision is returned by inspect and successful mutation responses. It is
not persisted in frontmatter. SHA-256 is a stale-write detector for cooperative
writers, not an authentication signature or an authorization decision.

### Filename and identity

For creation, the portable default publication name is:

    <generated-id>.md

at the configured ledger root. The generated ID remains the identity; the
filename is only the default physical location. Existing items may have a
consumer-selected layout, and a future consumer configuration may select a
different creation layout without changing identity or references. The v1
create request does not let a caller choose an arbitrary filename.

### Local lock protocol

Each existing item has one lock identity keyed by immutable ID, not filename:

    <ledger>/.wowbagger-locks/<item-id>.lock

The lock file is created exclusively and contains bounded JSON metadata:

~~~json
{
  "lock_version": 1,
  "item_id": "wb_...",
  "operation": "transition",
  "writer_id": "opaque-random-value",
  "started_at": "2030-01-10T12:34:56.789Z"
}
~~~

The metadata is diagnostic only. It must not contain credentials, command
arguments, host names, or user names, and it must never be treated as proof of
ownership. A malformed lock still counts as held.

For an operation that refers to existing items, a writer:

1. validates CLI input and the complete ledger;
2. resolves every relevant existing item by immutable ID;
3. acquires the required per-item locks in ascending immutable-ID order using
   exclusive creation;
4. re-loads and re-validates the complete ledger while those locks are held;
5. re-reads and hashes every locked item from its actual regular file;
6. compares the target's expected revision only after that re-read;
7. writes at most one replacement item; and
8. removes its locks and temporary files after a confirmed result whenever the
   filesystem permits.

The target item is always locked for a transition. A create operation also
locks every existing parent and live dependency named by the new item before it
publishes the new file. That prevents cooperative creation of a new incoming
edge while a target is being terminalized. Locks are not writes to ledger items;
they do not turn a multi-item lifecycle change into an atomic transaction.

Temporary files use the same directory as the target item and a name that does
not end in .md. The writer creates the temporary file exclusively, writes the
complete next bytes, synchronizes the file where supported, then replaces the
target using a same-directory rename. Keeping the names in one directory avoids
cross-device rename behaviour. After replacement it re-reads and re-hashes the
published target before reporting the new revision. Directory synchronization
is attempted only where the platform and filesystem support it.

This is the strongest practical local replacement sequence, not a promise of a
universal durable transaction. Node and operating systems do not give
Wowbagger a portable proof that a power loss preserves either old or new bytes.
On platforms where replacing an open destination fails, the writer must return
an operation result rather than silently choosing a weaker overwrite strategy.

### Create publication

Creation first chooses a collision-resistant ULID, validates that it is absent
from the complete ledger, and prepares its bytes in a same-directory temporary
file. Publication must use an exclusive, no-overwrite final-name strategy.

An implementation may use an explicitly verified same-filesystem hard-link
publication path when the filesystem supports it. It MUST NOT assume that hard
links are available or equally permitted on Windows, macOS, Linux, network
filesystems, or managed working directories. The portable fallback reserves the
final path with exclusive creation and writes the prepared bytes to that newly
reserved file. A normal rename is not the portable no-overwrite primitive:
POSIX replacement can replace an existing destination, and Windows behaviour
and sharing rules differ.

The fallback intentionally has a visibility and crash window after final-path
reservation. A crash can leave an empty or partial item even though no existing
item was overwritten. Validation will fail closed on that artifact. Recovery
must be manual and auditable; a later create MUST NOT overwrite it merely
because its name resembles a generated ID.

## Options considered

### Direct file writes without revisions or locks

Rejected. Two writers can both read an item, then each write a valid but
different successor. The later write silently erases the earlier one. Calling
that coordination would be false.

### Treat Git commit and push as the core compare-and-set

Rejected. A Git commit records a local snapshot after a filesystem write; it
does not conditionally replace one item based on the exact bytes an operation
inspected. A push conditionally advances a remote ref, not a specific Markdown
item. Separate clones and branches can each commit valid histories, and merge
or rebase resolution can still overwrite or reinterpret the item.

Git remains valuable for audit, review, backup, merge conflict detection, and
manual recovery. It is not required by the standalone contract, and it is not
an honest substitute for a local expected-revision check.

### Cooperative per-item local CAS

Accepted for the first backend. It makes the useful guarantee narrow and
testable: within one ledger directory, writers that obey the protocol detect a
stale inspected item and do not intentionally overwrite it. It keeps Markdown
canonical and works without a remote service.

### Transactional multi-item backend or coordination service

Deferred. A backend that can atomically update a target and every dependent or
child disposition may advertise that capability later. It must define its
durability, isolation, recovery, and cross-machine scope separately. The local
backend must not simulate that capability with a sequence of independent
renames.

## Guarantees and non-guarantees

| Concern | Local backend guarantee | Explicit non-guarantee |
|---|---|---|
| Revision comparison | Cooperative writers compare the target's raw bytes under its lock. | Protection against editors or processes that ignore the lock. |
| Replacement | A successful normal transition replaces one target through a same-directory temporary file and re-hashes the resulting bytes. | Crash durability, distributed atomicity, or a filesystem-independent atomic-rename proof. |
| Creation | A normal create never intentionally overwrites an existing final filename. | All-or-nothing visibility or recovery after a crash during final publication. |
| Relationships | A mutation that needs dependent cleanup or child disposition is refused before an item write. | Multi-file atomicity by sequencing local writes. |
| Scope | Coordination is among Wowbagger writers using the same ledger directory in one working copy. | Coordination across clones, worktrees, machines, shared mounts with different semantics, or non-cooperating writers. |
| Claims | No claim is created, renewed, interpreted, or enforced. | Any implied exclusive work ownership from a local lock. |

## Crash and stale-lock recovery

Locks are never broken automatically merely because their timestamp is old.
Clock skew, suspended processes, slow filesystems, and long-running work make
age an unsafe ownership test.

Normal failures before publication leave Markdown item bytes unchanged. A crash
or an I/O failure after a publication attempt can leave one of these states:

- a temporary file remains and the original item is still present;
- a final create reservation is empty or partial;
- the replacement is visible but the lock remains;
- the writer cannot determine whether the replacement became visible.

The response contract distinguishes unchanged, committed, and unknown outcomes.
Clients must inspect after an unknown outcome and must not retry a transition
blindly.

Stale-lock and partial-create recovery is an explicit administrator action, not
a writer timeout. Before removing or repairing an artifact, the operator must
capture its path, raw-byte SHA-256, observed UTC time, rationale, and the
before/after item revisions in a durable audit record such as a reviewed Git
commit or incident log. The operator then inspects and validates the full
ledger. A future recovery command may automate evidence capture, but it may not
silently delete a lock based only on age.

## Security boundaries

- Filesystem permissions and repository trust determine who may write a
  ledger. Wowbagger does not authenticate a writer.
- The ledger root, item paths, lock metadata, and Markdown content are
  untrusted inputs. Implementations must continue the read-only core's
  symbolic-link rejection and must not execute metadata or use it as a shell
  argument.
- IDs used in lock filenames must first satisfy the canonical ID grammar.
  Paths returned to callers are ledger-relative display paths, never caller
  supplied path fragments.
- A hash detects a changed byte sequence; it does not make malicious changes
  impossible, prevent SHA-256 collision attacks by an adversary, or prove that
  an observed lock holder is alive.
- Hard links outside the ledger, privileged processes, filesystem races, and
  antivirus or backup agents are outside the cooperative CAS boundary.

## Consequences

- The next implementation can provide useful local inspect, create, and
  single-item transition behaviour without inventing a false distributed lock.
- Lifecycle safety remains stricter than convenience: required dependent
  cleanup and child disposition fail unchanged until a backend advertises a
  suitable atomic scope.
- Mutation output must expose its actual outcome rather than treating every
  nonzero exit as an unchanged ledger.
- Work claims, adapters, consumer policy, and PropertyCompass adoption remain
  out of scope.
