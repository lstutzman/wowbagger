# Task 4 report: durable repair journal and candidate staging

## Result

Added durable `number-repair-intent` and `number-repair-final` journal grammar, plus shared Git-common-directory candidate staging.

- Journal replay validates intent shape, candidate revisions, item identity, and exact one-time intent/final pairing.
- Candidate staging lives below `wowbagger/<namespace>/repairs/<repair_id>` in the Git common directory.
- Candidate writes use exclusive no-follow opens, file fsync, and directory fsync.
- Manifests bind item IDs, relative paths, snapshot revision, candidate revision, digest, and byte size.
- Reads reject absent files, tampered bytes, traversal paths, duplicate paths, and malformed manifests.
- Staging and journal work are durable primitives; apply integration remains Task 5.

## TDD evidence

- RED: replay rejected the new journal type as unknown.
- GREEN: valid intent/final pair replays and exact pairing is enforced.
- Staging round-trip, tamper, traversal, and absent-candidate behavior are covered.

## Verification

```text
TMPDIR=/tmp node --test test/ledger-repair-recovery.test.js test/claim-store.test.js test/ledger-repair-apply.test.js test/ledger-repair-proposal.test.js test/ledger-repair-contract.test.js test/schemas.test.js
84 passed

TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/ledger-repair-recovery.test.js test/claim-store.test.js test/ledger-repair-apply.test.js test/ledger-repair-proposal.test.js test/ledger-repair-contract.test.js test/schemas.test.js
84 passed
```

Inline review found no Critical or Important issue. Native review dispatch was unavailable because the provider returned HTTP 429 before execution.
