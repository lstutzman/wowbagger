---
schema_version: 1
id: wb_01KZHX3E00F59S35P71X9JGGB6
number: 41
title: "Fix the adapter defects three reviews confirmed"
kind: task
priority: 1
status: triage
created: 2026-08-09
updated: 2026-08-09
provenance:
  source: "code-review"
  recorded_at: "2026-08-09T15:12:00.000Z"
depends_on: []
related: [wb_01KZ77NSW8ZP1289HFMN2ECNXD]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

Three independent reviews of the Plan 2 and Plan 3 work each confirmed their
findings by mutation. These are the defects in adapter behaviour, as distinct from
the runner weakness recorded separately.

Mutation authority and recovery, the sharpest group:

- Any launcher exception becomes a fabricated `started: false` observation, so a
  mutation that already applied is reported as `core-launch-failed` rather than
  `mutation-outcome-unknown`. A caller may then retry an applied mutation. Changing
  the fabricated observation to `started: true` left all 582 tests and all 183
  assertions green, so nothing tests it.
- A contradicted mutation observation bypasses unknown-outcome handling whenever
  `started` is exactly `false`. The shipped mapper returns
  `core-observation-incomplete` where the oracle returns `mutation-outcome-unknown`.

Forwarding and envelope handling:

- Envelope validation covers only `ready`, `validate`, and `capabilities`, so every
  `inspect`, `create`, and `transition` envelope is classified invalid. A real
  successful `inspect` becomes `core-protocol-error`.
- Response contents are not bound to the launched request. A child answering a
  different `as_of` than it was asked for is forwarded as a complete success.
- A stdin stream error escapes the bootstrap flow, producing no stdout object, an
  uncaught stack trace, and exit 1. Section 3.3 requires exactly one JSON object
  plus one LF and exit zero on every path.

Path safety, masked by weak vectors:

- The path-syntax assertions pass through a later missing-snapshot refusal, so they
  never prove the syntax guard fired. Removing the drive-prefix, backslash, and
  volume-prefix guards separately each left conformance at 183 of 183 and the suite
  at 582 of 582, while direct calls then accepted `C:repo`, `\\server\share`, and
  `Volume{fixture}/repo`. The win32 refusals are effectively untested.

Type coercion in the authority surface, from the security review:

- The approval nonce regex accepts non-string values through coercion, which
  defeats single-use redemption by type confusion: a numeric nonce and its string
  form are distinct set members, so one approval redeems twice.
- The instruction source-ID regex coerces likewise, so `source_id: null` passes the
  exact source schema and reaches launch.
- `validateHandoffResume` verifies digests without parsing the handoff bytes, and
  accepted arbitrary non-JSON content. The main `invokeAdapter` path uses the
  stronger `validateHandoffCarrier`, so this is currently unreachable there.

Unpinned boundaries, where a surviving mutant marks untested code:

- The captured-stdout equality boundary in `process-outcome.js`: `>` to `>=`
  survived the whole suite and the whole conformance run.

The security review also confirmed the core authority model holds. Approval expiry
is inclusive at issue and expired at the instant of expiry, binding mismatch is
refused, string-nonce replay is refused, every untrusted source is refused, the
unsupported-handoff gate wins before carrier parsing, and claims stay advisory
under fenced, publication-protected, and safe-exclusive probes.
