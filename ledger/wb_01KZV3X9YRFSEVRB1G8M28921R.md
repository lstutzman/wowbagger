---
schema_version: 2
id: wb_01KZV3X9YRFSEVRB1G8M28921R
number: 52
title: "Make dogfood setup work in an isolated agent worktree"
kind: task
priority: 10
status: backlog
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-dogfood-pilot"
  recorded_at: "2026-08-12T13:52:27Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the dogfood topology defect at priority 10."
    rationale: "The prescribed reversible setup created a sibling worktree after agent launch, but the harness could not run Git there. This is not a core failure; it is a repeatable productization/runbook defect that blocks the supported pilot unless setup happens before agent launch."
---

The first dogfood prompt told an agent to create a disposable sibling worktree and keep all changes there. The harness refused Git commands against that sibling worktree before execution, including `cd <pilot-worktree> && git status` and `git -C <pilot-worktree> rev-parse HEAD`. Non-Git commands there succeeded, but each shell call reset to the session root. This blocked every required checkpoint, implementation, and ledger commit.

This is a harness boundary, not a Wowbagger core failure. It is still a defect in the supported dogfood workflow because the prescribed reversible topology cannot complete from an agent session rooted elsewhere. The recovery is to stop and launch a new agent session with the pilot worktree as its project root.

Done means the dogfood/runbook flow creates or selects the disposable worktree before agent launch, resumes with that worktree as the session root, verifies Git access there before installation or ledger mutation, and records the harness limitation separately from product defects.
