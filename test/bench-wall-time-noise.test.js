// The safety limits on the benchmark's load generator (ledger item #112).
//
// This repository has already paid for an unbounded load generator once: a
// reproduction helper with a bare `for (;;)` loop and no teardown orphaned to
// PID 1 and burned 7.4 cores for fifteen hours. The generator that proves the
// wall-time flagging works is therefore bounded by construction, and these
// tests hold the two bounds that failed last time — a worker count that stays
// below the machine and a wall-clock deadline that always exists.
import test from 'node:test';
import assert from 'node:assert/strict';

import { NOISE_MAXIMUM_SECONDS, resolveNoisePlan } from '../bench/wall-time-noise.js';

test('caps the worker count below the core count', () => {
  // Sizing the burners at or above the core count starves the process being
  // measured and corrupts the very timings the load exists to produce.
  const plan = resolveNoisePlan({ workers: 64, seconds: 30, cpuCount: 16 });

  assert.ok(plan.workers < 16, `expected fewer than 16 workers, got ${plan.workers}`);
  assert.equal(plan.workers, 14);
});

test('clamps the run to the stated wall-clock ceiling', () => {
  const plan = resolveNoisePlan({ workers: 2, seconds: NOISE_MAXIMUM_SECONDS * 10, cpuCount: 16 });

  assert.equal(plan.durationMs, NOISE_MAXIMUM_SECONDS * 1000);
});

test('refuses a duration that is not a positive number of seconds', () => {
  // The failure this guards is the one that cost fifteen hours: a generator
  // that starts without a deadline. There is no defaulting here — a caller who
  // cannot say when the load stops does not get to start it.
  for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, '30']) {
    assert.throws(
      () => resolveNoisePlan({ workers: 2, seconds, cpuCount: 16 }),
      /positive number of seconds/,
      `expected a refusal for ${JSON.stringify(seconds)}`,
    );
  }
});
