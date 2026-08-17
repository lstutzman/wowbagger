---
schema_version: 2
id: wb_01KZHX3E00MX94XA5EG7J4TXWQ
number: 42
title: "Decide which vectors drive a real child and which inject an observation"
kind: task
priority: 1
status: done
created: 2026-08-09
updated: 2026-08-10
completed: 2026-08-10
provenance:
  source: "code-review"
  recorded_at: "2026-08-09T15:45:00.000Z"
depends_on: []
related: [ wb_01KZ77NSW8ZP1289HFMN2ECNXD, wb_01KZHX3E00XVRADSYMHC29A88Y ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-10
    summary: "Accepted; the work was delivered in the same session that filed it."
    rationale: "The runner dispatches on each vector's declared mode: equivalence launches a real core child, negative-capability forbids one, protocol injects the declared input. Section 10 records the rule."
  - action: complete
    date: 2026-08-10
    summary: "Delivered and verified."
    rationale: "The runner dispatches on each vector's declared mode: equivalence launches a real core child, negative-capability forbids one, protocol injects the declared input. Section 10 records the rule."
---

After item 40 made the conformance run drive the shipped entrypoint, three
assertions fail. Two independent investigations, deliberately assigned opposing
positions, reached the same conclusion: the adapter is correct on all three, and
the fixtures are correct for what they declare. The runner is comparing two
different things.

The reference runner never launches a core child. For `06-bounded-output` it
injects `process.json` as an already-complete process observation and checks only
how the adapter classifies it. The `exit_code: 0` in that fixture is therefore a
synthetic value chosen to exercise classification, not a prediction about a real
process. Proof that it was never a real observation: run without a limit, the
fixture's own `inspect` request emits 183 stdout bytes and exits 2, not 0.

The implementation runner instead launches a real child, which the contract
requires it to terminate on a stream limit, so it reports `exit_code: null`. That
is correct behaviour compared against a fixture that describes a different
scenario.

The same substitution explains `01-capability-separation`. Its
`adapter-capabilities.json` declares an `example.api-only` profile with
`command_execution.supported: false`. Under that profile both
`optional_features.claims: false` and a `capability-unavailable` refusal before
path handling are right, and the shipped engine produces exactly that response
when given the profile. The runner applies the API-only artifact to the real
Claude adapter, which does support command execution and probes a real core, so
it reaches `path-rejected` and derives `claims: true` from the live probe.

The decision this item needs is architectural, not mechanical. Not every vector
can be evaluated against a real process: some exist precisely to test how a
supplied observation is classified, and launching a child destroys what they
measure. The runner needs a principled split between the cases it drives for real
and the cases where it injects the declared observation, and section 10 should
say which is which rather than leaving it to the runner author.

Regenerating the fixtures to match a real run is the tempting answer and the wrong
one. It would delete the classification coverage these vectors exist to provide,
and it is the move that turns a measurement gap into a passing number.

One genuinely stale artefact did surface. `docs/adapter-contract.md` around line
318 still says a future versioned contract is required and the current core has no
claims. Commit `e23a2f4` moved the core, the oracle, and case 10 from "claims
unsupported" to "claims advisory" when item 16 landed, and did not repair that
sentence.
