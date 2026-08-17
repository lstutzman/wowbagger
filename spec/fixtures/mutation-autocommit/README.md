# Auto-commit normative envelopes

These manifests pin the exact envelopes `--auto-commit` and `mutation-finalize`
emit on a provisioned merge-coordinated ledger. `test/auto-commit-normative.test.js`
drives the real CLI against a fresh Git repository and compares byte-for-byte
after substituting the placeholders each case declares.

`{{...}}` placeholders stand for values only the run can know: a revision, a Git
object id, a provisioned namespace, or the opaque recovery token. Everything
else is fixed by the contract, including every member name, the fixed commit
subject, the ordered ledger-relative commit set, `failure_stage`, and `reason`.

[Mutation contract](../../../docs/mutation-contract.md) section 13 is the prose.
