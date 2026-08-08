---
schema_version: 1
id: wb_01KZCRA000W582NVMSR7D2S758
title: "State the transition request contract independently in the oracle"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-08
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T22:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
priority: 20
number: 39
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: the oracle asks the subject whether the subject is valid, for transition."
    rationale: "spec/adapter-reference.js imports validateTransitionRequest from src/mutation.js, so changing the rule in src moves the oracle with it and every conformance test stays green. Create was made independent in the ninth review round; transition was left because the hand-written create validator introduced two holes on its first attempt, and transition carries the lifecycle edge table, per-edge decision rules, terminal dates and epic rollup. Doing it hastily would repeat the failure with more surface."
  - action: record
    date: 2026-08-08
    summary: "Allocate handle 39 and rank the transition oracle gap at 20."
    rationale: "It was filed without a number because create cannot allocate one, and I then referred to it as item 39 in a commit message before the number existed. The gap it describes matters only when a second implementation is certified, and none exists."
---

`spec/adapter-reference.js` decides whether a transition request is canonical by
calling `validateTransitionRequest`, imported from `src/mutation.js` — the code
it exists to measure.

An oracle that asks the subject whether the subject's input is valid proves
nothing. Change the rule in `src` and the oracle's notion of a valid request
moves with it, so every conformance test stays green while the contract has
silently changed. `CONTEXT.md` defines an oracle as an independent
re-implementation for exactly this reason.

Create was made independent during the ninth review round. Transition was not,
and the reason is worth recording rather than hiding: the hand-written create
validator introduced **two holes on its first attempt**. It called
`WOWBAGGER_ID.test()` without a `typeof` guard, so a one-element array coerced
to a string and passed as a canonical ID, and it accepted any string for
`provenance.recorded_at` where the real validator requires an RFC 3339 UTC
instant. Both would have made the oracle certify a request the CLI correctly
refuses, reporting a protocol failure against a conforming backend.

Transition is the harder of the two. It carries the lifecycle edge table, the
required-decision rules per edge, terminal dates, and epic rollup. Writing it
quickly would repeat the same failure with more surface.

Acceptance:

- transition request validity is stated in `spec/` in its own terms, derived
  from `SPEC.md` section 5 and `docs/mutation-contract.md` section 8 rather
  than from `src/`;
- the statement is checked against the real validator on a corpus of requests
  that includes non-string values where a string is required, every lifecycle
  edge, and each decision-required and decision-forbidden case; and
- `spec/` imports nothing from `src/` for request validity.

Surfaced 2026-08-07 by the ninth review round.
