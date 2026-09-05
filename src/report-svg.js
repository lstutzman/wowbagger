// Hand-rolled inline SVG. No chart library, no external request, no client
// script: the charts are markup the generator emits, so the report stays one
// self-contained file and renders the same bytes for the same ledger.
//
// Every chart keeps its figures in the markup - axis text and `<title>` nodes -
// because a number that lives only in pixel geometry is a number the reader
// cannot check. A chart with nothing to plot returns the empty string; the
// caller keeps its numeric statement rather than showing an empty axis.

const CHART_WIDTH = 720;
// The mean the evidence layer computes; named here only so the tooltip can say
// how long a window it covers.
const ROLLING_WEEKS = 4;
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

const HEAT_LABEL_WIDTH = 66;
const HEAT_CELL_WIDTH = 74;
const HEAT_ROW = 26;
const HEAT_HEADER = 20;
// A pale cell still has to be visible, and the darkest still has to hold black
// text, so the ramp runs between the two rather than across the full range.
const HEAT_FLOOR = 0.2;
const HEAT_RANGE = 0.6;

// Age crossed with status. How long work has waited is only half the question;
// the other half is whether it is waiting untriaged, unstarted, or started and
// stalled. The trailing Total column keeps the plain bucket count readable.
export function agingHeatmapChart(matrix) {
  const cellCounts = matrix.rows.flatMap((row) => row.counts);
  if (matrix.statuses.length === 0 || cellCounts.reduce((sum, count) => sum + count, 0) === 0) {
    return '';
  }

  const width = HEAT_LABEL_WIDTH + (matrix.statuses.length + 1) * HEAT_CELL_WIDTH;
  const height = HEAT_HEADER + matrix.rows.length * HEAT_ROW;
  // A zero total returned above, so at least one cell is positive.
  const peak = Math.max(...cellCounts);
  const columnCentre = (index) => HEAT_LABEL_WIDTH + index * HEAT_CELL_WIDTH + HEAT_CELL_WIDTH / 2;

  const headings = [...matrix.statuses, 'Total']
    .map((label, index) => `<text class="chart-head" x="${columnCentre(index)}" y="14" text-anchor="middle">${escapeText(label)}</text>`)
    .join('');

  const rows = matrix.rows.map((row, rowIndex) => {
    const top = HEAT_HEADER + rowIndex * HEAT_ROW;
    const cells = row.counts.map((count, columnIndex) => {
      const opacity = count === 0 ? 0 : coordinate(HEAT_FLOOR + HEAT_RANGE * (count / peak));
      return `<g><title>${escapeText(matrix.statuses[columnIndex])}, ${escapeText(row.label)}: ${plural(count, 'open item')}</title>`
        + `<rect class="heat" x="${HEAT_LABEL_WIDTH + columnIndex * HEAT_CELL_WIDTH + 2}" y="${top + 2}" width="${HEAT_CELL_WIDTH - 4}" height="${HEAT_ROW - 4}" fill-opacity="${opacity}"></rect>`
        + `<text class="chart-value" x="${columnCentre(columnIndex)}" y="${top + 18}" text-anchor="middle">${count}</text>`
        + '</g>';
    }).join('');
    const total = row.counts.reduce((sum, count) => sum + count, 0);
    return `<text class="chart-label" x="0" y="${top + 18}">${escapeText(row.label)}</text>${cells}`
      + `<text class="chart-total" x="${columnCentre(matrix.statuses.length)}" y="${top + 18}" text-anchor="middle">${total}</text>`;
  }).join('');

  return `<svg class="chart chart-compact" data-testid="chart-aging-heatmap" viewBox="0 0 ${width} ${height}" role="img" aria-label="Open items by age bucket and status. ${plural(cellCounts.reduce((sum, count) => sum + count, 0), 'open item')} in total.">${headings}${rows}</svg>`;
}

const THROUGHPUT_HEIGHT = 160;
const THROUGHPUT_TOP = 14;
const THROUGHPUT_BOTTOM = 34;

// Closures per week with a four-week mean over them. Weekly throughput is
// noisy enough that the bars alone invite a story about last week; the mean is
// the line that tells whether the ledger is actually speeding up. The mean is
// a closure rate: it counts every departure, not delivered work alone.
export function throughputChart(weeks) {
  const total = weeks.reduce((sum, week) => sum + week.closures, 0);
  if (weeks.length === 0 || total === 0) {
    return '';
  }

  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = THROUGHPUT_HEIGHT - THROUGHPUT_TOP - THROUGHPUT_BOTTOM;
  const baseline = THROUGHPUT_TOP + plotHeight;
  // The mean can never exceed the tallest week, so the bars set the scale.
  const peak = Math.max(...weeks.map((week) => week.closures));
  const slot = plotWidth / weeks.length;
  const barWidth = slot * 0.6;
  const centre = (index) => PLOT_LEFT + slot * (index + 0.5);
  const atCount = (count) => coordinate(baseline - (count / peak) * plotHeight);

  const bars = weeks.map((week, index) => {
    const mean = week.rolling === null
      ? 'no four-week mean yet'
      : `${week.rolling} a week over the last ${ROLLING_WEEKS}`;
    const scope = week.partial === true ? ', partial week' : '';
    const label = (weeks.length - 1 - index) % 2 === 0
      ? `<text class="chart-tick" x="${coordinate(centre(index))}" y="${baseline + 15}" text-anchor="middle">${escapeText(week.weekStart.slice(5))}</text>`
      : '';
    return `<g><title>Week of ${escapeText(week.weekStart)}: ${plural(week.closures, 'closure')} (${week.done ?? 0} done)${scope}, ${mean}</title>`
      + `<rect class="bar-closure" x="${coordinate(centre(index) - barWidth / 2)}" y="${atCount(week.closures)}" width="${coordinate(barWidth)}" height="${coordinate((week.closures / peak) * plotHeight)}"></rect>`
      + `</g>${label}`;
  }).join('');

  const meanPoints = weeks
    .map((week, index) => (week.rolling === null
      ? null
      : `${coordinate(centre(index))},${atCount(week.rolling)}`))
    .filter((point) => point !== null);
  // Two points make a line. One would emit an invisible polyline, which is a
  // chart element claiming to say something it cannot.
  const meanLine = meanPoints.length < 2
    ? ''
    : `<polyline class="rolling" points="${meanPoints.join(' ')}"></polyline>`;

  return `<svg class="chart" data-testid="chart-throughput" viewBox="0 0 ${CHART_WIDTH} ${THROUGHPUT_HEIGHT}" role="img" aria-label="Closures per week with a four-week mean. ${plural(total, 'closure')} over ${plural(weeks.length, 'week')}.">`
    + `<line class="chart-grid" x1="${PLOT_LEFT}" y1="${THROUGHPUT_TOP}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${THROUGHPUT_TOP}"></line>`
    + `<line class="chart-axis" x1="${PLOT_LEFT}" y1="${baseline}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${baseline}"></line>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${THROUGHPUT_TOP + 4}" text-anchor="end">${peak}</text>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${baseline + 4}" text-anchor="end">0</text>`
    + `${bars}${meanLine}</svg>`;
}

const FLOW_AREA_HEIGHT = 180;
const FLOW_AREA_TOP = 12;
const FLOW_AREA_BOTTOM = 34;
// Terminal first: a cumulative flow diagram reads bottom-up, and finished work
// is the floor everything else stands on.
const FLOW_BANDS = [
  { key: 'terminal', className: 'band-terminal', label: 'Terminal' },
  { key: 'accepted', className: 'band-accepted', label: 'Accepted' },
  { key: 'triage', className: 'band-triage', label: 'Untriaged' },
];

// Cumulative flow: every item the ledger has ever held, stacked by the state it
// was in on each day. The width of a band is inventory; the slope of its top
// edge is arrival rate. A band that widens while the one below it stays flat is
// work piling up.
export function cumulativeFlowChart(points) {
  const peak = points.reduce(
    (highest, point) => Math.max(highest, point.triage + point.accepted + point.terminal),
    0,
  );
  // Two points make an area. One would be a vertical line pretending to be a
  // trend, and a zero peak means the window holds nothing to stack.
  if (points.length < 2 || peak === 0) {
    return '';
  }

  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = FLOW_AREA_HEIGHT - FLOW_AREA_TOP - FLOW_AREA_BOTTOM;
  const baseline = FLOW_AREA_TOP + plotHeight;
  const atIndex = (index) => coordinate(PLOT_LEFT + (index / (points.length - 1)) * plotWidth);
  const atCount = (count) => coordinate(baseline - (count / peak) * plotHeight);

  let floors = points.map(() => 0);
  const bands = FLOW_BANDS.map((band) => {
    const tops = points.map((point, index) => floors[index] + point[band.key]);
    const upper = tops.map((top, index) => `${atIndex(index)},${atCount(top)}`);
    const lower = floors.map((floor, index) => `${atIndex(index)},${atCount(floor)}`).reverse();
    floors = tops;
    return `<g><title>${band.label}: ${plural(points.at(-1)[band.key], 'item')} on ${escapeText(points.at(-1).date)}</title>`
      + `<polygon class="${band.className}" points="${[...upper, ...lower].join(' ')}"></polygon></g>`;
  }).join('');

  return `<svg class="chart" data-testid="chart-cumulative-flow" viewBox="0 0 ${CHART_WIDTH} ${FLOW_AREA_HEIGHT}" role="img" aria-label="Every item stacked by state, day by day. ${plural(peak, 'item')} at the widest.">`
    + `<line class="chart-axis" x1="${PLOT_LEFT}" y1="${baseline}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${baseline}"></line>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${FLOW_AREA_TOP + 4}" text-anchor="end">${peak}</text>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${baseline + 4}" text-anchor="end">0</text>`
    + bands
    + `<text class="chart-tick" x="${PLOT_LEFT}" y="${baseline + 15}" text-anchor="start">${escapeText(points.at(0).date)}</text>`
    + `<text class="chart-tick" x="${CHART_WIDTH - PLOT_RIGHT}" y="${baseline + 15}" text-anchor="end">${escapeText(points.at(-1).date)}</text>`
    + '</svg>';
}

const SCATTER_HEIGHT = 180;
const SCATTER_TOP = 12;
const SCATTER_BOTTOM = 34;
const MILLISECONDS_PER_DAY = 86400000;

function dayNumber(date) {
  return Date.parse(`${date}T00:00:00Z`) / MILLISECONDS_PER_DAY;
}

// Every finished item as one dot: how long it took against when it finished.
// Two percentile lines are the summary the report already prints; the dots say
// whether that summary describes a tight cluster or the middle of a spread.
export function cycleTimeChart(cycleTime) {
  if (cycleTime.samples.length === 0) {
    return '';
  }

  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = SCATTER_HEIGHT - SCATTER_TOP - SCATTER_BOTTOM;
  const baseline = SCATTER_TOP + plotHeight;
  const days = cycleTime.samples.map((sample) => dayNumber(sample.completedOn));
  const firstDay = Math.min(...days);
  // A ledger can finish everything on one day, and every sample can take zero
  // days. Both spans are real, and both would divide by zero, so each falls
  // back to one unit: the dots then sit on a single column or a single row,
  // which is exactly what happened.
  const daySpan = Math.max(1, Math.max(...days) - firstDay);
  const peak = Math.max(1, ...cycleTime.samples.map((sample) => sample.days));
  const atDay = (day) => coordinate(PLOT_LEFT + ((day - firstDay) / daySpan) * plotWidth);
  const atDuration = (duration) => coordinate(baseline - (duration / peak) * plotHeight);

  const dots = cycleTime.samples.map((sample, index) => {
    const handle = sample.number === null ? 'An item' : `#${sample.number}`;
    return `<g><title>${escapeText(handle)} completed ${escapeText(sample.completedOn)} after ${plural(sample.days, 'day')}</title>`
      + `<circle class="sample" cx="${atDay(days[index])}" cy="${atDuration(sample.days)}" r="3.5"></circle></g>`;
  }).join('');

  const percentiles = [
    { className: 'percentile-50', value: cycleTime.medianDays, label: 'median' },
    { className: 'percentile-85', value: cycleTime.p85Days, label: 'p85' },
  ].map((line) => `<g><title>${line.label} ${plural(line.value, 'day')}</title>`
    + `<line class="${line.className}" x1="${PLOT_LEFT}" y1="${atDuration(line.value)}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${atDuration(line.value)}"></line></g>`).join('');

  return `<svg class="chart" data-testid="chart-cycle-time" viewBox="0 0 ${CHART_WIDTH} ${SCATTER_HEIGHT}" role="img" aria-label="Accept-to-complete days for ${plural(cycleTime.sampleCount, 'finished item')}. Median ${cycleTime.medianDays}, p85 ${cycleTime.p85Days}.">`
    + `<line class="chart-axis" x1="${PLOT_LEFT}" y1="${baseline}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${baseline}"></line>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${SCATTER_TOP + 4}" text-anchor="end">${peak}d</text>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${baseline + 4}" text-anchor="end">0d</text>`
    + percentiles
    + dots
    + `<text class="chart-tick" x="${PLOT_LEFT}" y="${baseline + 15}" text-anchor="start">${escapeText(cycleTime.samples.at(0).completedOn)}</text>`
    + `<text class="chart-tick" x="${CHART_WIDTH - PLOT_RIGHT}" y="${baseline + 15}" text-anchor="end">${escapeText(cycleTime.samples.at(-1).completedOn)}</text>`
    + '</svg>';
}

const FORECAST_HEIGHT = 150;
const FORECAST_TOP = 12;
const FORECAST_BOTTOM = 34;
const FORECAST_MARKS = [
  { share: 0.5, weeksKey: 'weeks50', dateKey: 'date50' },
  { share: 0.85, weeksKey: 'weeks85', dateKey: 'date85' },
  { share: 0.95, weeksKey: 'weeks95', dateKey: 'date95' },
];

// The Monte Carlo fan: the share of trials that finish the remaining work by
// each elapsed week, with the three percentile marks standing on the curve.
// The three dates say where the band edges are; the slope between them says
// how steeply the odds climb, which is what separates a tight forecast from a
// wide one that happens to share the same median.
export function forecastChart(forecast, asOf) {
  if (forecast === null || forecast.weeks95 === 0) {
    return '';
  }

  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = FORECAST_HEIGHT - FORECAST_TOP - FORECAST_BOTTOM;
  const baseline = FORECAST_TOP + plotHeight;
  const atWeek = (weeks) => coordinate(PLOT_LEFT + (weeks / forecast.weeks95) * plotWidth);
  const atShare = (share) => coordinate(FORECAST_TOP + (1 - share) * plotHeight);

  const curve = forecast.distribution
    .map((point) => `L${atWeek(point.weeks)},${atShare(point.share)}`)
    .join('');
  // A mark stands on the curve, not at its nominal share: nearest-rank
  // percentiles land on the first week at or above the share, so the curve is
  // usually a little higher there. Drawing the nominal height would float the
  // mark off the line it is supposed to be reading.
  const shareAt = (weeks) => forecast.distribution
    .find((point) => point.weeks === weeks)?.share ?? 1;
  const marks = FORECAST_MARKS.map((mark) => {
    const weeks = forecast[mark.weeksKey];
    const x = atWeek(weeks);
    const y = atShare(shareAt(weeks));
    const percent = Math.round(mark.share * 100);
    return `<g><title>${percent}% of trials finish ${plural(forecast.remaining, 'item')} by ${escapeText(forecast[mark.dateKey])}, ${plural(weeks, 'week')} from ${escapeText(asOf)}</title>`
      + `<line class="mark-${percent}" x1="${x}" y1="${y}" x2="${x}" y2="${baseline}"></line>`
      // The 95th percentile mark sits on the right edge, where a centred label
      // would hang half of itself outside the viewBox and be clipped.
      + `<text class="chart-value" x="${x}" y="${coordinate(y - 5)}" text-anchor="${x > CHART_WIDTH - 30 ? 'end' : 'middle'}">${percent}%</text>`
      + '</g>';
  }).join('');

  return `<svg class="chart" data-testid="chart-forecast" viewBox="0 0 ${CHART_WIDTH} ${FORECAST_HEIGHT}" role="img" aria-label="Chance of finishing ${plural(forecast.remaining, 'remaining open item')} by each week: 50% by ${escapeText(forecast.date50)}, 85% by ${escapeText(forecast.date85)}, 95% by ${escapeText(forecast.date95)}.">`
    + `<line class="chart-grid" x1="${PLOT_LEFT}" y1="${FORECAST_TOP}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${FORECAST_TOP}"></line>`
    + `<line class="chart-axis" x1="${PLOT_LEFT}" y1="${baseline}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${baseline}"></line>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${FORECAST_TOP + 4}" text-anchor="end">100%</text>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${baseline + 4}" text-anchor="end">0%</text>`
    + `<path class="fan" d="M${atWeek(0)},${baseline}${curve}L${atWeek(forecast.weeks95)},${baseline}Z"></path>`
    + marks
    + `<text class="chart-tick" x="${PLOT_LEFT}" y="${baseline + 15}" text-anchor="start">${escapeText(asOf)}</text>`
    + `<text class="chart-tick" x="${CHART_WIDTH - PLOT_RIGHT}" y="${baseline + 15}" text-anchor="end">${plural(forecast.weeks95, 'week')} on</text>`
    + '</svg>';
}

const FLOW_HEIGHT = 200;
const FLOW_TOP = 14;
const FLOW_BOTTOM = 34;

// Arrivals against closures, one grouped pair per week. The gap between the
// pairs is the backlog growing or shrinking, which is the only thing this
// chart exists to make visible.
export function weeklyFlowChart(weeks) {
  const total = weeks.reduce((sum, week) => sum + week.arrivals + week.closures, 0);
  if (weeks.length === 0 || total === 0) {
    return '';
  }

  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM;
  const baseline = FLOW_TOP + plotHeight;
  // A zero total returned above, so some week is positive and the peak can
  // never be zero. A single week divides just as cleanly as twelve.
  const peak = Math.max(...weeks.map((week) => Math.max(week.arrivals, week.closures)));
  const slot = plotWidth / weeks.length;
  const barWidth = slot * 0.32;

  const groups = weeks.map((week, index) => {
    const centre = PLOT_LEFT + slot * (index + 0.5);
    const arrivalHeight = (week.arrivals / peak) * plotHeight;
    const closureHeight = (week.closures / peak) * plotHeight;
    // Tick every other week, counted back from the newest: the most recent
    // week is the one a reader looks for first, so it always carries a date.
    const label = (weeks.length - 1 - index) % 2 === 0
      ? `<text class="chart-tick" x="${coordinate(centre)}" y="${baseline + 15}" text-anchor="middle">${escapeText(week.weekStart.slice(5))}</text>`
      : '';
    const scope = week.partial === true ? ', partial week' : '';
    return `<g><title>Week of ${escapeText(week.weekStart)}: ${plural(week.arrivals, 'arrival')}, ${plural(week.closures, 'closure')}${scope}</title>`
      + `<rect class="bar-arrival" x="${coordinate(centre - barWidth - 1)}" y="${coordinate(baseline - arrivalHeight)}" width="${coordinate(barWidth)}" height="${coordinate(arrivalHeight)}"></rect>`
      + `<rect class="bar-closure" x="${coordinate(centre + 1)}" y="${coordinate(baseline - closureHeight)}" width="${coordinate(barWidth)}" height="${coordinate(closureHeight)}"></rect>`
      + `</g>${label}`;
  }).join('');

  return `<svg class="chart" data-testid="chart-weekly-flow" viewBox="0 0 ${CHART_WIDTH} ${FLOW_HEIGHT}" role="img" aria-label="Arrivals against closures per week. Peak ${peak} items in a week.">`
    + `<line class="chart-grid" x1="${PLOT_LEFT}" y1="${FLOW_TOP}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${FLOW_TOP}"></line>`
    + `<line class="chart-axis" x1="${PLOT_LEFT}" y1="${baseline}" x2="${CHART_WIDTH - PLOT_RIGHT}" y2="${baseline}"></line>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${FLOW_TOP + 4}" text-anchor="end">${peak}</text>`
    + `<text class="chart-tick" x="${PLOT_LEFT - 6}" y="${baseline + 4}" text-anchor="end">0</text>`
    + `${groups}</svg>`;
}

// The charts the browser re-renders, serialized from the same functions Node
// executes above. Tested for runtime parity against the direct functions in a
// VM: the browser never carries a second formula.
function browserChartSource(fn) {
  return fn.toString().replace(/^export\s+/, '');
}

export function reportSvgBrowserSource() {
  return [
    `const CHART_WIDTH = ${CHART_WIDTH};`,
    `const ROLLING_WEEKS = ${ROLLING_WEEKS};`,
    `const PLOT_LEFT = ${PLOT_LEFT};`,
    `const PLOT_RIGHT = ${PLOT_RIGHT};`,
    `const HEAT_LABEL_WIDTH = ${HEAT_LABEL_WIDTH};`,
    `const HEAT_CELL_WIDTH = ${HEAT_CELL_WIDTH};`,
    `const HEAT_ROW = ${HEAT_ROW};`,
    `const HEAT_HEADER = ${HEAT_HEADER};`,
    `const HEAT_FLOOR = ${HEAT_FLOOR};`,
    `const HEAT_RANGE = ${HEAT_RANGE};`,
    `const THROUGHPUT_HEIGHT = ${THROUGHPUT_HEIGHT};`,
    `const THROUGHPUT_TOP = ${THROUGHPUT_TOP};`,
    `const THROUGHPUT_BOTTOM = ${THROUGHPUT_BOTTOM};`,
    `const FLOW_AREA_HEIGHT = ${FLOW_AREA_HEIGHT};`,
    `const FLOW_AREA_TOP = ${FLOW_AREA_TOP};`,
    `const FLOW_AREA_BOTTOM = ${FLOW_AREA_BOTTOM};`,
    `const FLOW_BANDS = ${JSON.stringify(FLOW_BANDS)};`,
    `const SCATTER_HEIGHT = ${SCATTER_HEIGHT};`,
    `const SCATTER_TOP = ${SCATTER_TOP};`,
    `const SCATTER_BOTTOM = ${SCATTER_BOTTOM};`,
    `const MILLISECONDS_PER_DAY = ${MILLISECONDS_PER_DAY};`,
    `const FORECAST_HEIGHT = ${FORECAST_HEIGHT};`,
    `const FORECAST_TOP = ${FORECAST_TOP};`,
    `const FORECAST_BOTTOM = ${FORECAST_BOTTOM};`,
    `const FORECAST_MARKS = ${JSON.stringify(FORECAST_MARKS)};`,
    `const FLOW_HEIGHT = ${FLOW_HEIGHT};`,
    `const FLOW_TOP = ${FLOW_TOP};`,
    `const FLOW_BOTTOM = ${FLOW_BOTTOM};`,
    browserChartSource(escapeText),
    browserChartSource(coordinate),
    browserChartSource(plural),
    browserChartSource(agingHeatmapChart),
    browserChartSource(throughputChart),
    browserChartSource(cumulativeFlowChart),
    browserChartSource(dayNumber),
    browserChartSource(cycleTimeChart),
    browserChartSource(forecastChart),
    browserChartSource(weeklyFlowChart),
  ].join('\n');
}
