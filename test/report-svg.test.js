import test from 'node:test';
import assert from 'node:assert/strict';

test('escapes every label it is handed instead of trusting the caller', async () => {
  const { agingHeatmapChart } = await import('../src/report-svg.js');
  const svg = agingHeatmapChart({
    statuses: ['</title><script>alert(1)</script> & "x"'],
    rows: [{ label: '</title><script>alert(1)</script> & "x"', counts: [1] }],
  });

  assert.doesNotMatch(svg, /<script>|<\/title><script/);
  assert.match(svg, /&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/);
});

test('escapes the as-of date the forecast curve prints', async () => {
  const { forecastChart } = await import('../src/report-svg.js');
  const svg = forecastChart(fanForecast(), '<img src=x>');

  assert.doesNotMatch(svg, /<img src=x>/);
  assert.match(svg, /&lt;img src=x&gt;/);
});

test('scales each weekly bar against the tallest week in the series', async () => {
  const { weeklyFlowChart } = await import('../src/report-svg.js');
  const svg = weeklyFlowChart([
    { weekStart: '2026-08-03', arrivals: 2, closures: 1, done: 1 },
    { weekStart: '2026-08-10', arrivals: 0, closures: 4, done: 3 },
  ]);

  // Peak 4 over a 152px plot with a 166px baseline: half-height arrivals,
  // quarter-height closures, then a full-height closure week.
  assert.match(svg, /<rect class="bar-arrival" x="93\.84" y="90" width="108\.16" height="76"><\/rect>/);
  assert.match(svg, /<rect class="bar-closure" x="204" y="128" width="108\.16" height="38"><\/rect>/);
  assert.match(svg, /<rect class="bar-arrival" x="431\.84" y="166" width="108\.16" height="0"><\/rect>/);
  assert.match(svg, /<rect class="bar-closure" x="542" y="14" width="108\.16" height="152"><\/rect>/);
});

function agingMatrix(overrides = {}) {
  return {
    statuses: ['backlog', 'in-progress'],
    rows: [
      { label: 'under 7d', counts: [4, 1] },
      { label: '7-30d', counts: [2, 0] },
    ],
    ...overrides,
  };
}

test('shades each heatmap cell against the fullest cell and totals every row', async () => {
  const { agingHeatmapChart } = await import('../src/report-svg.js');
  const svg = agingHeatmapChart(agingMatrix());

  assert.match(svg, /viewBox="0 0 288 72"/);
  assert.match(svg, /<text class="chart-head" x="103" y="14" text-anchor="middle">backlog<\/text>/);
  assert.match(svg, /<text class="chart-head" x="251" y="14" text-anchor="middle">Total<\/text>/);
  // Peak 4: the fullest cell reaches 0.8, a quarter of it reaches 0.35.
  assert.match(svg, /<rect class="heat" x="68" y="22" width="70" height="22" fill-opacity="0\.8"><\/rect>/);
  assert.match(svg, /<rect class="heat" x="142" y="22" width="70" height="22" fill-opacity="0\.35"><\/rect>/);
  assert.match(svg, /<rect class="heat" x="68" y="48" width="70" height="22" fill-opacity="0\.5"><\/rect>/);
  assert.match(svg, /<rect class="heat" x="142" y="48" width="70" height="22" fill-opacity="0"><\/rect>/);
  assert.match(svg, /<text class="chart-total" x="251" y="38" text-anchor="middle">5<\/text>/);
  assert.match(svg, /<text class="chart-total" x="251" y="64" text-anchor="middle">2<\/text>/);
  assert.match(svg, /<title>backlog, under 7d: 4 open items<\/title>/);
  assert.match(svg, /<title>in-progress, 7-30d: 0 open items<\/title>/);
});

test('draws no heatmap when no open item is left to place', async () => {
  const { agingHeatmapChart } = await import('../src/report-svg.js');

  assert.equal(agingHeatmapChart({ statuses: [], rows: [] }), '');
  assert.equal(
    agingHeatmapChart({ statuses: ['backlog'], rows: [{ label: 'under 7d', counts: [0] }] }),
    '',
  );
});

test('runs the rolling mean over the closure bars, starting where it exists', async () => {
  const { throughputChart } = await import('../src/report-svg.js');
  const svg = throughputChart([
    { weekStart: '2026-07-20', arrivals: 0, closures: 0, done: 0, rolling: null },
    { weekStart: '2026-07-27', arrivals: 0, closures: 1, done: 0, rolling: null },
    { weekStart: '2026-08-03', arrivals: 0, closures: 2, done: 2, rolling: 1 },
    { weekStart: '2026-08-10', arrivals: 0, closures: 4, done: 3, rolling: 3 },
  ]);

  // Peak 4 over a 112px plot with a 126px baseline, four 169px slots.
  assert.match(svg, /<rect class="bar-closure" x="405\.8" y="70" width="101\.4" height="56"><\/rect>/);
  assert.match(svg, /<rect class="bar-closure" x="574\.8" y="14" width="101\.4" height="112"><\/rect>/);
  assert.match(svg, /<polyline class="rolling" points="456\.5,98 625\.5,42"><\/polyline>/);
  assert.match(svg, /<title>Week of 2026-08-10: 4 closures \(3 done\), 3 a week over the last 4<\/title>/);
  assert.match(svg, /<title>Week of 2026-07-27: 1 closure \(0 done\), no four-week mean yet<\/title>/);
});

test('withholds the rolling line until two weeks carry a mean', async () => {
  const { throughputChart } = await import('../src/report-svg.js');
  const svg = throughputChart([
    { weekStart: '2026-07-20', arrivals: 0, closures: 0, done: 0, rolling: null },
    { weekStart: '2026-07-27', arrivals: 0, closures: 1, done: 0, rolling: null },
    { weekStart: '2026-08-03', arrivals: 0, closures: 2, done: 2, rolling: null },
    { weekStart: '2026-08-10', arrivals: 0, closures: 4, done: 3, rolling: 1.75 },
  ]);

  assert.match(svg, /data-testid="chart-throughput"/);
  assert.doesNotMatch(svg, /<polyline/);
});

test('draws no throughput chart when the window recorded no closures', async () => {
  const { throughputChart } = await import('../src/report-svg.js');

  assert.equal(throughputChart([]), '');
  assert.equal(
    throughputChart([{ weekStart: '2026-08-10', arrivals: 3, closures: 0, done: 0, rolling: 0 }]),
    '',
  );
});

test('stacks the cumulative flow bands from terminal work upward', async () => {
  const { cumulativeFlowChart } = await import('../src/report-svg.js');
  const svg = cumulativeFlowChart([
    { date: '2026-08-12', triage: 1, accepted: 0, terminal: 0 },
    { date: '2026-08-13', triage: 1, accepted: 1, terminal: 0 },
    { date: '2026-08-14', triage: 0, accepted: 1, terminal: 2 },
  ]);

  // Peak 3 over a 134px plot with a 146px baseline, three points across 676px.
  assert.match(svg, /<polygon class="band-terminal" points="34,146 372,146 710,56\.67 710,146 372,146 34,146"><\/polygon>/);
  assert.match(svg, /<polygon class="band-accepted" points="34,146 372,101\.33 710,12 710,56\.67 372,146 34,146"><\/polygon>/);
  assert.match(svg, /<polygon class="band-triage" points="34,101\.33 372,56\.67 710,12 710,12 372,101\.33 34,146"><\/polygon>/);
  assert.match(svg, /<title>Terminal: 2 items on 2026-08-14<\/title>/);
  assert.match(svg, /<title>Untriaged: 0 items on 2026-08-14<\/title>/);
});

test('draws no cumulative flow when the window holds no item at all', async () => {
  const { cumulativeFlowChart } = await import('../src/report-svg.js');

  assert.equal(cumulativeFlowChart([]), '');
  assert.equal(cumulativeFlowChart([{ date: '2026-08-14', triage: 1, accepted: 0, terminal: 0 }]), '');
  assert.equal(cumulativeFlowChart([
    { date: '2026-08-13', triage: 0, accepted: 0, terminal: 0 },
    { date: '2026-08-14', triage: 0, accepted: 0, terminal: 0 },
  ]), '');
});

test('plots every cycle-time sample against its completion date', async () => {
  const { cycleTimeChart } = await import('../src/report-svg.js');
  const svg = cycleTimeChart({
    sampleCount: 3,
    medianDays: 2,
    p85Days: 4,
    samples: [
      { number: 2, completedOn: '2026-08-10', days: 0 },
      { number: 1, completedOn: '2026-08-12', days: 2 },
      { number: 3, completedOn: '2026-08-14', days: 4 },
    ],
  });

  // Four days of span across 676px, four days of cycle over a 134px plot.
  assert.match(svg, /<circle class="sample" cx="34" cy="146" r="3\.5"><\/circle>/);
  assert.match(svg, /<circle class="sample" cx="372" cy="79" r="3\.5"><\/circle>/);
  assert.match(svg, /<circle class="sample" cx="710" cy="12" r="3\.5"><\/circle>/);
  assert.match(svg, /<line class="percentile-50" x1="34" y1="79" x2="710" y2="79"><\/line>/);
  assert.match(svg, /<line class="percentile-85" x1="34" y1="12" x2="710" y2="12"><\/line>/);
  assert.match(svg, /<title>#2 completed 2026-08-10 after 0 days<\/title>/);
  assert.match(svg, /<title>#1 completed 2026-08-12 after 2 days<\/title>/);
});

test('plots same-day cycle-time samples without dividing by zero', async () => {
  const { cycleTimeChart } = await import('../src/report-svg.js');
  const svg = cycleTimeChart({
    sampleCount: 2,
    medianDays: 0,
    p85Days: 0,
    samples: [
      { number: 1, completedOn: '2026-08-14', days: 0 },
      { number: 2, completedOn: '2026-08-14', days: 0 },
    ],
  });

  assert.match(svg, /data-testid="chart-cycle-time"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('draws no cycle-time scatter without a single accept-to-complete sample', async () => {
  const { cycleTimeChart } = await import('../src/report-svg.js');

  assert.equal(
    cycleTimeChart({
      sampleCount: 0, medianDays: null, p85Days: null, samples: [],
    }),
    '',
  );
});

function fanForecast(overrides = {}) {
  return {
    remaining: 5,
    weeks50: 2,
    weeks85: 3,
    weeks95: 4,
    date50: '2026-08-28',
    date85: '2026-09-04',
    date95: '2026-09-11',
    distribution: [
      { weeks: 0, share: 0 },
      { weeks: 1, share: 0.25 },
      { weeks: 2, share: 0.5 },
      { weeks: 3, share: 0.86 },
      { weeks: 4, share: 0.96 },
    ],
    trials: 5000,
    ...overrides,
  };
}

test('draws the forecast as a closure-probability curve under three marks', async () => {
  const { forecastChart } = await import('../src/report-svg.js');
  const svg = forecastChart(fanForecast(), '2026-08-14');

  // 676px of plot over 4 weeks: 169px a week, 104px of height for 0 to 100%.
  assert.match(
    svg,
    /<path class="fan" d="M34,116L34,116L203,90L372,64L541,26\.56L710,16\.16L710,116Z"><\/path>/,
  );
  assert.match(svg, /<line class="mark-50" x1="372" y1="64" x2="372" y2="116"><\/line>/);
  assert.match(svg, /<line class="mark-85" x1="541" y1="26\.56" x2="541" y2="116"><\/line>/);
  assert.match(svg, /<line class="mark-95" x1="710" y1="16\.16" x2="710" y2="116"><\/line>/);
  assert.match(svg, /<title>50% of trials finish 5 items by 2026-08-28, 2 weeks from 2026-08-14<\/title>/);
  assert.match(svg, /<title>95% of trials finish 5 items by 2026-09-11, 4 weeks from 2026-08-14<\/title>/);
});

test('always ticks the newest week on the flow axis', async () => {
  const { weeklyFlowChart } = await import('../src/report-svg.js');
  const svg = weeklyFlowChart([
    { weekStart: '2026-07-27', arrivals: 1, closures: 0, done: 0 },
    { weekStart: '2026-08-03', arrivals: 1, closures: 0, done: 0 },
    { weekStart: '2026-08-10', arrivals: 1, closures: 0, done: 0 },
    { weekStart: '2026-08-17', arrivals: 1, closures: 0, done: 0 },
  ]);

  assert.deepEqual(svg.match(/>(\d\d-\d\d)</g), ['>08-03<', '>08-17<']);
});

test('plots a single week without NaN or Infinity coordinates', async () => {
  const { weeklyFlowChart } = await import('../src/report-svg.js');
  const svg = weeklyFlowChart([{ weekStart: '2026-08-10', arrivals: 1, closures: 0, done: 0 }]);

  assert.match(svg, /data-testid="chart-weekly-flow"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('plots a forecast whose percentiles coincide without NaN coordinates', async () => {
  const { forecastChart } = await import('../src/report-svg.js');
  const svg = forecastChart(fanForecast({
    weeks50: 2, weeks85: 2, weeks95: 2, date85: '2026-08-28', date95: '2026-08-28',
    distribution: [{ weeks: 0, share: 0 }, { weeks: 1, share: 0.4 }, { weeks: 2, share: 0.96 }],
  }), '2026-08-14');

  assert.match(svg, /data-testid="chart-forecast"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('names closures and done separately in the throughput titles', async () => {
  const { throughputChart } = await import('../src/report-svg.js');
  const svg = throughputChart([
    { weekStart: '2026-08-03', arrivals: 1, closures: 2, done: 1, partial: false, rolling: null },
    { weekStart: '2026-08-10', arrivals: 0, closures: 1, done: 1, partial: true, rolling: null },
  ]);

  assert.match(svg, /<title>Week of 2026-08-03: 2 closures \(1 done\), no four-week mean yet<\/title>/);
  assert.match(svg, /<title>Week of 2026-08-10: 1 closure \(1 done\), partial week, no four-week mean yet<\/title>/);
  assert.match(svg, /aria-label="Closures per week with a four-week mean\. 3 closures over 2 weeks\."/);
});

// The report inlines the evidence and chart sources into one script scope, so
// the two serializers must not declare the same top-level names.
test('composes with the evidence browser source in one script scope', async () => {
  const vm = await import('node:vm');
  const svg = await import('../src/report-svg.js');
  const evidence = await import('../src/report-evidence.js');
  const context = vm.createContext({});

  vm.runInContext(`${evidence.reportEvidenceBrowserSource()}\n${svg.reportSvgBrowserSource()}`, context);

  assert.equal(vm.runInContext('typeof throughputChart', context), 'function');
  assert.equal(vm.runInContext('typeof buildEvidence', context), 'function');
});

test('replays the same charts in the browser bundle as Node renders', async () => {
  const vm = await import('node:vm');
  const svg = await import('../src/report-svg.js');
  const context = vm.createContext({});
  vm.runInContext(svg.reportSvgBrowserSource(), context);

  const weeks = [
    { weekStart: '2026-08-03', arrivals: 2, closures: 1, done: 1, partial: false, rolling: 0.25 },
    { weekStart: '2026-08-10', arrivals: 0, closures: 3, done: 2, partial: false, rolling: 1 },
  ];
  const cycleTime = {
    sampleCount: 2,
    medianDays: 10,
    p85Days: 20,
    samples: [
      { number: 8, completedOn: '2026-08-10', days: 10 },
      { number: 9, completedOn: '2026-08-12', days: 20 },
    ],
  };
  const forecast = fanForecast();
  const matrix = {
    statuses: ['backlog'],
    rows: [{ label: 'under 7d', counts: [2] }],
  };
  const cases = {
    agingHeatmapChart: [matrix, { statuses: [], rows: [] }],
    throughputChart: [weeks, []],
    weeklyFlowChart: [weeks, []],
    cumulativeFlowChart: [
      [{ date: '2026-08-13', triage: 1, accepted: 1, terminal: 0 }],
      [],
    ],
    cycleTimeChart: [cycleTime, { sampleCount: 0, medianDays: null, p85Days: null, samples: [] }],
    forecastChart: [[forecast, '2026-08-14'], [null, '2026-08-14']],
  };
  for (const [name, inputs] of Object.entries(cases)) {
    for (const args of inputs) {
      const argv = name === 'forecastChart' ? args : [args];
      const expected = svg[name](...argv);
      vm.runInContext(`globalThis.__args = ${JSON.stringify(argv)};`, context);
      const actual = vm.runInContext(`(${name})(...globalThis.__args)`, context);
      assert.equal(actual, expected, name);
    }
  }
});
