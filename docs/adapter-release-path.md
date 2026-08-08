# The shared adapter packaging and release path

Version 1. One packaging and release path ships a single core version to
every harness adapter, so the adapters cannot drift apart. This records the
four scope answers; three shipped with the adapter work at `ae3dcb4` and are
restated here only so the path reads as one document.

## One repository, one version

The core and every adapter package live in this repository and release
together. A release is a git tag of this repository; installing
`github:lstutzman/wowbagger` at a ref installs the core and every adapter
that ref carries. No adapter bundles a core or acquires its own copy —
adapters depend on the installed core, which keeps version skew detectable
instead of silent (decision recorded on the release-path ledger item).

How a released core version is identified:

- **The behavioural version is `contract_version`**, reported by
  `capabilities` and required by adapters as
  `required_core_contract_version` in the section 3.1 manifest. Contracts
  change it; refactors do not.
- **The distribution version is the repository tag** (npm `version` in
  `package.json` matches it at tag time). It names bytes, not behaviour.
- CHANGELOG.md records behaviour changes per release; the first tagged
  release inherits the current Unreleased section.

## How an adapter declares support

`required_core_contract_version` in its manifest, validated before the
adapter advertises anything (section 3.1). The adapter and the core it finds
at runtime may be installed separately, which is exactly the skew the next
rule exists for.

## What happens on an unsupported pairing

`verifyCoreProbe` compares the independently-launched core
`capabilities --json` probe against the validated describe result and
refuses a mismatch with `core-contract-version-mismatch` — machinery that is
mutation-verified in the tree. Refusal, never a guess.

## How a candidate release is checked

`node spec/run-adapter-implementation.js --target <adapter>` runs the shared
normative vectors against the shipped engine for each adapter target before
a tag is cut, alongside the full suite on Node 26 and Node 20 and
`npm audit --omit=dev`. A target whose evidence regresses does not ship.
