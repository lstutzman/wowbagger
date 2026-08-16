// The generic-consumer view of every response this CLI emits.
//
// This file deliberately imports nothing from src/. It is written as the
// generic JSON consumer described by docs/mutation-contract.md section 2:
// it knows only the documented dispatch rule and the normative
// spec/fixtures/envelope-domains manifest. A shape change in either the
// implementation or the manifest makes it fail.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../spec/fixtures/envelope-domains/manifest.json',
  import.meta.url,
)), 'utf8'));

// The documented dispatch rule, transcribed from the contract. A consumer
// reads the root `namespace` member first, then the version field that the
// selected domain names.
function dispatch(envelope) {
  if (Object.hasOwn(envelope, 'namespace')) {
    return { domain: envelope.namespace, contract_version: envelope.contract_version };
  }
  if (Object.hasOwn(envelope, 'ok')) {
    return { domain: 'core', contract_version: envelope.contract_version };
  }
  return { domain: 'bare-result', contract_version: null };
}

function run(cwd, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd,
    encoding: 'utf8',
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function requestFile(root, name, value) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const ITEM = `---
schema_version: 2
id: ${ITEM_ID}
number: 1
title: "Before"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-11
provenance:
  source: "fixture/envelope-domains"
  recorded_at: "2026-08-11T00:00:00Z"
depends_on: []
related: []
decisions: []
---

before
`;
const ITEM_REVISION = `sha256:${createHash('sha256').update(ITEM).digest('hex')}`;

function itemRequest(title) {
  return {
    title,
    kind: 'task',
    provenance: { source: 'fixture/envelope-domains', recorded_at: '2026-08-11T00:00:00Z' },
    depends_on: [],
  };
}

async function temporaryRoot(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function initialisedRepository(prefix) {
  const root = await temporaryRoot(prefix);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  return { ledger, root };
}

// Walks every documented response class the CLI can emit and returns
// name -> { envelope, exit }.
async function walkEveryResponseClass() {
  const observed = new Map();
  const see = (name, result) => {
    assert.equal(observed.has(name), false, `duplicate walked class ${name}`);
    observed.set(name, result);
  };

  {
    const root = await temporaryRoot('wb-envelopes-valid-');
    const ledger = path.join(root, 'ledger');
    await mkdir(ledger);
    await writeFile(path.join(ledger, 'item.md'), ITEM);
    await mkdir(path.join(ledger, '.wowbagger'));
    await writeFile(path.join(ledger, '.wowbagger', 'report.json'), JSON.stringify({
      report_version: 1,
      repository: { name: 'envelope-domains' },
      title: 'Envelope domains',
      output: '../../report.html',
    }));

    see('validate.success', run(root, 'validate', '--ledger', ledger, '--json'));
    see('ready.success', run(root, 'ready', '--ledger', ledger, '--json', '--as-of', '2026-08-16'));
    see('capabilities.success', run(root, 'capabilities', '--json'));
    see('capabilities.invalid-request', run(root, 'capabilities', '--ledger', ledger));
    see('inspect.success', run(root, 'inspect', '--ledger', ledger, '--id', ITEM_ID, '--json'));
    see('inspect.item-not-found', run(root, 'inspect', '--ledger', ledger, '--id', 'wb_01KZBMBEZKPE7D15HKW9Q3GSZW', '--json'));
    see('mint-id.success', run(root, 'mint-id', '--json'));
    see('mint-id.invalid-request', run(root, 'mint-id', '--date', 'not-a-date', '--json'));
    see('report.success', run(root, 'report', '--ledger', ledger, '--as-of', '2026-08-16', '--json'));
    see('report.invalid-request', run(root, 'report', '--ledger', ledger, '--json'));
    see('create.invalid-request', run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-invalid.json', {}), '--json'));
    see('create.id-collision', run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-collision.json', {
      id: ITEM_ID,
      item: itemRequest('Collides'),
      body: 'collides\n',
    }), '--json'));
    see('patch.invalid-request', run(root, 'patch', '--ledger', ledger, '--input', await requestFile(root, 'patch-invalid.json', {}), '--json'));
    see('patch.revision-conflict', run(root, 'patch', '--ledger', ledger, '--input', await requestFile(root, 'patch-conflict.json', {
      id: ITEM_ID,
      expected_revision: `sha256:${'0'.repeat(64)}`,
      date: '2026-08-16',
      set: { priority: 3 },
    }), '--json'));
    see('transition.revision-conflict', run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition-conflict.json', {
      id: ITEM_ID,
      expected_revision: `sha256:${'0'.repeat(64)}`,
      to_status: 'in-progress',
      date: '2026-08-16',
    }), '--json'));
    see('transition.success', run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition-ok.json', {
      id: ITEM_ID,
      expected_revision: ITEM_REVISION,
      to_status: 'in-progress',
      date: '2026-08-16',
    }), '--json'));
  }

  {
    const root = await temporaryRoot('wb-envelopes-invalid-');
    const ledger = path.join(root, 'ledger');
    await mkdir(ledger);
    await writeFile(path.join(ledger, 'broken.md'), '---\nschema_version: 2\nid: not-an-id\n---\n\nbroken\n');
    see('validate.ledger-invalid', run(root, 'validate', '--ledger', ledger, '--json'));
    see('ready.ledger-invalid', run(root, 'ready', '--ledger', ledger, '--json', '--as-of', '2026-08-16'));
    see('inspect.ledger-invalid', run(root, 'inspect', '--ledger', ledger, '--id', ITEM_ID, '--json'));
  }

  {
    const { ledger, root } = await initialisedRepository('wb-envelopes-advisory-');
    see('claim-capabilities.success', run(root, 'claim', 'capabilities', '--ledger', ledger, '--json'));
    see('publish-claimed.capability-unavailable', run(root, 'publish-claimed', '--ledger', ledger, '--input', '/dev/null', '--json'));
  }

  {
    const { ledger, root } = await initialisedRepository('wb-envelopes-claimed-');
    const itemPath = path.join(ledger, 'item.md');
    await writeFile(itemPath, ITEM);
    const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
    see('provision.success', provisioned);
    const namespace = provisioned.envelope.result.ledger_namespace;
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'Provision the ledger');

    see('claim-read.success', run(root, 'claim', 'read', '--ledger', ledger, '--input', await requestFile(root, 'read.json', {
      ledger_namespace: namespace,
      item_id: ITEM_ID,
    }), '--json'));
    const acquired = run(root, 'claim', 'acquire', '--ledger', ledger, '--input', await requestFile(root, 'acquire.json', {
      ledger_namespace: namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      lease_duration_ms: 300000,
      expected: { last_epoch: '0', active: null },
    }), '--json');
    see('claim-acquire.success', acquired);
    see('claim-acquire.claim-conflict', run(root, 'claim', 'acquire', '--ledger', ledger, '--input', await requestFile(root, 'acquire-conflict.json', {
      ledger_namespace: namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-b',
      lease_duration_ms: 300000,
      expected: { last_epoch: '1', active: null },
    }), '--json'));
    see('claim-acquire.ledger-namespace-unbound', run(root, 'claim', 'acquire', '--ledger', ledger, '--input', await requestFile(root, 'acquire-unbound.json', {
      ledger_namespace: 'wbns_11111111111111111111111111111111',
      item_id: ITEM_ID,
      owner_id: 'agent-b',
      lease_duration_ms: 300000,
      expected: { last_epoch: '0', active: null },
    }), '--json'));
    see('claim-renew.invalid-request', run(root, 'claim', 'renew', '--ledger', ledger, '--input', await requestFile(root, 'renew-invalid.json', {}), '--json'));
    see('claim-release.invalid-request', run(root, 'claim', 'release', '--ledger', ledger, '--input', await requestFile(root, 'release-invalid.json', {}), '--json'));
    see('claim-verify.success', run(root, 'claim-verify', '--ledger', ledger, '--json'));
    see('claim-verify-subcommand.invalid-request', run(root, 'claim', 'verify', '--ledger', ledger, '--input', await requestFile(root, 'verify.json', {
      ledger_namespace: namespace,
      operation_id: 'pub_agent-a_0001',
    }), '--json'));
    see('publish-claimed.invalid-request', run(root, 'publish-claimed', '--ledger', ledger, '--input', await requestFile(root, 'publish-invalid.json', {}), '--json'));

    see('transition.active-claim-write-refused', run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'fenced-transition.json', {
      id: ITEM_ID,
      expected_revision: ITEM_REVISION,
      to_status: 'in-progress',
      date: '2026-08-16',
    }), '--json'));
    see('patch.active-claim-write-refused', run(root, 'patch', '--ledger', ledger, '--input', await requestFile(root, 'fenced-patch.json', {
      id: ITEM_ID,
      expected_revision: ITEM_REVISION,
      date: '2026-08-16',
      set: { priority: 3 },
    }), '--json'));

    const candidate = Buffer.from(ITEM.replace('title: "Before"', 'title: "After"'));
    see('publish-claimed.success', run(root, 'publish-claimed', '--ledger', ledger, '--input', await requestFile(root, 'publish.json', {
      operation_id: 'pub_agent-a_0001',
      ledger_namespace: namespace,
      item_id: ITEM_ID,
      expected_revision: ITEM_REVISION,
      candidate_source_base64: candidate.toString('base64'),
      candidate_sha256: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
      claim_fence: {
        ledger_namespace: namespace,
        item_id: ITEM_ID,
        owner_id: 'agent-a',
        epoch: acquired.envelope.result.claim.epoch,
      },
    }), '--json'));

  }

  {
    // Legacy create refuses an identity that already has claim history, even
    // though no item file was ever published under it.
    const { ledger, root } = await initialisedRepository('wb-envelopes-claimed-id-');
    const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
    const namespace = provisioned.envelope.result.ledger_namespace;
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'Provision the ledger');
    run(root, 'claim', 'acquire', '--ledger', ledger, '--input', await requestFile(root, 'acquire.json', {
      ledger_namespace: namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      lease_duration_ms: 300000,
      expected: { last_epoch: '0', active: null },
    }), '--json');
    see('create.claimed-item-write-refused', run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'fenced-create.json', {
      id: ITEM_ID,
      item: itemRequest('Recreated'),
      body: 'recreated\n',
    }), '--json'));
  }

  {
    const { ledger, root } = await initialisedRepository('wb-envelopes-uncommitted-');
    run(root, 'provision', '--ledger', ledger, '--json');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'Provision the ledger');
    const priorId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
    const created = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-prior.json', {
      id: priorId,
      item: itemRequest('Prior item'),
      body: 'prior\n',
    }), '--json');
    see('create.success', created);
    run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition-prior.json', {
      id: priorId,
      expected_revision: created.envelope.result.item.revision,
      to_status: 'backlog',
      date: '2026-08-15',
      decision: { summary: 'Accept the prior item.', rationale: 'The prior item is ready for work.' },
    }), '--json');
    see('create.claim-store-unavailable', run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-next.json', {
      id: 'wb_01M01BFR001TXV22D7KZ6TQYH3',
      item: itemRequest('Next item'),
      body: 'next\n',
    }), '--json'));
  }

  return observed;
}

// The walk drives dozens of subprocesses, so every test shares one run.
let walked = null;
function walkOnce() {
  walked ??= walkEveryResponseClass();
  return walked;
}

function pinnedClasses() {
  return new Map(manifest.classes.map((entry) => [entry.class, entry]));
}

function advertisedCommands() {
  const helpFor = (...argumentsList) => spawnSync(
    process.execPath,
    [CLI, ...argumentsList],
    { encoding: 'utf8' },
  ).stdout;
  const namesUnder = (text, heading) => {
    const lines = text.split('\n');
    const start = lines.indexOf(`${heading}:`);
    assert.notEqual(start, -1, `help text has no ${heading} section`);
    const names = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === '') break;
      names.push(line.trim().split(/\s+/u)[0]);
    }
    return names;
  };
  return {
    commands: namesUnder(helpFor('--help'), 'Commands'),
    claimSubcommands: namesUnder(helpFor('claim', '--help'), 'Subcommands'),
  };
}

test('every emitted response classifies into its pinned domain by the documented dispatch rule', async () => {
  const observed = await walkOnce();
  const pinned = pinnedClasses();

  for (const [name, entry] of pinned) {
    const seen = observed.get(name);
    assert.ok(seen, `the walk never emitted the pinned class ${name}`);
    const routed = dispatch(seen.envelope);
    assert.equal(routed.domain, entry.domain, `${name} dispatched to ${routed.domain}`);
    assert.equal(
      routed.contract_version,
      manifest.domains[entry.domain].contract_version,
      `${name} carries the wrong version field for domain ${entry.domain}`,
    );
  }
});

test('every emitted response matches its pinned envelope shape exactly', async () => {
  const observed = await walkOnce();
  const pinned = pinnedClasses();

  for (const [name, entry] of pinned) {
    const seen = observed.get(name);
    assert.ok(seen, `the walk never emitted the pinned class ${name}`);
    assert.deepEqual(
      Object.keys(seen.envelope).sort(),
      [...entry.root_members].sort(),
      `${name} root members drifted`,
    );
    assert.equal(seen.exit, entry.exit, `${name} exit drifted`);
    assert.equal(seen.envelope.namespace ?? null, manifest.domains[entry.domain].namespace, `${name} namespace drifted`);
    assert.equal(seen.envelope.command ?? null, entry.command, `${name} command member drifted`);
    assert.equal(seen.envelope.contract_version ?? null, manifest.domains[entry.domain].contract_version, `${name} contract_version drifted`);
    assert.equal(seen.envelope.state ?? null, entry.state, `${name} state drifted`);
    assert.equal(seen.envelope.error?.code ?? null, entry.error_code, `${name} error code drifted`);
  }
});

test('the pinned class list and the emitted class list are the same set', async () => {
  const observed = await walkOnce();
  const pinned = pinnedClasses();
  assert.deepEqual([...observed.keys()].sort(), [...pinned.keys()].sort());
});

test('every pinned class uses one of its domain declared root-member shapes', () => {
  for (const entry of manifest.classes) {
    const shapes = Object.values(manifest.domains[entry.domain].root_member_shapes);
    const key = [...entry.root_members].sort().join(',');
    assert.ok(
      shapes.some((shape) => [...shape].sort().join(',') === key),
      `${entry.class} uses a root-member shape the ${entry.domain} domain does not declare`,
    );
  }
});

test('the pinned domain map covers every command the CLI advertises', () => {
  const { commands, claimSubcommands } = advertisedCommands();
  const covered = new Set(Object.values(manifest.domains).flatMap((domain) => domain.commands));
  const groups = new Set(manifest.command_groups);
  for (const command of commands) {
    if (groups.has(command)) continue;
    assert.equal(covered.has(command), true, `command ${command} has no pinned response domain`);
  }
  for (const subcommand of claimSubcommands) {
    assert.equal(
      covered.has(`claim ${subcommand}`),
      true,
      `claim subcommand ${subcommand} has no pinned response domain`,
    );
  }
});

test('the mutation contract tabulates every response domain', () => {
  const [domainTable] = ruleTables();
  assert.equal(domainTable.length, Object.keys(manifest.domains).length);

  for (const [name, domain] of Object.entries(manifest.domains)) {
    const row = domainTable.find((cells) => cells[0] === domain.prose_name);
    assert.ok(row, `the domain table must have a row for ${name}`);
    assert.equal(
      row[1].includes(`\`${domain.namespace}\``),
      domain.namespace !== null,
      `the ${name} row must state its namespace member`,
    );
    if (domain.namespace === null) assert.match(row[1], /absent/);
    assert.equal(
      row[2].includes(String(domain.contract_version)),
      domain.contract_version !== null,
      `the ${name} row must state its contract_version`,
    );
  }
});

test('the mutation contract tabulates where every command answers', () => {
  const [, commandTable] = ruleTables();
  const { commands, claimSubcommands } = advertisedCommands();
  const groups = new Set(manifest.command_groups);
  const rowFor = (needle) => commandTable.find((cells) => cells[0].includes(`\`${needle}`));

  for (const command of commands) {
    if (groups.has(command)) continue;
    assert.ok(rowFor(command), `the command table must state where ${command} answers`);
  }
  for (const subcommand of claimSubcommands) {
    assert.ok(
      commandTable.some((cells) => cells[0].includes('claim') && cells[0].includes(subcommand)),
      `the command table must state where claim ${subcommand} answers`,
    );
  }
  for (const command of manifest.domains['ledger-mutation'].answers_for) {
    const row = rowFor(command);
    assert.equal(row[1], 'core', `${command} must succeed in the core domain`);
    assert.match(row[2], /ledger-mutation/, `${command} refusals must name the fence domain`);
  }
  for (const command of manifest.domains['bare-result'].commands) {
    assert.match(rowFor(command)[1], /bare result/, `${command} must succeed as a bare result`);
    assert.match(rowFor(command)[2], /bare result/, `${command} must refuse as a bare result`);
  }
});

test('the mutation contract states both sanctioned exceptions and why they stay', () => {
  const rule = flattened(ruleSection());

  assert.match(rule, /`validate` and `ready` emit a bare result rather than an envelope/);
  assert.match(rule, /scripts read `\.valid` and `\.errors` directly/);
  assert.match(rule, /They stay bare/);
  assert.match(
    rule,
    /claim-fenced refusal to `create`, `transition`, or `patch` answers in the ledger-mutation domain/,
  );
  assert.match(rule, /This is not envelope drift/);
  assert.match(rule, /Re-wrapping it in a core envelope would silently change three pinned surfaces/);
  assert.match(rule, /spec\/fixtures\/envelope-domains\/manifest\.json/);
});

test('the work-claim contract claims the fenced refusal envelope as its own surface', () => {
  const contract = flattened(readFileSync(
    fileURLToPath(new URL('../docs/work-claim-contract.md', import.meta.url)),
    'utf8',
  ));
  assert.match(contract, /`ledger-mutation` for the legacy write refusals/);
  assert.match(contract, /MUST NOT be re-wrapped in one/);
});

function ruleSection() {
  const contract = readFileSync(fileURLToPath(new URL('../docs/mutation-contract.md', import.meta.url)), 'utf8');
  return section(contract, '### Response domains and the dispatch rule');
}

// Returns the markdown tables of the rule section as arrays of trimmed cells,
// header and separator rows removed.
function ruleTables() {
  const tables = [];
  let current = null;
  for (const line of ruleSection().split('\n')) {
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^-+$/u.test(cell))) continue;
      if (current === null) {
        current = [];
        tables.push(current);
        continue;
      }
      current.push(cells);
      continue;
    }
    current = null;
  }
  return tables;
}

function flattened(source) {
  return source.replace(/\s+/gu, ' ');
}

function section(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const end = source.indexOf('\n### ', start + heading.length);
  return source.slice(start, end === -1 ? source.length : end);
}

test('namespace-first dispatch resolves the command names two domains share', async () => {
  const observed = await walkOnce();
  const core = observed.get('capabilities.success').envelope;
  const claim = observed.get('claim-capabilities.success').envelope;

  // Dispatching on `command` alone is ambiguous: both say "capabilities".
  assert.equal(core.command, claim.command);
  // Dispatching on namespace first is not.
  assert.equal(dispatch(core).domain, 'core');
  assert.equal(dispatch(claim).domain, 'work-claim');
  assert.notEqual(dispatch(core).contract_version, dispatch(claim).contract_version);

  // The same invocation of one core command can answer in either domain.
  const coreCreate = observed.get('create.success').envelope;
  const fencedCreate = observed.get('create.claimed-item-write-refused').envelope;
  assert.equal(dispatch(coreCreate).domain, 'core');
  assert.equal(dispatch(fencedCreate).domain, 'ledger-mutation');
  assert.equal(coreCreate.command, 'create');
  assert.equal(fencedCreate.command, 'create-v1');
});
