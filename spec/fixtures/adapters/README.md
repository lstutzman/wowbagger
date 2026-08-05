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
