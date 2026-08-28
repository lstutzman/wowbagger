import { performance } from 'node:perf_hooks';

// Deterministic phase counters for the large-ledger cost model (ledger item
// #122, stage 0). A complete ledger load already has its own counter in
// `ledger.js`; these count the phases underneath it that a wall time cannot
// attribute — per-item lock file work, the namespace process lock, and the
// Git HEAD tree scan and blob reads.
//
// The counters are monotonic and process-wide, exactly like `ledgerLoadCount`.
// A caller reads `phaseCounters()` before the work it cares about and passes
// that snapshot to `countersSince()` afterwards. They are the numbers a
// before/after comparison is entitled to use: they are identical on a quiet
// machine and on one carrying fifteen sibling agents.
const COUNTER_NAMES = [
  'item_lock_acquisitions',
  'item_lock_fsyncs',
  'item_lock_releases',
  'namespace_lock_acquisitions',
  'worktree_identity_lock_acquisitions',
  'head_tree_entries',
  'head_blobs_read',
  'head_bytes_read',
];

const counters = Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0]));

export function phaseCounters() {
  return { ...counters };
}

export function countersSince(before) {
  return Object.fromEntries(COUNTER_NAMES.map((name) => [name, counters[name] - (before[name] ?? 0)]));
}

// Unknown names fail closed rather than growing the record silently: a
// mistyped counter must not read as zero work in a guard.
export function recordCount(name, amount = 1) {
  if (!Object.hasOwn(counters, name)) {
    throw new Error(`unknown phase counter: ${name}`);
  }
  counters[name] += amount;
}

// Accumulated wall time per phase, in milliseconds. Unlike the counters these
// are the machine's opinion rather than the program's, so the benchmark
// reports them under its reliability marker. They exist because the phases
// they name run inside the mutation engine, where an outside timer cannot
// reach them.
const TIMING_NAMES = [
  'item_lock_acquire_ms',
  'item_lock_release_ms',
  'head_tree_ms',
  'head_blob_ms',
];

const timings = Object.fromEntries(TIMING_NAMES.map((name) => [name, 0]));

export function phaseTimings() {
  return { ...timings };
}

export function timingsSince(before) {
  return Object.fromEntries(TIMING_NAMES.map((name) => [name, timings[name] - (before[name] ?? 0)]));
}

export async function timePhase(name, run) {
  if (!Object.hasOwn(timings, name)) {
    throw new Error(`unknown phase timer: ${name}`);
  }
  const started = performance.now();
  try {
    return await run();
  } finally {
    timings[name] += performance.now() - started;
  }
}
