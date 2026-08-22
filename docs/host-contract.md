# Direct-core host contract

Status: core contract version 5. This document is the supported way for a
non-agent consumer — a UI plugin, an editor extension, a service — to resolve,
launch, bound, and validate the Wowbagger core on the host that owns the
workspace.

It publishes what Wowbagger owns: the package seam, the process tuple, the
advertised limits, the response domains, the exit meanings, and the packaged
JSON Schemas. It states, and does not claim, what the host owns: executable
discovery, working directory selection, timeout, cancellation, process-tree
containment, stream caps, consent, and routing. Wowbagger documents these
requirements and their outcomes; it does not claim these facilities, because it
cannot enforce them from inside a child process the host started.

The behaviour this document describes is defined normatively elsewhere. Command
semantics live in [the mutation contract](mutation-contract.md), ledger
semantics in [SPEC.md](../SPEC.md), adapter semantics in [the adapter
contract](adapter-contract.md), and claim semantics in [the work-claim
contract](work-claim-contract.md). Nothing here widens any of them.

## 1. Resolving the core

The core is a Node.js program. Launching it needs four things and never a
shell: an absolute Node executable, the absolute `wowbagger.js` the package
installed, an argument array, and `shell: false`. Neither path is discovered by
searching a global npm directory, and neither is a platform command shim.

Wowbagger requires Node.js 20 or later. The package declares that floor in
`engines.node`, and the launch seam exports it as `MINIMUM_NODE_MAJOR` for a
host that resolves its own runtime instead of reusing the one it is running on.

~~~js
import { resolveCoreLaunch } from 'wowbagger';

const launch = resolveCoreLaunch(['capabilities', '--json']);
// { executable: <absolute Node executable>, args: [<absolute wowbagger.js>, 'capabilities', '--json'], shell: false }
~~~

`resolveCoreLaunch(argv, { nodeExecutable })` supplies a host-resolved runtime.
The executable must be an absolute path: a bare name such as `node` is refused
rather than left for `PATH` to answer, because PATH lookup is the discovery this
seam exists to remove.

A host that wants the script path alone, without importing anything, resolves
the published subpath:

~~~js
const script = fileURLToPath(import.meta.resolve('wowbagger/wowbagger.js'));
~~~

`CORE_SCRIPT_PATH` from the main entry is the same absolute path. Both are
resolved from the installed package's own location, so they are correct for a
global install, a local install, a workspace link, and a plain clone alike, and
neither depends on the caller's working directory.

The `bin` mapping still exists and is still the supported way for a person at a
terminal to run `wowbagger`. It is not the seam for a host: on Windows it is a
`.cmd` shim that cannot be spawned without a shell at all.

## 2. The process tuple

| Element | Value | Owner |
|---|---|---|
| executable | the absolute Node executable | host |
| argv | `[<absolute wowbagger.js>, ...coreArguments]` | Wowbagger publishes the array; the host passes it verbatim |
| `shell` | `false`, always and never a shell | Wowbagger |
| working directory | the directory that owns the ledger path | host |
| stdin | bounded request bytes, then EOF | host |
| stdout | captured, byte-exact, one JSON object and one LF | host captures; Wowbagger writes |
| stderr | captured; empty on every `--json` response | host captures |
| timeout | a wall-clock bound the host enforces | host |
| cancellation | the host's own signal or kill | host |
| process-tree containment | a process group or job object the host reaps | host |
| stream caps | a byte cap on captured stdout and stderr | host |

The argument array goes to the process verbatim: never a shell, never a
concatenated command string, and never a string a shell would re-split. Every
argument value — a ledger path, an item ID, a date — travels as one array
element, so no quoting rule exists to get wrong.

`--ledger` is a host-chosen path. The core performs no ledger discovery and
binds no implicit path.

### A missing executable is a host result

A missing or unlaunchable executable is a host-level result, not malformed
Wowbagger JSON. A process that never started emitted nothing, so there is no
envelope to parse and no exit code to interpret; the host reports its own
transport failure. Core failures that do run keep their documented response
domains and exit codes, in section 5.

## 3. Bounded input and output

### Input

A mutation request is strict UTF-8 JSON with one top-level object. It reaches
the core in exactly one of two ways:

1. **Bounded stdin.** `--input -` reads standard input to EOF. The host writes
   the complete request, closes the stream, and enforces its own byte bound
   before it writes.
2. **A host-created request file.** `--input <file>` reads a file the host
   created with the permissions it wants. A secure host-created temporary file
   is the alternative when a runtime cannot deliver stdin.

Never shell source, and never inline unbounded argv JSON. An invocation
primitive that carries argv only cannot call `transition` at all; that is the
gap the two transports above close, and widening argv is not the answer.

### Output

Every `--json` invocation writes exactly one JSON object and one trailing LF to
stdout, and nothing to stderr. A host caps both streams and treats an incomplete
stdout as an unresolved outcome, not as a refusal.

`list` and `inspect --workbench` are the two bounded reads: each carries an
advertised response bound, refuses rather than exceeding it, and says which
bound it hit. A full `inspect` has no response bound, and this is deliberate
rather than an omission. `inspect` is lossless: it returns the complete
base64 item source beside the parsed core view, and an item committed before
`max_item_source_bytes` existed is still inspectable. Bounding it would make the
one read an operator uses to repair an oversized item the one read that refuses.
A host that needs a bound uses `list` to choose a row and reads
`max_item_source_bytes` to size its buffer for the read that follows.

## 4. Path semantics on the owning host

The host that owns the workspace is the host that runs the core, with that
runtime's own Node executable and that runtime's own path spelling. There is
no cross-runtime path guessing.

| Host shape | Ledger path | Node executable |
|---|---|---|
| native worktree or plain folder | the local absolute path | the local runtime's Node |
| Git worktree | the worktree's own path, not the main checkout's | the local runtime's Node |
| direct SSH | the remote absolute path, resolved on the remote | the remote runtime's Node |
| WSL or another paired runtime | the path as that runtime spells it | that runtime's Node |

A Windows host must not translate a path into a WSL path, or the reverse, and
then launch the other runtime's core against it. Route the invocation to the
runtime that owns the workspace and let it resolve its own package.

Routing, relay negotiation, credential forwarding, and consent are the host's
concerns. Wowbagger neither performs nor validates them.

## 5. Reading the response

### Dispatch on the namespace first

A consumer must dispatch on the root `namespace` member before it reads any
version field. Two domains answer to `capabilities`, and one core command can
answer in two domains, so the command member alone is ambiguous.

1. A response with a root `namespace` member belongs to the domain that member
   names.
2. A response with no namespace member but a root `ok` member belongs to the core
   domain; its `contract_version` is the core contract version.
3. A response with neither is a bare result. Only `validate` and `ready` emit
   one, and they are deliberately outside the envelope rule for compatibility.

| Domain | Root `namespace` | Version to negotiate |
|---|---|---|
| core | absent | top-level `contract_version` of `capabilities --json`, currently `5` |
| bare result | absent, and no `ok` member either | none |
| work-claim | `work-claim` | `result.operations.work_claim.api_version` |
| ledger-publication | `ledger-publication` | the same work-claim `api_version` |
| ledger-mutation | `ledger-mutation` | the same work-claim `api_version` |

A claim-domain `contract_version: 1` is the legacy envelope marker. Never
compare it with the core `contract_version`.

### Exit status

| Exit | Condition |
|---:|---|
| 0 | successful command; a mutation is state `committed` |
| 1 | a bare-result command found the ledger invalid |
| 2 | argument, request, lookup, or candidate/lifecycle/layout-precondition failure |
| 3 | the complete configured ledger is invalid |
| 4 | cooperative comparison, lock, identity, or default-path conflict |
| 5 | the backend lacks the required capability or write scope |
| 6 | an unexpected operating or post-publication recovery condition |

Only exit 0 is normal completion. A host must read the mutation `state` member
on every nonzero `create`, `transition`, or `patch` result.

### When the response is lost

Only complete observed process output establishes a result. When a transition's
response never arrives — a signal, a timeout, an incomplete stream, or a lost
transport — the outcome is unresolved, and the host follows one sequence:
**Dispatch once, never replay, invalidate the inspected revision, reconnect,
then re-read the ledger.** A later ledger state is not causal proof that the
lost dispatch produced it.

Exit 4 `revision-conflict` is the exception in the other direction: it is a
proven non-write. Re-inspect for the current revision and dispatch again with
it.

There is no operation identity, operation journal, replay endpoint, or automatic
retry, and adding correlation requires a new contract decision. [The mutation
contract](mutation-contract.md), section 10, is normative for this behaviour.

## 6. Advertised limits and capabilities

`capabilities --json` advertises every semantic limit under the negotiated core
contract version. Read them there: no consumer must infer a limit from an
adapter implementation, and none of these numbers is discoverable any other way.

| `result.limits` member | Value | Meaning |
|---|---:|---|
| `max_item_source_bytes` | 8388608 | the complete serialized item source at every candidate door |
| `default_list_page_size` | 50 | the page size `list` uses when the query names none |
| `max_list_page_size` | 200 | the largest page size a query may request |
| `max_list_title_characters` | 120 | the code-point bound on a projected list title |
| `max_list_response_bytes` | 131072 | the whole `list` response, envelope and trailing LF included |
| `max_workbench_title_characters` | 120 | the code-point bound on a projected workbench title |
| `max_workbench_collection_entries` | 50 | the largest bounded workbench collection |
| `max_workbench_response_bytes` | 65536 | the whole `inspect --workbench` response |

The same envelope advertises which operations exist and how they are negotiated:
`result.operations.list.query_version`,
`result.operations.inspect.workbench.projection_version`,
`result.operations.report.config_versions` with `named_views`, and
`result.operations.work_claim.api_version`. The list query and the workbench
projection have their own version domains; a shape this core does not recognize
is refused by that number, not by the core contract version.

`result.limits` also states plainly what the local backend does not do:
`multi_item_atomicity`, `cross_clone_coordination`,
`cross_worktree_coordination`, `cross_machine_coordination`,
`noncooperating_writer_protection`, and `automatic_stale_lock_breaking` are all
`false`.

## 7. Packaged JSON Schemas

The schemas are published with the package and resolvable from an installed
consumer as `wowbagger/schemas/<file>`. `schemas/index.json` names each one's
response domain and that domain's version. Each `$id` is a stable identifier,
not a fetch URL.

| Schema | Domain | Validates |
|---|---|---|
| `common.json` | shared | definitions reused below; not a validation target on its own |
| `core-envelope.json` | core 5 | every core-domain response, by its four exact root shapes |
| `core-capabilities-response.json` | core 5 | `capabilities --json`, including every advertised limit |
| `core-inspect-response.json` | core 5 | the default lossless `inspect` read |
| `core-inspect-workbench-response.json` | core 5 | `inspect --workbench`, projection version 1 |
| `core-list-query.json` | list query 1 | the strict `list` request |
| `core-list-response.json` | core 5 | a bounded, paginated `list` page |
| `core-list-error-response.json` | core 5 | every documented `list` refusal |
| `core-transition-request.json` | core 5 | the strict `transition` request |
| `core-transition-response.json` | core 5 | a committed `transition` |
| `core-transition-error-response.json` | core 5 | every documented `transition` refusal, with its state |
| `core-report-response.json` | core 5 | `report` publications and refusals, including a named view |
| `bare-validation-result.json` | bare result | `validate`, and `ready` on an invalid ledger |
| `bare-ready-result.json` | bare result | a `ready` success |
| `ledger-mutation-refusal.json` | ledger-mutation 1 | the legacy-write fence refusals |
| `report-config-v1.json` | report config 1 | `<ledger>/.wowbagger/report.json` at version 1 |
| `report-config-v2.json` | report config 2 | the same file at version 2, which names views |

Every schema fixes its root members exactly and pins the version of its own
domain. A core schema therefore refuses a namespaced refusal, a neighbouring
contract version, and an extra root member, and a version 1 report configuration
refuses a version 2 one. Validate against the schema for the domain you
dispatched to, never against a union of all of them.

## 8. What Wowbagger does not provide

These are host concerns or rejected product behaviour. They are not coming to
the core, and a host must not read this contract as a promise of any of them:

- consent UI, declared-tool policy, and audit records;
- opaque workspace tokens, focus generation, and focus invalidation;
- remote routing, relay negotiation, and credential forwarding;
- process spawning, host caps, and cancellation enforcement;
- workspace event listeners and change notifications;
- an automatic transition, a scheduled mutation, or any write the caller did
  not dispatch explicitly;
- mirrored ledger state or a second store; a response is a live projection and
  may be cached as transient interface state only;
- operation identity, an operation journal, or a replay endpoint; and
- a daemon, an RPC service, or a long-lived core process.

Each invocation is one process, started by the host, that reads a request,
writes one response, and exits.
