// Deterministic large-ledger fixture generator for the mutation latency
// benchmark. It writes a schema-2 ledger that the core validates as valid, so
// the benchmark measures the ordinary mutation path rather than an error path.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FIXTURE_DATE = '2026-01-05';

// A small linear congruential generator keeps the fixture byte-identical
// across runs and runtimes, so before/after numbers compare the same input.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function encodeTimestamp(milliseconds) {
  let remaining = milliseconds;
  let encoded = '';
  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function fixtureId(random) {
  const instant = Date.parse(`${FIXTURE_DATE}T00:00:00.000Z`);
  let entropy = '';
  for (let index = 0; index < 16; index += 1) {
    entropy += ULID_ALPHABET[Math.floor(random() * 32)];
  }
  return `wb_${encodeTimestamp(instant)}${entropy}`;
}

// Body text of a realistic size: the field report's ledger carries multi-line
// item bodies, and body length changes the read cost per item.
function fixtureBody(number) {
  const lines = [];
  for (let index = 0; index < 6; index += 1) {
    lines.push(`Paragraph ${index} of benchmark item ${number}. `
      + 'It carries enough prose to keep the item file near the size of a real '
      + 'ledger entry so parse and read costs stay representative.');
  }
  return `${lines.join('\n\n')}\n`;
}

function fixtureItemSource({ id, number, kind, status, parent, dependsOn, decisions }) {
  const lines = [
    '---',
    'schema_version: 2',
    `id: ${id}`,
    `number: ${number}`,
    `title: "Benchmark item ${number}"`,
    `kind: ${kind}`,
    'priority: 50',
    `status: ${status}`,
    `created: ${FIXTURE_DATE}`,
    `updated: ${FIXTURE_DATE}`,
  ];
  if (parent) {
    lines.push(`parent: ${parent}`);
  }
  lines.push(
    'provenance:',
    '  source: "benchmark-fixture"',
    `  recorded_at: "${FIXTURE_DATE}T00:00:00.000Z"`,
  );
  if (dependsOn.length === 0) {
    lines.push('depends_on: []');
  } else {
    lines.push('depends_on:');
    for (const dependency of dependsOn) {
      lines.push(`  - ${dependency}`);
    }
  }
  lines.push('related: []');
  if (decisions.length === 0) {
    lines.push('decisions: []');
  } else {
    lines.push('decisions:');
    for (const decision of decisions) {
      lines.push(
        `  - action: ${decision.action}`,
        `    date: ${FIXTURE_DATE}`,
        `    summary: "${decision.summary}"`,
        `    rationale: "${decision.rationale}"`,
      );
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n${fixtureBody(number)}`;
}

// Builds `count` items: one epic per `epicEvery` items with the following
// tasks as its children, and a short depends_on chain inside each epic group.
// The shape gives the validator real relation, cycle, and epic work to do.
export function buildFixtureItems(count, seed = 20260816) {
  const random = seededRandom(seed);
  const epicEvery = 25;
  const items = [];
  let currentEpicId = null;
  let previousTaskId = null;

  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    const id = fixtureId(random);
    const isEpic = index % epicEvery === 0;

    if (isEpic) {
      currentEpicId = id;
      previousTaskId = null;
      items.push({
        id,
        number,
        kind: 'epic',
        source: fixtureItemSource({
          id,
          number,
          kind: 'epic',
          status: 'backlog',
          parent: null,
          dependsOn: [],
          decisions: [{
            action: 'accept',
            summary: 'Accept the benchmark epic.',
            rationale: 'Fixture item for the mutation latency benchmark.',
          }],
        }),
      });
      continue;
    }

    const dependsOn = previousTaskId && index % 3 === 0 ? [previousTaskId] : [];
    items.push({
      id,
      number,
      kind: 'task',
      source: fixtureItemSource({
        id,
        number,
        kind: 'task',
        status: 'backlog',
        parent: currentEpicId,
        dependsOn,
        decisions: [{
          action: 'accept',
          summary: 'Accept the benchmark task.',
          rationale: 'Fixture item for the mutation latency benchmark.',
        }],
      }),
    });
    previousTaskId = id;
  }

  return items;
}

export async function writeFixtureLedger(directory, count, seed) {
  await mkdir(directory, { recursive: true });
  const items = buildFixtureItems(count, seed);
  await Promise.all(items.map((item) => (
    writeFile(path.join(directory, `${item.id}.md`), item.source, 'utf8')
  )));
  return items;
}

export async function createFixtureLedger(count, seed) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-bench-'));
  const ledger = path.join(root, 'ledger');
  const items = await writeFixtureLedger(ledger, count, seed);
  return { root, ledger, items };
}
