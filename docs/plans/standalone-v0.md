# Wowbagger standalone v0 plan

Status: planned

## Product boundary

Wowbagger v0 stands on its own. It consumes only a configured Markdown ledger
and its own documented contracts. It has no PropertyCompass runtime dependency,
policy input, installation step, configuration, consumer migration, or release
gate.

PropertyCompass experience may inform anonymized synthetic fixtures and general
requirements, but no consumer data, source paths, vocabulary, report branding,
or backlog records enter this repository.

## Phase 0: Contract and fixtures

Deliver SPEC.md, the identity-and-claim ADR, and synthetic black-box fixtures.
The contract specifies lifecycle, validation, readiness, capability boundaries,
and the difference between durable ledger work and run-local work.

Exit criteria:

- fixture data contains no consumer-specific facts;
- the ID and claim contract requires no remote;
- the documents do not choose an implementation language or dependencies.

## Phase 1: Read-only core

Implement validate and ready against the specification and fixture suite.
Validation fails closed. Ready emits deterministic machine-readable output and
does not mutate files.

Exit criteria:

- valid and invalid fixtures produce the expected results;
- the core runs without an adapter, remote, policy engine, or claim backend;
- malformed or incomplete ledgers never produce a partial ready queue.

## Phase 2: Mutations and compare-and-set

Implement item creation, lifecycle transitions, dependency normalisation, and
capability reporting. Add compare-and-set behaviour only where a backend can
honestly provide it.

Exit criteria:

- creation uses collision-resistant immutable IDs;
- unsupported claim or CAS requests fail without changing the ledger;
- conflict and recovery cases are black-box tested;
- no documentation promises global atomicity for a local or Git-only backend.

## Phase 3: Optional policy engine

Define a generic policy-input contract for consumers that want scoring, ranking,
report styling, or enrichment guidance. The core remains useful without it.
Policy values and weighting schemes are consumer-owned.

Exit criteria:

- core readiness remains deterministic when no policy is installed;
- policy absence never causes invented defaults;
- fixtures prove that policy cannot change lifecycle validity.

## Phase 4: Harness adapters

Build thin Claude Code and Codex adapters that discover instructions and invoke
the same core commands. Document the generic tool contract for other harnesses.
Adapters may package discovery metadata, but they do not duplicate lifecycle or
policy logic.

Exit criteria:

- each adapter passes the common black-box fixture suite;
- a direct core invocation and adapter invocation have equivalent observable
  results;
- adapters remain optional to core operation.

## Phase 5: Release readiness

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

No current Wowbagger phase may modify PropertyCompass files, install an
adapter there, move its policies, or migrate its backlog. Historical
PropertyCompass material remains reference evidence in its own repository.
