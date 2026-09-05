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

// Lifecycle order, so a heatmap column always sits where the reader expects
// it. A status no open item holds is left out rather than drawn as an empty
// column: the chart shows the ledger it has, not the one the schema allows.
const OPEN_STATUSES = ['triage', 'backlog', 'in-progress'];

// Age crossed with status. Aging alone says how long work has waited; crossing
// it with status says whether the wait is untriaged, unstarted, or stalled
// mid-flight, which are three different problems.
export function buildAgingMatrix(openItems, asOf) {
  const statuses = OPEN_STATUSES.filter(
    (status) => openItems.some((item) => item.status === status),
  );
  const rows = AGE_BUCKETS.map((bucket, index) => {
    const floor = index === 0 ? 0 : AGE_BUCKETS[index - 1].maxDays;
    const inBucket = openItems.filter((item) => {
      const age = daysBetween(item.created, asOf) ?? 0;
      return age >= floor && (bucket.maxDays === null || age < bucket.maxDays);
    });
    return {
      label: bucket.label,
      counts: statuses.map((status) => inBucket.filter((item) => item.status === status).length),
    };
  });
  return { statuses, rows };
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

// Arrivals against closures, week by week. An arrival is `created`; a closure
// is the item reaching any terminal status, because every one of the four
// terminal statuses removes work from the backlog. `done` counts the closures
// that delivered: only a `done` departure is finished work, so only `done`
// may be read as completed work.
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed)
    && new Date(parsed).toISOString().slice(0, 10) === value;
}

// The weeks an evidence window covers. The default is the trailing twelve
// calendar weeks ending in the week of `asOf`. An explicit range uses the
// inclusive UTC calendar dates `from` through `to` (`to <= asOf`); a week
// bucket the range cuts short is marked partial, and the rolling mean only
// covers complete weeks. A range never filters items out: anything created
// before `from` still contributes to cumulative inventory.
function resolveWindow(asOf, range) {
  if (range === null || range === undefined) {
    const lastWeek = weekStart(asOf);
    const weekStarts = [];
    for (let index = WINDOW_WEEKS - 1; index >= 0; index -= 1) {
      weekStarts.push(shiftDays(lastWeek, -index * 7));
    }
    return {
      weekStarts,
      start: weekStarts[0],
      end: asOf,
      partial: new Set(),
      windowWeeks: WINDOW_WEEKS,
      range: null,
    };
  }
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  if (!isValidDateString(from) || !isValidDateString(to) || from > to || to > asOf) {
    throw new Error(`invalid report range ${JSON.stringify(range)}`);
  }
  const weekStarts = [];
  for (let start = weekStart(from); start <= weekStart(to); start = shiftDays(start, 7)) {
    weekStarts.push(start);
  }
  const partial = new Set(
    weekStarts.filter((start) => start < from || shiftDays(start, 6) > to),
  );
  const windowDays = (daysBetween(from, to) ?? 0) + 1;
  const windowWeeks = windowDays / 7;
  return {
    weekStarts, start: from, end: to, partial, windowWeeks, range: { from, to },
  };
}

export function buildWeeklyFlow(allItems, asOf, range = null) {
  const window = resolveWindow(asOf, range);
  const counts = new Map();
  for (const start of window.weekStarts) {
    counts.set(start, {
      weekStart: start, arrivals: 0, closures: 0, done: 0, partial: window.partial.has(start),
    });
  }

  for (const item of allItems) {
    const arrivalWeek = counts.get(weekStart(item.created));
    if (arrivalWeek !== undefined && item.created >= window.start && item.created <= window.end) {
      arrivalWeek.arrivals += 1;
    }
    if (item.terminalDate === null) {
      continue;
    }
    const departureWeek = counts.get(weekStart(item.terminalDate));
    if (departureWeek !== undefined
      && item.terminalDate >= window.start && item.terminalDate <= window.end) {
      departureWeek.closures += 1;
      if (item.status === 'done') {
        departureWeek.done += 1;
      }
    }
  }
  return attachRollingMean(counts, window);
}

// A four-week trailing mean over closures. Weekly throughput is noisy
// enough that the bar heights alone mislead; the mean is the trend line.
// A trailing window shorter than four complete weeks stays null: averaging
// over fewer weeks, or over a week the selected range cut short, would
// flatter or understate the start of the window.
const ROLLING_WEEKS = 4;

function attachRollingMean(counts, window) {
  return window.weekStarts.map((start, index) => {
    const week = counts.get(start);
    const trailing = window.weekStarts.slice(Math.max(0, index - ROLLING_WEEKS + 1), index + 1);
    if (trailing.length < ROLLING_WEEKS || trailing.some((member) => window.partial.has(member))) {
      return { ...week, rolling: null };
    }
    const total = trailing.reduce((sum, member) => sum + counts.get(member).closures, 0);
    return { ...week, rolling: Math.round((total / ROLLING_WEEKS) * 100) / 100 };
  });
}
// Cumulative flow over the same window the weekly series covers. Each item
// carries three timestamps - `created`, the accept decision, and its terminal
// date - so every day in the window can be replayed from the current bytes.
// Only three bands are honest here: `backlog -> in-progress` records no
// decision, so the ledger cannot say when work actually started. An explicit
// range moves the window edges but never drops early items: anything created
// before the range still stands in inventory on every day it spans.
// A band named Untriaged holds items with no recorded accept decision, which
// is reconstruction uncertainty - not proof the item sat untriaged. Deleted
// items and unrecorded transitions cannot be recovered from the snapshot.
export function buildCumulativeFlow(allItems, asOf, range = null) {
  const window = resolveWindow(asOf, range);
  const states = allItems.map((item) => ({
    created: item.created,
    accepted: item.decisions.find((decision) => decision.action === 'accept')?.date ?? null,
    terminal: item.terminalDate,
  }));

  const points = [];
  for (let date = window.start; date <= window.end; date = shiftDays(date, 1)) {
    const point = {
      date, triage: 0, accepted: 0, terminal: 0,
    };
    for (const state of states) {
      if (state.created > date) {
        continue;
      }
      if (state.terminal !== null && state.terminal <= date) {
        point.terminal += 1;
      } else if (state.accepted !== null && state.accepted <= date) {
        point.accepted += 1;
      } else {
        point.triage += 1;
      }
    }
    points.push(point);
  }
  return points;
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
      samples.push({ number: item.number, completedOn: item.terminalDate, days: elapsed });
    }
  }
  // Each sample is kept, not just the two percentiles: a scatter shows whether
  // the median describes a tight cluster or the middle of a spread, which two
  // numbers cannot say. Ordered by completion so the plot reads left to right,
  // then by number so the order never depends on input order.
  samples.sort((left, right) => (left.completedOn < right.completedOn ? -1
    : left.completedOn > right.completedOn ? 1
      : left.number - right.number));
  const days = samples.map((sample) => sample.days).sort((left, right) => left - right);

  return {
    sampleCount: samples.length,
    medianDays: percentile(days, 0.5),
    p85Days: percentile(days, 0.85),
    samples,
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

// Monte Carlo over the observed weekly closure rate, per Vacanti: resample the
// weeks the ledger actually recorded rather than extrapolating an average,
// and report a band instead of one false-precision date. This is a
// closure-based estimate of when open work clears, not a feature-delivery
// commitment: closures include kills, deferrals, and archives alongside done.
export function buildForecast(weeks, remaining, asOf) {
  const samples = weeks.map((week) => week.closures);
  if (samples.reduce((total, value) => total + value, 0) === 0) {
    return null;
  }
  if (remaining === 0) {
    return {
      remaining: 0,
      weeks50: 0,
      weeks85: 0,
      weeks95: 0,
      date50: asOf,
      date85: asOf,
      date95: asOf,
      distribution: [{ weeks: 0, share: 1 }],
      trials: FORECAST_TRIALS,
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
  const weeks95 = percentile(trials, 0.95);
  return {
    remaining,
    weeks50,
    weeks85,
    weeks95,
    date50: shiftDays(asOf, weeks50 * 7),
    date85: shiftDays(asOf, weeks85 * 7),
    date95: shiftDays(asOf, weeks95 * 7),
    distribution: cumulativeShare(trials, weeks95),
    trials: FORECAST_TRIALS,
  };
}

// The share of trials finished by each week, up to the 95th percentile. Three
// marked dates say where the band edges are; the curve says how steeply the
// odds climb between them, which is the difference between a tight forecast
// and a wide one that happens to share the same p50.
function cumulativeShare(sortedTrials, lastWeek) {
  const points = [];
  let finished = 0;
  for (let week = 0; week <= lastWeek; week += 1) {
    while (finished < sortedTrials.length && sortedTrials[finished] <= week) {
      finished += 1;
    }
    points.push({ weeks: week, share: Math.round((finished / sortedTrials.length) * 10000) / 10000 });
  }
  return points;
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

export function buildEvidence(openItems, terminalItems, asOf, range = null) {
  const window = resolveWindow(asOf, range);
  const retained = [...openItems, ...terminalItems];
  const weeks = buildWeeklyFlow(retained, asOf, range);
  const closureTotal = weeks.reduce((total, week) => total + week.closures, 0);
  const doneTotal = weeks.reduce((total, week) => total + week.done, 0);

  return {
    range: window.range,
    agingBuckets: buildAgingBuckets(openItems, asOf),
    agingMatrix: buildAgingMatrix(openItems, asOf),
    weeks,
    throughput: {
      total: closureTotal,
      done: doneTotal,
      windowWeeks: window.windowWeeks,
      perWeek: window.windowWeeks === 0
        ? 0
        : Math.round((closureTotal / window.windowWeeks) * 100) / 100,
    },
    cumulativeFlow: buildCumulativeFlow(retained, asOf, range),
    coverageGaps: {
      // Retained items past triage with no recorded accept decision. Their
      // band history reads as untriaged until departure, which is
      // reconstruction uncertainty, not proof they sat untriaged.
      missingAcceptance: retained.filter((item) => item.status !== 'triage'
        && !item.decisions.some((decision) => decision.action === 'accept')).length,
    },
    cycleTime: buildCycleTime(terminalItems),
    forecast: buildForecast(weeks, openItems.length, asOf),
  };
}

// The calculators the browser re-runs, serialized from the same functions
// Node executes above. Tested for runtime parity against the direct functions
// in a VM: the browser never carries a second formula.
function browserFunctionSource(fn) {
  return fn.toString().replace(/^export\s+/, '');
}

export function reportEvidenceBrowserSource() {
  return [
    `const AGE_BUCKETS = ${JSON.stringify(AGE_BUCKETS)};`,
    `const OPEN_STATUSES = ${JSON.stringify(OPEN_STATUSES)};`,
    `const WINDOW_WEEKS = ${WINDOW_WEEKS};`,
    `const MILLISECONDS_PER_DAY = ${MILLISECONDS_PER_DAY};`,
    `const ROLLING_WEEKS = ${ROLLING_WEEKS};`,
    `const FORECAST_TRIALS = ${FORECAST_TRIALS};`,
    `const FORECAST_WEEK_CEILING = ${FORECAST_WEEK_CEILING};`,
    `const FORECAST_SEED = ${FORECAST_SEED};`,
    browserFunctionSource(daysBetween),
    browserFunctionSource(buildAgingBuckets),
    browserFunctionSource(buildAgingMatrix),
    browserFunctionSource(weekStart),
    browserFunctionSource(shiftDays),
    browserFunctionSource(isValidDateString),
    browserFunctionSource(resolveWindow),
    browserFunctionSource(buildWeeklyFlow),
    browserFunctionSource(attachRollingMean),
    browserFunctionSource(buildCumulativeFlow),
    browserFunctionSource(buildCycleTime),
    browserFunctionSource(percentile),
    browserFunctionSource(buildForecast),
    browserFunctionSource(cumulativeShare),
    browserFunctionSource(seededRandom),
    browserFunctionSource(buildEvidence),
  ].join('\n');
}
