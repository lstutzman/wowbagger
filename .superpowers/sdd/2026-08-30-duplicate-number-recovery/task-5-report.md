# Task 5 report: apply repairs under the shared fence

## Result

Implemented duplicate-number repair publication through the existing verified Git common-directory namespace lock.

- Ordinary valid-ledger mutation behavior is unchanged.
- `number-repair` performs the required duplicate-only invalid-ledger bypass.
- The apply path re-reads the ledger and snapshot under `withClaimLock`.
- Candidate bytes rewrite only the number scalar, preserving IDs, relations, and body bytes.
- Candidate successor validation runs before publication.
- The path stages candidates, appends a durable intent, atomically replaces affected item files, re-reads candidate revisions, validates the repaired ledger, and appends the terminal final entry.
- Successful responses use the ledger-repair v1 committed envelope with `git_commit: null` until the auto-commit recovery task.

## TDD evidence

- RED: the valid duplicate fixture reached successor validation but still reported duplicate-number errors.
- GREEN: candidate construction now updates the moved item's number and commits the repaired ledger under the shared fence.
- Publication reread compares every affected item revision to the staged candidate revision before the final journal entry.

## Verification

```text
TMPDIR=/tmp node --test test/ledger-repair-apply.test.js test/ledger-repair-recovery.test.js test/ledger-repair-contract.test.js test/ledger-repair-proposal.test.js test/claim-store.test.js test/schemas.test.js
86 passed

TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/ledger-repair-apply.test.js test/ledger-repair-recovery.test.js test/ledger-repair-contract.test.js test/ledger-repair-proposal.test.js test/claim-store.test.js test/schemas.test.js
86 passed
```

Inline review found no Critical or Important issue. Native review dispatch was unavailable because the provider returned HTTP 429 before execution.
