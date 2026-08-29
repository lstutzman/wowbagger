// The reconciliation topology, decided once, from evidence alone.
//
// Every command that reconciles a claim journal has to answer the same
// question about a drifted item: which of the recognized topologies is this,
// and does it block the write in front of us? Answering it inside each command
// is how the answers drifted apart, so the decision lives here, pure: no Git,
// no filesystem, no prose. Callers gather the evidence, render the sentences,
// and keep the scope to themselves.
//
// The vocabulary:
//
//   revision state  where a surface's bytes stand against the journal —
//                   `expected` the authorized revision itself, `authorized`
//                   some other revision the journal once ruled legitimate,
//                   `unknown` bytes no ruling covers, `absent` no bytes at all.
//   owner evidence  `{ kind, ref?, commit? }` from `findRevisionOwner`: which
//                   live worktree, if any, carries the expected revision.
//   expected writer `current` when the journal names this worktree as the
//                   writer of the expected revision, `other` when it names
//                   another, `unknown` when nothing can be attributed.
//   scope           who a finding blocks: `global` every write, `target` only
//                   a write against the item it names, `none` nobody.
//   remediation     which remedy the topology prescribes; the caller renders
//                   the sentence, so the kinds carry no wording.

// Where one surface's bytes stand against the journal. `expected` is a
// refinement of `authorized`, so it is tested first.
export function normalizeRevision(revision, expectedRevision, authorizedRevisions) {
  if (revision === null) return 'absent';
  if (revision === expectedRevision) return 'expected';
  return authorizedRevisions.has(revision) ? 'authorized' : 'unknown';
}

// Owner evidence costs a walk of every live worktree's history, so the two
// topologies that never consult it must not pay for it. The predicate answers
// from the same states the classifier judges, through the same helper, so
// neither can drift from the other.
export function requiresOwnerEvidence({ workingTree, head }) {
  return !isUnattributed(workingTree, head) && workingTree !== 'expected';
}

// Bytes no ruling covers, on either surface, and a working tree that is gone
// while another surface still holds bytes. Nothing here is attributable to a
// writer or an owner: the local state is simply out of protocol.
function isUnattributed(workingTree, head) {
  return workingTree === 'unknown'
    || head === 'unknown'
    || (workingTree === 'absent' && head !== 'absent');
}

// One topology, one member. `expectedOwner` is required exactly when
// `requiresOwnerEvidence` says so, and is never read otherwise.
export function classifyReconciliation({ workingTree, head, expectedOwner, expectedWriter }) {
  if (isUnattributed(workingTree, head)) return UNAUTHORIZED_REVISION;
  // The authorized bytes are here and Git has yet to record them. Nothing is
  // in doubt but the commit.
  if (workingTree === 'expected') {
    return { scope: 'global', reason: 'git-finalization-required', remediation: 'commit-in-git' };
  }
  // A live named worktree carries the expected revision, so there is a ref to
  // wait on and a commit to name. This outranks every other synchronization
  // answer, because it is the only one that names an owner.
  if (expectedOwner.kind === 'named-sibling') {
    return {
      scope: 'target',
      reason: 'worktree-synchronization-required',
      owner: expectedOwner,
      remediation: 'wait-for-named-owner',
    };
  }
  // The item is gone locally while the journal still expects a revision no
  // named worktree carries. There is nothing here to call unauthorized and
  // nobody to wait for, so the remedy is to establish ownership by inspection.
  if (workingTree === 'absent') {
    return {
      scope: 'target',
      reason: 'worktree-synchronization-required',
      remediation: 'establish-ownership',
    };
  }
  // Advice to wait for an owning worktree needs an owner that could still
  // appear. When the journal names this worktree as the writer of the expected
  // revision, or this worktree's own history reaches it, the successor exists
  // nowhere but in the journal: there is nothing to synchronize from, and the
  // authorized bytes on disk are simply the wrong ones.
  if (expectedWriter !== 'current' && expectedOwner.kind !== 'current') {
    return {
      scope: 'target',
      reason: 'worktree-synchronization-required',
      remediation: 'await-owner-commit',
    };
  }
  return UNAUTHORIZED_REVISION;
}

const UNAUTHORIZED_REVISION = Object.freeze({
  scope: 'global',
  reason: 'unauthorized-revision',
  remediation: 'restore-or-adopt',
});

// Scope, never reason text, decides what a finding refuses. A mutation names
// the item it targets, and a synchronization another item waits on is a wait
// this mutation does not touch. A caller that names no target, such as the
// `claim-verify` command, keeps every finding blocking.
export function blocksTarget(scope, itemId, targetItemId) {
  if (scope === 'none') return false;
  if (scope === 'global') return true;
  return targetItemId === null || itemId === targetItemId;
}
