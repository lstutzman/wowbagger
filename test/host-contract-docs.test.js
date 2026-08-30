import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LIFECYCLE_STATUSES } from '../src/lifecycle.js';
import { DECISION_ACTIONS } from '../src/validate.js';
import {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_ITEM_SOURCE_BYTES,
  MAX_LIST_PAGE_SIZE,
  MAX_LIST_RESPONSE_BYTES,
  MAX_LIST_TITLE_CHARACTERS,
  MAX_WORKBENCH_COLLECTION_ENTRIES,
  MAX_WORKBENCH_RESPONSE_BYTES,
  MAX_WORKBENCH_TITLE_CHARACTERS,
} from '../src/limits.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function read(...segments) {
  return readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

// Installed guidance is hard-wrapped prose, so a documented claim is asserted
// against its words rather than against the column it happens to break at.
function collapse(text) {
  return text.replace(/\s+/g, ' ');
}

const manifest = JSON.parse(read('package.json'));
const hostContract = read('docs', 'host-contract.md');
const flatHostContract = collapse(hostContract);
const spec = read('SPEC.md');
const flatSpec = collapse(spec);
const mutationContract = read('docs', 'mutation-contract.md');
const flatMutationContract = collapse(mutationContract);
const readme = read('README.md');
const skill = read('skills', 'wowbagger', 'SKILL.md');
const schemaIndex = JSON.parse(read('schemas', 'index.json'));

test('the host contract ships and every consumer surface points at it', () => {
  assert.ok(manifest.files.includes('docs/host-contract.md'), 'the host contract must ship');
  for (const [surface, text] of [['README.md', readme], ['skills/wowbagger/SKILL.md', skill]]) {
    assert.match(text, /docs\/host-contract\.md/, `${surface} must reference the host contract`);
  }
});

test('the host contract states the shell-free launch requirement exactly', () => {
  assert.match(flatHostContract, /Node\.js 24 or later/);
  assert.match(flatHostContract, /absolute Node executable/i);
  assert.match(flatHostContract, /absolute `wowbagger\.js`/i);
  assert.match(flatHostContract, /argument array/i);
  assert.match(flatHostContract, /`shell: false`/);
  // The package seam, not a command shim or a global npm directory search.
  assert.match(flatHostContract, /resolveCoreLaunch/);
  assert.match(flatHostContract, /import\.meta\.resolve/);
  assert.match(flatHostContract, /wowbagger\/wowbagger\.js/);
  assert.match(flatHostContract, /never a shell/i);
});

test('the host contract makes a missing executable a host-level result', () => {
  assert.match(
    flatHostContract,
    /A missing or unlaunchable executable is a host-level result, not malformed Wowbagger JSON/,
  );
});

test('the host contract requires bounded input and output', () => {
  assert.match(flatHostContract, /bounded stdin/i);
  assert.match(flatHostContract, /host-created request file/i);
  assert.match(flatHostContract, /never .*inline unbounded argv JSON/i);
  assert.match(flatHostContract, /captured stdout and stderr/i);
  assert.match(flatHostContract, /`list` and `inspect --workbench` are the two bounded reads/);
  // `inspect` is the honest exception: an oversized legacy item stays inspectable.
  assert.match(flatHostContract, /A full `inspect` has no response bound/);
});

test('the host contract assigns the process facilities to the host', () => {
  for (const facility of [
    'executable discovery',
    'working directory',
    'timeout',
    'cancellation',
    'process-tree containment',
    'stream caps',
    'routing',
  ]) {
    assert.ok(
      flatHostContract.includes(facility),
      `the host contract must name ${facility} as host-owned`,
    );
  }
  assert.match(
    flatHostContract,
    /Wowbagger documents these requirements and their outcomes; it does not claim these facilities/,
  );
});

test('the host contract states the owning-host path rule for every runtime shape', () => {
  for (const shape of ['worktree', 'plain folder', 'SSH', 'WSL']) {
    assert.ok(flatHostContract.includes(shape), `the host contract must cover a ${shape} host`);
  }
  assert.match(flatHostContract, /no cross-runtime path guessing/i);
});

test('the host contract states the namespace-first dispatch rule', () => {
  assert.match(
    flatHostContract,
    /dispatch on the root `namespace` member before it reads any version field/i,
  );
  assert.match(flatHostContract, /no namespace member but a root `ok` member belongs to the core domain/i);
  assert.match(flatHostContract, /neither is a bare result/i);
});

test('the host contract publishes the exact advertised limits', () => {
  for (const [name, value] of [
    ['max_item_source_bytes', MAX_ITEM_SOURCE_BYTES],
    ['default_list_page_size', DEFAULT_LIST_PAGE_SIZE],
    ['max_list_page_size', MAX_LIST_PAGE_SIZE],
    ['max_list_title_characters', MAX_LIST_TITLE_CHARACTERS],
    ['max_list_response_bytes', MAX_LIST_RESPONSE_BYTES],
    ['max_workbench_title_characters', MAX_WORKBENCH_TITLE_CHARACTERS],
    ['max_workbench_collection_entries', MAX_WORKBENCH_COLLECTION_ENTRIES],
    ['max_workbench_response_bytes', MAX_WORKBENCH_RESPONSE_BYTES],
  ]) {
    const row = hostContract
      .split('\n')
      .find((line) => line.startsWith(`| \`${name}\``));
    assert.ok(row, `the host contract must advertise ${name} in the limits table`);
    assert.ok(row.includes(String(value)), `${name} must be documented as ${value}`);
  }
  assert.match(flatHostContract, /no consumer .*infer.* from an adapter implementation/i);
});

test('the host contract names every published schema', () => {
  for (const { file } of schemaIndex.schemas) {
    assert.ok(hostContract.includes(file), `the host contract must name schemas/${file}`);
  }
  assert.match(flatHostContract, /wowbagger\/schemas\//);
});

test('the host contract carries the once-only dispatch sequence and refuses to invent recovery', () => {
  assert.match(
    flatHostContract,
    /Dispatch once, never replay, invalidate the inspected revision, reconnect, then re-read the ledger\./,
  );
  assert.match(flatHostContract, /exit 4[^.]*proven non-write/i);
});

test('the host contract states what Wowbagger will not add', () => {
  for (const excluded of [
    'automatic transition',
    'mirrored ledger state',
    'daemon',
    'remote routing',
    'operation identity',
  ]) {
    assert.ok(
      flatHostContract.toLowerCase().includes(excluded.toLowerCase()),
      `the host contract must exclude ${excluded}`,
    );
  }
});

test('every public surface states the core contract version the runtime emits', () => {
  assert.match(
    flatSpec,
    /Core mutation contracts 1 through 5 are defined\. The shipped runtime emits version 5/,
  );
  assert.doesNotMatch(flatSpec, /The shipped runtime emits version\s+2/);
  assert.match(
    collapse(mutationContract.split('\n').slice(0, 6).join('\n')),
    /Status: versions 1 through 5 are defined; .*runtime currently emits version 5/,
  );
  assert.doesNotMatch(flatMutationContract, /currently emits version 3/);
  assert.match(flatHostContract, /core contract version 5/i);
});

test('the lifecycle vocabulary names deferred wherever it names the other statuses', () => {
  // SPEC's own status vocabulary must be the validator's, not a subset of it.
  const statusRow = spec
    .split('\n')
    .find((line) => line.startsWith('| status | Yes |'));
  assert.ok(statusRow, 'SPEC must document the status field');
  for (const status of LIFECYCLE_STATUSES) {
    assert.ok(statusRow.includes(status), `the SPEC status field must name ${status}`);
  }
  // Section 5 must carry deferred as a lifecycle state with its own edges, and
  // section 7 must carry the decision that records entering it.
  assert.match(flatSpec, /\| deferred \| /, 'the SPEC lifecycle table must define deferred');
  assert.match(flatSpec, /backlog \| in-progress, deferred, archived, killed/);
  assert.match(flatSpec, /\| task or epic \| deferred \| backlog \|/);
  assert.match(flatSpec, /\| deferred \| defer \| deferred \|/);
  for (const action of DECISION_ACTIONS) {
    assert.ok(flatSpec.includes(action), `the SPEC decision vocabulary must name ${action}`);
  }
  // The lossless core view carries the deferred date, so section 5 of the
  // mutation contract has to list it beside the other terminal dates.
  assert.match(flatMutationContract, /optional parent, snoozed_until, completed, killed, archived, deferred/);
});

// `report` is the one core command that answers an invalid ledger at exit 1
// rather than at exit 3, and its read and publication failures land there too.
// A contract that files exit 1 under bare results alone sends a host to parse a
// `{valid, errors}` shape that never arrives.
test('both contracts state every report refusal at the exit it actually uses', () => {
  const exitRow = (contract, exit) => contract
    .split('\n')
    .find((line) => line.startsWith(`| ${exit} |`));

  const mutationExitOne = exitRow(mutationContract, 1);
  assert.ok(mutationExitOne, 'the mutation contract must carry an exit 1 row');
  for (const code of ['ledger-invalid', 'report-read-failed', 'report-write-failed']) {
    assert.ok(
      mutationExitOne.includes(code),
      `the mutation contract exit 1 row must name ${code}`,
    );
  }
  assert.match(mutationExitOne, /report/, 'the mutation contract exit 1 row must name report');

  const mutationExitTwo = exitRow(mutationContract, 2);
  for (const code of ['report-config-invalid', 'report-view-not-found']) {
    assert.ok(
      mutationExitTwo.includes(code),
      `the mutation contract exit 2 row must name ${code}`,
    );
  }

  const hostExitOne = exitRow(hostContract, 1);
  assert.ok(hostExitOne, 'the host contract must carry an exit 1 row');
  assert.match(
    hostExitOne,
    /report/,
    'the host contract must not file exit 1 as a bare-result-only condition',
  );
});
