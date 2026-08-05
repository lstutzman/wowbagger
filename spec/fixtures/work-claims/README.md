# Work-claim reference-model vectors

These fictional version 2 fixtures are normative inputs and outputs for the
[fenced work-claim contract](../../../docs/work-claim-contract.md). They do not
claim that the current local Wowbagger runtime implements work claims.

Each case contains one unique-key UTF-8 `manifest.json` with:

- explicit durable claim, clock-floor, ledger, and idempotency state;
- explicit disposable preflight state and backend write-path capability;
- exact ledger source bytes represented as canonical base64 and bound to a
  SHA-256 digest;
- ordered public operations, model-only barriers, faults, and restarts;
- every exact result envelope or model event; and
- the complete exact final state.

The no-I/O runner in `test/work-claim-reference.js` executes `initial` and
`actions`; the test requires byte-for-byte structural equality with `expected`.
`ledger-publication.preflight` and `.commit` are model barriers used to expose a
pause between ordinary validation and the public operation's atomic commit.
They are not two public authorization calls and preflight never authorizes a
write.

The loader reads manifests and their sources only after `lstat` verifies every
path component, opens final files with no-follow, and confirms a regular file
beneath this root. Tests reject duplicate JSON members, traversal, symlinks,
directories, special files, digest/base64 disagreement, an unbound revision or
candidate, missing coverage, and any transcript or final-state difference.

The committed cases cover fenced and advisory capabilities; alternate and
legacy writer bypasses; same-item/different-ledger isolation; contention;
expiry, takeover, renew, release, restart, and ABA; wrong ledger, item, owner,
and epoch fences; the epoch-N preflight/epoch-N+1 takeover race; clock-floor
persistence on rejection; backward clock after restart; clock storage failure;
and an atomically committed publication whose response is lost.

A reference-model pass only proves agreement with the normative state machine.
A future backend is conformant only after a backend adapter runs the same
requests, barriers, restarts, and faults against real storage and matches the
exact envelopes, durable read-back, and source bytes.

Regenerate committed manifests after an intentional contract change with:

```sh
node scripts/generate-work-claim-vectors.js
```
