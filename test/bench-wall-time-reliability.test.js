// The benchmark's judgement about its own wall times (ledger item #112).
//
// Item #107's run measured a one-full-load price that swung 321 ms to 3,774 ms
// under sibling-agent load while the load counts stayed exact. These tests pin
// the rule that decides when the benchmark is allowed to present a millisecond
// as a property of the code rather than of the machine. The benchmark itself
// stays out of the default test run; only this pure judgement is tested here.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WALL_TIME_SPREAD_LIMIT,
  describeWallTimeReliability,
  judgeWallTimeReliability,
} from '../bench/wall-time-reliability.js';

test('calls wall times reliable when repeated load measurements agree', () => {
  const verdict = judgeWallTimeReliability({
    samples: [12, 12.6, 12.3],
    loadAverage: [1.1, 1, 0.9],
  });

  assert.equal(verdict.reliable, true);
});

test('calls wall times unreliable when the spread exceeds the stated factor', () => {
  // Item #107's field numbers: the same one-full-load price, measured minutes
  // apart on a machine carrying sibling agents.
  const verdict = judgeWallTimeReliability({
    samples: [321, 1383, 3774],
    loadAverage: [78, 120, 190],
  });

  assert.equal(verdict.reliable, false);
});

test('reports the spread, the samples and the load average behind the verdict', () => {
  const verdict = judgeWallTimeReliability({
    samples: [321, 1383, 3774],
    loadAverage: [78, 120, 190],
  });

  assert.equal(verdict.best, 321);
  assert.equal(verdict.worst, 3774);
  assert.equal(verdict.spread.toFixed(2), '11.76');
  assert.equal(verdict.limit, 1.5);
  assert.deepEqual(verdict.samples, [321, 1383, 3774]);
  assert.deepEqual(verdict.loadAverage, [78, 120, 190]);
});

test('refuses to judge from fewer than three measurements', () => {
  // Two samples cannot distinguish a quiet machine from a lucky pair, so the
  // benchmark must not be able to claim reliability on that evidence.
  for (const samples of [[], [12], [12, 12.1]]) {
    assert.throws(
      () => judgeWallTimeReliability({ samples, loadAverage: [1, 1, 1] }),
      /at least 3 measurements/,
      `expected a refusal for ${JSON.stringify(samples)}`,
    );
  }
});

test('holds the verdict at the stated factor and turns just past it', () => {
  const judge = (worst) => judgeWallTimeReliability({
    samples: [100, 100, worst],
    loadAverage: [1, 1, 1],
  }).reliable;

  assert.equal(judge(100 * WALL_TIME_SPREAD_LIMIT), true);
  assert.equal(judge(100 * WALL_TIME_SPREAD_LIMIT + 0.1), false);
});

test('banners an unreliable run with the spread, the limit and the load average', () => {
  const described = describeWallTimeReliability(judgeWallTimeReliability({
    samples: [321, 1383, 3774],
    loadAverage: [78, 120, 190],
  }));

  assert.match(described.banner, /WALL TIMES UNRELIABLE/);
  assert.match(described.banner, /11\.76x/);
  assert.match(described.banner, /1\.50x/);
  assert.match(described.banner, /321\.0 ms to 3774\.0 ms/);
  assert.match(described.banner, /load average 78\.00/);
  assert.match(described.marker, /^UNRELIABLE/);
});

test('leaves a quiet run unmarked and unbannered', () => {
  const described = describeWallTimeReliability(judgeWallTimeReliability({
    samples: [12, 12.6, 12.3],
    loadAverage: [1.1, 1, 0.9],
  }));

  assert.equal(described.banner, null);
  assert.equal(described.marker, '');
});

test('records the load average on every run, reliable or not', () => {
  // Requirement 2 of item #112: the machine load is reported unconditionally,
  // so a quiet-looking run still carries the evidence that it was quiet.
  for (const samples of [[12, 12.1, 12.2], [321, 1383, 3774]]) {
    const described = describeWallTimeReliability(judgeWallTimeReliability({
      samples,
      loadAverage: [4.48, 4.93, 10.9],
    }));

    assert.equal(described.loadAverageLine, 'load average: 4.48 / 4.93 / 10.90  (1-, 5-, 15-minute)');
  }
});
