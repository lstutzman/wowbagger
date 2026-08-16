// Hand-rolled inline SVG. No chart library, no external request, no client
// script: the charts are markup the generator emits, so the report stays one
// self-contained file and renders the same bytes for the same ledger.
//
// Every chart keeps its figures in the markup - axis text and `<title>` nodes -
// because a number that lives only in pixel geometry is a number the reader
// cannot check. A chart with nothing to plot returns the empty string; the
// caller keeps its numeric statement rather than showing an empty axis.

const CHART_WIDTH = 720;
const PLOT_LEFT = 34;
const PLOT_RIGHT = 10;

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Two decimals is finer than a pixel and keeps emitted coordinates identical
// across runs on every platform.
function coordinate(value) {
  return Math.round(value * 100) / 100;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const AGING_WIDTH = 300;
const AGING_ROW = 26;
const AGING_LABEL_WIDTH = 66;
const AGING_COUNT_WIDTH = 30;

// Open items by age, one horizontal bar per bucket. Horizontal because the
// bucket labels are words, and a word reads better beside a bar than under it.
export function agingBucketChart(buckets) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (buckets.length === 0 || total === 0) {
    return '';
  }

  const height = AGING_ROW * buckets.length;
  const trackWidth = AGING_WIDTH - AGING_LABEL_WIDTH - AGING_COUNT_WIDTH;
  // A zero total returned above, so at least one bucket is positive and the
  // peak can never be zero.
  const peak = Math.max(...buckets.map((bucket) => bucket.count));

  const rows = buckets.map((bucket, index) => {
    const top = index * AGING_ROW;
    const barWidth = (bucket.count / peak) * trackWidth;
    return `<g><title>${escapeText(bucket.label)}: ${plural(bucket.count, 'open item')}</title>`
      + `<text class="chart-label" x="0" y="${top + 17}">${escapeText(bucket.label)}</text>`
      + `<rect class="bar-aging" x="${AGING_LABEL_WIDTH}" y="${top + 6}" width="${coordinate(barWidth)}" height="14"></rect>`
      + `<text class="chart-value" x="${coordinate(AGING_LABEL_WIDTH + barWidth + 6)}" y="${top + 17}">${bucket.count}</text>`
      + '</g>';
  }).join('');

  return `<svg class="chart" data-testid="chart-aging" viewBox="0 0 ${AGING_WIDTH} ${height}" role="img" aria-label="Open items by age bucket. ${plural(total, 'open item')} in total.">${rows}</svg>`;
}

const FORECAST_HEIGHT = 62;
const FORECAST_TRACK_TOP = 12;
const FORECAST_TRACK_HEIGHT = 20;

// The forecast as elapsed time rather than one date: the solid band is where
// half the trials land, the pale band carries the run out to the 85th
// percentile. A forecast drawn as a single line reads as a promise.
export function forecastChart(forecast, asOf) {
  if (forecast === null || forecast.weeks85 === 0) {
    return '';
  }

  const trackWidth = CHART_WIDTH - PLOT_RIGHT;
  const scale = trackWidth / forecast.weeks85;
  const at50 = coordinate(forecast.weeks50 * scale);
  const baseline = FORECAST_TRACK_TOP + FORECAST_TRACK_HEIGHT;

  return `<svg class="chart" data-testid="chart-forecast" viewBox="0 0 ${CHART_WIDTH} ${FORECAST_HEIGHT}" role="img" aria-label="Forecast band for ${plural(forecast.remaining, 'remaining open item')}: 50% by ${escapeText(forecast.date50)}, 85% by ${escapeText(forecast.date85)}.">`
    + `<g><title>50% of trials finish ${plural(forecast.remaining, 'item')} by ${escapeText(forecast.date50)}, ${plural(forecast.weeks50, 'week')} from ${escapeText(asOf)}</title>`
    + `<rect class="band-50" x="0" y="${FORECAST_TRACK_TOP}" width="${at50}" height="${FORECAST_TRACK_HEIGHT}"></rect></g>`
    + `<g><title>85% of trials finish ${plural(forecast.remaining, 'item')} by ${escapeText(forecast.date85)}, ${plural(forecast.weeks85, 'week')} from ${escapeText(asOf)}</title>`
    + `<rect class="band-85" x="${at50}" y="${FORECAST_TRACK_TOP}" width="${coordinate(trackWidth - at50)}" height="${FORECAST_TRACK_HEIGHT}"></rect></g>`
    + `<line class="chart-marker" x1="${at50}" y1="${FORECAST_TRACK_TOP - 4}" x2="${at50}" y2="${baseline + 4}"></line>`
    + `<line class="chart-marker" x1="${coordinate(trackWidth)}" y1="${FORECAST_TRACK_TOP - 4}" x2="${coordinate(trackWidth)}" y2="${baseline + 4}"></line>`
    + `<text class="chart-tick" x="0" y="${baseline + 18}" text-anchor="start">${escapeText(asOf)}</text>`
    + `<text class="chart-value" x="${at50}" y="${baseline + 18}" text-anchor="middle">50% ${escapeText(forecast.date50)}</text>`
    + `<text class="chart-value" x="${coordinate(trackWidth)}" y="${baseline + 18}" text-anchor="end">85% ${escapeText(forecast.date85)}</text>`
    + '</svg>';
}

const FLOW_HEIGHT = 200;
const FLOW_TOP = 14;
const FLOW_BOTTOM = 34;

// Arrivals against completions, one grouped pair per week. The gap between the
// pairs is the backlog growing or shrinking, which is the only thing this
// chart exists to make visible.
export function weeklyFlowChart(weeks) {
  const total = weeks.reduce((sum, week) => sum + week.arrivals + week.completions, 0);
  if (weeks.length === 0 || total === 0) {
    return '';
  }

  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM;
  const baseline = FLOW_TOP + plotHeight;
  // A zero total returned above, so some week is positive and the peak can
  // never be zero. A single week divides just as cleanly as twelve.
  const peak = Math.max(...weeks.map((week) => Math.max(week.arrivals, week.completions)));
  const slot = plotWidth / weeks.length;
  const barWidth = slot * 0.32;

  const groups = weeks.map((week, index) => {
    const centre = PLOT_LEFT + slot * (index + 0.5);
    const arrivalHeight = (week.arrivals / peak) * plotHeight;
    const completionHeight = (week.completions / peak) * plotHeight;
    // Tick every other week, counted back from the newest: the most recent
    // week is the one a reader looks for first, so it always carries a date.
    const label = (weeks.length - 1 - index) % 2 === 0
      ? `<text class="chart-tick" x="${coordinate(centre)}" y="${baseline + 15}" text-anchor="middle">${escapeText(week.weekStart.slice(5))}</text>`
      : '';
    return `<g><title>Week of ${escapeText(week.weekStart)}: ${plural(week.arrivals, 'arrival')}, ${plural(week.completions, 'completion')}</title>`
      + `<rect class="bar-arrival" x="${coordinate(centre - barWidth - 1)}" y="${coordinate(baseline - arrivalHeight)}" width="${coordinate(barWidth)}" height="${coordinate(arrivalHeight)}"></rect>`
      + `<rect class="bar-completion" x="${coordinate(centre + 1)}" y="${coordinate(baseline - completionHeight)}" width="${coordinate(barWidth)}" height="${coordinate(completionHeight)}"></rect>`
      + `</g>${label}`;
  }).join('');

  return `<svg class="chart" data-testid="chart-weekly-flow" viewBox="0 0 ${CHART_WIDTH} ${FLOW_HEIGHT}" role="img" aria-label="Arrivals against completions per week. Peak ${peak} items in a week.">`
    + `<line class="chart-grid" x1="${PLOT_LEFT}" y1="${FLOW_TOP}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${FLOW_TOP}"></line>`
    + `<line class="chart-axis" x1="${PLOT_LEFT}" y1="${baseline}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${baseline}"></line>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${FLOW_TOP + 4}" text-anchor="end">${peak}</text>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${baseline + 4}" text-anchor="end">0</text>`
    + `${groups}</svg>`;
}
