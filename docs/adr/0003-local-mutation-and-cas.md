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
| create | Publish one new triage item under a caller-generated ID. | Supported when this phase is implemented. |
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

Inspect parses the normalized core view, extracts the body, computes this
digest, and produces the lossless source encoding from one raw buffer read
through one validated file handle. Arbitrary YAML extensions are omitted from
the normalized JSON core and retained in the exact base64-encoded source.

### Filename and identity

For creation, the portable default publication name is:

    <requested-id>.md

at the configured ledger root. The requested ID remains the identity; the
filename is only the default physical location. Existing items may have a
consumer-selected layout, and a future consumer configuration may select a
different creation layout without changing identity or references. The v1
create request requires a caller-generated collision-resistant ULID but does
not let the caller choose an arbitrary filename.

### Local lock protocol

Each immutable item ID has one lock identity, even before its create
publication. Locks are keyed by ID, not filename:

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
5. re-reads, re-parses, and hashes every locked existing item from its actual
   regular file;
6. compares the target's expected revision only after that re-read;
7. constructs and completely validates the one-item proposed ledger;
8. writes at most one item only when no other item would require mutation; and
9. removes its locks and temporary files after a confirmed result whenever the
   filesystem permits.

The target, every relevant referenced or referring item, and every direct child
needed for an epic check are locked in deterministic ID order. Every item whose
depends_on contains a terminalizing target is considered regardless of that
item's own status. A create operation locks its requested ID plus every existing
parent and live dependency named by the new item. That prevents cooperative
creation of a new incoming edge while a target is being terminalized. Locks are
not writes to ledger items; they do not turn a multi-item lifecycle change into
an atomic transaction.

Temporary files use the same directory as the item and a name that does not end
in .md. The writer creates the temporary file exclusively, writes the complete
next bytes, and synchronizes the completed open handle before publication.
Transition then uses the platform's existing-file atomic replacement primitive.
Create uses the stricter no-clobber publication rule below. Keeping the names in
one directory avoids cross-device behaviour. After publication the writer
re-reads and re-hashes the final path before reporting the new revision.
Directory synchronization is best effort and capability-reported.

This is the strongest practical local replacement sequence, not a promise of a
universal durable transaction. Node and operating systems do not give
Wowbagger a portable proof that a power loss preserves either old or new bytes.
On platforms where replacing an open destination fails, the writer must return
an operation result rather than silently choosing a weaker overwrite strategy.

### Create publication

The caller supplies a canonical collision-resistant ULID before mutation.
Create validates it, locks that ID alongside referenced parent and dependency
IDs, confirms its absence, and prepares the complete bytes in a same-directory
temporary file. The completed temporary handle must be synced before
publication.

Identity and path conflicts are separate. If the requested ID already exists
at any ledger path, create reports an ID collision. If that ID is absent but
the default `<requested-id>.md` path contains a valid item with another ID,
create reports a path collision naming the occupant and leaves its bytes
unchanged. The identity collision takes precedence because filenames are not
identities.

Publication requires one atomic no-clobber primitive that makes only the
complete prepared file visible at the final name. A verified same-filesystem
hard-link publication is one example. Hard links are not assumed available or
equally permitted on Windows, macOS, Linux, network filesystems, or managed
working directories. If the configured filesystem cannot provide a suitable
primitive, create fails unchanged with a capability result.

A check followed by an overwriting rename is not no-clobber. Reserving the
final path and copying bytes into it is forbidden because it exposes empty or
partial final items. After publication, the writer re-opens the known final ID
path and compares its exact bytes. Exact expected bytes mean committed even if
directory sync or cleanup later fails; absence can be unchanged; any
indeterminate or different result is unknown.

Complete candidate-ledger validation can still reject a locally well-formed
single-item proposal, such as creating or restoring a nonterminal child below
a killed or archived epic. After more specific conflicts, multi-item blockers,
and transition preconditions are classified, the backend reports that
candidate rejection deterministically and leaves the ledger unchanged.

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
| Creation | A normal create atomically exposes complete bytes without clobbering an existing ID, or fails unchanged when that primitive is unavailable. | Universal availability of hard links or another atomic no-clobber primitive; power-loss durability. |
| Relationships | Every referring item is checked for terminalization and every required dependent or child mutation is reported and refused before publication. | Multi-file atomicity by sequencing local writes. |
| Scope | Coordination is among Wowbagger writers using the same ledger directory in one working copy. | Coordination across clones, worktrees, machines, shared mounts with different semantics, or non-cooperating writers. |
| Claims | No claim is created, renewed, interpreted, or enforced. | Any implied exclusive work ownership from a local lock. |

## Crash and stale-lock recovery

Locks are never broken automatically merely because their timestamp is old.
Clock skew, suspended processes, slow filesystems, and long-running work make
age an unsafe ownership test.

Normal failures before publication leave Markdown item bytes unchanged. A crash
or an I/O failure after a publication attempt can leave one of these states:

- a temporary file remains and the original item is still present;
- no final create item is visible and a complete temporary file remains;
- the complete published item or replacement is visible but a lock or
  temporary name remains;
- the writer cannot determine whether the replacement became visible.

The response contract distinguishes unchanged, committed, and unknown outcomes.
Clients must inspect after an unknown outcome and must not retry a transition
blindly.

Stale-lock and artifact recovery is an explicit administrator action, not a
writer timeout. The caller-known create ID is the automated recovery key:
inspect that ID first, and retry only after inspect proves it absent. Before
removing or repairing an artifact, the operator must
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
- Operating failures use closed phase and reason values; platform exception
  text and OS error codes do not enter the normative envelope.
- Work claims, adapters, consumer policy, and PropertyCompass adoption remain
  out of scope.
