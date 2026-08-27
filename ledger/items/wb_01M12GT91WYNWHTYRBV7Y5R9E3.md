---
schema_version: 2
id: wb_01M12GT91WYNWHTYRBV7Y5R9E3
number: 178
title: "Audit reconciliation ownership classification as one topology matrix"
kind: task
priority: 2
status: triage
created: 2026-08-27
updated: 2026-08-27
provenance:
  source: "no-mistakes/01M12F0YXS2QA72BQTTFABB5M6/review"
  recorded_at: "2026-08-27T21:05:00Z"
depends_on: []
related: []
---
## Problem

The alpha.11 release phase found #173, #176, and #177 in the same ownership-determination path. Each point fix closed one topology and exposed the adjacent gap. The classifier needs one explicit topology matrix rather than more local inference.

## Acceptance criteria

- Design one matrix covering named current owner, detached current owner, sibling ref, unreachable expected revision, authorized predecessors, unknown bytes, and target versus unrelated mutation scope.
- Map each cell to reason, blocking status, owner evidence, remediation, and public envelope.
- Add public-seam tests that cover every distinct outcome and fail if one topology silently aliases another.
- Review `findRevisionOwner`, `reconciliationDiagnosis`, and target-scope handling as one module boundary before changing implementation.
- Preserve the #173/#176/#177 decisions and explain any deliberate consolidation.

## Worktree identity constraint

The matrix must include the cell where an expected revision is uncommitted and unreachable while the working tree holds an authorized predecessor. Committed Git evidence alone cannot distinguish this worktree's own uncommitted successor from another worktree's successor. Resolving self-versus-sibling attribution likely requires an explicit worktree identity mechanism; do not infer it from item path, journal order, or absence from refs. Pin target, unrelated, and bare claim-verify behavior plus the not-yet-reachable remediation before proposing such a mechanism.
