// Git finalization for `--auto-commit`.
//
// The flag folds the commit-per-mutation ceremony into one invocation on a
// provisioned ledger. This module owns every Git write, and it owns nothing
// else: the mutation engine runs unchanged, and a mutation that changed no item
// byte never reaches a Git command here.
import path from 'node:path';

import { resolveWorkClaimCapability } from './claim-capabilities.js';
import { resolveVerifiedGitCommonDir } from './claim-store.js';
import { readNamespace } from './namespace.js';

// The core-domain refusal for a flag used where no namespace reconciliation
// contract exists. It is raised before the mutation, so no item byte moves.
function capabilityUnavailable(command, reason) {
  return {
    ok: false,
    exit: 5,
    state: 'unchanged',
    error: {
      code: 'capability-unavailable',
      message: 'Auto-commit requires a provisioned merge-coordinated ledger.',
      details: { reason },
    },
  };
}

// The same refusal in the claimed-publication domain.
function publicationCapabilityUnavailable(reason) {
  return {
    exit: 5,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'capability-unavailable',
        message: 'Auto-commit requires a provisioned merge-coordinated ledger.',
        details: { reason },
      },
    },
  };
}

export async function withAutoCommit({ ledgerDirectory, command, run }) {
  const publication = command === 'publish-claimed';
  let gitCommonDir;
  try {
    gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory, { failClosed: true });
  } catch {
    return publication
      ? publicationCapabilityUnavailable('git-verification-failed')
      : capabilityUnavailable(command, 'git-verification-failed');
  }
  const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
  const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
  if (capability.mode !== 'merge-coordinated' || !capability.claim_protected_publication) {
    const reason = gitCommonDir ? 'ledger-namespace-unbound' : 'git-directory-not-found';
    return publication
      ? publicationCapabilityUnavailable(reason)
      : capabilityUnavailable(command, reason);
  }
  return run();
}

export function ledgerRelative(ledgerDirectory, file) {
  return path.relative(path.resolve(ledgerDirectory), file).split(path.sep).join('/');
}
