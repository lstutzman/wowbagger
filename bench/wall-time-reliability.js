// Whether this benchmark run may present its wall times as measurements of the
// code rather than of the machine (ledger item #112).

// The stated factor. One full ledger load is pure read-and-parse work, so two
// measurements of it minutes apart on an otherwise quiet machine land within a
// few percent of each other. Half again as long is far outside that, and means
// something other than this code decided how long the run took.
export const WALL_TIME_SPREAD_LIMIT = 1.5;

// Fewer than three measurements cannot separate a quiet machine from a lucky
// pair, so the benchmark is not allowed to claim reliability on that evidence.
export const WALL_TIME_MINIMUM_SAMPLES = 3;

export function judgeWallTimeReliability({ samples, loadAverage }) {
  if (samples.length < WALL_TIME_MINIMUM_SAMPLES) {
    throw new Error(`wall-time reliability needs at least ${WALL_TIME_MINIMUM_SAMPLES}`
      + ` measurements, got ${samples.length}`);
  }
  const best = Math.min(...samples);
  const worst = Math.max(...samples);
  const spread = worst / best;
  return {
    reliable: spread <= WALL_TIME_SPREAD_LIMIT,
    samples: [...samples],
    best,
    worst,
    spread,
    limit: WALL_TIME_SPREAD_LIMIT,
    loadAverage: [...loadAverage],
  };
}

// Flag, do not suppress. A suppressed number tells the reader nothing about how
// bad the machine was, so the natural next move is to run the benchmark again
// and trust whatever it prints the second time — the exact mistake item #107
// made. A number printed next to its own spread and load average says both "do
// not compare this" and "here is how far off it is", and it stays in the log
// for anyone reconstructing the run. Deterministic load counts stay the
// headline either way.
export function describeWallTimeReliability(verdict) {
  const loadAverageLine = `load average: ${verdict.loadAverage.map((value) => value.toFixed(2)).join(' / ')}`
    + '  (1-, 5-, 15-minute)';
  if (verdict.reliable) {
    return { loadAverageLine, banner: null, marker: '' };
  }
  return {
    loadAverageLine,
    banner: `WALL TIMES UNRELIABLE: one full load measured ${verdict.samples.length} times spread`
      + ` ${verdict.spread.toFixed(2)}x (${verdict.best.toFixed(1)} ms to ${verdict.worst.toFixed(1)} ms),`
      + ` past the ${verdict.limit.toFixed(2)}x limit, at load average ${verdict.loadAverage[0].toFixed(2)}.`
      + ' Every millisecond below measures this machine, not this code.'
      + ' The complete ledger load counts above are the honest before/after numbers.',
    marker: 'UNRELIABLE  ',
  };
}
