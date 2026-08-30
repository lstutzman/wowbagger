import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './support.js';

const currentDistribution = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
).version;

test('version-drift reports a stale skill before mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-version-drift-'));
  const skill = path.join(root, 'SKILL.md');
  try {
    await writeFile(skill, [
      '---',
      'name: wowbagger',
      '---',
      '',
      'This skill requires distribution version: `0.1.0-alpha.6` and core `contract_version: 3`.',
      '',
    ].join('\n'));
    const result = runCli('version-drift', '--skill', skill, '--json');
    assert.equal(result.status, 4, result.stderr);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'version-drift');
    assert.equal(envelope.contract_version, 5);
    assert.equal(envelope.error.details.installed_distribution, '0.1.0-alpha.6');
    assert.equal(envelope.error.details.required_distribution, currentDistribution);
    assert.equal(envelope.error.details.running_distribution, currentDistribution);
    assert.equal(envelope.error.details.installed_contract_version, 3);
    assert.equal(envelope.error.details.required_contract_version, 5);
    assert.equal(envelope.error.details.running_contract_version, 5);
    assert.equal(envelope.error.details.provenance.kind, 'direct-path');
    assert.equal(envelope.error.details.provenance.path, skill);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('version-drift detects a newer incompatible skill contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-version-drift-newer-'));
  const skill = path.join(root, 'SKILL.md');
  try {
    await writeFile(skill, [
      '---',
      'name: wowbagger',
      '---',
      '',
      `This skill requires distribution version: \`${currentDistribution}\` and core \`contract_version: 6\`.`,
      '',
    ].join('\n'));
    const { inspectVersionDrift } = await import('../src/version-drift.js');
    const report = await inspectVersionDrift({
      skillPath: skill,
      packagePath: path.join(process.cwd(), 'package.json'),
      runningDistribution: '0.1.0-alpha.14',
      runningContractVersion: 5,
    });
    assert.equal(report.exit, 4);
    assert.equal(report.stdout.error.code, 'version-drift-detected');
    assert.equal(report.stdout.error.details.running_distribution, '0.1.0-alpha.14');
    assert.equal(report.stdout.error.details.installed_contract_version, 6);
    assert.equal(report.stdout.error.details.required_contract_version, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('version-drift succeeds when skill and core versions match', () => {
  const result = runCli('version-drift', '--json');
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, 'version-drift');
  assert.equal(envelope.contract_version, 5);
  assert.equal(envelope.result.installed_distribution, currentDistribution);
  assert.equal(envelope.result.installed_contract_version, 5);
});