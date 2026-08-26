import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distributionVersion = JSON.parse(
  readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
).version;

const INVENTORY_COMMANDS = [
  'validate',
  'ready',
  'capabilities',
  'inspect',
  'create',
  'transition',
  'patch',
  'mint-id',
  'provision',
  'claim',
  'publish-claimed',
];

test('--help prints the command inventory and exits 0', () => {
  const result = runCli('--help');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '', result.stderr);
  for (const command of INVENTORY_COMMANDS) {
    assert.ok(result.stdout.includes(command), `inventory missing ${command}`);
  }
  assert.match(result.stdout, /wowbagger <command> \[options\]/);
});

test('-h is an accepted alias for --help', () => {
  const result = runCli('-h');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Commands:'));
});

test('--version prints the package version and exits 0', () => {
  const result = runCli('--version');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '', result.stderr);
  assert.equal(result.stdout, `${distributionVersion}\n`);
});

test('-v is an accepted alias for --version', () => {
  const result = runCli('-v');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${distributionVersion}\n`);
});

test('every command supports <command> --help and exits 0', () => {
  for (const command of INVENTORY_COMMANDS) {
    const result = runCli(command, '--help');
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, '', `${command}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`wowbagger ${command}`), `help header missing ${command}`);
  }
});

test('per-command help prints that command usage line', () => {
  const cases = [
    ['validate', 'wowbagger validate --ledger <dir> --json'],
    ['ready', 'wowbagger ready --ledger <dir> --as-of YYYY-MM-DD'],
    ['inspect', 'wowbagger inspect --ledger <dir> (--id <id> | --number <n>) --json'],
    ['create', 'wowbagger create --ledger <dir> --input <json-file|-> --json'],
    ['transition', 'wowbagger transition --ledger <dir> --input <json-file|-> --json'],
    ['patch', 'wowbagger patch --ledger <dir> --input <json-file|-> --json'],
    ['mint-id', 'wowbagger mint-id [--date YYYY-MM-DD] --json'],
  ];

  for (const [command, usageLine] of cases) {
    const result = runCli(command, '--help');
    assert.ok(result.stdout.includes(usageLine), `${command}: expected "${usageLine}"`);
  }
});

test('claim --help lists the claim subcommands', () => {
  const result = runCli('claim', '--help');

  assert.equal(result.status, 0, result.stderr);
  for (const subcommand of ['capabilities', 'read', 'acquire', 'renew', 'release']) {
    assert.ok(result.stdout.includes(subcommand), `claim help missing ${subcommand}`);
  }
});

test('capability help identifies the core and ledger-specific claim profiles', () => {
  const core = runCli('capabilities', '--help');
  const claim = runCli('claim', '--help');
  const publish = runCli('publish-claimed', '--help');

  assert.match(core.stdout, /unbound default claim profile/);
  assert.match(core.stdout, /claim capabilities --ledger <dir> --json/);
  assert.match(claim.stdout, /provisioned ledger's work-claim profile/);
  assert.match(claim.stdout, /namespace.*backend/);
  assert.match(publish.stdout, /claim_protected_publication: true/);
  assert.doesNotMatch(publish.stdout, /unavailable on an advisory backend/);
});

test('capability help names the core and work-claim version fields', () => {
  const core = runCli('capabilities', '--help');
  const claim = runCli('claim', '--help');

  assert.match(core.stdout, /contract_version.*core contract/);
  assert.match(core.stdout, /operations\.work_claim\.api_version.*work-claim API/);
  assert.match(claim.stdout, /operations\.work_claim\.api_version/);
  assert.match(claim.stdout, /top-level claim contract_version.*legacy envelope marker/);
});

test('provision help exposes the Git prerequisite and its capability preflight', () => {
  const result = runCli('provision', '--help');

  assert.match(result.stdout, /Requires a Git checkout/);
  assert.match(result.stdout, /claim capabilities --ledger <dir> --json/);
  assert.match(result.stdout, /operations\.work_claim\.supported: true/);
});

test('a typo suggestion turns an unknown command into a did-you-mean instead of the bare usage throw', () => {
  const result = runCli('transitio');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: transitio/);
  assert.match(result.stderr, /Did you mean wowbagger transition\?/);
});

test('a distant unknown command points at the inventory', () => {
  const result = runCli('frobnicate');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: frobnicate/);
  assert.match(result.stderr, /wowbagger --help/);
});

test('help and version are untouched by machine JSON surfaces', () => {
  const invalid = runCli('validate', '--json');
  assert.equal(invalid.status, 1);

  const capabilities = runCli('capabilities', '--json');
  assert.equal(capabilities.status, 0, capabilities.stderr);
  const parsed = JSON.parse(capabilities.stdout);
  assert.equal(parsed.ok, true);

  const version = runCli('--version');
  assert.equal(version.stdout, `${distributionVersion}\n`);
});

test('help documents claim verification and list query members', () => {
  const global = runCli('--help');
  const list = runCli('list', '--help');

  assert.ok(global.stdout.includes('claim-verify'));
  assert.match(list.stdout, /query_version/);
  assert.match(list.stdout, /page_size/);
  assert.match(list.stdout, /cursor/);
  assert.match(list.stdout, /sort/);
});
