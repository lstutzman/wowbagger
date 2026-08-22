---
schema_version: 2
id: wb_01M0MX86880WXMDWYFTPVVNHC8
number: 137
title: "Provision declarations for existing consumer extension fields"
kind: task
priority: 2
status: done
created: 2026-08-22
updated: 2026-08-22
completed: 2026-08-22
provenance:
  source: "propertycompass2-field-report-26"
  recorded_at: "2026-08-22T14:16:07.893Z"
depends_on: []
related: [ wb_01M07V3M3AHKRPAYYNBV8V7DTF, wb_01KZSM9K009JZBSY9NACGHCBEV ]
decisions:
  - action: accept
    date: 2026-08-22
    summary: "Accept item into backlog for maintainer triage."
    rationale: "The reported scope is recorded; backlog acceptance makes it eligible for scheduling and implementation."
  - action: complete
    date: 2026-08-22
    summary: "Complete explicit extension declaration provisioning."
    rationale: "Selected existing extension members now have explicit dry-run/apply validation, conflict refusal, deterministic declaration bytes, and managed mutation guidance."
---

## Problem

PropertyCompass2 alpha.6 needed to synchronize #648's managed ledger mirror with narrowed legacy tags `[bug, calculator, tax, sdlt, ltt, statutory-constants, compliance]`. The ledger item already carried consumer-owned `tags`, as do migrated items carrying `tier` and legacy identity fields, but `patch.set.extensions.tags` refused unchanged with `patch-precondition-failed` / `extension-declaration-missing`: `.wowbagger/extensions.json` was absent.

Item #118 correctly made extension patching fail closed behind a committed declaration. The migration/provisioning workflow never produced that declaration for a ledger that already contained known extension members. Preservation works, but correction requires an unsanctioned Markdown edit followed by commit, `claim-adopt`, and `claim-verify`. A migrated ledger should not need to violate the managed mutation boundary before it can declare fields that already exist throughout its validated source.

## Scope

1. Reproduce with a migrated schema-2 ledger containing existing scalar and string-list extension members but no `.wowbagger/extensions.json`; prove `patch.set.extensions` refuses and the only current recovery is out-of-protocol adoption.
2. Decide the authority source for declaration generation: explicit migration mapping/config, a new declaration migration command, or an opt-in `provision` input. Do not infer types silently from one arbitrary item or widen `provision` without explicit operator intent.
3. Generate a committed version-1 declaration for selected existing members and supported types (`string`, `integer`, `boolean`, `string-list`), validate every selected member across the complete ledger, and fail closed on mixed types, nested values, anchors/aliases, reserved names, or absent evidence.
4. Separate claim-store provisioning from extension declaration authority in command/request/result schemas even if one operator workflow invokes both. A claim namespace must not silently authorize frontmatter writes.
5. Provide a dry run listing proposed member/type pairs, conflicts, affected item counts, output path, and exact bytes. Apply uses atomic no-clobber publication and refuses an existing different declaration.
6. After declaration, prove an exact CAS patch of pre-existing `tags` succeeds without hand-edit or `claim-adopt`, preserves all unpatched nodes, and leaves `claim-verify` clean.
7. Update migration and installed-consumer guidance so imported ledgers declare extension ownership before their first managed correction.

## Acceptance criteria

- Normative fixtures cover uniform string-list tags, scalar fields, mixed-type conflict, reserved/core names, anchors, existing equal/different declarations, dry run, and applied declaration.
- No command guesses extension authority merely because a field exists; every generated member is explicitly selected by operator-supplied configuration.
- Generated declaration bytes match the current extension-declaration contract exactly and are committed/reviewable ledger structure.
- A PropertyCompass-shaped `tags` patch succeeds end to end after provisioning, preserves unrelated YAML node identity, and needs no adoption.
- Existing ledgers without a declaration still fail closed for undeclared extension patches.
- JSON Schemas, mutation contract, migration runbook, README, and installed skill expose the workflow without parsing human output.
- Current Node and Node 20 gates pass with mutation testing of every authority and type guard.

## Evidence

PropertyCompass2 `docs/wowbagger-feedback.md` entry 26, 2026-08-22, found while rescuing #648. The exact one-line edit plus commit/adopt/verify workaround succeeded, proving stored bytes were valid and the missing seam was declaration provisioning rather than field validation.
