---
schema_version: 2
id: wb_01KZHX3E00XVRADSYMHC29A88Y
number: 40
title: "Make the conformance run evidence the shipped entrypoint"
kind: task
priority: 1
status: done
created: 2026-08-09
updated: 2026-08-10
completed: 2026-08-10
provenance:
  source: "code-review"
  recorded_at: "2026-08-09T15:10:00.000Z"
depends_on: []
related: [ wb_01KZ77NSW8ZP1289HFMN2ECNXD ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-10
    summary: "Accepted; the work was delivered in the same session that filed it."
    rationale: "The conformance run now drives the shipped entrypoint over the real wire, and the runner fails closed on unknown modes, corrupted artifact hashes, skipped assertions, and declared baseline evidence it previously ignored."
  - action: complete
    date: 2026-08-10
    summary: "Delivered and verified."
    rationale: "The conformance run now drives the shipped entrypoint over the real wire, and the runner fails closed on unknown modes, corrupted artifact hashes, skipped assertions, and declared baseline evidence it previously ignored."
---

The implementation runner reports 183 of 183 assertions and 15 of 15 cases as
`pass`. That number does not mean what item 13 requires it to mean.

Item 13 asks for a runner that evaluates each assertion "against the installed
Claude Code entrypoint rather than against a reference model". The runner instead
imports `invokeAdapter` directly and injects a synthetic platform map, a synthetic
workspace map, and a synthetic launcher. The shipped entrypoint is never on the
path being measured.

Driven for real, `adapters/claude-code/entrypoint.js` cannot invoke the core at
all. It refuses with `adapter-platform-mismatch`, because darwin is `unverified`
in its own manifest. Forced past that, every workspace command meets a hard-coded
empty workspace map and returns `path-rejected`, and every core command meets a
hard-coded throwing launcher and returns `core-launch-failed`. The entrypoint's
dynamic result nonetheless advertises command execution, and its core probe runs
in-process rather than against a real core.

The proof is a single mutation: removing the required trailing LF from
`writeBootstrapResponse` left the conformance run green at 15 of 15, while the
real process-wire tests failed 18 of 20. A conformance run that survives a broken
wire is not measuring the wire.

The runner also fails open in four further ways the reference runner catches:

- an unknown execution mode still contributes a passing case;
- a corrupted artifact SHA-256 still contributes a passing case;
- `executed_assertions` is copied from the manifest rather than derived from
  completed evaluations, so a skipped assertion is still reported as executed;
- the core-baseline evaluator ignores the assertion's declared `stdout_artifact`,
  `stderr_bytes`, and `exit_code`, so a manifest claiming exit 99 still passes.

Item 13's criteria are explicit that a skipped, unknown, or unconsumed assertion
must fail the run. Today it does not.

Until this is fixed, section 10's `Implementation-pass (darwin)` entry for the
Claude Code column is not earned and must not ship, and item 13 cannot close on
the strength of the current run.
