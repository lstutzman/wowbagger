---
schema_version: 2
id: wb_01M12AFABEHGEF5RXKNFATRRED
number: 175
title: "Preserve claim verification diagnostics in mutation-finalize recovery"
kind: task
priority: 1
status: done
created: 2026-08-27
updated: 2026-08-27
completed: 2026-08-27
provenance:
  source: "no-mistakes/01M128J68X7PZ6J36P0P3YFDRN/review"
  recorded_at: "2026-08-27T19:30:00Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-27
    summary: "Accept the release-blocking mutation-finalize diagnostics gap."
    rationale: "The release review proved that mutation-finalize drops claim verification code and reason even though ordinary auto-commit preserves them and alpha.11 documents same-fidelity diagnostics. The recovery path must share the established construction before publication."
  - action: complete
    date: 2026-08-27
    summary: "Preserved mutation-finalize claim verification diagnostics."
    rationale: "RED observed an undefined claim_verify_code after mutation-finalize committed. Commit d717fae reuses the ordinary auto-commit reconciliation details and corrects retryability guidance; 02ed0e6 and 7eb8fda keep the limitation and release notes honest. GREEN passed 15/15, diagnostics safety passed 51/51, and the complete suite passed 1730/1730 on current Node and Node 20 with adapter conformance and ledger validation green."
---
## Problem

The mutation-finalize recovery path constructs a post-commit-reconciliation-failed envelope from only `reason` and `findings`, dropping `claim_verify_code` and `claim_verify_reason`. Ordinary auto-commit preserves the full diagnostic cause, so the two paths violate the same-fidelity promise introduced by #170 and #171.

## Acceptance criteria

- A RED test exercises the public mutation-finalize recovery output and fails because claim verification code and reason are absent.
- Mutation-finalize and ordinary auto-commit use the same diagnostic construction.
- `claim_verify_code` and `claim_verify_reason` are preserved; `findings` remains optional and is never invented.
- `state: committed`, Git commit evidence, and idempotent recovery behavior remain unchanged.
- Existing #170 and #171 diagnostic and retryability suites stay green.
- Correct the stale comment that calls the auto-commit mutex the only retryable reason.
- Full current Node, Node 20, adapter, and ledger gates pass.
