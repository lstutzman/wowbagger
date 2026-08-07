# ADR 0008: Frontmatter patching is a guarded mutation

Status: accepted for standalone v0

## Context

The local mutation runtime exposed guarded creation and lifecycle transition,
but no operation for correcting ordinary frontmatter. A consumer could inspect
an item and learn its exact revision, yet changing its priority, planning
number, relations, or title still required a hand-edit.

That hand-edit bypassed complete-ledger validation, the per-ID lock, the exact
byte compare-and-swap, and atomic publication. It could silently introduce a
missing parent, dependency cycle, duplicate number, or concurrent overwrite.
It also made the plugin's own instruction to use the CLI for ledger mutations
impossible to follow for this class of change.

Adding a command widens the adapter contract. The current adapter evidence
passes 79 of 183 assertions, while section 10 of the adapter contract reads
Unverified for every platform. Nothing in the wild therefore depended on the
previous exact command list. The independent oracle must still describe and
enforce the widened list exactly.

## Decision

Add `patch` to the core command and capability surfaces and to the exact adapter
command list. The advertised operation is a supported single-item write with
an exact-byte SHA-256 compare-and-swap scope. The adapter implementation,
runtime probe, independent reference oracle, and pinned capability evidence all
name the same new contract member; none makes command matching optional or
permissive.

Patch accepts exactly five frontmatter fields: `priority`, `number`, `parent`,
`depends_on`, and `title`. Priority, number, and parent may be removed with
null; dependencies are replaced as a complete list. Every patch supplies a
date, summary, and rationale. A successful operation sets `updated` to that
date and appends a `record` decision carrying the supplied evidence.

The set is deliberately narrow. Identity, schema interpretation, and creation
history are immutable. Status and terminal dates remain exclusively owned by
transition. Updated and decisions are operation-derived. Provenance is
historical evidence. Kind, related, snoozed_until, extension fields, and body
remain outside this first contract; a later decision may widen the set, while
existing consumers could prevent it from narrowing safely.

Patch reuses transition's per-ID lock closure, locked revision comparison,
complete proposed-ledger validation, atomic replacement, and read-back
verification. It locks the target and the relevant old and proposed parent and
dependency IDs. A stale revision returns `revision-conflict`; an invalid
proposal returns `candidate-invalid`; and a change that would require another
item to be rewritten returns `atomic-scope-required`. Refusal leaves the target
unchanged.

## Alternatives considered

### Continue requiring hand-edits

Rejected. It keeps the common operation outside every safety property the
mutation runtime exists to provide and contradicts the plugin's instruction to
use that runtime.

### Allow every frontmatter field

Rejected. Identity and history fields need stronger immutability, lifecycle
fields already have a decision-bearing transition protocol, and broad
extension or body rewriting would enlarge the lossless-preservation contract
without evidence that it is needed.

### Add priority only

Rejected. Number, parent, dependencies, and typo corrections to title have the
same hand-edit failure mode and fit the same one-item validated replacement.
Excluding them would preserve an arbitrary unsafe path.

### Make the adapter oracle accept either command list

Rejected. The oracle describes the contract independently. Accepting both
lists would stop detecting an implementation that omitted or misspelled
`patch`, defeating the purpose of exact conformance evidence.

## Consequences

- Consumers can change the five named fields without bypassing validation,
  cooperative locking, compare-and-swap, or atomic publication.
- Every successful frontmatter change has a durable record decision and updates
  the item's date.
- Patches that need multi-item atomicity remain impossible in the local backend
  and fail unchanged.
- The adapter's exact command list and capability evidence now include `patch`;
  implementations that omit it fail the independent oracle.
- Widening the patchable set later requires another explicit contract decision.
