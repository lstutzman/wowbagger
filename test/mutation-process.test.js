import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withLedger } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const testCli = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));
const fixtures = new URL('../spec/fixtures/mutations/', import.meta.url);
const CREATE_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

test('two create processes leave one complete item and no temporary or lock files', async () => {
  await withLedger({}, async (ledger) => {
    const firstRequest = path.join(path.dirname(ledger), 'first.json');
    const secondRequest = path.join(path.dirname(ledger), 'second.json');
    await writeFile(firstRequest, JSON.stringify(createRequest(CREATE_ID, `\n${'a'.repeat(1024 * 1024)}\n`)));
    await writeFile(secondRequest, JSON.stringify(createRequest(CREATE_ID, `\n${'b'.repeat(1024 * 1024)}\n`)));

    const finalPath = path.join(ledger, `${CREATE_ID}.md`);
    let finished = false;
    const commands = Promise.all([
      runCli('create', '--ledger', ledger, '--input', firstRequest, '--json'),
      runCli('create', '--ledger', ledger, '--input', secondRequest, '--json'),
    ]);
    commands.finally(() => { finished = true; }).catch(() => {});

    const observations = [];
    while (!finished) {
      try {
        observations.push(fingerprint(await readFile(finalPath)));
      } catch (error) {
        assert.equal(error.code, 'ENOENT');
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    const results = await commands;
    const output = results.map(parseOutput);
    const successes = output.filter((entry) => entry.ok);
    const conflicts = output.filter((entry) => !entry.ok);

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.ok(['id-collision', 'lock-held'].includes(conflicts[0].error.code));
    assert.ok([0, 4].includes(results[0].status));
    assert.ok([0, 4].includes(results[1].status));

    const finalBytes = await readFile(finalPath);
    observations.push(fingerprint(finalBytes));
    const expected = Buffer.from(successes[0].result.item.source_base64, 'base64');
    assert.deepEqual(finalBytes, expected);
    assert.ok(observations.every((entry) => entry.size === finalBytes.length && entry.sha256 === fingerprint(finalBytes).sha256));
    await assertNoOwnArtifacts(ledger);
  });
});

test('create selects the schema version for every valid ledger state', async () => {
  const seedId = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const cases = [
    { name: 'empty ledger', files: {}, expectedSchemaVersion: 2 },
    {
      name: 'schema version 1 ledger',
      files: { [`${seedId}.md`]: schemaSeed(seedId, 1) },
      expectedSchemaVersion: 1,
    },
    {
      name: 'schema version 2 ledger',
      files: { [`${seedId}.md`]: schemaSeed(seedId, 2) },
      expectedSchemaVersion: 2,
    },
  ];

  for (const scenario of cases) {
    await withLedger(scenario.files, async (ledger) => {
      const requestPath = path.join(path.dirname(ledger), 'create.json');
      await writeFile(requestPath, JSON.stringify(createRequest(CREATE_ID, '')));

      const result = await runCli('create', '--ledger', ledger, '--input', requestPath, '--json');
      const output = parseOutput(result);

      assert.equal(result.status, 0, `${scenario.name}: ${result.stdout}`);
      assert.equal(output.result.item.core.schema_version, scenario.expectedSchemaVersion, scenario.name);
      assert.match(
        await readFile(path.join(ledger, `${CREATE_ID}.md`), 'utf8'),
        new RegExp(`^schema_version: ${scenario.expectedSchemaVersion}$`, 'm'),
        scenario.name,
      );
      await assertNoOwnArtifacts(ledger);
    });
  }
});

test('a stale transition snapshot cannot overwrite the committed successor', async () => {
  const source = await fixtureText('transition-success/before.md');
  const request = JSON.parse(await fixtureText('transition-success/request.json'));
  const id = request.id;

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify(request));

    const committed = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    const stale = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(committed.status, 0, committed.stderr);
    assert.equal(stale.status, 4, stale.stderr);
    assert.equal(parseOutput(stale).error.code, 'revision-conflict');
    const finalBytes = await readFile(path.join(ledger, `${id}.md`));
    assert.deepEqual(finalBytes, Buffer.from(parseOutput(committed).result.item.source_base64, 'base64'));
    assert.match(finalBytes.toString('utf8'), /^status: backlog$/m);
    await assertNoOwnArtifacts(ledger);
  });
});

test('a valid existing lock prevents a competing transition without changing the item', async () => {
  const source = await fixtureText('lock-held/ledger/wb_01Q4G4Q3G004HMASW9NF6YY093.md');
  const request = JSON.parse(await fixtureText('lock-held/request.json'));
  const id = request.id;

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const lockDirectory = path.join(ledger, '.wowbagger-locks');
    const lockPath = path.join(lockDirectory, `${id}.lock`);
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    const lockSource = JSON.stringify({
      lock_version: 1,
      item_id: id,
      operation: 'transition',
      writer_id: 'process-lock-contention',
      started_at: '2030-01-16T08:00:00Z',
    });
    await mkdir(lockDirectory);
    await writeFile(lockPath, lockSource);
    await writeFile(requestPath, JSON.stringify(request));

    const result = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 4, result.stderr);
    assert.equal(parseOutput(result).error.code, 'lock-held');
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
    assert.equal(await readFile(lockPath, 'utf8'), lockSource);
  });
});

test('create reports a directory collision without touching its contents', async () => {
  await withLedger({}, async (ledger) => {
    const finalDirectory = path.join(ledger, `${CREATE_ID}.md`);
    const occupant = path.join(finalDirectory, 'occupant.txt');
    const requestPath = path.join(path.dirname(ledger), 'create.json');
    await mkdir(finalDirectory);
    await writeFile(occupant, 'do not replace me\n');
    await writeFile(requestPath, JSON.stringify(createRequest(CREATE_ID, '')));

    const result = await runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 4, result.stderr);
    assert.equal(parseOutput(result).error.code, 'path-collision');
    assert.equal(await readFile(occupant, 'utf8'), 'do not replace me\n');
    assert.equal((await readdir(finalDirectory)).length, 1);
    await assertNoOwnArtifacts(ledger);
  });
});

test('inspect derives revision, raw source, and body from one file snapshot', async () => {
  const id = 'wb_01Q4837BM01W70T30B184GG1R6';
  const source = await fixtureText(`inspect/ledger/${id}.md`);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const result = await runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const item = parseOutput(result).result.item;
    const raw = Buffer.from(item.source_base64, 'base64');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(item.revision, `sha256:${createHash('sha256').update(raw).digest('hex')}`);
    assert.equal(raw.toString('utf8'), source);
    assert.ok(raw.toString('utf8').endsWith(item.body));
  });
});

test('a terminal lifecycle change requiring dependent cleanup remains a no-write refusal', async () => {
  const targetId = 'wb_01Q4JTHP40ZVEBN63PAGS11ZPW';
  const dependentId = 'wb_01Q4M9YB0004HMASW9NF6YY093';
  const target = await fixtureText(`multi-item-required/ledger/${targetId}.md`);
  const dependent = await fixtureText(`multi-item-required/ledger/${dependentId}.md`);
  const request = await fixtureText('multi-item-required/request.json');

  await withLedger({ [`${targetId}.md`]: target, [`${dependentId}.md`]: dependent }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, request);

    const result = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseOutput(result).error.code, 'atomic-scope-required');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), target);
    assert.equal(await readFile(path.join(ledger, `${dependentId}.md`), 'utf8'), dependent);
    await assertNoOwnArtifacts(ledger);
  });
});

test('a schema version 2 done transition changes only the target when a dependent names it', async () => {
  const targetId = 'wb_01Q4JTHP40ZVEBN63PAGS11ZPW';
  const dependentId = 'wb_01Q4M9YB0004HMASW9NF6YY093';
  const target = `---
schema_version: 2
id: ${targetId}
title: "Complete the prerequisite"
kind: task
status: in-progress
created: 2030-01-15
updated: 2030-01-15
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-15T13:00:00Z"
depends_on: []
related: []
---
`;
  const dependent = `---
schema_version: 2
id: ${dependentId}
title: "Keep declared prerequisite history"
kind: task
status: backlog
created: 2030-01-16
updated: 2030-01-16
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-16T14:00:00Z"
depends_on: [${targetId}]
related: []
---
`;

  await withLedger({ [`${targetId}.md`]: target, [`${dependentId}.md`]: dependent }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: `sha256:${createHash('sha256').update(target).digest('hex')}`,
      to_status: 'done',
      date: '2030-01-17',
      decision: {
        summary: 'Complete the prerequisite.',
        rationale: 'Dependents retain satisfied prerequisite history.',
      },
    }));

    const result = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    const output = parseOutput(result);

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'committed');
    assert.equal(output.result.item.core.status, 'done');
    assert.equal(await readFile(path.join(ledger, `${dependentId}.md`), 'utf8'), dependent);
    assert.deepEqual(output.result.item.core.related, []);
    await assertNoOwnArtifacts(ledger);
  });
});

test('a schema version 2 done transition retains its satisfied prerequisites', async () => {
  const prerequisiteId = 'wb_01Q4G4Q3G0207EXVQEXVQEXVQE';
  const targetId = 'wb_01Q4JTHP40ZVEBN63PAGS11ZPW';
  const prerequisite = `---
schema_version: 2
id: ${prerequisiteId}
title: "Completed prerequisite"
kind: task
status: done
created: 2030-01-14
updated: 2030-01-15
completed: 2030-01-15
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: complete
    date: 2030-01-15
    summary: "Complete the prerequisite."
    rationale: "The prerequisite evidence is complete."
---
`;
  const target = `---
schema_version: 2
id: ${targetId}
title: "Complete dependent work"
kind: task
status: in-progress
created: 2030-01-15
updated: 2030-01-15
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-15T13:00:00Z"
depends_on: [${prerequisiteId}]
related: []
---
`;

  await withLedger({
    [`${prerequisiteId}.md`]: prerequisite,
    [`${targetId}.md`]: target,
  }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: `sha256:${createHash('sha256').update(target).digest('hex')}`,
      to_status: 'done',
      date: '2030-01-16',
      decision: {
        summary: 'Complete the dependent work.',
        rationale: 'Every declared prerequisite is done.',
      },
    }));

    const result = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    const output = parseOutput(result);

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'committed');
    assert.equal(output.result.item.core.status, 'done');
    assert.deepEqual(output.result.item.core.depends_on, [prerequisiteId]);
    assert.equal(await readFile(path.join(ledger, `${prerequisiteId}.md`), 'utf8'), prerequisite);
    assert.match(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), new RegExp(`^depends_on: \\[\\s*${prerequisiteId}\\s*\\]$`, 'm'));
    await assertNoOwnArtifacts(ledger);
  });
});

test('a schema version 2 done transition refuses a live prerequisite', async () => {
  const prerequisiteId = 'wb_01Q4G4Q3G0207EXVQEXVQEXVQE';
  const targetId = 'wb_01Q4JTHP40ZVEBN63PAGS11ZPW';
  const prerequisite = `---
schema_version: 2
id: ${prerequisiteId}
title: "Live prerequisite"
kind: task
status: backlog
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
---
`;
  const target = `---
schema_version: 2
id: ${targetId}
title: "Blocked completion"
kind: task
status: in-progress
created: 2030-01-15
updated: 2030-01-15
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-15T13:00:00Z"
depends_on: [${prerequisiteId}]
related: []
---
`;

  await withLedger({
    [`${prerequisiteId}.md`]: prerequisite,
    [`${targetId}.md`]: target,
  }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: `sha256:${createHash('sha256').update(target).digest('hex')}`,
      to_status: 'done',
      date: '2030-01-16',
      decision: {
        summary: 'Attempt blocked completion.',
        rationale: 'The live prerequisite must prevent completion.',
      },
    }));

    const result = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    const output = parseOutput(result);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'transition-precondition-failed');
    assert.deepEqual(output.error.details.issues, [{
      code: 'live-dependencies',
      field: 'depends_on',
      message: 'Completion requires every depends_on target to be done.',
      related_ids: [prerequisiteId],
    }]);
    assert.equal(await readFile(path.join(ledger, `${prerequisiteId}.md`), 'utf8'), prerequisite);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), target);
    await assertNoOwnArtifacts(ledger);
  });
});

test('an epic cannot enter in-progress before candidate validation', async () => {
  const id = 'wb_01Q4JTHP40ZVEBN63PAGS11ZPW';
  const source = `---
schema_version: 2
id: ${id}
title: "Unsupported epic edge"
kind: epic
status: backlog
created: 2030-01-15
updated: 2030-01-15
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-15T13:00:00Z"
depends_on: []
related: []
---
`;

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: `sha256:${createHash('sha256').update(source).digest('hex')}`,
      to_status: 'in-progress',
      date: '2030-01-16',
    }));

    const result = await runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    const output = parseOutput(result);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'transition-precondition-failed');
    assert.deepEqual(output.error.details.issues, [{
      code: 'invalid-edge',
      field: 'to_status',
      message: 'The requested lifecycle edge is not allowed for this item.',
      related_ids: [],
    }]);
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
    await assertNoOwnArtifacts(ledger);
  });
});

test('a completed writer never removes a successor writer lock during repeated handoff', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await withLedger({ [`${id}.md`]: triageSource(id) }, async (ledger) => {
      const inspected = await runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = parseOutput(inspected).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), 'transition.json');
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: 'Accept the handoff item.',
          rationale: 'Exercise ownership-safe lock cleanup.',
        },
      }));

      const suffix = `handoff-${iteration}`;
      const released = path.join(ledger, `.wowbagger-test-${suffix}-released`);
      const acquired = path.join(ledger, `.wowbagger-test-${suffix}-acquired`);
      const allowSuccessor = path.join(ledger, `.wowbagger-test-${suffix}-allow-successor`);
      const predecessor = runTestCli(`pause-after-success-release:${suffix}`,
        'transition', '--ledger', ledger, '--input', requestPath, '--json');
      await waitForFile(released);
      const successor = runTestCli(`pause-after-lock-acquired:${suffix}`,
        'transition', '--ledger', ledger, '--input', requestPath, '--json');
      await waitForFile(acquired);
      const predecessorResult = await predecessor;

      assert.equal(predecessorResult.status, 0, predecessorResult.stderr);
      const lockPath = path.join(ledger, '.wowbagger-locks', `${id}.lock`);
      assert.equal((await lstat(lockPath)).isFile(), true);

      await writeFile(allowSuccessor, 'continue\n');
      const successorResult = await successor;
      assert.equal(successorResult.status, 4, successorResult.stderr);
      assert.equal(parseOutput(successorResult).error.code, 'revision-conflict');
      await assertNoOwnArtifacts(ledger);
    });
  }
});

function createRequest(id, body) {
  return {
    id,
    item: {
      title: 'Exercise real-process mutation coordination',
      kind: 'task',
      provenance: {
        source: 'test/mutation-process',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
    },
    body,
  };
}

function triageSource(id) {
  return `---
schema_version: 1
id: ${id}
title: "Coordinate an ownership-safe lock handoff"
kind: task
status: triage
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/mutation-process"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
---
`;
}

function schemaSeed(id, schemaVersion) {
  return triageSource(id).replace('schema_version: 1', `schema_version: ${schemaVersion}`);
}

function runCli(...argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...argumentsList], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function runTestCli(scenario, ...argumentsList) {
  return runProcess(testCli, argumentsList, {
    ...process.env,
    WOWBAGGER_TEST_SCENARIO: scenario,
  });
}

function runProcess(executable, argumentsList, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...argumentsList], {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({
      status,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function waitForFile(file) {
  const deadline = Date.now() + 2_000;
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

function parseOutput(result) {
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

async function fixtureText(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, fixtures)), 'utf8');
}

function fingerprint(bytes) {
  return {
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function assertNoOwnArtifacts(ledger) {
  const entries = await readdir(ledger);
  assert.deepEqual(entries.filter((entry) => entry.startsWith('.wowbagger-tmp-')), []);
  if (entries.includes('.wowbagger-locks')) {
    assert.deepEqual(await readdir(path.join(ledger, '.wowbagger-locks')), []);
  }
}
