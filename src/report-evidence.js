// The evidence layer. Every series here is reconstructed from the current
// ledger bytes at render time: each item timestamps its own arrival
// (`created`) and its own departure (the terminal date), so one snapshot
// carries the whole history. No stored snapshots, no capture infrastructure.
import { daysBetween } from './report-sequencing.js';

const AGE_BUCKETS = [
  { label: 'under 7d', maxDays: 7 },
  { label: '7-30d', maxDays: 30 },
  { label: '30-90d', maxDays: 90 },
  { label: 'over 90d', maxDays: null },
];

export function buildAgingBuckets(openItems, asOf) {
  return AGE_BUCKETS.map((bucket, index) => {
    const floor = index === 0 ? 0 : AGE_BUCKETS[index - 1].maxDays;
    return {
      label: bucket.label,
      count: openItems.filter((item) => {
        const age = daysBetween(item.created, asOf) ?? 0;
        return age >= floor && (bucket.maxDays === null || age < bucket.maxDays);
      }).length,
    };
  });
}

// The trailing window every flow series is measured over.
const WINDOW_WEEKS = 12;
const MILLISECONDS_PER_DAY = 86400000;

// The Monday that starts the ISO week containing an ISO calendar date.
export function weekStart(date) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const weekday = new Date(parsed).getUTCDay();
  const offsetDays = (weekday + 6) % 7;
  return new Date(parsed - offsetDays * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

function shiftDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

// Arrivals against completions, week by week. An arrival is `created`; a
// completion is the item reaching any terminal status, because every one of the
// four terminal statuses removes work from the backlog.
export function buildWeeklyFlow(allItems, asOf) {
  const lastWeek = weekStart(asOf);
  const counts = new Map();
  const weekStarts = [];
  for (let index = WINDOW_WEEKS - 1; index >= 0; index -= 1) {
    const start = shiftDays(lastWeek, -index * 7);
    weekStarts.push(start);
    counts.set(start, { weekStart: start, arrivals: 0, completions: 0 });
  }

  for (const item of allItems) {
    const arrivalWeek = counts.get(weekStart(item.created));
    if (arrivalWeek !== undefined) {
      arrivalWeek.arrivals += 1;
    }
    const departureWeek = item.terminalDate === null
      ? undefined
      : counts.get(weekStart(item.terminalDate));
    if (departureWeek !== undefined) {
      departureWeek.completions += 1;
    }
  }
  return weekStarts.map((start) => counts.get(start));
}

// Cycle time is measured accept-to-complete. `backlog -> in-progress` records
// no decision, so the in-progress start is not timestamped; the accept decision
// is the earliest reliable start the ledger carries. Only items that reached
// `done` are samples: a kill or a deferral is a departure, not a completion.
export function buildCycleTime(terminalItems) {
  const samples = [];
  for (const item of terminalItems) {
    if (item.status !== 'done') {
      continue;
    }
    const accepted = item.decisions.find((decision) => decision.action === 'accept');
    if (accepted === undefined) {
      continue;
    }
    const elapsed = daysBetween(accepted.date, item.terminalDate);
    if (elapsed !== null) {
      samples.push(elapsed);
    }
  }
  samples.sort((left, right) => left - right);

  return {
    sampleCount: samples.length,
    medianDays: percentile(samples, 0.5),
    p85Days: percentile(samples, 0.85),
  };
}

// Nearest-rank percentile: the smallest sample at or above the requested share
// of the ordered set. No interpolation, so every reported figure is a value the
// ledger actually contains.
export function percentile(sortedSamples, share) {
  if (sortedSamples.length === 0) {
    return null;
  }
  const rank = Math.max(1, Math.ceil(share * sortedSamples.length));
  return sortedSamples[rank - 1];
}

const FORECAST_TRIALS = 5000;
const FORECAST_WEEK_CEILING = 520;
// A fixed seed. The forecast must be identical for identical ledger bytes and
// the same --as-of, so the sampler may not read the clock or Math.random.
const FORECAST_SEED = 0x9e3779b9;

// Monte Carlo over observed weekly throughput, per Vacanti: resample the weeks
// the ledger actually recorded rather than extrapolating an average, and report
// a band instead of one false-precision date.
export function buildForecast(weeks, remaining, asOf) {
  const samples = weeks.map((week) => week.completions);
  if (samples.reduce((total, value) => total + value, 0) === 0) {
    return null;
  }
  if (remaining === 0) {
    return {
      remaining: 0, weeks50: 0, weeks85: 0, date50: asOf, date85: asOf, trials: FORECAST_TRIALS,
    };
  }

  const nextRandom = seededRandom(FORECAST_SEED);
  const trials = [];
  for (let trial = 0; trial < FORECAST_TRIALS; trial += 1) {
    let completed = 0;
    let elapsedWeeks = 0;
    while (completed < remaining && elapsedWeeks < FORECAST_WEEK_CEILING) {
      completed += samples[Math.floor(nextRandom() * samples.length)];
      elapsedWeeks += 1;
    }
    trials.push(elapsedWeeks);
  }
  trials.sort((left, right) => left - right);

  const weeks50 = percentile(trials, 0.5);
  const weeks85 = percentile(trials, 0.85);
  return {
    remaining,
    weeks50,
    weeks85,
    date50: shiftDays(asOf, weeks50 * 7),
    date85: shiftDays(asOf, weeks85 * 7),
    trials: FORECAST_TRIALS,
  };
}

// mulberry32. Small, deterministic, and dependency-free.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildEvidence(openItems, terminalItems, asOf) {
  const weeks = buildWeeklyFlow([...openItems, ...terminalItems], asOf);
  const completionTotal = weeks.reduce((total, week) => total + week.completions, 0);

  return {
    agingBuckets: buildAgingBuckets(openItems, asOf),
    weeks,
    throughput: {
      total: completionTotal,
      windowWeeks: WINDOW_WEEKS,
      perWeek: Math.round((completionTotal / WINDOW_WEEKS) * 100) / 100,
    },
    cycleTime: buildCycleTime(terminalItems),
    forecast: buildForecast(weeks, openItems.length, asOf),
  };
}
