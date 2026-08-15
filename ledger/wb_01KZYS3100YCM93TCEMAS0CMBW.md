---
schema_version: 2
id: wb_01KZYS3100YCM93TCEMAS0CMBW
number: 82
title: "Retire the PropertyCompass legacy backlog after Wowbagger proof"
kind: task
status: triage
created: 2026-08-14
updated: 2026-08-14
provenance:
  source: "user-request"
  recorded_at: "2026-08-14T14:47:48.000Z"
depends_on: [wb_01KZYS3100ZR9M1Y1YJ6W1RX4M]
related: [wb_01KZ77NSW8363H1V6QG1HZRG11]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

# Purpose

Define the final cutover that removes the PropertyCompass legacy backlog only after the Wowbagger proof period succeeds. Item #80 governs the parallel proof period and must complete first. This item does not authorize retirement by itself. Lee must make the explicit retirement decision after reviewing the proof evidence.

# Retirement trigger

Start this item only when all item #80 proof metrics pass, no proof or migration defect remains unresolved, the frozen legacy baseline has no drift, and Lee explicitly declares Wowbagger proven and authorizes retirement. A date, elapsed trial period, or successful migration alone is not sufficient.

# Finalization move

1. Open a quiesced finalization window. Stop all PropertyCompass backlog writers and claims.
2. Run the complete source-to-target reconciliation against the frozen mapping and exact source-byte evidence. Require zero errors.
3. Record the final proof report, mapping checksum, ledger revision, ready result, claim-recovery evidence, and the explicit Lee approval.
4. Preserve a durable audit and rollback bundle containing the frozen legacy snapshot, source-to-target mapping, migration report, and restoration instructions. Verify the bundle before deletion.
5. Remove the live legacy backlog files and every active legacy read or write path. This includes legacy create, claim, prioritization, lifecycle, generated-prioritization, hook, skill, script, and documentation entry points. Do not leave a second writable backlog or a silent compatibility writer.
6. Update repository instructions and collaborator guidance so Wowbagger is the only documented backlog and claim workflow.
7. Run the complete PropertyCompass gate plus Wowbagger validation, ready, claim-capability, reconciliation, and collaborator smoke checks.
8. Review the complete retirement diff. Merge and push only after Lee gives a separate release approval.

# Rollback boundary

Before the retirement change merges, rollback restores the verified pre-retirement tree and leaves the legacy system frozen. After it merges, rollback is an explicit repository change that stops Wowbagger writes, restores the audited legacy bundle, reconciles state created since retirement, and requires Lee to reauthorize legacy writes. Never restore both systems as concurrent writers.

# Acceptance criteria

1. Item #80 is done and its proof report satisfies every recorded exit criterion.
2. Lee's explicit Wowbagger-proven and retirement approval is recorded as a decision on this item.
3. Final pre-retirement reconciliation reports zero item, byte, lifecycle, relationship, link, ready, claim, or mapping errors.
4. The audit and rollback bundle reconstructs all 1,501 frozen legacy cards byte-for-byte and maps every card to its canonical Wowbagger item.
5. No active code, hook, skill, script, command, generated output, or documentation can create or mutate the legacy backlog.
6. `docs/backlog/` and obsolete legacy tooling are removed only in the reviewed retirement change. Historical references remain only where they are clearly marked as history or audit evidence.
7. Wowbagger remains the sole active writer. No dual-write or compatibility writer exists.
8. A collaborator can inspect, select ready work, claim it, publish or transition it, and recover an interrupted operation using only the documented Wowbagger workflow.
9. The full PropertyCompass gate and all Wowbagger validation and reconciliation checks pass after removal.
10. The retirement diff is not merged or pushed without Lee's separate release approval.
