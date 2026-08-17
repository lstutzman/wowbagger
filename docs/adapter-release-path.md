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
adapter and no dynamic capability result. A v1 or v2 adapter probing the v3
core sees `contract_version: 3` and refuses before the requested command.
Neither pairing silently selects the other version's behavior.

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

## How a release is cut

**Merge session work to `main` first, then cut on `main`.** This is the ritual,
and `scripts/cut-release.js` enforces the part of it that is checkable: it
refuses to run unless HEAD is the tip of the release branch (`main` by default,
`--branch` to override) and is not behind its upstream. The old two-phase
sequence — cut in a session worktree, merge afterwards, tag the merge — is
retired. It is why `v0.1.0-alpha.5` and `v0.1.0-alpha.6` name merge commits
`115799e` and `26369ef` rather than their cut commits `310a9cc` and `5ebd40c`,
which made the published HEAD differ from the tag the prepublish guard checks.

The cut itself is one command:

```sh
npm run release:cut -- <version> --date YYYY-MM-DD [--dry-run]
```

`--date` is required: a changelog heading must not depend on the operator's
clock or locale. The command refuses a dirty checkout, a non-increasing or
malformed version, a target that already exists as a local tag, a remote tag, or
a published npm version, and a `## Unreleased` section that is absent,
duplicated, or empty. Nothing is written until every one of those passes.

**Version sites are proved, not grepped.** `scripts/release-version-sites.json`
classifies every literal occurrence of the current version in a tracked text
file as `mutable` (moves with the release) or `retained` (history that must keep
naming the old version), by JSON Pointer or by an anchored text locator carrying
a `{version}` placeholder, each with an exact occurrence count. Before planning,
the command scans every tracked text file: each occurrence must match exactly
one locator, and each locator must match exactly the count it declares. After
planning, surviving old-version occurrences must equal the retained set exactly
and new-version occurrences must equal the mutable set plus the new changelog
heading. A global "grep finds nothing" test would be wrong — the changelog and
the dated design records must keep their old versions — so exact-set equality is
the proof. A release site added next month is unmanifested and fails the cut
rather than shipping stale.

The manifest is maintained by hand; the cut command never edits it. A locator
may carry `applies_to_version` when it describes a dated record that names one
specific release; such a locator is dormant for every other cut instead of
needing to be pruned. The manifest file itself is excluded from the scan,
because its version literals are locator keys rather than release sites.

**The changelog is never renamed.** The cut opens a fresh empty `## Unreleased`
and files the released notes under `## <version> - <date>` directly beneath it.
The two previous cuts renamed the heading instead, which left the file with no
bucket for the next change; the command now makes that outcome impossible.

After planning, the command materializes the bytes, runs the full release gate
over them (the four verification commands above on both runtimes, all three
adapter targets, `npm audit --omit=dev`, and both Git whitespace checks), and
only then creates one `Cut <version>` commit and one **annotated** `v<version>`
tag, in that order. A red gate restores every byte and creates no commit and no
tag. `--dry-run` runs the same planner and the same gate against a copy of HEAD
and then proves the repository's HEAD, refs, index, and worktree bytes are
unchanged.

Reruns converge rather than repair: a cut tag at a clean HEAD reports
`already cut`, a complete cut commit without its tag resumes at tagging, and a
tag pointing at another commit refuses.

## What the cut deliberately does not do

The command stops at a verified local tag. These remain separate, named states,
because no local command can undo any of them:

1. `git push` the commit, then `git push` the tag. Confirm the remote tag
   resolves to the pushed HEAD.
2. `npm publish --tag next`, in an interactive terminal — the account
   authenticates with a WebAuthn passkey. **The `--tag next` is not optional:** a
   plain `npm publish` recreates `latest`, and `prepublishOnly` cannot see the
   operator's publish flag.
3. `npm run release:channels -- check <version>` as post-publish verification.

Never report a release as shipped after only the local cut.

## The prerelease channel policy

While every published release is `0.1.0-alpha.*` the target state is
**`latest` mirroring `next`**: both dist-tags name the newest published
prerelease, with `0.1.0-alpha.1` deprecated (deprecated, never unpublished — an
existing installation keeps working and warns on the next install). The
first-choice policy was no `latest` tag at all, so a bare install fails loudly;
the registry refused it — `npm dist-tag rm wowbagger latest` returns E400
(verified live 2026-08-17), because npm mandates every package carry a
`latest`. Given that forced tag, the current prerelease is strictly better than
the dead first alpha it used to serve. `wowbagger@next` stays the documented
install.

`scripts/release-channels.js` encodes that policy:

```sh
npm run release:channels -- check <version>            # read-only, post-publish
npm run release:channels -- repair <version> --dry-run # print the writes
npm run release:channels -- repair <version>           # authenticated writes
```

`check` reads the registry and never writes. `repair` is idempotent: it moves
`next` and `latest` only when either is wrong and applies the deprecation only
when the approved message is missing. Whether `next` is retained for the
prerelease line after the first stable release is decided then, not now.
