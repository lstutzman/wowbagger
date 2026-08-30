# Task 6 report: interrupted repair recovery

## Result

Added idempotent recovery for an unresolved `number-repair-intent`.

- Recovery runs before the ordinary duplicate-only gate, so it can repair a partially or fully published ledger.
- It reads and verifies the staged manifest under the namespace lock.
- Expected old revisions are atomically replaced; already-published candidate revisions are accepted.
- A third revision returns `ledger-repair-outcome-unknown` with `state: unknown` and leaves that path untouched.
- A valid recovered ledger receives exactly one `number-repair-final` terminal; repeated calls return the committed result without replaying publication.
- Auto-commit and `mutation-finalize` token integration remain for the next task slice.

## TDD evidence

- Recovery path covered with an intent and staged candidate present before any item publication; the call applies candidates and writes the terminal exactly once.
- Existing apply and staging suites remain green.

## Verification

```text
TMPDIR=/tmp node --test test/ledger-repair-apply.test.js test/ledger-repair-recovery.test.js
12 passed

TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/ledger-repair-apply.test.js test/ledger-repair-recovery.test.js
12 passed
```

Inline review found no Critical or Important issue. Native review dispatch was unavailable because the provider returned HTTP 429 before execution.
