# Wowbagger standalone v0 plan

Status: in progress

## Product boundary

Wowbagger v0 stands on its own. It consumes only a configured Markdown ledger
and its own documented contracts. It has no PropertyCompass runtime dependency,
policy input, installation step, configuration, consumer migration, or release
gate.

PropertyCompass experience may inform anonymized synthetic fixtures and general
requirements, but no consumer data, source paths, vocabulary, report branding,
or backlog records enter this repository.

## Phase 0: contract and fixtures

Deliver SPEC.md, ADR 0001, and synthetic black-box fixtures. The contract
defines immutable identity, structured provenance, lifecycle safety, dependency
liveness, fail-closed validation, deterministic read-only readiness, and the
durable-ledger versus run-local boundary.

Exit criteria:

- fixtures contain no consumer-specific facts;
- IDs are remote-independent and their UTC timestamp dates match created;
- killed or archived prerequisites cannot silently ready dependents;
- the documents do not choose an implementation language or dependencies.

## Phase 1: read-only core

Implement validate and ready against the specification and fixture suite.
Validation fails closed. Ready emits deterministic machine-readable output,
orders by created then ID, and does not mutate files.

Exit criteria:

- valid and invalid fixtures produce the expected results and stable messages;
- the core runs without an adapter, remote, policy engine, or claim backend;
- malformed or incomplete ledgers never produce a partial ready queue;
- snoozed_until equality is eligible and epics never dispatch.

## Phase 2: mutations and compare-and-set

Status: implemented and verified in the pre-alpha standalone runtime.

ADR 0003, the local mutation contract, and synthetic mutation vectors define
the implemented first backend as local-filesystem, cooperative, and single-item
only. The runtime exposes those commands directly without an adapter.

Implement capability reporting, item creation, inspect/revision, and lifecycle
transitions only where a backend can honestly provide them. The local backend
must refuse rather than sequence a required dependent disposition, child
disposition, or other multi-file write.

Exit criteria:

- creation requires a caller-generated collision-resistant immutable ID and
  publishes complete bytes through atomic no-clobber or fails unchanged;
- inspection exposes a lossless exact source from the same bytes it hashes, and
  successful local transitions use cooperative single-item CAS only;
- done, killed, and archived transitions that require relation cleanup in
  SPEC.md inspect every referring item, validate the complete proposed ledger,
  and fail unchanged until a backend advertises suitable multi-item atomicity;
- unsupported mutation or CAS requests fail without changing the ledger;
- conflict and recovery cases are black-box tested;
- no documentation promises global atomicity for a local or Git-only backend.

Work-claim storage is not part of this implemented phase. [ADR
0004](../adr/0004-fenced-work-claim-protocol.md) and the separate claim
contract now define the required envelope and fail-closed resolution behaviour;
the current local runtime remains claim-unsupported until a future backend
implements them.

## Phase 3: optional policy engine

Define a generic policy-input contract for consumers that want ranking, report
styling, or enrichment guidance. Core ready first returns the valid lifecycle
candidate set ordered by created and ID; policy ranks or decorates that result
separately and cannot change core validity or readiness.

Exit criteria:

- core readiness remains deterministic when no policy is installed;
- policy absence never causes invented defaults;
- fixtures prove that policy cannot bypass lifecycle validity.

## Phase 4: harness adapters

Build thin Claude Code and Codex adapters that discover instructions and invoke
the same core commands. Document the generic tool contract for other harnesses.
Adapters may package discovery metadata, but they do not duplicate lifecycle or
policy logic.

Exit criteria:

- each adapter passes the common black-box fixture suite;
- a direct core invocation and adapter invocation have equivalent observable
  results;
- adapters remain optional to core operation.

## Phase 5: release readiness

Document installation, compatibility guarantees, versioning, security posture,
and supported backend capabilities. Publish only after the standalone core and
adapters have stable compatibility evidence.

Exit criteria:

- a versioned release can be installed and evaluated without a consumer
  repository integration;
- the README and integration guidance distinguish supported guarantees from
  future capabilities;
- release validation uses only standalone synthetic fixtures.

## Explicit deferral: PropertyCompass adoption

PropertyCompass adoption is a later, independent consumer decision. It starts
only after a versioned Wowbagger release exists and a separate consumer
adoption item selects that version and defines its migration evidence.

No current Wowbagger phase may modify PropertyCompass files, install an adapter
there, move its policies, or migrate its backlog. Historical PropertyCompass
material remains reference evidence in its own repository.
