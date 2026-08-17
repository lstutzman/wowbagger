---
schema_version: 2
id: wb_01M086JPRKRHXNW5YB0GND09ZX
number: 123
title: "Fold the commit ceremony into the mutation with auto-commit"
kind: task
priority: 10
status: backlog
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T15:48:55Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Ideation survivor: the consumer's most frequent daily ceremony, with an honest commit-failed contract per the enrichment."
---

Ideation survivor 2 of 5 (2026-08-17). Full design basis: docs/ideation/2026-08-17-open-ideation.md and the Sol enrichment at docs/ideation/enrichments/2026-08-17-autocommit.md - the enrichment is the authoritative scope; this body is its summary.

Add --auto-commit, an opt-in bare CLI flag on create, transition, patch, and publish-claimed, provisioned ledgers only (capability-gated on mode merge-coordinated), that folds the commit-per-mutation ceremony into the mutation:

- Preflight: per-working-tree mutex; refuse any staged path anywhere and any dirty path under the ledger; identity/HEAD snapshot; internal pre-mutation claim-verify requiring clean claim state.
- Run the mutation unchanged. state unchanged or unknown: return unchanged, NO git action (the item #96 byte-identical rule survives, including the documented publish-refusal-terminal exception - dirty but uncommitted).
- state committed: stage exactly the item path plus (for transition/patch/publish-claimed) the one reconcile log, require the log to carry this invocation's terminal, fixed commit subjects (wowbagger: <verb> item #N), normal git identity, hooks and signing honored, never --no-verify.
- Post-commit: verify parent, changed-path set, item blob revision; then claim-verify in the same invocation; success returns result.git_commit + commit_paths + claim_verified.
- Failure contract: git-commit-failed (exit 6, state committed, core domain for c/t/p, publication domain for publish-claimed) carrying the published revision, the exact commit set with digests, failure_stage/reason, and a bound recovery token. Ambiguous git outcomes are git-commit-outcome-unknown. One idempotent recovery verb: mutation-finalize --recovery-token (work-claim domain) that re-derives paths, creates the exact commit if absent, and claim-verifies.
- What NOT to build (binding): no auto-push, no config/env default, no advisory-ledger mode, no broad staging, no hook/signing bypass, no adapter-side flag in v1.

Open maintainer decisions (enrichment section 7): publish-claimed in v1 (recommended yes); the strict preflight rule vs temporary-index design; version positions (flag is additive - the enrichment argues core 3 / work-claim api 1 hold); detached/unborn HEAD support; the ok:false-state:committed handling.

Acceptance: the enrichment's matrix verbatim (section 5) - dirty-state matrix, refusal matrix (no commit on any refusal), failure fixtures (hooks via core.hooksPath, signing, held index, HEAD movement, response loss), mutation-finalize idempotency, and both-runtime gates. Effort L: the failure contract is the work, not the happy path.
