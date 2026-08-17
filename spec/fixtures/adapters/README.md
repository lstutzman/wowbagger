# Harness-neutral adapter conformance vectors

These fixtures are normative synthetic evidence for
[the harness-neutral adapter contract](../../../docs/adapter-contract.md).
They define a future adapter runner; they do not implement Claude Code, Codex,
Kimi, or an OpenAI-compatible adapter.

Each case directory has one strict UTF-8 JSON `manifest.json`. The manifest
lists every artifact other than itself with its exact SHA-256 digest over raw
bytes. JSON objects must not contain duplicate members. Artifact paths are
relative, use forward slashes, and cannot escape their case directory.

Every case names its applicable target set:

- `direct-core` is present only for equivalence assertions that run the real
  reference CLI. It is not a target for adapter-only behavior.
- `claude-code` is a future Claude Code adapter.
- `codex` is a future Codex adapter.
- `kimi` is a future Kimi-hosted adapter when its host has the required tools.
- `openai-compatible-harness` is a future generic harness adapter with the
  required tools. An API-only OpenAI-compatible endpoint is a negative profile,
  not this target.

## Environment requirement: run from a git checkout

**Run these vectors from a real git checkout of this repository.** They are not
reproducible from an exported tarball, an `npm pack` extraction, or a container
build context that does not copy `.git`.

The `10-capabilities-forwarding` case compares the core's `capabilities` output
byte for byte. In core mutation contract version 2, one member of that output
is derived from whether a `.git` directory can be resolved from the working
directory:

- `operations.work_claim.supported` — `true` with git, `false` without

The mutation members are fixed regardless of Git discovery:

- `backend.coordination_scope` — `same-working-copy-cooperative-writers`
- `limits.cross_worktree_coordination` — `false`

The committed expectation pins the Git-present claim value. Without a `.git`
directory the core truthfully reports claims unsupported, the byte comparison
fails, and **that failure is caused by the environment, not by the adapter
under test**. Do not treat it as an adapter defect.

The remaining members, including every work-claim safety member
(`mode`, `claim_protected_publication`, `fencing_enforced_at`,
`safe_exclusive_dispatch`), are fixed regardless of git presence.

Making the vectors self-sufficient would require the harness to synthesize a
git directory at two independent call sites — `evaluateCoreBaseline` in
`spec/run-adapter-vectors.js`, and the standalone baseline test in
`test/adapter-vectors.test.js` — and the manifest schema has no field for
declaring a precondition. Documenting the requirement was chosen over changing
the harness; see ledger item `wb_01KZBNMT39DE0F95RV0C5K0EJQ`.

## Manifest contract

```json
{
  "adapter_vector_version": 1,
  "case": "ready-forwarding",
  "coverage": ["bounded-io", "core-forwarding"],
  "targets": [
    "claude-code",
    "codex",
    "direct-core",
    "kimi",
    "openai-compatible-harness"
  ],
  "mode": "equivalence",
  "assertions": [],
  "artifacts": []
}
```

`mode` is one of:

- `equivalence`: each tool-capable adapter must preserve the direct-core
  baseline exit code and raw standard streams.
- `negative-capability`: a host without the stated prerequisite must refuse
  before core launch. It must not manufacture an equivalent core result.
- `protocol`: the adapter must preserve a declared contract input or handoff;
  no core command is required in that case.

Each assertion has an `id`, a `type`, and a value specific to that type. The
supported types are `core-baseline`, `capability`, `instruction-order`,
`path-refusal`, `output-bound`, `approval-gate`, `resume-plan`,
`platform-status`, `process-outcome`, `path-race`, `path-syntax`,
`snapshot-identity`, `entrypoint-path`, `invoke-version`, `core-probe`,
`negotiation`, `context-validation`, and `approval-schema`. A runner must fail
closed on an unknown assertion type or a vector version other than exactly 1.

## End-to-end core-outcome scenarios

A `core-baseline` assertion may carry a `scenario` member naming a
subdirectory of the case's `scenarios/`. That is the one extension to the
assertion shape, made inside `adapter_vector_version` 1 rather than by moving
the manifest protocol: no existing assertion changes meaning, and a runner that
does not read `scenario` still fails closed on the artifacts it cannot find.

A scenario directory holds its own `scenario.json`, `core-invocation.json`,
`invocation.json`, `expected-core-stdout.jsonl`, `expected-adapter-result.json`,
its mutation input, and the exact ledger bytes for its before and after states.
Every one of those files is a hashed artifact in the case manifest under its
`scenarios/<name>/…` path. `scenario.json` declares:

- `workspace.kind` — `plain`, `git-provisioned` (a seeded namespace, a
  hand-authored claim journal, and a fixed future clock floor), or
  `git-unverifiable` (a `.git` marker the walker finds and `git rev-parse`
  cannot confirm).
- `workspace.clock_horizon` — the seeded clock floor. `observed_at` in a
  claim-fence read-back is `max(physical_now, floor)`, so the refusal bytes are
  fixed while wall time is before that instant. **Both runners fail loudly and
  name the date once it passes.** Re-seed the journal and the committed
  read-back with a later floor; do not normalize the observed value.
- `approval` — `consumer` when the invocation is a mutation the conformance host
  must approve, `none` otherwise.
- `ledger.before` / `ledger.after` — the complete ledger state, entry by entry,
  each pinned to a scenario-local source file by digest.
- `derived_from` — for every byte reused from a normative fixture elsewhere in
  the repository: the repository-relative source, its SHA-256, and the form
  (`bytes`, or `compact-json-line` for the one compact-JSON-plus-LF transform
  the core's stdout takes). A change on either side stops the vector and asks
  for a reviewed golden change instead of regenerating one.

Each assertion runs the direct core in one isolated temporary workspace and the
adapter engine in a second workspace materialized from the same before state.
Sharing one workspace would let the baseline mutation destroy the adapter's
precondition, so the two never touch.

Goldens here are hand-authored from `docs/adapter-contract.md`,
`docs/work-claim-contract.md`, and the normative `spec/fixtures/mutations/**`
bytes. Only base64, SHA-256, and byte length are derived, and only from an
already hand-authored byte string. Do not regenerate an expectation from a
passing run, add an auto-refresh path, or mask a field that moved.

The test at `test/adapter-vectors.test.js` validates strict JSON, exact hashes,
safe artifact paths, coverage completeness, and applicable target sets. Run
`node spec/run-adapter-vectors.js` for the semantic reference model. It runs
the real core baselines and every declared assertion, reports
`reference-pass`, records an evidence function for every assertion ID, rejects
duplicate-member JSON and artifact-hash drift itself, and semantically rejects
re-hashed wrong expectation artifacts rather than merely reading them. It
records all future implementations as `unverified`. A
future adapter implementation must run the semantic assertions on its actual
host and native platform before claiming support.

The artifacts use only invented workspaces, paths, text, IDs, and outputs.
They contain no consumer product data or vendor credentials.
