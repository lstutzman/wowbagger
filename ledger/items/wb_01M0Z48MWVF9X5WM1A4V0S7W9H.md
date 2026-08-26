---
schema_version: 2
id: wb_01M0Z48MWVF9X5WM1A4V0S7W9H
number: 158
title: "Stress finding: parent-migrate answers as patch-v1/contract_version 1 with inconsistent exit codes and doubled issues"
kind: task
priority: 2
status: triage
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB+C"
  recorded_at: "2026-08-26T13:31:00.382Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
---

## Problem
- Envelope: `namespace:"ledger-mutation", command:"patch-v1", contract_version:1` — wrong command name and version vs every other verb's v5 self-identification (`src/mutation.js:513-533` passes literal 'patch-v1' to the legacy fence). Dispatch-by-command-name clients misroute.
- Exit codes: stale expected_revision → revision-conflict exit 4, but stale expected_parent → parent-revision-conflict exit 2. Same CAS class, different exits; revision precedence also beats parent precedence undocumented.
- Absent-member requests emit BOTH invalid-value and missing-member issues (transition/patch emit one); snooze omits the state member entirely.
- actual parent not reported on parent-revision-conflict (same-field CAS refusals elsewhere report actual values).

## Source
F-P-006, F-BWaveB3 probe battery, F-BWaveB2-2.
