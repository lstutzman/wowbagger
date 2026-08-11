---
schema_version: 2
id: wb_01KZHX3E001CSCENR21QMTDJFN
number: 39
title: "Close the bootstrap wire's duplicated refusal paths"
kind: task
status: done
created: 2026-08-09
updated: 2026-08-10
completed: 2026-08-10
provenance:
  source: "code-review"
  recorded_at: "2026-08-09T14:05:00.000Z"
depends_on: [ wb_01KZ77NSW8ZP1289HFMN2ECNXD ]
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-10
    summary: "Accept into backlog: close the bootstrap wire's duplicated and unreachable refusal paths."
    rationale: "A review found the entrypoint's inner refusal branches unreachable and message/shape duplication across tables and the reference model; the work is a contract decision, not a silence."
  - action: complete
    date: 2026-08-10
    summary: "Closed the bootstrap wire's duplicated refusal paths and bounded describe reads."
    rationale: "D1: describe and invoke both read under the configured request byte ceiling (was unbounded for describe, the first call any host makes), with a mutation-guarded test proving the bounded reader bails on an oversized never-ending stream instead of hanging. D2: refusal messages moved to a single src/adapter/messages.js source (INVOKE_MESSAGES) consumed by both invoke.js and the entrypoint, with a wire-level test pinning the shipped message so it cannot silently diverge from the reference model; oracle untouched. D3: unknown operations are refused before reading stdin (previously they read stdin, misreported malformed reads as describe errors, and hung on a host that never closes stdin), with mutation-guarded tests. Also fixed the readBootstrapRequest detail asymmetry (parse branch now returns detail {member: request_json}). Suite 657/657 on current node and node 20; adapter conformance pass; ledger valid."
---

A review of the Plan 2 work found six issues that were deliberately left unfixed,
because each is a design question rather than a defect with an obvious answer.
They are recorded here so they are not rediscovered from scratch.

The entrypoint hand-builds an invoke-shaped refusal for the oversize and
parse-failure cases, using the same threshold and shape that `invokeAdapter`
already enforces internally. Both inner branches are therefore unreachable from a
shipped adapter. The reference model in `spec/run-adapter-vectors.js` is documented
as the function that enforces `max_request_bytes` before parsing, so it no longer
governs the two cases it was written to govern. A correction to the inner refusal
details would land in the reference model and go green in the vectors while all
three shipped entrypoints kept emitting the old shape.

The message `The adapter invocation is invalid.` now exists in three places: the
`MESSAGES` table in `src/adapter/invoke.js`, the `OUTER_ERROR_MESSAGES` table in
`spec/adapter-reference.js`, and as a bare literal in the entrypoint. The error
registry test pins codes against the contract and the vectors; nothing pins the
messages. Changing it in the two tables diverges the wire from the reference model
with no test failing.

Smaller items on the same boundary:

- `describe` passes no byte ceiling at all, so a hostile describe payload is
  unbounded. Whether describe should carry a limit, and which one, is a contract
  question section 3.3 does not currently answer. It is the first call any host
  makes, so it is the more reachable surface.
- `readBootstrapRequest` returns `detail` on the limit branch and drops it on the
  parse branch, and the describe caller ignores `detail` entirely.
- An unknown operation still reads stdin and reports a describe-shaped error rather
  than `invalid-invocation`, and hangs if the host never closes stdin.
- A stdin read error throws out of the read loop and rejects the entrypoint's
  top-level await, producing an unhandled rejection and zero JSON objects on
  stdout. That breaks the section 3.3 guarantee of exactly one object plus one LF.

The two defects the same review found in the byte limit itself were fixed at the
time and are not part of this item.
