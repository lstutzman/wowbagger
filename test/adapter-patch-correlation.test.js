import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { mapProcessOutcome as referenceMapProcessOutcome } from '../spec/adapter-reference.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const mutationFixtures = path.join(projectRoot, 'spec', 'fixtures', 'mutations');

// Runs the real core against an isolated copy of a normative patch fixture and
// returns what the adapter would observe. The envelope is an observation,
// never an expectation: the expectation asserted below is hand-authored from
// the mutation contract's section 9 — a committed patch over any member of the
// patchable field set is forwarded, not reported as an unknown outcome.
async function observedPatch(t, fixture) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-patch-correlation-'));
  t.after(() => rm(temporary, { force: true, recursive: true }));
  const ledger = path.join(temporary, 'ledger');
  await mkdir(ledger);
  await cp(path.join(mutationFixtures, fixture, 'ledger'), ledger, { recursive: true });
  const input = await readFile(path.join(mutationFixtures, fixture, 'request.json'));
  const core = spawnSync(process.execPath, [
    path.join(projectRoot, 'bin', 'wowbagger.js'),
    'patch', '--ledger', ledger, '--input', '-', '--json',
  ], { cwd: projectRoot, input, encoding: null });
  assert.equal(core.status, 0, core.stderr?.toString('utf8'));
  return {
    input,
    request: JSON.parse(input.toString('utf8')),
    process: {
      started: true,
      input_delivery: 'delivered',
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: core.stdout.toString('base64'),
      stderr_base64: core.stderr.toString('base64'),
    },
  };
}

function outcomeContext(observed) {
  return {
    adapter_contract_version: 2,
    request_id: 'patch-correlation-0001',
    command: 'patch',
    core_request: {
      command: 'patch',
      ledger: 'ledger',
      input_base64: observed.input.toString('base64'),
    },
    mutation_input: observed.input,
    item_id: observed.request.id,
    expected_revision: observed.request.expected_revision,
    stdout_limit_bytes: 65536,
    stderr_limit_bytes: 4096,
    process: observed.process,
  };
}

test('forwards a committed patch that replaces the body instead of reporting an unknown outcome', async (t) => {
  const observed = await observedPatch(t, 'patch-body');
  const context = outcomeContext(observed);

  const shipped = mapProcessOutcome(context);
  const reference = referenceMapProcessOutcome(context);

  assert.equal(shipped, null, JSON.stringify(shipped));
  assert.equal(reference, null, JSON.stringify(reference));
});

// An extension member is absent from the lossless core view, so the only
// surface the response carries it on is the item source. Decoding and parsing
// that source is the correlation; the alternative is no correlation at all.
test('forwards a committed patch that writes a declared extension member', async (t) => {
  const observed = await observedPatch(t, 'patch-extensions');
  const context = outcomeContext(observed);

  const shipped = mapProcessOutcome(context);
  const reference = referenceMapProcessOutcome(context);

  assert.equal(shipped, null, JSON.stringify(shipped));
  assert.equal(reference, null, JSON.stringify(reference));
});

// Retunes the response so the extension member the request asked for is not
// the one the item carries. Correlating nothing would pass this too, which is
// why the negative is asserted rather than the positive alone.
async function tamperedItemSource(t, fixture, edit) {
  const observed = await observedPatch(t, fixture);
  const envelope = JSON.parse(Buffer.from(observed.process.stdout_base64, 'base64').toString('utf8'));
  const item = envelope.result.item;
  const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
  const replacement = Buffer.from(edit(source), 'utf8');
  item.source_base64 = replacement.toString('base64');
  item.revision = `sha256:${createHash('sha256').update(replacement).digest('hex')}`;
  const context = outcomeContext(observed);
  context.process = {
    ...observed.process,
    stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
  };
  return context;
}

test('refuses a committed patch whose item does not carry the requested extension member', async (t) => {
  const context = await tamperedItemSource(
    t,
    'patch-extensions',
    (source) => source.replace('external_id: "PC-1475"', 'external_id: "PC-9999"'),
  );

  assert.equal(mapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
  assert.equal(referenceMapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
});

// A title correction is the reason title is patchable at all, so it is the
// member most likely to be sent and the one whose refusal cost most.
test('forwards a committed patch that replaces the title', async (t) => {
  const observed = await observedPatch(t, 'patch-title');
  const context = outcomeContext(observed);

  assert.equal(mapProcessOutcome(context), null);
  assert.equal(referenceMapProcessOutcome(context), null);
});

test('refuses a committed patch whose item does not carry the requested title', async (t) => {
  const context = await tamperedItemSource(
    t,
    'patch-title',
    (source) => source.replace(/^title: .*$/m, 'title: "A title nobody requested"'),
  );

  assert.equal(mapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
  assert.equal(referenceMapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
});

test('forwards a committed patch that replaces a whole relation list', async (t) => {
  const observed = await observedPatch(t, 'patch-relations');
  const context = outcomeContext(observed);

  assert.equal(mapProcessOutcome(context), null);
  assert.equal(referenceMapProcessOutcome(context), null);
});

// An append names only the addition, so the readable correlation is that the
// addition is exactly the tail of the body read back.
test('forwards a committed patch that appends to the body', async (t) => {
  const observed = await observedPatch(t, 'patch-body-append');
  const context = outcomeContext(observed);

  assert.equal(mapProcessOutcome(context), null);
  assert.equal(referenceMapProcessOutcome(context), null);
});

test('refuses a committed patch whose body does not end with the requested addition', async (t) => {
  const context = await tamperedItemSource(
    t,
    'patch-body-append',
    (source) => `${source}a trailing byte the request never asked for\n`,
  );

  assert.equal(mapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
  assert.equal(referenceMapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
});

// A request the core would refuse cannot be promoted into a valid mutation
// just to correlate a success. `number` is the immutable item identity, and
// the two body write modes are mutually exclusive in one request.
for (const [name, set] of [
  ['a set member outside the patchable field set', { kind: 'epic' }],
  ['the immutable item number', { number: 4 }],
  ['both body write modes at once', { body: '\nnew\n', body_append: 'more\n' }],
  ['an empty title', { title: '' }],
  ['a relation list that is not an array', { related: 'wb_01Q4ZK3DG020ANANANANANANAM' }],
  ['an extensions container naming no member', { extensions: {} }],
]) {
  test(`refuses a patch response answering a request naming ${name}`, async (t) => {
    const observed = await observedPatch(t, 'patch-body');
    const request = { ...observed.request, set };
    const input = Buffer.from(`${JSON.stringify(request)}\n`);
    const context = outcomeContext(observed);
    context.mutation_input = input;
    context.core_request = { ...context.core_request, input_base64: input.toString('base64') };

    assert.equal(mapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
    assert.equal(referenceMapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
  });
}
