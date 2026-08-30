# Task 6 report: interrupted repair and auto-commit recovery

## Result

Implemented unresolved repair recovery and explicit auto-commit finalization.

- Recovery runs before the ordinary duplicate-only gate.
- Expected old revisions are atomically replaced; already-published candidate revisions are accepted.
- A third revision returns `ledger-repair-outcome-unknown` with `state: unknown` and leaves the path untouched.
- A valid recovered ledger receives exactly one `number-repair-final` terminal; repeated calls return the committed result without replaying publication.
- `--auto-commit` writes the derived reconciliation log and stages exactly the repaired item paths plus that log.
- Git retargeting variables are stripped for commit operations.
- Commit failures return a bounded repair recovery token.
- `mutation-finalize` recognizes and completes repair recovery tokens without replaying item publication.

## TDD evidence

- Recovery test covers an intent and staged candidate before item publication.
- Auto-commit test verifies the exact committed path set.
- Existing apply, journal, and staging suites remain green.

## Verification

```text
TMPDIR=/tmp node --test test/ledger-repair-apply.test.js test/ledger-repair-recovery.test.js test/ledger-repair-contract.test.js
37 passed
```

Native review dispatch was unavailable because the provider returned HTTP 429 before execution. Inline review found and corrected path-root and token-result issues during focused execution; the final focused suite passed on current Node. Node24 verification remains part of the final gate.
