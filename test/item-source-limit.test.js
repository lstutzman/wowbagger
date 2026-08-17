import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  referenceCoreCapabilities,
  verifyCoreProbe as referenceVerifyCoreProbe,
} from '../spec/adapter-reference.js';
import { coreCapabilities, verifyCoreProbe } from '../src/adapter/core-probe.js';
import { dynamicDescribe } from './adapter-contract-fixtures.js';
import { runCli, withLedger } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

// The one public bound on a complete serialized item source. Written here as a
// literal, never imported from src: a test that reads the production constant
// cannot notice the constant moving.
const LIMIT = 8388608;

test('capabilities negotiates core contract version 4', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).contract_version, 4);
});

test('capabilities advertises the exact item source byte limit', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.limits.max_item_source_bytes, LIMIT);
});

// The two engines spell a refusal differently. Normalize to the one pair the
// negotiation questions below actually ask about.
function refusalOf(result) {
  return {
    code: result.error_code ?? result.error?.code,
    detail: result.detail ?? result.error?.details,
  };
}

// Both engines answer the same negotiation questions from independent code, so
// every probe question below is asked twice.
const PROBES = [
  ['engine', coreCapabilities, verifyCoreProbe],
  ['oracle', referenceCoreCapabilities, referenceVerifyCoreProbe],
];

for (const [name, capabilities, verify] of PROBES) {
  test(`${name}: a complete version 4 core envelope passes probe negotiation`, () => {
    assert.deepEqual(verify(dynamicDescribe(), capabilities()), { ok: true });
  });

  // A version 3 consumer validated `result.limits` by exact members and did not
  // know `max_item_source_bytes`. It must stop at negotiation rather than accept
  // a core whose accepted input has narrowed underneath it.
  test(`${name}: a version 3 core envelope fails closed at probe negotiation`, () => {
    const probe = capabilities();
    probe.contract_version = 3;
    const describe = dynamicDescribe();
    describe.core.required_core_contract_version = 3;

    const result = verify(describe, probe);

    assert.equal(result.ok, false);
    assert.equal(refusalOf(result).code, 'core-protocol-error');
  });

  test(`${name}: a real version 3 core envelope fails closed at probe negotiation`, () => {
    const probe = capabilities();
    probe.contract_version = 3;
    delete probe.result.limits.max_item_source_bytes;
    const describe = dynamicDescribe();
    describe.core.required_core_contract_version = 3;

    const result = verify(describe, probe);

    assert.equal(result.ok, false);
    assert.equal(refusalOf(result).code, 'core-protocol-error');
  });

  test(`${name}: a core envelope without the limit fails closed at probe negotiation`, () => {
    const probe = capabilities();
    delete probe.result.limits.max_item_source_bytes;

    const result = verify(dynamicDescribe(), probe);

    assert.equal(result.ok, false);
    assert.deepEqual(refusalOf(result).detail, { member: 'result.limits' });
  });

  test(`${name}: a core envelope whose advertised limit drifted fails closed`, () => {
    const probe = capabilities();
    probe.result.limits.max_item_source_bytes = LIMIT + 1;

    const result = verify(dynamicDescribe(), probe);

    assert.equal(result.ok, false);
    assert.deepEqual(refusalOf(result).detail, { member: 'result.limits' });
  });
}

const CREATE_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

// A refusal publishes no item and leaves no temporary file behind. The lock
// directory itself outlives every locked mutation; a retained lock file inside
// it would not.
async function assertNothingPublished(ledger) {
  const entries = (await readdir(ledger)).sort();
  assert.deepEqual(entries.filter((entry) => entry !== '.wowbagger-locks'), []);
  if (entries.includes('.wowbagger-locks')) {
    assert.deepEqual(await readdir(path.join(ledger, '.wowbagger-locks')), []);
  }
}

function createRequest(body) {
  return {
    id: CREATE_ID,
    item: {
      title: 'Bound the item source',
      kind: 'task',
      provenance: { source: 'fixture/item-source-limit', recorded_at: '2030-01-10T12:34:56.789Z' },
      depends_on: [],
      related: [],
    },
    body,
  };
}

// spawnSync truncates at 1 MiB by default, and an accepted 8-MiB item answers
// with its decoded body plus its base64 source.
function runLargeCli(...argumentsList) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

async function runCreate(ledger, body) {
  const requestPath = path.join(path.dirname(ledger), 'request.json');
  await writeFile(requestPath, JSON.stringify(createRequest(body)), 'utf8');
  const result = runLargeCli('create', '--ledger', ledger, '--input', requestPath, '--json');
  assert.equal(result.stderr, '');
  return { result, envelope: JSON.parse(result.stdout) };
}

function runCreateFromStdin(ledger, body) {
  const result = spawnSync(process.execPath, [
    cliPath, 'create', '--ledger', ledger, '--input', '-', '--json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input: JSON.stringify(createRequest(body)),
  });
  assert.equal(result.stderr, '');
  return { result, envelope: JSON.parse(result.stdout) };
}

// The serializer writes fixed frontmatter, one LF, then the body verbatim, so
// one measured create fixes the overhead every other create in this file uses.
// Measured, never recomputed from the production serializer.
async function createOverheadBytes() {
  return withLedger({}, async (ledger) => {
    const { envelope } = await runCreate(ledger, 'x');
    assert.equal(envelope.ok, true);
    return Buffer.from(envelope.result.item.source_base64, 'base64').length - 1;
  });
}

test('create accepts an item source of exactly the byte limit', async () => {
  const overhead = await createOverheadBytes();
  await withLedger({}, async (ledger) => {
    const { result, envelope } = await runCreate(ledger, 'x'.repeat(LIMIT - overhead));

    assert.equal(result.status, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.state, 'committed');
    assert.equal(Buffer.from(envelope.result.item.source_base64, 'base64').length, LIMIT);
  });
});

test('create refuses an item source one byte over the limit and publishes nothing', async () => {
  const overhead = await createOverheadBytes();
  await withLedger({}, async (ledger) => {
    const { result, envelope } = await runCreate(ledger, 'x'.repeat(LIMIT - overhead + 1));

    assert.equal(result.status, 2);
    assert.deepEqual(envelope, {
      ok: false,
      command: 'create',
      contract_version: 4,
      state: 'unchanged',
      error: {
        code: 'item-source-too-large',
        message: 'The proposed item source exceeds the supported byte limit.',
        details: { id: CREATE_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT },
      },
    });
    await assertNothingPublished(ledger);
  });
});

// Byte accounting, not string length: 2,097,152 three-byte characters are
// 6,291,456 bytes and 2,097,152 JavaScript string units.
test('create counts multi-byte UTF-8 source bytes, not string length', async () => {
  const overhead = await createOverheadBytes();
  await withLedger({}, async (ledger) => {
    const wide = '€'.repeat(2097152);
    const body = wide + 'x'.repeat(LIMIT - overhead + 1 - Buffer.byteLength(wide, 'utf8'));
    assert.equal(Buffer.byteLength(body, 'utf8'), LIMIT - overhead + 1);
    assert.ok(body.length < Buffer.byteLength(body, 'utf8'));

    const { result, envelope } = await runCreate(ledger, body);

    assert.equal(result.status, 2);
    assert.equal(envelope.error.code, 'item-source-too-large');
    assert.equal(envelope.error.details.size_bytes, LIMIT + 1);
    await assertNothingPublished(ledger);
  });
});

test('the stdin create vector refuses exactly where the file vector refuses', async () => {
  const overhead = await createOverheadBytes();
  await withLedger({}, async (ledger) => {
    const accepted = runCreateFromStdin(ledger, 'x'.repeat(LIMIT - overhead));
    assert.equal(accepted.result.status, 0);
    assert.equal(Buffer.from(accepted.envelope.result.item.source_base64, 'base64').length, LIMIT);
  });
  await withLedger({}, async (ledger) => {
    const { result, envelope } = runCreateFromStdin(ledger, 'x'.repeat(LIMIT - overhead + 1));

    assert.equal(result.status, 2);
    assert.equal(envelope.error.code, 'item-source-too-large');
    assert.deepEqual(envelope.error.details, {
      id: CREATE_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT,
    });
    await assertNothingPublished(ledger);
  });
});

// alpha.6 accepted this create with exit 0 and state committed.
test('a fifty-mebibyte create refuses and publishes no item', async () => {
  await withLedger({}, async (ledger) => {
    const { result, envelope } = await runCreate(ledger, 'x'.repeat(52428800));

    assert.equal(result.status, 2);
    assert.equal(envelope.error.code, 'item-source-too-large');
    assert.equal(envelope.error.details.limit_bytes, LIMIT);
    assert.ok(envelope.error.details.size_bytes > 52428800);
    await assertNothingPublished(ledger);
  });
});

const TARGET_ID = 'wb_01Q4AS1Y80248J48HK6D248NAN';
const TARGET_FRONTMATTER = [
  '---',
  'schema_version: 1',
  `id: ${TARGET_ID}`,
  'title: "Bound the successor"',
  'kind: task',
  'status: triage',
  'created: 2030-01-12',
  'updated: 2030-01-12',
  'provenance:',
  '  source: "fixture/item-source-limit"',
  '  recorded_at: "2030-01-12T10:00:00Z"',
  'depends_on: []',
  'related: []',
  '---',
  '',
].join('\n');

function seedSource(bodyBytes) {
  return `${TARGET_FRONTMATTER}${'x'.repeat(bodyBytes)}`;
}

function revisionOf(text) {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

// Runs one mutating verb against a ledger holding exactly one seeded item of
// the requested body size, and reports the envelope plus the bytes on disk.
async function runOnSeeded(command, bodyBytes, requestMembers) {
  const source = seedSource(bodyBytes);
  return withLedger({ [`${TARGET_ID}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: TARGET_ID,
      expected_revision: revisionOf(source),
      ...requestMembers,
    }), 'utf8');

    const result = runLargeCli(command, '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.stderr, '');
    const committed = await readFile(path.join(ledger, `${TARGET_ID}.md`));
    return { result, envelope: JSON.parse(result.stdout), committed, before: source };
  });
}

const TRANSITION_REQUEST = {
  to_status: 'backlog',
  date: '2030-01-13',
  decision: {
    summary: 'Accept the bounded successor.',
    rationale: 'The decision block is what pushes this successor across the bound.',
  },
};

const PATCH_DATE = '2030-01-13';

// Each verb writes a different successor around the same body, so each one's
// non-body overhead is measured once from a real committed successor.
async function overheadFor(command, requestMembers) {
  const { envelope, committed } = await runOnSeeded(command, 1, requestMembers);
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error ?? {}));
  return committed.length - 1;
}

test('transition refuses a successor its decision block pushes one byte over the limit', async () => {
  const overhead = await overheadFor('transition', TRANSITION_REQUEST);

  const accepted = await runOnSeeded('transition', LIMIT - overhead, TRANSITION_REQUEST);
  assert.equal(accepted.result.status, 0, JSON.stringify(accepted.envelope.error ?? {}));
  assert.equal(accepted.committed.length, LIMIT);

  const refused = await runOnSeeded('transition', LIMIT - overhead + 1, TRANSITION_REQUEST);
  assert.equal(refused.result.status, 2);
  assert.deepEqual(refused.envelope, {
    ok: false,
    command: 'transition',
    contract_version: 4,
    state: 'unchanged',
    error: {
      code: 'item-source-too-large',
      message: 'The proposed item source exceeds the supported byte limit.',
      details: { id: TARGET_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT },
    },
  });
  // The stored item was legal; only the successor is not.
  assert.ok(refused.before.length < LIMIT);
  assert.equal(refused.committed.toString('utf8'), refused.before);
});

test('patch body replacement refuses a successor one byte over the limit', async () => {
  const request = (body) => ({ date: PATCH_DATE, set: { body } });
  const overhead = await overheadFor('patch', request('x'));

  const accepted = await runOnSeeded('patch', 1, request('x'.repeat(LIMIT - overhead)));
  assert.equal(accepted.result.status, 0, JSON.stringify(accepted.envelope.error ?? {}));
  assert.equal(accepted.committed.length, LIMIT);

  const refused = await runOnSeeded('patch', 1, request('x'.repeat(LIMIT - overhead + 1)));
  assert.equal(refused.result.status, 2);
  assert.deepEqual(refused.envelope, {
    ok: false,
    command: 'patch',
    contract_version: 4,
    state: 'unchanged',
    error: {
      code: 'item-source-too-large',
      message: 'The proposed item source exceeds the supported byte limit.',
      details: { id: TARGET_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT },
    },
  });
  assert.equal(refused.committed.toString('utf8'), refused.before);
});

test('patch body append refuses a successor one byte over the limit', async () => {
  const request = (bodyAppend) => ({ date: PATCH_DATE, set: { body_append: bodyAppend } });
  const overhead = await overheadFor('patch', request('x'));

  const accepted = await runOnSeeded('patch', 1, request('x'.repeat(LIMIT - overhead)));
  assert.equal(accepted.result.status, 0, JSON.stringify(accepted.envelope.error ?? {}));
  assert.equal(accepted.committed.length, LIMIT);

  const refused = await runOnSeeded('patch', 1, request('x'.repeat(LIMIT - overhead + 1)));
  assert.equal(refused.result.status, 2);
  assert.equal(refused.envelope.error.code, 'item-source-too-large');
  assert.deepEqual(refused.envelope.error.details, {
    id: TARGET_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT,
  });
  assert.equal(refused.committed.toString('utf8'), refused.before);
});

test('patch counts multi-byte UTF-8 successor bytes, not string length', async () => {
  const request = (body) => ({ date: PATCH_DATE, set: { body } });
  const overhead = await overheadFor('patch', request('x'));
  const wide = '€'.repeat(2097152);
  const body = wide + 'x'.repeat(LIMIT - overhead + 1 - Buffer.byteLength(wide, 'utf8'));
  assert.ok(body.length < Buffer.byteLength(body, 'utf8'));

  const refused = await runOnSeeded('patch', 1, request(body));

  assert.equal(refused.result.status, 2);
  assert.equal(refused.envelope.error.code, 'item-source-too-large');
  assert.equal(refused.envelope.error.details.size_bytes, LIMIT + 1);
  assert.equal(refused.committed.toString('utf8'), refused.before);
});

// A ledger committed before the bound existed must stay readable and
// repairable. Only its successors are bounded.
const LEGACY_BODY_BYTES = LIMIT + 4096;

async function withLegacyOversizedLedger(callback) {
  const source = seedSource(LEGACY_BODY_BYTES);
  assert.ok(Buffer.byteLength(source, 'utf8') > LIMIT);
  return withLedger({ [`${TARGET_ID}.md`]: source }, async (ledger) => callback(ledger, source));
}

test('a legacy oversized item still validates clean', async () => {
  await withLegacyOversizedLedger(async (ledger) => {
    const result = runLargeCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true, errors: [] });
  });
});

test('a legacy oversized item is still inspectable', async () => {
  await withLegacyOversizedLedger(async (ledger, source) => {
    const result = runLargeCli('inspect', '--ledger', ledger, '--id', TARGET_ID, '--json');

    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.item.revision, revisionOf(source));
    assert.equal(
      Buffer.from(envelope.result.item.source_base64, 'base64').toString('utf8'),
      source,
    );
  });
});

test('a patch that shrinks a legacy oversized item under the bound is accepted', async () => {
  await withLegacyOversizedLedger(async (ledger, source) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: TARGET_ID,
      expected_revision: revisionOf(source),
      date: PATCH_DATE,
      set: { body: '\nrepaired\n' },
    }), 'utf8');

    const result = runLargeCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stderr);
    const committed = await readFile(path.join(ledger, `${TARGET_ID}.md`));
    assert.ok(committed.length < LIMIT);
    assert.equal(JSON.parse(result.stdout).state, 'committed');
  });
});

test('a patch that leaves a legacy oversized item over the bound refuses', async () => {
  await withLegacyOversizedLedger(async (ledger, source) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: TARGET_ID,
      expected_revision: revisionOf(source),
      date: PATCH_DATE,
      set: { priority: 30 },
    }), 'utf8');

    const result = runLargeCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'item-source-too-large');
    assert.equal((await readFile(path.join(ledger, `${TARGET_ID}.md`))).toString('utf8'), source);
  });
});

test('a body append to a legacy oversized item refuses', async () => {
  await withLegacyOversizedLedger(async (ledger, source) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: TARGET_ID,
      expected_revision: revisionOf(source),
      date: PATCH_DATE,
      set: { body_append: 'more\n' },
    }), 'utf8');

    const result = runLargeCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'item-source-too-large');
    assert.equal((await readFile(path.join(ledger, `${TARGET_ID}.md`))).toString('utf8'), source);
  });
});

test('a transition of a legacy oversized item refuses', async () => {
  await withLegacyOversizedLedger(async (ledger, source) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: TARGET_ID,
      expected_revision: revisionOf(source),
      ...TRANSITION_REQUEST,
    }), 'utf8');

    const result = runLargeCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'item-source-too-large');
    assert.equal((await readFile(path.join(ledger, `${TARGET_ID}.md`))).toString('utf8'), source);
  });
});

// Size is not the first question a door asks. Every refusal class the engine
// already decided before serializing a successor still wins, and the classes it
// decides after the successor exists lose.
const OVERSIZED_BODY = LIMIT + 4096;

test('an invalid ledger still refuses before the successor is measured', async () => {
  const source = seedSource(OVERSIZED_BODY);
  await withLedger({
    [`${TARGET_ID}.md`]: source,
    'broken.md': 'not an item\n',
  }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: TARGET_ID, expected_revision: revisionOf(source), ...TRANSITION_REQUEST,
    }), 'utf8');

    const result = runLargeCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 3);
    assert.equal(JSON.parse(result.stdout).error.code, 'ledger-invalid');
  });
});

test('a missing item still refuses before the successor is measured', async () => {
  const { result, envelope } = await runOnSeeded('transition', OVERSIZED_BODY, {
    ...TRANSITION_REQUEST,
    id: 'wb_01Q4AS1Y80248J48HK6D248NAM',
  });

  assert.equal(result.status, 2);
  assert.equal(envelope.error.code, 'item-not-found');
});

test('a stale revision still refuses before the successor is measured', async () => {
  const { result, envelope } = await runOnSeeded('transition', OVERSIZED_BODY, {
    ...TRANSITION_REQUEST,
    expected_revision: `sha256:${'0'.repeat(64)}`,
  });

  assert.equal(result.status, 4);
  assert.equal(envelope.error.code, 'revision-conflict');
});

test('a failed transition precondition still refuses before the successor is measured', async () => {
  const { result, envelope } = await runOnSeeded('transition', OVERSIZED_BODY, {
    ...TRANSITION_REQUEST,
    date: '2030-01-11',
  });

  assert.equal(result.status, 2);
  assert.equal(envelope.error.code, 'transition-precondition-failed');
});

test('a failed patch precondition still refuses before the successor is measured', async () => {
  const { result, envelope } = await runOnSeeded('patch', OVERSIZED_BODY, {
    date: '2030-01-11',
    set: { priority: 30 },
  });

  assert.equal(result.status, 2);
  assert.equal(envelope.error.code, 'patch-precondition-failed');
});

test('an ID collision still refuses before the create candidate is measured', async () => {
  const overhead = await createOverheadBytes();
  const existing = [
    '---',
    'schema_version: 2',
    `id: ${CREATE_ID}`,
    'number: 1',
    'title: "Already here"',
    'kind: task',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/item-source-limit"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
    'already here',
    '',
  ].join('\n');
  await withLedger({ [`${CREATE_ID}.md`]: existing }, async (ledger) => {
    const { result, envelope } = await runCreate(ledger, 'x'.repeat(LIMIT - overhead + 1));

    assert.equal(result.status, 4);
    assert.equal(envelope.error.code, 'id-collision');
  });
});

// candidate-invalid is decided from the serialized successor, so the successor
// must be within the bound before the question is worth asking.
test('an oversized create that would also invalidate the ledger reports its size', async () => {
  const overhead = await createOverheadBytes();
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    const request = createRequest('x'.repeat(LIMIT - overhead + 1));
    request.item.depends_on = ['wb_01Q4AS1Y80248J48HK6D248NAM'];
    await writeFile(requestPath, JSON.stringify(request), 'utf8');

    const result = runLargeCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'item-source-too-large');
    await assertNothingPublished(ledger);
  });
});
