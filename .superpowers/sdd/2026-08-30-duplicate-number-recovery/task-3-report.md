# Task 3 report: validate complete repair mappings

## Result

Implemented empirical apply-time validation for the duplicate-number repair request.

- Refuses a changed ledger snapshot before any item write.
- Refuses stale item byte revisions and stale expected numbers.
- Requires exactly the movable item from every duplicate group.
- Refuses replacement numbers occupied by unchanged items, self-replacements, or another repair item.
- Leaves the ledger unchanged for every refusal.
- Keeps the later staging/publication boundary explicit.

## TDD evidence

- RED: stale snapshot request returned the pre-task stage-boundary refusal instead of `ledger-repair-revision-conflict`.
- GREEN: snapshot and item-witness checks now return exit 4 with the expected domain error.
- RED: replacement collision returned the stage-boundary refusal.
- GREEN: occupied replacement numbers return `ledger-repair-number-collision`.
- RED: an omitted duplicate-group change returned the stage-boundary refusal.
- GREEN: incomplete mappings return `ledger-repair-mapping-incomplete` and identify missing IDs.
- Existing valid-ledger contract expectation was updated from the pre-apply stage boundary to the empirical `ledger-repair-not-applicable` refusal.

## Verification

```text
TMPDIR=/tmp node --test test/ledger-repair-apply.test.js test/ledger-repair-proposal.test.js test/ledger-repair-contract.test.js test/schemas.test.js
48 passed

TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/ledger-repair-apply.test.js test/ledger-repair-proposal.test.js test/ledger-repair-contract.test.js test/schemas.test.js
48 passed
```

Inline review found no Critical or Important issue. Native review dispatch was unavailable because the provider returned HTTP 429 before execution.
