# The shared adapter packaging and release path

Version 2. One packaging and release path ships core mutation contract 2 and
adapter contract 2 to every harness adapter, so the adapters cannot drift
apart. Contract version 1 of each remains frozen and defined, but the shipped
manifests advertise only adapter `[2]` and require core `2`.

## One repository, one version

The core and every adapter package live in this repository and release
together. A release is a git tag of this repository. A tag is published to the
public npm registry as `wowbagger` and is also installable directly from a ref
(`github:lstutzman/wowbagger`); either route installs the core and every
adapter that tag carries. No adapter bundles a core or acquires its own copy —
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

`adapter_contract_versions` and `required_core_contract_version` in its
manifest, validated before the adapter advertises anything (section 3.1). The
version 2 manifests use `[2]` and `2`, respectively. The adapter and the core it
finds at runtime may be installed separately, which is exactly the skew the
next rule exists for.

## What happens on an unsupported pairing

`verifyCoreProbe` compares the independently-launched core
`capabilities --json` probe against the validated describe result and
refuses a mismatch with `core-contract-version-mismatch` — machinery that is
mutation-verified in the tree. Refusal, never a guess.

A v1-only consumer receives `unsupported-adapter-contract-version` from a v2
adapter and no dynamic capability result. A v1 adapter probing the v2 core sees
`contract_version: 2` and refuses before the requested command. Neither pairing
silently selects the other version's behavior.

## How a candidate release is checked

`node spec/run-adapter-implementation.js --target <adapter>` runs the shared
normative vectors against the shipped engine for each adapter target before
a tag is cut, alongside the full suite on Node 26 and Node 20 and
`npm audit --omit=dev`. A target whose evidence regresses does not ship.

The same release gate also runs `test/packaging.test.js`. It requires these
distribution versions to equal the `package.json` version before publication:

- `.claude-plugin/plugin.json` `version`;
- `.claude-plugin/marketplace.json` `metadata.version`; and
- the `wowbagger` marketplace entry's `version`.

Validate the plugin and marketplace manifests in the release checkout. The
marketplace source `ref` must name `v<package version>`. The prepublish gate
requires that tag to resolve to the clean release checkout, so the npm version,
Git tag, and all three plugin metadata values name the same bytes. A mismatch
blocks npm publication.
