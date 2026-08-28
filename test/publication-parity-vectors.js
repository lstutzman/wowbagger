// Byte-parity vectors for claimed publication (ledger item #122).
//
// Removing the publication's per-item lock closure must not move one byte of
// what a caller or a journal reader sees. These vectors drive the six outcome
// classes a publication has — success, fence refusal, ledger revision
// conflict, validation refusal, idempotent replay, and indeterminate
// publication — and record the response envelope and the whole claim journal
// for each. The recording is normalized only where the value cannot be fixed
// by construction: wall-clock instants and the generated namespace. Item
// bytes, revisions, operation ids, and every code, message, and field name
// stay exactly as they were written.
//
// Excluded from the parity boundary: faults injected into the per-item lock
// file I/O that publication no longer performs. Those failures cannot stay
// observable after the I/O that produced them is gone.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const DATE = '2026-08-17';
const ITEM_ID = 'wb_01M06G96000000000000000001';
const OTHER_ID = 'wb_01M06G96000000000000000002';

function itemSource(id, number, title, status = 'backlog') {
  return `---
schema_version: 2
id: ${id}
number: ${number}
title: "${title}"
kind: task
priority: 50
status: ${status}
created: ${DATE}
updated: ${DATE}
provenance:
  source: "parity"
  recorded_at: "${DATE}T00:00:00.000Z"
depends_on: []
related: []
decisions: []
---

Fixed bytes for the publication parity vectors.
`;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function cli(argumentsList) {
  return JSON.parse(execFileSync(process.execPath, [CLI, ...argumentsList], { encoding: 'utf8' }));
}

// A fresh provisioned ledger holding two fixed items. Everything about it is
// byte-fixed except the namespace the provision command generates.
async function fixture(publishClaimed, resolveGitCommonDir) {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-parity-'));
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'parity@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Parity'], { cwd: root });
  await writeFile(path.join(ledger, `${ITEM_ID}.md`), itemSource(ITEM_ID, 1, 'Before'));
  await writeFile(path.join(ledger, `${OTHER_ID}.md`), itemSource(OTHER_ID, 2, 'Bystander'));
  const namespace = cli(['provision', '--ledger', ledger, '--json']).result.ledger_namespace;
  execFileSync('git', ['add', '--all'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--message', 'parity fixture'], { cwd: root });
  const acquirePath = path.join(root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: ITEM_ID,
    owner_id: 'parity-agent',
    lease_duration_ms: 600_000,
    expected: { last_epoch: '0', active: null },
  }));
  const claim = cli(['claim', 'acquire', '--ledger', ledger, '--input', acquirePath, '--json']).result.claim;
  return {
    claim,
    gitCommonDir: await resolveGitCommonDir(ledger),
    ledger,
    namespace,
    publishClaimed,
    root,
  };
}

function request(context, operationId, { title = 'After', expectedRevision, epoch, number } = {}) {
  let source = itemSource(ITEM_ID, number ?? 1, title);
  const candidate = Buffer.from(source, 'utf8');
  return {
    operation_id: operationId,
    ledger_namespace: context.namespace,
    item_id: ITEM_ID,
    expected_revision: expectedRevision ?? sha256(Buffer.from(itemSource(ITEM_ID, 1, 'Before'), 'utf8')),
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: sha256(candidate),
    claim_fence: {
      ledger_namespace: context.namespace,
      item_id: ITEM_ID,
      owner_id: context.claim.owner_id,
      epoch: epoch ?? context.claim.epoch,
    },
  };
}

function publish(context, publicationRequest, scenario) {
  return context.publishClaimed({
    ledgerDirectory: context.ledger,
    gitCommonDir: context.gitCommonDir,
    namespace: context.namespace,
    request: publicationRequest,
    scenario,
  });
}

// Wall-clock instants, the generated namespace, and the writer's worktree UUID
// are the only values that cannot be fixed by construction, so they are the
// only values replaced. The operation digest hashes the request, and the
// request names the namespace, so it moves with the namespace and is replaced
// for the same reason — the digests inside one recording are still checked
// against each other. The writer UUID is replaced in place rather than
// dropped, so a recording still proves which entries carry the field.
function normalize(value, namespace, digests) {
  const replaced = JSON.stringify(value)
    .replaceAll(namespace, '<namespace>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<time>')
    .replace(
      /"writer_worktree_id":"[0-9a-f-]{36}"/g,
      '"writer_worktree_id":"<writer-worktree-id>"',
    );
  return JSON.parse(replaced.replace(/"operation_digest":"sha256:[0-9a-f]{64}"/g, (match) => {
    if (!digests.has(match)) digests.set(match, `<digest-${digests.size + 1}>`);
    return `"operation_digest":"${digests.get(match)}"`;
  }));
}

async function journalRecord(context, digests) {
  const journalPath = path.join(context.gitCommonDir, 'wowbagger', context.namespace, 'journal.ndjson');
  const source = await readFile(journalPath, 'utf8');
  return source.trimEnd().split('\n').map((line) => normalize(JSON.parse(line), context.namespace, digests));
}

async function vector(name, publishClaimed, resolveGitCommonDir, run) {
  const context = await fixture(publishClaimed, resolveGitCommonDir);
  const digests = new Map();
  try {
    const envelope = await run(context);
    return {
      name,
      envelope: normalize(envelope, context.namespace, digests),
      journal: await journalRecord(context, digests),
      item: await readFile(path.join(context.ledger, `${ITEM_ID}.md`), 'utf8'),
    };
  } finally {
    await rm(context.root, { force: true, recursive: true });
  }
}

export async function publicationParityVectors(publishClaimed, resolveGitCommonDir) {
  const build = (name, run) => vector(name, publishClaimed, resolveGitCommonDir, run);
  return [
    await build('success', (context) => publish(context, request(context, 'pub_parity_0001'))),
    await build('fence-refusal', (context) => (
      publish(context, request(context, 'pub_parity_0002', { epoch: '99' }))
    )),
    await build('revision-conflict', (context) => publish(context, request(context, 'pub_parity_0003', {
      expectedRevision: sha256(Buffer.from('not the item on disk', 'utf8')),
    }))),
    // A candidate that takes the bystander's number leaves the complete ledger
    // invalid, so the publication refuses without touching the target.
    await build('validation-refusal', (context) => (
      publish(context, request(context, 'pub_parity_0004', { number: 2 }))
    )),
    await build('idempotent-replay', async (context) => {
      await publish(context, request(context, 'pub_parity_0005'));
      return publish(context, request(context, 'pub_parity_0005'));
    }),
    await build('indeterminate', (context) => (
      publish(context, request(context, 'pub_parity_0006'), 'fail:after-ledger-commit')
    )),
  ];
}
