// Shared setup for tests that publish a claimed candidate on a provisioned
// ledger: a Git worktree, a provisioned namespace, one claimed item and one
// bystander, and the request builder the publication takes. The publication
// path is the one ledger item #122 measures and then coarsens, so its phase
// tests, its crash tests, and its byte-parity tests all start here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishClaimed } from '../src/claim-publication.js';
import { resolveGitCommonDir } from '../src/claim-store.js';
import { mintId } from '../src/mint.js';
import { createItem } from '../src/mutation.js';
import { provisionNamespace, readNamespace } from '../src/namespace.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
export const HARNESS_DATE = '2026-08-17';

function git(cwd, ...argumentsList) {
  execFileSync('git', argumentsList, { cwd });
}

export function createRequest(id, title = 'Publication harness item') {
  return {
    id,
    item: {
      title,
      kind: 'task',
      priority: 50,
      provenance: { source: 'publication-harness', recorded_at: `${HARNESS_DATE}T00:00:00.000Z` },
      depends_on: [],
    },
    body: 'Written by the claimed publication harness.\n',
  };
}

// Turns an existing ledger directory into a provisioned one: a Git worktree
// with a committed ledger and a provisioned namespace. Tests that build their
// own fixture — a large one, or one with a particular shape — provision it
// this way and then use the same claim and request helpers.
export async function provisionExistingLedger(root, ledger) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'publication@example.invalid');
  git(root, 'config', 'user.name', 'Publication Harness');
  await provisionNamespace(ledger);
  git(root, 'add', '--all');
  git(root, 'commit', '-qm', 'provision the ledger');
  const namespace = await readNamespace(ledger);
  return { gitCommonDir: await resolveGitCommonDir(ledger), ledger, namespace, root };
}

// A provisioned ledger with `bystanders` extra items beyond the claimed one.
// The bystanders are what the publish lock closure currently widens over, so
// tests that count lock work choose how much of it there is to count.
export async function withProvisionedLedger(bystanders, callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-publication-'));
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const { gitCommonDir, namespace } = await provisionExistingLedger(root, ledger);
  const commit = (message) => {
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', message);
  };
  try {
    const id = mintId(HARNESS_DATE);
    assert.equal((await createItem(ledger, createRequest(id))).ok, true);
    const otherIds = [];
    for (let index = 0; index < bystanders; index += 1) {
      const otherId = mintId(HARNESS_DATE);
      assert.equal((await createItem(ledger, createRequest(otherId, `Bystander ${index}`))).ok, true);
      otherIds.push(otherId);
    }
    commit('create the items');
    const claim = await acquireClaim(ledger, root, namespace, id);
    return await callback({
      claim, commit, gitCommonDir, id, ledger, namespace, otherIds, root,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

export async function acquireClaim(ledger, root, namespace, itemId) {
  const requestPath = path.join(root, 'acquire.json');
  await writeFile(requestPath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'publication-agent',
    lease_duration_ms: 600_000,
    expected: { last_epoch: '0', active: null },
  }));
  const envelope = JSON.parse(execFileSync(
    process.execPath,
    [CLI, 'claim', 'acquire', '--ledger', ledger, '--input', requestPath, '--json'],
    { encoding: 'utf8' },
  ));
  assert.equal(envelope.ok, true, JSON.stringify(envelope));
  return envelope.result.claim;
}

export function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function publicationRequest(context, inspected, operationId, title, rewrite = (source) => source) {
  const candidate = Buffer.from(rewrite(Buffer.from(inspected.item.source_base64, 'base64')
    .toString('utf8')
    .replace(/^title: .*$/m, `title: "${title}"`)), 'utf8');
  return {
    operation_id: operationId,
    ledger_namespace: context.namespace,
    item_id: context.id,
    expected_revision: inspected.item.revision,
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: sha256(candidate),
    claim_fence: {
      ledger_namespace: context.namespace,
      item_id: context.id,
      owner_id: context.claim.owner_id,
      epoch: context.claim.epoch,
    },
  };
}

export function publish(context, request, scenario) {
  return publishClaimed({
    ledgerDirectory: context.ledger,
    gitCommonDir: context.gitCommonDir,
    namespace: context.namespace,
    request,
    scenario,
  });
}

export async function waitForFile(file) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await lstat(file);
      return;
    } catch (error) {
      assert.equal(error.code, 'ENOENT');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${path.basename(file)}`);
}
