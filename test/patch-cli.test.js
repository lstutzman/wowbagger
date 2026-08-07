import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { runCli, withLedger } from './support.js';

test('patch changes priority and records why under a guarded replacement', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const body = '\nThe body stays byte-for-byte exact.\n';
  const source = itemSource(id, body);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 3 },
      date: '2030-01-16',
      decision: {
        summary: 'Raise the fictional survey priority.',
        rationale: 'The survey now blocks the next planning pass.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const output = JSON.parse(result.stdout);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(result.stderr, '');
    assert.equal(data.priority, 3);
    assert.equal(data.updated, '2030-01-16');
    assert.deepEqual(data.decisions.at(-1), {
      action: 'record',
      date: '2030-01-16',
      summary: 'Raise the fictional survey priority.',
      rationale: 'The survey now blocks the next planning pass.',
    });
    assert.ok(rewritten.endsWith(body));
    assert.equal(Object.hasOwn(output.result.item, 'priority'), false);
    assert.equal(Object.hasOwn(output.result.item.core, 'priority'), false);
    assert.deepEqual(await readdir(path.join(ledger, '.wowbagger-locks')), []);
  });
});

test('patch changes title, number, parent, and dependencies in one item', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const oldParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const newParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const dependencyId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', [`parent: ${oldParentId}`]);

  await withLedger({
    [`${targetId}.md`]: target,
    [`${oldParentId}.md`]: itemSource(oldParentId, '', [], 'epic'),
    [`${newParentId}.md`]: itemSource(newParentId, '', [], 'epic'),
    [`${dependencyId}.md`]: itemSource(dependencyId),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-fields.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: {
        title: 'Survey the fictional aurora corridor',
        number: 7,
        parent: newParentId,
        depends_on: [dependencyId],
      },
      date: '2030-01-17',
      decision: {
        summary: 'Correct the survey metadata.',
        rationale: 'The corrected title and relations match the planning record.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(data.title, 'Survey the fictional aurora corridor');
    assert.equal(data.number, 7);
    assert.equal(data.parent, newParentId);
    assert.deepEqual(data.depends_on, [dependencyId]);
    assert.equal(data.decisions.at(-1).action, 'record');
  });
});

test('patch removes optional priority, number, and parent with null', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const parentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', [
    'number: 12',
    `parent: ${parentId}`,
    'priority: 4',
  ]);

  await withLedger({
    [`${targetId}.md`]: target,
    [`${parentId}.md`]: itemSource(parentId, '', [], 'epic'),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-remove.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { priority: null, number: null, parent: null },
      date: '2030-01-18',
      decision: {
        summary: 'Clear optional planning metadata.',
        rationale: 'The item no longer has a parent, number, or explicit priority.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(Object.hasOwn(data, 'priority'), false);
    assert.equal(Object.hasOwn(data, 'number'), false);
    assert.equal(Object.hasOwn(data, 'parent'), false);
  });
});

test('patch refuses an invalid proposed ledger and leaves target bytes unchanged', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const missingParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-invalid.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { parent: missingParentId },
      date: '2030-01-19',
      decision: {
        summary: 'Attach the item to the missing epic.',
        rationale: 'This synthetic request must fail complete-ledger validation.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'candidate-invalid');
    assert.equal(output.error.details.validation_errors[0].code, 'unresolved-parent');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('patch refuses a stale revision and leaves target bytes unchanged', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'patch-stale.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: `sha256:${'0'.repeat(64)}`,
      patch: { priority: 1 },
      date: '2030-01-20',
      decision: {
        summary: 'Apply a stale priority change.',
        rationale: 'The stale compare-and-swap witness must refuse this write.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 4, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'revision-conflict');
    assert.equal(output.error.details.expected_revision, `sha256:${'0'.repeat(64)}`);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('patch refuses while the target per-ID lock is held', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const lockDirectory = path.join(ledger, '.wowbagger-locks');
    const lockPath = path.join(lockDirectory, `${targetId}.lock`);
    const lockSource = `${JSON.stringify({
      lock_version: 1,
      item_id: targetId,
      operation: 'patch',
      writer_id: 'held-patch-writer',
      started_at: '2030-01-20T12:00:00Z',
    })}\n`;
    const requestPath = path.join(path.dirname(ledger), 'patch-locked.json');
    await mkdir(lockDirectory);
    await writeFile(lockPath, lockSource);
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { priority: 2 },
      date: '2030-01-20',
      decision: {
        summary: 'Change priority while another writer holds the lock.',
        rationale: 'The per-ID lock must serialize cooperative patch writers.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 4, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'lock-held');
    assert.equal(output.error.details.owner.operation, 'patch');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
    assert.equal(await readFile(lockPath, 'utf8'), lockSource);
  });
});

test('patch refuses when reparenting would require changing a done epic rollup', async () => {
  const childId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const epicId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const child = killedChildSource(childId, epicId);
  const epic = doneEpicSource(epicId, childId);

  await withLedger({ [`${childId}.md`]: child, [`${epicId}.md`]: epic }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', childId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-multi-item.json');
    await writeFile(requestPath, JSON.stringify({
      id: childId,
      expected_revision: revision,
      patch: { parent: null },
      date: '2030-01-16',
      decision: {
        summary: 'Remove the child from its completed epic.',
        rationale: 'Changing the child set would also require a new epic rollup.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 5, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'atomic-scope-required');
    assert.deepEqual(output.error.details, {
      id: childId,
      blockers: [{ code: 'child-disposition', item_id: epicId, field: 'parent' }],
      precondition_issues: [],
    });
    assert.equal(await readFile(path.join(ledger, `${childId}.md`), 'utf8'), child);
    assert.equal(await readFile(path.join(ledger, `${epicId}.md`), 'utf8'), epic);
  });
});

test('patch requires decision evidence for every frontmatter change', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-no-decision.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { priority: 5 },
      date: '2030-01-20',
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout).error.details.issues, [{
      path: '/decision',
      code: 'missing-member',
      message: 'Required member decision is missing.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('patch rejects a frontmatter field outside the exact patchable set', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-status.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { status: 'done' },
      date: '2030-01-20',
      decision: {
        summary: 'Try to bypass transition.',
        rationale: 'Status changes belong only to the transition operation.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout).error.details.issues, [{
      path: '/patch/status',
      code: 'unknown-member',
      message: 'Patch member status is not allowed.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

function itemSource(id, body = '', extraFrontmatter = [], kind = 'task') {
  return `---
schema_version: 1
id: ${id}
title: "Survey the fictional northern lights"
kind: ${kind}
status: backlog
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/patch-cli"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
${extraFrontmatter.length > 0 ? `${extraFrontmatter.join('\n')}\n` : ''}---
${body}`;
}

function frontmatter(source) {
  return source.split('\n---\n', 1)[0].replace(/^---\n/, '');
}

function killedChildSource(id, parent) {
  return `---
schema_version: 1
id: ${id}
title: "Close the fictional child survey"
kind: task
status: killed
created: 2030-01-14
updated: 2030-01-16
killed: 2030-01-16
provenance:
  source: "test/patch-cli"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
parent: ${parent}
decisions:
  - action: kill
    date: 2030-01-16
    summary: "Close the child survey."
    rationale: "The synthetic survey is no longer needed."
---
`;
}

function doneEpicSource(id, child) {
  return `---
schema_version: 1
id: ${id}
title: "Complete the fictional survey epic"
kind: epic
status: done
created: 2030-01-14
updated: 2030-01-17
completed: 2030-01-17
provenance:
  source: "test/patch-cli"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: complete
    date: 2030-01-17
    summary: "Complete the survey epic."
    rationale: "Every direct child has reached a terminal state."
    rollup:
      - id: ${child}
        status: killed
---
`;
}
