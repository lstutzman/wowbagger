// Mutation latency benchmark for ledger item 91.
//
// Not part of the default test run (`npm test` runs `test/*.test.js` only).
// Run it explicitly:
//
//   TMPDIR=/tmp node bench/mutation-latency.bench.js
//   TMPDIR=/tmp node bench/mutation-latency.bench.js --items 1500 --repeat 3
//   TMPDIR=/tmp node bench/mutation-latency.bench.js --load-samples 5
//   TMPDIR=/tmp node --cpu-prof --cpu-prof-dir=/tmp/prof bench/mutation-latency.bench.js
//
// It generates a fixture ledger in a temporary directory. It never reads or
// writes this repository's own `ledger/`.
//
// The run judges its own wall times (ledger item #112). It measures the price of
// one full ledger load `--load-samples` times, and when the spread across those
// repeats exceeds the factor stated in `wall-time-reliability.js` it flags every
// millisecond it prints. The deterministic load counts are the headline numbers
// either way, and the machine's load average is recorded on every run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createFixtureLedger } from './ledger-fixture.js';
import {
  WALL_TIME_MINIMUM_SAMPLES,
  describeWallTimeReliability,
  judgeWallTimeReliability,
} from './wall-time-reliability.js';
import { appendClaimEntry, claimJournalPath } from '../src/claim-journal.js';
import { operationDigest, publishClaimed } from '../src/claim-publication.js';
import { resolveGitCommonDir } from '../src/claim-store.js';
import { readGitHeadLedger } from '../src/git-reconciliation.js';
import {
  countersSince, phaseCounters, phaseTimings, timingsSince,
} from '../src/instrumentation.js';
import { ledgerLoadCount, loadLedger } from '../src/ledger.js';
import { mintId } from '../src/mint.js';
import { createItem, inspectItem, transitionItem } from '../src/mutation.js';
import { provisionNamespace, readNamespace } from '../src/namespace.js';
import { validateLedger } from '../src/validate.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

function parseArguments(argumentList) {
  const options = {
    items: 1500,
    repeat: 1,
    seed: 20260816,
    provisioned: false,
    loadSamples: WALL_TIME_MINIMUM_SAMPLES,
  };
  for (let index = 0; index < argumentList.length; index += 1) {
    const name = argumentList[index];
    if (name === '--load-samples') {
      options.loadSamples = Number(argumentList[index + 1]);
      index += 1;
      continue;
    }
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

// Complete-ledger loads per mutation before item #100 collapsed the redundant
// unlocked reads. A claim-protected mutation read the whole directory three
// times: once in reconcileClaimJournal, once before lock closure, and once
// under lock. A plain-directory mutation skipped reconciliation and read
// twice. Measured on this fixture at 1,500 items; the run below reports the
// live count against these.
const LOADS_BEFORE_ITEM_100 = { provisioned: 3, plain: 2 };

// Complete-ledger loads per `publish-claimed` before item #107 collapsed its
// redundant unlocked reads, measured on this fixture at 1,500 items. The plain
// call read three times — validateCandidateLedger, then the mutation engine's
// pre-lock and locked reads — and four when an unresolved publish-intent forced
// journal reconciliation to read the ledger first. The run below reports the
// live count against these.
const LOADS_BEFORE_ITEM_107 = { publish: 3, reconciledPublish: 4 };

async function timed(label, run) {
  const started = performance.now();
  const loadsBefore = ledgerLoadCount();
  const countersBefore = phaseCounters();
  const timingsBefore = phaseTimings();
  const value = await run();
  return {
    label,
    milliseconds: performance.now() - started,
    loads: ledgerLoadCount() - loadsBefore,
    counters: countersSince(countersBefore),
    timings: timingsSince(timingsBefore),
    value,
  };
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
//
// One full load is measured repeatedly rather than once, for two reasons. It is
// the price every dropped read stops paying, so every derived saving below is
// denominated in it; and it is the same pure read-and-parse work each time, so
// the spread across those repeats is a direct reading of how much the machine
// is interfering. `best` is the load price the report quotes: of the repeats it
// is the one least contaminated by whatever else the machine was doing.
// The first read of the fixture pays for a cold filesystem cache, which on a
// 1,500-item ledger is a third again as long as every read after it. That is a
// systematic cost of reading first, not machine interference, and counting it
// would flag a quiet run. So one load is measured and thrown away before the
// samples that the verdict is drawn from.
async function measureBaselineCosts(ledger, options) {
  const loadSamples = [];
  let loaded = await timed('load-ledger-warmup', () => loadLedger(ledger));
  for (let sample = 0; sample < options.loadSamples; sample += 1) {
    loaded = await timed('load-ledger', () => loadLedger(ledger));
    loadSamples.push(loaded.milliseconds);
  }
  const validate = await timed('validate-ledger', () => validateLedger(loaded.value));
  const baseline = {
    load: Math.min(...loadSamples),
    loadSamples,
    validate: validate.milliseconds,
    gitHead: null,
    gitHeadCounters: null,
  };
  if (options.provisioned) {
    const gitHead = await timed('git-head-ledger', () => readGitHeadLedger(ledger));
    baseline.gitHead = gitHead.milliseconds;
    baseline.gitHeadCounters = gitHead.counters;
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
  return {
    milliseconds: created.milliseconds,
    loads: created.loads,
    counters: created.counters,
    timings: created.timings,
    id: request.id,
  };
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
  return {
    milliseconds: transitioned.milliseconds,
    loads: transitioned.loads,
    counters: transitioned.counters,
    timings: transitioned.timings,
  };
}

// The full claimed loop the field report runs: provision, acquire the claim,
// inspect the target, build candidate bytes, then publish under the fence.
// Only the publication itself is timed and load-counted; setup is not.
async function acquireClaim(ledger, root, namespace, itemId) {
  const requestPath = path.join(root, 'bench-acquire.json');
  await writeFile(requestPath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'benchmark-agent',
    lease_duration_ms: 600_000,
    expected: { last_epoch: '0', active: null },
  }));
  const stdout = execFileSync(
    process.execPath,
    [CLI, 'claim', 'acquire', '--ledger', ledger, '--input', requestPath, '--json'],
    { encoding: 'utf8' },
  );
  const envelope = JSON.parse(stdout);
  assertOk('claim acquire', envelope);
  return envelope.result.claim;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function publicationRequest(namespace, itemId, inspected, claim, operationId, title) {
  const candidate = Buffer.from(Buffer.from(inspected.item.source_base64, 'base64')
    .toString('utf8')
    .replace(/^title: .*$/m, `title: "${title}"`), 'utf8');
  return {
    operation_id: operationId,
    ledger_namespace: namespace,
    item_id: itemId,
    expected_revision: inspected.item.revision,
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: sha256(candidate),
    claim_fence: {
      ledger_namespace: namespace,
      item_id: itemId,
      owner_id: claim.owner_id,
      epoch: claim.epoch,
    },
  };
}

// A second publication measured behind an unresolved publish-intent, which
// forces the journal reconciliation that reads the complete ledger again. The
// intent names the revision already on disk, so reconciliation rolls it back
// and reports `pending-intent-resolved` rather than refusing the publication.
async function appendPendingIntent(journalPath, namespace, request, revision) {
  await appendClaimEntry(journalPath, {
    type: 'publish-intent',
    operation_id: 'pub_bench_pending',
    operation_digest: operationDigest(request),
    ledger_namespace: namespace,
    item_id: request.item_id,
    fence: request.claim_fence,
    expected_revision: revision,
    candidate_sha256: sha256(Buffer.from('benchmark pending candidate', 'utf8')),
    state: 'pending',
  });
}

async function measurePublishClaimed(fixture, target) {
  const namespace = await readNamespace(fixture.ledger);
  const gitCommonDir = await resolveGitCommonDir(fixture.ledger);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  const claim = await acquireClaim(fixture.ledger, fixture.root, namespace, target.id);

  const first = publicationRequest(
    namespace,
    target.id,
    await inspectItem(fixture.ledger, target.id),
    claim,
    'pub_bench_0001',
    'Benchmark publication',
  );
  const published = await timed('publish-claimed', () => publishClaimed({
    ledgerDirectory: fixture.ledger,
    gitCommonDir,
    namespace,
    request: first,
  }));
  assertOk('publish-claimed', published.value);

  const inspected = await inspectItem(fixture.ledger, target.id);
  const second = publicationRequest(
    namespace,
    target.id,
    inspected,
    claim,
    'pub_bench_0002',
    'Benchmark publication after reconciliation',
  );
  await appendPendingIntent(journalPath, namespace, second, inspected.item.revision);
  const reconciled = await timed('publish-claimed-reconciled', () => publishClaimed({
    ledgerDirectory: fixture.ledger,
    gitCommonDir,
    namespace,
    request: second,
  }));
  assertOk('publish-claimed after pending intent', reconciled.value);

  return {
    publish: published.milliseconds,
    publishLoads: published.loads,
    publishCounters: published.counters,
    publishTimings: published.timings,
    reconciledPublish: reconciled.milliseconds,
    reconciledPublishLoads: reconciled.loads,
    reconciledPublishCounters: reconciled.counters,
  };
}

const format = (value) => `${value.toFixed(1)} ms`;

// Deterministic counters first, wall times second, and the machine load on
// every run whether or not the wall times survived it (ledger item #112). The
// counters are the same number on a quiet machine and on one carrying fifteen
// sibling agents, so they are what a before/after comparison is entitled to
// use. Anything denominated in milliseconds — including the savings derived
// from one full load — carries the run's reliability marker.
function report(options, samples, baseline, publication) {
  const verdict = judgeWallTimeReliability({
    samples: baseline.loadSamples,
    loadAverage: os.loadavg(),
  });
  const described = describeWallTimeReliability(verdict);

  console.log(`items: ${options.items}  repeat: ${options.repeat}  runtime: ${process.version}`
    + `  ledger: ${options.provisioned ? 'provisioned git' : 'plain directory'}`);
  console.log(described.loadAverageLine);
  reportLoadCounts(options, samples, publication);
  reportPhaseCounters(samples, baseline, publication);
  if (described.banner) {
    console.log(described.banner);
  }
  reportWallTimes(options, samples, baseline, publication, verdict, described.marker);
}

// Load-count attribution. Wall time on this fixture is noisy — the claim
// journal grows with every round and Git HEAD reads dominate the provisioned
// path — so the load count is the honest before/after number, and one full
// load is the price each dropped read stops paying.
function reportLoadCounts(options, samples, publication) {
  const before = options.provisioned
    ? LOADS_BEFORE_ITEM_100.provisioned
    : LOADS_BEFORE_ITEM_100.plain;
  const distinct = (values) => [...new Set(values)].sort((left, right) => left - right).join('/');
  const createLoads = distinct(samples.map((sample) => sample.createLoads));
  const transitionLoads = distinct(samples.map((sample) => sample.transitionLoads));

  console.log(`complete ledger loads per mutation: create ${createLoads}`
    + `  transition ${transitionLoads}  (before item #100: ${before})`);
  console.log(`loads saved per mutation: ${mutationLoadsSaved(options, samples)}`);
  if (publication) {
    console.log('complete ledger loads per publish-claimed:'
      + ` ${publication.publishLoads} (before item #107: ${LOADS_BEFORE_ITEM_107.publish})`
      + `  after pending intent ${publication.reconciledPublishLoads}`
      + ` (before item #107: ${LOADS_BEFORE_ITEM_107.reconciledPublish})`);
    console.log(`loads saved per publish-claimed: ${publicationLoadsSaved(publication)}`);
  }
}

// Phase attribution, deterministic half (ledger item #122, stage 0). A whole
// mutation's wall time cannot say whether the item-lock file work or the Git
// HEAD read paid for it; these counts can, and they say the same number on any
// machine. `item locks` is one create + one metadata write + one fsync +
// one unlink per counted acquisition.
function reportPhaseCounters(samples, baseline, publication) {
  const distinct = (values) => [...new Set(values)].sort((left, right) => left - right).join('/');
  const counted = (key, name) => distinct(samples.map((sample) => sample[key][name]));

  console.log(`item locks per mutation: create ${counted('createCounters', 'item_lock_acquisitions')}`
    + ` (fsyncs ${counted('createCounters', 'item_lock_fsyncs')})`
    + `  transition ${counted('transitionCounters', 'item_lock_acquisitions')}`
    + ` (fsyncs ${counted('transitionCounters', 'item_lock_fsyncs')})`);
  console.log(`namespace locks per mutation: create ${counted('createCounters', 'namespace_lock_acquisitions')}`
    + `  transition ${counted('transitionCounters', 'namespace_lock_acquisitions')}`);
  console.log(`HEAD reads per mutation: tree entries ${counted('transitionCounters', 'head_tree_entries')}`
    + `  blobs ${counted('transitionCounters', 'head_blobs_read')}`
    + `  bytes ${counted('transitionCounters', 'head_bytes_read')}`);
  if (baseline.gitHeadCounters) {
    console.log(`one git HEAD ledger read: tree entries ${baseline.gitHeadCounters.head_tree_entries}`
      + `  blobs ${baseline.gitHeadCounters.head_blobs_read}`
      + `  bytes ${baseline.gitHeadCounters.head_bytes_read}`);
  }
  if (publication) {
    const publish = publication.publishCounters;
    console.log(`item locks per publish-claimed: ${publish.item_lock_acquisitions}`
      + ` (fsyncs ${publish.item_lock_fsyncs}, releases ${publish.item_lock_releases})`
      + `  after pending intent ${publication.reconciledPublishCounters.item_lock_acquisitions}`);
    console.log(`namespace locks per publish-claimed: ${publish.namespace_lock_acquisitions}`);
    console.log(`HEAD reads per publish-claimed: tree entries ${publish.head_tree_entries}`
      + `  blobs ${publish.head_blobs_read}  bytes ${publish.head_bytes_read}`);
  }
}

// Phase attribution, wall-time half. Each figure is the best of the repeats,
// for the same reason the load price is: of the samples it is the one least
// contaminated by whatever else the machine was doing. These carry the run's
// reliability marker; the counts above do not.
function reportPhaseTimes(samples, publication, line) {
  const best = (key, name) => Math.min(...samples.map((sample) => sample[key][name]));

  line(`transition phases: item locks ${format(best('transitionTimings', 'item_lock_acquire_ms'))} acquire`
    + ` + ${format(best('transitionTimings', 'item_lock_release_ms'))} release`
    + `  HEAD ${format(best('transitionTimings', 'head_tree_ms'))} tree`
    + ` + ${format(best('transitionTimings', 'head_blob_ms'))} blobs`);
  if (publication) {
    const spent = publication.publishTimings;
    line(`publish-claimed phases: item locks ${format(spent.item_lock_acquire_ms)} acquire`
      + ` + ${format(spent.item_lock_release_ms)} release`
      + `  HEAD ${format(spent.head_tree_ms)} tree`
      + ` + ${format(spent.head_blob_ms)} blobs`);
  }
}

function mutationLoadsSaved(options, samples) {
  const before = options.provisioned
    ? LOADS_BEFORE_ITEM_100.provisioned
    : LOADS_BEFORE_ITEM_100.plain;
  return before - Math.max(...samples.map((sample) => sample.transitionLoads));
}

function publicationLoadsSaved(publication) {
  return LOADS_BEFORE_ITEM_107.publish - publication.publishLoads;
}

function reportWallTimes(options, samples, baseline, publication, verdict, marker) {
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
  const line = (text) => console.log(`${marker}${text}`);

  line(`one full load (read + parse): ${format(baseline.load)}`
    + `  [${verdict.samples.length} samples ${verdict.samples.map((value) => value.toFixed(1)).join('/')}`
    + `, spread ${verdict.spread.toFixed(2)}x of ${verdict.limit.toFixed(2)}x limit]`);
  line(`one full validate (in memory): ${format(baseline.validate)}`);
  if (baseline.gitHead !== null) {
    line(`one git HEAD ledger read: ${format(baseline.gitHead)}`);
  }
  line(`create    best ${format(creates.best)}  median ${format(creates.median)}  worst ${format(creates.worst)}`);
  line(`transition best ${format(transitions.best)}  median ${format(transitions.median)}  worst ${format(transitions.worst)}`);
  reportPhaseTimes(samples, publication, line);
  const mutationSaved = mutationLoadsSaved(options, samples);
  line(`loads saved per mutation in wall time: ${mutationSaved}`
    + ` at ${format(baseline.load)} per load = ${format(mutationSaved * baseline.load)}`);
  if (publication) {
    line(`publish-claimed ${format(publication.publish)}`
      + `  after pending intent ${format(publication.reconciledPublish)}`);
    const publicationSaved = publicationLoadsSaved(publication);
    line(`loads saved per publish-claimed in wall time: ${publicationSaved}`
      + ` at ${format(baseline.load)} per load = ${format(publicationSaved * baseline.load)}`);
  }
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
      samples.push({
        create: created.milliseconds,
        createLoads: created.loads,
        createCounters: created.counters,
        createTimings: created.timings,
        transition: accepted.milliseconds,
        transitionLoads: accepted.loads,
        transitionCounters: accepted.counters,
        transitionTimings: accepted.timings,
      });
    }
    // publish-claimed exists only on a provisioned ledger: it is refused
    // outright on an advisory backend, so there is nothing to measure there.
    const publication = options.provisioned
      ? await measurePublishClaimed(fixture, targets.at(-1))
      : null;
    report(options, samples, baseline, publication);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

await main();
