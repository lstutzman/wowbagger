import test from 'node:test';
import assert from 'node:assert/strict';

test('escapes every label it is handed instead of trusting the caller', async () => {
  const { agingBucketChart } = await import('../src/report-svg.js');
  const svg = agingBucketChart([{ label: '</title><script>alert(1)</script> & "x"', count: 1 }]);

  assert.doesNotMatch(svg, /<script>|<\/title><script/);
  assert.match(svg, /&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/);
});

test('escapes the as-of date the forecast band prints', async () => {
  const { forecastChart } = await import('../src/report-svg.js');
  const forecast = {
    remaining: 1, weeks50: 1, weeks85: 2, date50: '2026-08-21', date85: '2026-08-28', trials: 5000,
  };
  const svg = forecastChart(forecast, '<img src=x>');

  assert.doesNotMatch(svg, /<img src=x>/);
  assert.match(svg, /&lt;img src=x&gt;/);
});

test('scales each weekly bar against the tallest week in the series', async () => {
  const { weeklyFlowChart } = await import('../src/report-svg.js');
  const svg = weeklyFlowChart([
    { weekStart: '2026-08-03', arrivals: 2, completions: 1 },
    { weekStart: '2026-08-10', arrivals: 0, completions: 4 },
  ]);

  // Peak 4 over a 152px plot with a 166px baseline: half-height arrivals,
  // quarter-height completions, then a full-height completion week.
  assert.match(svg, /<rect class="bar-arrival" x="93\.84" y="90" width="108\.16" height="76"><\/rect>/);
  assert.match(svg, /<rect class="bar-completion" x="204" y="128" width="108\.16" height="38"><\/rect>/);
  assert.match(svg, /<rect class="bar-arrival" x="431\.84" y="166" width="108\.16" height="0"><\/rect>/);
  assert.match(svg, /<rect class="bar-completion" x="542" y="14" width="108\.16" height="152"><\/rect>/);
});

test('scales each aging bar against the fullest bucket and prints its count', async () => {
  const { agingBucketChart } = await import('../src/report-svg.js');
  const svg = agingBucketChart([
    { label: 'under 7d', count: 1 },
    { label: '7-30d', count: 4 },
  ]);

  // Peak 4 over a 204px track: a quarter-width bar, then a full-width bar.
  assert.match(svg, /<rect class="bar-aging" x="66" y="6" width="51" height="14"><\/rect>/);
  assert.match(svg, /<text class="chart-value" x="123" y="17">1<\/text>/);
  assert.match(svg, /<rect class="bar-aging" x="66" y="32" width="204" height="14"><\/rect>/);
  assert.match(svg, /<text class="chart-value" x="276" y="43">4<\/text>/);
});

test('splits the forecast track at the median and runs it out to p85', async () => {
  const { forecastChart } = await import('../src/report-svg.js');
  const forecast = {
    remaining: 5, weeks50: 1, weeks85: 2, date50: '2026-08-21', date85: '2026-08-28', trials: 5000,
  };
  const svg = forecastChart(forecast, '2026-08-14');

  // A 710px track over 2 weeks puts the median mark at the halfway point.
  assert.match(svg, /<rect class="band-50" x="0" y="12" width="355" height="20"><\/rect>/);
  assert.match(svg, /<rect class="band-85" x="355" y="12" width="355" height="20"><\/rect>/);
  assert.match(svg, /<text class="chart-value" x="355" y="50" text-anchor="middle">50% 2026-08-21<\/text>/);
  assert.match(svg, /<text class="chart-value" x="710" y="50" text-anchor="end">85% 2026-08-28<\/text>/);
});

test('always ticks the newest week on the flow axis', async () => {
  const { weeklyFlowChart } = await import('../src/report-svg.js');
  const svg = weeklyFlowChart([
    { weekStart: '2026-07-27', arrivals: 1, completions: 0 },
    { weekStart: '2026-08-03', arrivals: 1, completions: 0 },
    { weekStart: '2026-08-10', arrivals: 1, completions: 0 },
    { weekStart: '2026-08-17', arrivals: 1, completions: 0 },
  ]);

  assert.deepEqual(svg.match(/>(\d\d-\d\d)</g), ['>08-03<', '>08-17<']);
});

test('plots a single week without NaN or Infinity coordinates', async () => {
  const { weeklyFlowChart } = await import('../src/report-svg.js');
  const svg = weeklyFlowChart([{ weekStart: '2026-08-10', arrivals: 1, completions: 0 }]);

  assert.match(svg, /data-testid="chart-weekly-flow"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('plots a forecast whose percentiles coincide without NaN coordinates', async () => {
  const { forecastChart } = await import('../src/report-svg.js');
  const forecast = {
    remaining: 3, weeks50: 2, weeks85: 2, date50: '2026-08-28', date85: '2026-08-28', trials: 5000,
  };
  const svg = forecastChart(forecast, '2026-08-14');

  assert.match(svg, /data-testid="chart-forecast"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
