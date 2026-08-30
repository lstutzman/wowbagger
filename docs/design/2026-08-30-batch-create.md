# Batch create decision

**Status:** Accepted
**Date:** 2026-08-30
**Decider:** Lee Stutzman
**Ledger item:** #186

## Context

A caller filing many items pays one `create` invocation and one Git commit per item. The current storage contract keeps each Markdown item at its final path, exposes files directly to Git and filesystem readers, and provides atomic no-clobber publication for one item only.

A public batch operation would need to allocate several immutable numbers from one synchronized snapshot, validate the complete successor ledger, recover after any process interruption, bind retries to one request, and define one exact Git commit set. Sequentially linking several final paths can expose a prefix of the batch. That prefix can be invalid when an earlier item refers to a later item. Calling such publication atomic would be false.

## Decision

Wowbagger will not add batch create to the direct-Markdown architecture. This is a permanent architecture decision, not a deferral to a later release.

The supported bulk workflow remains serial `create --auto-commit` calls in caller request order. On the successful path, each invocation:

- acquires the shared namespace fence;
- allocates one immutable number from a reconciled snapshot;
- validates the complete ledger plus one candidate;
- publishes one item with atomic no-clobber semantics; and
- commits exactly the item and reconciliation log.

On any refusal or unresolved response, the caller stops. A pre-publication refusal commits nothing. `git-commit-failed` requires `mutation-finalize`; `git-commit-outcome-unknown` requires inspection before any retry; post-commit reconciliation failure keeps the established commit and reports its recovery state. The caller starts the next create only after the previous result or documented recovery is final.

Capabilities continue to report `limits.multi_item_atomicity: false`. Core, adapter, host, and single-create request and response contracts do not change.

## Acceptance disposition

The accepted no-batch branch makes batch-only criteria not applicable: there is no multi-item allocation hold, aggregate candidate, batch publication boundary, batch retry identity, or one-commit batch set to implement or test. Existing single-create contention, numbering, validation, publication, and recovery contracts remain the evidence. Node 20 is also not a valid matrix target: item #188 raised the supported floor to Node 24. This decision adds no runtime behavior, so it requires no new Node runtime matrix.

## Options considered

### Permanent single-create loop

Keeps item files authoritative, preserves current recovery semantics, and tells direct readers the truth. Cost: N invocations and N commits for N items.

### Recoverable prefix publication

One namespace hold could allocate consecutive numbers and stage all candidates, but final-path links remain sequential. A crash can expose a prefix. Supporting it honestly requires partial-success envelopes, aggregate limits, versioned journal grammar, recovery commands, adapter authority, and prefix-valid ordering rules. Rejected because it does not provide batch atomicity.

### Generation-gated storage

A staged generation plus atomic pointer could define one logical commit for cooperating readers. It requires a new storage protocol, quiesced cutover, reader double-checks, rollback and roll-forward recovery, and physical-ledger binding. Direct Markdown and Git readers can still observe staging. Rejected because it replaces the product's storage model to save invocation overhead.

## Consequences

- Bulk importers must run creates serially and stop on the first refusal or unresolved response.
- Request order determines assigned-number order when every preceding create succeeds.
- There is no aggregate batch request, batch operation ID, batch recovery token, or one-commit batch promise.
- Concurrent create loops remain unsupported; each caller waits for the previous create and Git finalization.
- A future batch proposal must first replace the direct-Markdown storage contract and explicitly supersede this decision.
