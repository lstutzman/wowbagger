// Mutation latency benchmark for ledger item 91.
//
// Not part of the default test run (`npm test` runs `test/*.test.js` only).
// Run it explicitly:
//
//   TMPDIR=/tmp node bench/mutation-latency.bench.js
//   TMPDIR=/tmp node bench/mutation-latency.bench.js --items 1500 --repeat 3
//   TMPDIR=/tmp node --cpu-prof --cpu-prof-dir=/tmp/prof bench/mutation-latency.bench.js
//
// It generates a fixture ledger in a temporary directory. It never reads or
// writes this repository's own `ledger/`.
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createFixtureLedger } from './ledger-fixture.js';
import { readGitHeadLedger } from '../src/git-reconciliation.js';
import { loadLedger } from '../src/ledger.js';
import { mintId } from '../src/mint.js';
import { createItem, inspectItem, transitionItem } from '../src/mutation.js';
import { provisionNamespace } from '../src/namespace.js';
import { validateLedger } from '../src/validate.js';

function parseArguments(argumentList) {
  const options = { items: 1500, repeat: 1, seed: 20260816, provisioned: false };
  for (let index = 0; index < argumentList.length; index += 1) {
    const name = argumentList[index];
    if (name === '--items' || name === '--repeat' || name === '--seed') {
      options[name.slice(2)] = Number(argumentList[index + 1]);
      index += 1;
      continue;
    }
    if (name === '--provisioned') {
      options.provisioned = true;
    }
  }
  return options;
}

// The field report ran against a provisioned Git ledger, where every mutation
// also replays the claim journal and reconciles publication state. The default
// run measures the plain path; `--provisioned` measures the consumer's shape.
async function provisionLedger(root, ledger) {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'benchmark@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Benchmark'], { cwd: root });
  execFileSync('git', ['add', '--all'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--message', 'benchmark fixture'], { cwd: root });
  await provisionNamespace(ledger);
}

async function timed(label, run) {
  const started = performance.now();
  const value = await run();
  return { label, milliseconds: performance.now() - started, value };
}

function assertOk(label, outcome) {
  const payload = outcome?.stdout ?? outcome;
  if (payload?.ok !== true) {
    throw new Error(`${label} failed: ${JSON.stringify(payload)}`);
  }
  return outcome;
}

// Wall-time attribution for one mutation. Each phase is measured in isolation
// on the same fixture, so the numbers add up against the whole-mutation wall
// time reported below and name where the time actually goes.
async function measureBaselineCosts(ledger, options) {
  const load = await timed('load-ledger', () => loadLedger(ledger));
  const validate = await timed('validate-ledger', () => validateLedger(load.value));
  const baseline = { load: load.milliseconds, validate: validate.milliseconds, gitHead: null };
  if (options.provisioned) {
    const gitHead = await timed('git-head-ledger', () => readGitHeadLedger(ledger));
    baseline.gitHead = gitHead.milliseconds;
  }
  return baseline;
}

async function measureCreate(ledger, date) {
  const request = {
    id: mintId(date),
    item: {
      title: 'Benchmark create',
      kind: 'task',
      priority: 50,
      provenance: { source: 'benchmark', recorded_at: `${date}T00:00:00.000Z` },
      depends_on: [],
    },
    body: 'Created by the mutation latency benchmark.\n',
  };
  const created = await timed('create', () => createItem(ledger, request));
  assertOk('create', created.value);
  return { milliseconds: created.milliseconds, id: request.id };
}

async function measureTransition(ledger, id, date) {
  const inspected = await inspectItem(ledger, id);
  if (!inspected.item) {
    throw new Error(`transition target ${id} was not found`);
  }
  const request = {
    id,
    expected_revision: inspected.item.revision,
    to_status: 'in-progress',
    date,
  };
  const transitioned = await timed('transition', () => transitionItem(ledger, request));
  assertOk('transition', transitioned.value);
  return { milliseconds: transitioned.milliseconds };
}

function report(options, samples, baseline) {
  const summarize = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    return {
      best: sorted[0],
      median: sorted[Math.floor((sorted.length - 1) / 2)],
      worst: sorted.at(-1),
    };
  };
  const creates = summarize(samples.map((sample) => sample.create));
  const transitions = summarize(samples.map((sample) => sample.transition));
  const format = (value) => `${value.toFixed(1)} ms`;

  console.log(`items: ${options.items}  repeat: ${options.repeat}  runtime: ${process.version}`
    + `  ledger: ${options.provisioned ? 'provisioned git' : 'plain directory'}`);
  console.log(`one full load (read + parse): ${format(baseline.load)}`);
  console.log(`one full validate (in memory): ${format(baseline.validate)}`);
  if (baseline.gitHead !== null) {
    console.log(`one git HEAD ledger read: ${format(baseline.gitHead)}`);
  }
  console.log(`create    best ${format(creates.best)}  median ${format(creates.median)}  worst ${format(creates.worst)}`);
  console.log(`transition best ${format(transitions.best)}  median ${format(transitions.median)}  worst ${format(transitions.worst)}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fixture = await createFixtureLedger(options.items, options.seed);
  try {
    if (options.provisioned) {
      await provisionLedger(fixture.root, fixture.ledger);
    }
    const baseline = await measureBaselineCosts(fixture.ledger, options);
    const targets = fixture.items.filter((item) => item.kind === 'task');
    const samples = [];
    for (let round = 0; round < options.repeat; round += 1) {
      const date = '2026-08-16';
      const created = await measureCreate(fixture.ledger, date);
      const accepted = await measureTransition(
        fixture.ledger,
        targets[Math.floor(targets.length / 2) + round].id,
        date,
      );
      samples.push({ create: created.milliseconds, transition: accepted.milliseconds });
    }
    report(options, samples, baseline);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

await main();
