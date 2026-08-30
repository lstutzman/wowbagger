# Task 7 report: document and package the repair domain

## Result

Updated public documentation for `ledger-repair` v1.

- Added proposal/apply command guidance to the README.
- Added an Unreleased changelog entry.
- Replaced the old hand-edit warning in the mutation contract, work-claim contract, and installed Wowbagger skill.
- Documentation now states that number-only repair preserves ULID identities and relation values, while arbitrary hand edits remain unsupported.
- Core contract version 5 and repair contract version 1 remain separate.

## Verification

The complete dual-runtime test command is running as the final gate. Documentation changes are text-only and do not alter runtime contracts outside the already tested repair domain.
