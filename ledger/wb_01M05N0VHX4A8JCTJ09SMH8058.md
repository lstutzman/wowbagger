---
schema_version: 2
id: wb_01M05N0VHX4A8JCTJ09SMH8058
number: 108
title: "Let an operator diagnose and inspect an invalid ledger"
kind: task
status: triage
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T16:03:35Z"
depends_on: []
related: []
---

Diagnosability follow-up from item #104's repro: on a ledger with one invalid item (e.g. item-outside-layout), EVERY read and mutation refuses exit 3 ledger-invalid — including `inspect` of a perfectly valid item, which the operator needs to get the revision for the fix, and `claim-verify`, the documented reconciliation verb, exits 0 with findings [] and explains nothing about why every mutation is blocked. The enriched #104 refusal (expected_path + remediation) makes recovery survivable, but the read-path behavior is a trap: the tool refuses to show you the thing it is telling you to fix.

Two design questions, decide together (they share the answer's shape):
1. Should single-item `inspect` work on a ledger whose OTHER items are invalid? The lossless byte-snapshot contract (section 5) says inspect loads and validates the complete ledger — relaxing that needs care: an inspect that skips validation could hand out a revision from an inconsistent ledger state. A middle path: keep the refusal but attach the target item's snapshot when the target itself parses and only OTHER items are invalid, or add an explicit --unsafe-raw escape documented as recovery-only.
2. Should `claim-verify` mention ledger validity? It is the verb every remediation string names; when the ledger is invalid it should at least say "the ledger is invalid; claim state is consistent; fix validation first" instead of a bare green findings [].

Scope: decide both with contract evidence, document, implement the chosen shape, pin with fixtures (the #104 misplaced-item fixture is the natural base). Envelope changes are contract-sensitive: version-note per the response-domain rules.

Acceptance:
- An operator on the #104 fixture can obtain what they need to execute the remediation using only documented commands (no hand parsing), pinned by test.
- claim-verify on an invalid ledger names the validation blocker (or the decision not to is recorded with rationale).
- Gate green on both runtimes.
