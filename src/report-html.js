import { markdownBrowserSource } from './report-markdown.js';
import { READINESS_REASON_LABELS } from './report.js';
import { reportFieldValues } from './report-view.js';
import { reportSelectionBrowserSource } from './report-selection.js';
import {
  buildGraphModel,
  graphClientSource,
  graphSection,
  graphStyleSource,
} from './report-graph.js';
import {
  agingHeatmapChart,
  cumulativeFlowChart,
  cycleTimeChart,
  forecastChart,
  throughputChart,
  weeklyFlowChart,
} from './report-svg.js';

const READINESS_LABELS = {
  ready: 'Ready',
  blocked: 'Blocked',
  ineligible: 'Ineligible',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function fieldLabel(name) {
  return name.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function renderBadges(item) {
  const badges = [
    `<span class="badge state-${escapeHtml(item.readiness.state)}">${READINESS_LABELS[item.readiness.state]}</span>`,
    `<span class="badge">${escapeHtml(item.status)}</span>`,
  ];
  if (item.priority !== null) {
    badges.push(`<span class="badge">Priority ${escapeHtml(item.priority)}</span>`);
  }
  for (const [name, value] of Object.entries(item.fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        badges.push(`<span class="badge mapped">${escapeHtml(fieldLabel(name))}: ${escapeHtml(entry)}</span>`);
      }
    } else {
      badges.push(`<span class="badge mapped">${escapeHtml(fieldLabel(name))}: ${escapeHtml(value)}</span>`);
    }
  }
  return badges.join('');
}

function renderReasons(item, itemNumbers) {
  if (item.readiness.reasons.length === 0) {
    return '<span class="muted">No blockers.</span>';
  }
  return `<ul class="reasons">${item.readiness.reasons.map((reason) => {
    const label = READINESS_REASON_LABELS[reason.code] ?? reason.code;
    const related = reason.item_id === undefined ? '' : `: ${escapeHtml(handleFor(reason.item_id, itemNumbers))}`;
    return `<li>${escapeHtml(label)}${related}</li>`;
  }).join('')}</ul>`;
}

// An item the ledger numbers is named by that number, whether or not this
// report carries a row for it: the complete-ledger lookup is what keeps a
// filtered view from degrading an excluded reference to a raw ID. An ID with
// no number is either a schema-1 item or a dangling reference, and the raw ID
// is then the only handle there is.
function handleFor(id, itemNumbers) {
  const number = Object.prototype.hasOwnProperty.call(itemNumbers, id) ? itemNumbers[id] : null;
  return number === null ? id : `#${number}`;
}

function renderRelations(item, itemNumbers, retainedIds) {
  const rows = [
    ['Parent', item.parent === null ? [] : [item.parent]],
    ['Depends on', item.dependsOn],
    ['Related', item.related],
  ].filter(([, values]) => values.length > 0);
  if (rows.length === 0) {
    return '<span class="muted">No relations.</span>';
  }
  return `<dl class="relations">${rows.map(([label, values]) => `<dt>${label}</dt><dd>${values.map((value) => relationCell(value, itemNumbers, retainedIds)).join(', ')}</dd>`).join('')}</dl>`;
}

// A relation inside the artifact is a way into its canonical detail. A value
// outside the artifact names what the complete ledger knows and states
// explicitly that this report does not include it.
function relationCell(id, itemNumbers, retainedIds) {
  const handle = handleFor(id, itemNumbers);
  if (retainedIds !== undefined && !retainedIds.has(id)) {
    return `${escapeHtml(handle)} (not included in this report)`;
  }
  if (retainedIds === undefined && !Object.prototype.hasOwnProperty.call(itemNumbers, id)) {
    return `${escapeHtml(handle)} (not included in this report)`;
  }
  if (retainedIds !== undefined) {
    const anchor = anchorForId(id, itemNumbers);
    return `<a href="#${escapeHtml(anchor)}" data-reveal="${escapeHtml(anchor)}" data-inspect="${escapeHtml(id)}">${escapeHtml(handle)}</a>`;
  }
  return escapeHtml(handle);
}

function anchorForId(id, itemNumbers) {
  const number = Object.prototype.hasOwnProperty.call(itemNumbers, id) ? itemNumbers[id] : null;
  return `item-${number === null ? id : number}`;
}

function renderDecisions(item) {
  if (item.decisions.length === 0) {
    return '<span class="muted">No decisions.</span>';
  }
  return `<ol class="decisions">${item.decisions.map((decision) => `<li><strong>${escapeHtml(decision.action)}</strong> · ${escapeHtml(decision.date)}<br>${escapeHtml(decision.summary)}<br><span class="muted">${escapeHtml(decision.rationale)}</span></li>`).join('')}</ol>`;
}

function bodyExcerpt(body, limit = 220) {
  const compact = String(body).replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3)}...`;
}

// Standard mode has to change a shut card, so the summary states the facts the
// badges cannot: what kind of item it is, when it last moved, and how much
// relation and decision weight the drill-down holds.
function summaryContext(item) {
  const relations = (item.parent === null ? 0 : 1) + item.dependsOn.length + item.related.length;
  const parts = [item.kind, `updated ${item.updated}`];
  if (relations > 0) {
    parts.push(relations === 1 ? '1 relation' : `${relations} relations`);
  }
  if (item.decisions.length > 0) {
    parts.push(item.decisions.length === 1 ? '1 decision' : `${item.decisions.length} decisions`);
  }
  return parts.map((part) => escapeHtml(part)).join(' · ');
}

// The card is the one place an item's detail lives, so it carries the anchor
// every row above it points at. A number is the handle when the ledger knows
// one; an item without a number has only its ID to be named by.
function itemAnchor(item) {
  return escapeHtml(`item-${item.number === null ? item.id : item.number}`);
}

function renderImpact(item, impactById, itemNumbers) {
  const impact = impactById?.[item.id] ?? { downstreamIds: [], readyIfDoneIds: [] };
  const downstreamIds = Array.isArray(impact.downstreamIds) ? impact.downstreamIds : [];
  const readyIds = Array.isArray(impact.readyIfDoneIds) ? impact.readyIfDoneIds : [];
  const downstreamNames = downstreamIds.map((id) => escapeHtml(handleFor(id, itemNumbers))).join(', ');
  const readyNames = readyIds.map((id) => escapeHtml(handleFor(id, itemNumbers))).join(', ');
  const downstreamAction = downstreamIds.length === 0 ? '' : ` <button type="button" data-show-items="${escapeHtml(downstreamIds.join(','))}" data-label="${escapeHtml(`Downstream of ${handleFor(item.id, itemNumbers)}`)}">Show downstream</button>`;
  const readyAction = readyIds.length === 0 ? '' : ` <button type="button" data-show-items="${escapeHtml(readyIds.join(','))}" data-label="${escapeHtml(`Ready if ${handleFor(item.id, itemNumbers)} is done`)}">Show ready if done</button>`;
  return `<section class="standard-only"><h3>Dependency impact</h3><p>Downstream reach: ${downstreamIds.length} item${downstreamIds.length === 1 ? '' : 's'}${downstreamIds.length === 0 ? '.' : ` (${downstreamNames}).`}${downstreamAction}</p><p>Ready if done: ${readyIds.length} item${readyIds.length === 1 ? '' : 's'}${readyIds.length === 0 ? '.' : ` (${readyNames}).`}${readyAction}</p></section>`;
}

function renderCard(item, index, itemNumbers, retainedIds, impactById = {}) {
  const handle = item.number === null ? item.id : `#${item.number}`;
  // Shared search contract: number, immutable ID, title, and normalized mapped
  // values only. Lifecycle status, readiness, and kind filter; they do not
  // search.
  const searchText = [
    item.number === null ? '' : String(item.number),
    item.id,
    item.title,
    ...Object.values(item.fields).flatMap((value) => (Array.isArray(value) ? value : [value])),
  ].filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase('en-US');
  const latestDecision = item.decisions.at(-1);
  const summaryPreview = bodyExcerpt(item.body, 120);
  return `<details class="card" id="${itemAnchor(item)}" data-item data-item-id="${escapeHtml(item.id)}" data-order="${index}" data-state="${escapeHtml(item.readiness.state)}" data-status="${escapeHtml(item.status)}" data-kind="${escapeHtml(item.kind)}" data-priority="${item.priority ?? ''}" data-created="${escapeHtml(item.created)}" data-title="${escapeHtml(item.title.toLocaleLowerCase('en-US'))}" data-fields="${escapeHtml(JSON.stringify(item.fields))}" data-search="${escapeHtml(searchText)}">
<summary><span class="summary-main"><span class="handle">${escapeHtml(handle)}</span><span class="title">${escapeHtml(item.title)}</span></span><span class="badges">${renderBadges(item)}</span><span class="summary-context standard-only">${summaryContext(item)}</span>${summaryPreview === '' ? '' : `<span class="summary-preview detailed-only">${escapeHtml(summaryPreview)}</span>`}</summary>
<div class="card-detail">
<p class="outside-notice" hidden>Outside current filters. This detail stays open while the list shows the current scope.</p>
<div class="basic-grid"><section><h3>Readiness</h3>${renderReasons(item, itemNumbers)}</section><section><h3>Dates</h3><p>Created ${escapeHtml(item.created)}<br>Updated ${escapeHtml(item.updated)}</p></section></div>
<section class="standard-only"><h3>Relations</h3>${renderRelations(item, itemNumbers, retainedIds)}</section>${renderImpact(item, impactById, itemNumbers)}
<section class="standard-only"><h3>Latest decision</h3>${latestDecision === undefined ? '<span class="muted">No decisions.</span>' : renderDecisions({ decisions: [latestDecision] })}</section>
<section class="body-excerpt standard-only"><h3>Body excerpt</h3><p>${escapeHtml(bodyExcerpt(item.body))}</p></section>
<section class="detailed-only"><h3>Decision history</h3>${renderDecisions(item)}</section>
<section class="body-section detailed-only"><h3>Item body</h3><script type="text/markdown">${scriptJson(item.body)}</script><div class="rendered-markdown" data-rendered="0"></div><noscript><pre>${escapeHtml(item.body)}</pre></noscript></section>
</div>
</details>`;
}

// A chart row is only worth a heading when there is a chart in it. Every row
// that has a table keeps the table whether or not the chart drew, because the
// table is what a reader without SVG is left with.
function chartRow(heading, chart, caption = '', fallback = '') {
  if (chart === '' && fallback === '') {
    return '';
  }
  const figure = chart === ''
    ? ''
    : `<figure class="chart-figure">${chart}${caption === '' ? '' : `<figcaption>${caption}</figcaption>`}</figure>`;
  return `<section class="chart-row"><h3>${heading}</h3>${figure}${fallback}</section>`;
}

function renderEvidence(evidence, asOf) {
  const buckets = `<table><thead><tr><th>Age</th><th>Open items</th></tr></thead><tbody>${evidence.agingBuckets.map((bucket) => `<tr><td>${escapeHtml(bucket.label)}</td><td>${bucket.count}</td></tr>`).join('')}</tbody></table>`;
  const flow = `<div class="table-scroll"><table><thead><tr><th>Week</th><th>Arrivals</th><th>Closures</th><th>Done</th><th>Net</th><th>4-week mean</th></tr></thead><tbody>${evidence.weeks.map((week) => `<tr><td>${escapeHtml(week.weekStart)}${week.partial === true ? ' (partial)' : ''}</td><td>${week.arrivals}</td><td>${week.closures}</td><td>${week.done ?? 0}</td><td>${week.arrivals - week.closures > 0 ? '+' : ''}${week.arrivals - week.closures}</td><td>${week.rolling === null ? '—' : week.rolling}</td></tr>`).join('')}</tbody></table></div>`;
  const cycle = evidence.cycleTime.sampleCount === 0
    ? '<p class="muted">No accept-to-complete history yet.</p>'
    : `<p>Median <strong>${evidence.cycleTime.medianDays}d</strong> · p85 <strong>${evidence.cycleTime.p85Days}d</strong><br><span class="muted">${evidence.cycleTime.sampleCount} done items with recorded acceptance, accept to completion.</span></p>`;
  const forecast = evidence.forecast === null
    ? '<p class="muted">No closures in the window, so no forecast.</p>'
    : `<p><strong>${evidence.forecast.remaining}</strong> open items remaining.<br>50% by <strong>${escapeHtml(evidence.forecast.date50)}</strong> (${evidence.forecast.weeks50} weeks)<br>85% by <strong>${escapeHtml(evidence.forecast.date85)}</strong> (${evidence.forecast.weeks85} weeks)<br>95% by <strong>${escapeHtml(evidence.forecast.date95)}</strong> (${evidence.forecast.weeks95} weeks)<br><span class="muted">${evidence.forecast.trials} Monte Carlo trials resampling observed weekly closures. A closure-based estimate, not a delivery commitment.</span></p>`;

  const rows = [
    chartRow(
      'Chance of finishing by',
      forecastChart(evidence.forecast, asOf),
      '<span class="key key-50">50%</span><span class="key key-85">85%</span><span class="key key-95">95%</span> of Monte Carlo trials.',
    ),
    chartRow(
      'Arrivals against closures',
      weeklyFlowChart(evidence.weeks),
      '<span class="key key-arrival">Arrivals</span><span class="key key-closure">Closures</span>',
      flow,
    ),
    chartRow(
      'Throughput and its four-week mean',
      throughputChart(evidence.weeks),
      '<span class="key key-closure">Closures</span><span class="key key-rolling">4-week mean</span>',
    ),
    chartRow(
      'Cumulative flow',
      cumulativeFlowChart(evidence.cumulativeFlow),
      '<span class="key key-terminal">Terminal</span><span class="key key-accepted">Accepted</span><span class="key key-triage">Untriaged</span>',
    ),
    chartRow(
      'Cycle time by completion date',
      cycleTimeChart(evidence.cycleTime),
      '<span class="key key-p50">Median</span><span class="key key-p85">p85</span>',
    ),
    chartRow('Aging by age and status', agingHeatmapChart(evidence.agingMatrix), '', buckets),
  ].join('');

  return `<section id="evidence" class="panel"><div class="section-heading"><div><p class="eyebrow">Evidence</p><h2>Flow and forecast</h2></div><p class="muted">Reconstructed from item dates in this ledger. No stored snapshots. Closed includes done, killed, deferred, and archived.${evidence.range === null || evidence.range === undefined ? '' : ` Window ${escapeHtml(evidence.range.from)} to ${escapeHtml(evidence.range.to)}; weeks the range cuts short are marked partial.`} Missing acceptance history is reconstruction uncertainty: deleted items and unrecorded transitions cannot be recovered.${evidence.coverageGaps !== undefined && evidence.coverageGaps.missingAcceptance > 0 ? ` ${evidence.coverageGaps.missingAcceptance} retained items have no recorded acceptance and read as untriaged until departure.` : ''}</p></div><div class="evidence-grid"><section><h3>Throughput</h3><p><strong>${evidence.throughput.perWeek}</strong> items/week<br><span class="muted">${evidence.throughput.total} closures${evidence.throughput.done === undefined ? '' : ` (${evidence.throughput.done} done)`} over ${evidence.throughput.windowWeeks} weeks.</span></p></section><section><h3>Cycle time</h3>${cycle}</section><section><h3>Forecast</h3>${forecast}</section></div>${rows}</section>`;
}

function renderSwarm(batches, swarm = null) {
  const retained = (Array.isArray(batches) ? batches : []).filter((batch) => Array.isArray(batch) && batch.length > 0);
  if (retained.length === 0) {
    if (swarm === null || swarm === undefined) return '';
    return `<details id="batches" class="panel"><summary>Scoped members of existing batches</summary><p class="muted">No eligible batches in this scope. Batches require mapped area and complexity values in the eligible complexities; missing mappings are omitted, never invented.</p></details>`;
  }
  return `<details id="batches" class="panel"><summary>Scoped members of existing batches</summary><div class="section-heading"><div><p class="eyebrow">Parallel work</p><h2>Swarm candidates</h2></div><p class="muted">Ready items only. Each batch contains no repeated mapped area. Scoped members of the existing allocation; original packing is preserved.</p></div><div class="batch-grid">${retained.map((batch, index) => {
    const ids = batch.map((item) => item.id).filter(Boolean);
    return `<section class="batch" data-batch-ids="${escapeHtml(ids.join(','))}"><h3>Batch ${index + 1}</h3><ol>${batch.map((item) => `<li><span>${escapeHtml(item.number === null ? item.id : `#${item.number}`)}</span> ${escapeHtml(item.title)}</li>`).join('')}</ol><button type="button" data-show-items="${escapeHtml(ids.join(','))}" data-label="${escapeHtml(`Batch ${index + 1}`)}">Show batch</button></section>`;
  }).join('')}</div></details>`;
}

// A facet group is one dimension of the open set: readiness, lifecycle status,
// kind, and one group for every configured mapped field. A mapped field the
// item does not carry has no value in that dimension, so it answers no chip
function facetValues(item, key) {
  if (key === 'readiness') {
    return [item.readiness.state];
  }
  if (key === 'status') {
    return [item.status];
  }
  if (key === 'kind') {
    return [item.kind];
  }
  if (key === 'priority') {
    return reportFieldValues(item.priority);
  }
  return reportFieldValues(item.fields[key.slice(6)]);
}

function observedTypedValues(items, key) {
  const seen = new Map();
  for (const item of items) {
    for (const value of facetValues(item, key)) {
      const id = `${typeof value}:${JSON.stringify(value)}`;
      if (!seen.has(id)) {
        seen.set(id, value);
      }
    }
  }
  return [...seen.values()].sort((left, right) => {
    const leftKey = `${typeof left}:${JSON.stringify(left)}`;
    const rightKey = `${typeof right}:${JSON.stringify(right)}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function hasMissing(items, key) {
  return items.some((item) => facetValues(item, key).length === 0);
}

function renderCoverage(fieldCoverage) {
  const rows = fieldCoverage.map((entry) => {
    const scope = entry.mapped ? `${entry.present} present, ${entry.missing} missing, ${entry.invalid} invalid` : `not configured — ${entry.missing} items have no value here`;
    return `<li><strong>${escapeHtml(fieldLabel(entry.name))}</strong> — ${escapeHtml(scope)}</li>`;
  }).join('');
  return `<details id="coverage" class="panel"><summary>Metadata coverage</summary><ul>${rows}</ul><p class="muted">Missing means the item carries no value there. Invalid values are omitted from filters and never printed raw. Tags accept a nonempty string or an array of nonempty strings.</p></details>`;
}

function renderQuickViews() {
  const views = [
    ['work-next', 'Work next'],
    ['in-progress', 'In progress'],
    ['blocked', 'Blocked'],
    ['triage', 'Needs triage'],
    ['all-open', 'All open'],
  ];
  return `<div id="items-controls" aria-label="Items controls"><div role="group" aria-label="Quick views">${views.map(([value, label], index) => `<button type="button" data-quick="${value}" aria-pressed="${index === 0 ? 'true' : 'false'}">${label}</button>`).join('')}</div></div>`;
}

function areaCellKey(item) {
  const value = item.fields?.area;
  return (typeof value === 'string' && value !== '') ? value : null;
}

function renderAreaMatrix(openItems, itemNumbers) {
  const areas = [...new Set(openItems.map(areaCellKey))].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const statuses = [...new Set(openItems.map((item) => item.status))].sort();
  if (openItems.length === 0 || areas.length === 0 || statuses.length === 0) {
    return `<section id="area-matrix" class="panel" aria-label="Area by status matrix"><h3>Area by status</h3><p class="muted">No open items in this scope.</p></section>`;
  }
  const head = `<tr><th scope="col">Area</th>${statuses.map((s) => `<th scope="col">${escapeHtml(String(s))}</th>`).join('')}</tr>`;
  const rows = areas.map((area) => {
    const label = area === null ? 'Missing' : area;
    const cells = statuses.map((status) => {
      const ids = openItems.filter((item) => areaCellKey(item) === area && item.status === status).map((item) => item.id);
      if (ids.length === 0) return '<td><span class="muted">—</span></td>';
      const blocked = ids.filter((id) => openItems.find((item) => item.id === id)?.readiness.state === 'blocked').length;
      const names = ids.map((id) => escapeHtml(handleFor(id, itemNumbers))).join(', ');
      const areaAttr = area === null ? ' data-matrix-missing="1"' : ` data-matrix-area="${escapeHtml(area)}"`;
      return `<td>${ids.length} (blocked ${blocked})<br><span class="muted">${names}</span> <button type="button" data-matrix-status="${escapeHtml(status)}"${areaAttr} data-label="${escapeHtml(`${label} · ${status}`)}">Show</button></td>`;
    }).join('');
    return `<tr><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`;
  }).join('');
  return `<section id="area-matrix" class="panel" aria-label="Area by status matrix"><h3>Area by status</h3><p class="muted">Scoped open work. Each cell opens its exact items.</p><div class="table-scroll"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderAttentionSummary(attention, openItems = []) {
  const blockedFacts = attention.blocked.length === 0 ? 'Nothing blocked.' : `#${attention.blocked[0].number} ${attention.blocked[0].title} blocked by ${attention.blocked[0].blockers.map((b) => `#${b.number}`).join(', ')} · age ${attention.blocked[0].ageDays}d`;
  const agingFacts = attention.aging.length === 0 ? 'No open items.' : `#${attention.aging[0].number} ${attention.aging[0].title} · age ${attention.aging[0].ageDays}d · ${attention.aging[0].status}`;
  const stuckFacts = attention.stuck.length === 0 ? 'Nothing past p85.' : `#${attention.stuck[0].number} ${attention.stuck[0].title} · ${attention.stuck[0].elapsedDays}d since accept · p85 ${attention.stuck[0].thresholdDays}d`;
  const inProgress = openItems.filter((item) => item.status === 'in-progress');
  const triage = openItems.filter((item) => item.status === 'triage');
  const numbers = (items) => items.map((item) => item.number).filter((n) => n !== null && n !== undefined).join(',');
  const action = (nums, label) => nums === '' ? '' : ` <button type="button" data-show-numbers="${escapeHtml(nums)}" data-label="${escapeHtml(label)}">Show</button>`;
  const blockedNums = attention.blocked.map((e) => e.number).filter((n) => n !== null && n !== undefined).join(',');
  const agingNums = attention.aging.map((e) => e.number).filter((n) => n !== null && n !== undefined).join(',');
  const stuckNums = attention.stuck.map((e) => e.number).filter((n) => n !== null && n !== undefined).join(',');
  return `<section id="attention-summary" class="panel" aria-label="Attention summary"><div class="attention-grid">`
    + `<section><h3>In progress</h3><p>${inProgress.length === 0 ? 'Nothing in progress.' : escapeHtml(`${inProgress.length} item${inProgress.length === 1 ? '' : 's'} in progress.`)}${action(numbers(inProgress), 'In progress')}</p></section>`
    + `<section><h3>Blocked</h3><p>${escapeHtml(blockedFacts)}</p><p class="muted">Showing ${attention.blocked.length} of ${attention.blockedTotal}.${action(blockedNums, 'Blocked attention')}</p></section>`
    + `<section><h3>Needs triage</h3><p>${triage.length === 0 ? 'Nothing needs triage.' : escapeHtml(`${triage.length} item${triage.length === 1 ? '' : 's'} need triage.`)}${action(numbers(triage), 'Needs triage')}</p></section>`
    + `<section><h3>Oldest</h3><p>${escapeHtml(agingFacts)}${action(agingNums, 'Oldest open work')}</p></section>`
    + `<section><h3>Past p85</h3><p>${escapeHtml(stuckFacts)}${action(stuckNums, 'Past p85 attention')}</p></section>`
    + `</div></section>`;
}

const FACET_GROUP_LABELS = { readiness: 'Readiness', status: 'Status', kind: 'Kind', priority: 'Priority' };

// One filter vocabulary for the whole artifact. A fixed criterion a named view
// was generated from names its dimension and its values exactly as the
// interactive chip for that same dimension names them, so the reader reads one
// language above the drill-down and inside it.
function groupLabel(key) {
  return FACET_GROUP_LABELS[key] ?? fieldLabel(key.slice(6));
}

function optionLabel(key, value) {
  return key === 'readiness' ? READINESS_LABELS[value] : String(value);
}

function typedIncludes(values, candidate) {
  return values.some((entry) => typeof entry === typeof candidate && entry === candidate);
}

// Readiness and kind are the schema's own closed vocabularies, so every value
// is offered whether or not the open set currently holds one; a chip counting
// zero is a fact about the ledger. Status, priority, and the mapped fields are
// open, so only what the open cards actually carry is offered, plus a typed
// Missing chip when any card carries no value there.
function facetGroups(items, fieldNames) {
  const declared = [
    { key: 'readiness', values: ['ready', 'blocked', 'ineligible'] },
    { key: 'status', values: observedTypedValues(items, 'status') },
    { key: 'kind', values: ['task', 'epic'] },
    { key: 'priority', values: observedTypedValues(items, 'priority') },
    ...fieldNames.map((name) => ({
      key: `field:${name}`,
      values: observedTypedValues(items, `field:${name}`),
    })),
  ];
  return declared
    .map((group) => {
      const options = group.values.map((value) => ({
        selection: { kind: 'value', value },
        value,
        label: optionLabel(group.key, value),
        count: items.filter((item) => typedIncludes(facetValues(item, group.key), value)).length,
      }));
      if (hasMissing(items, group.key)) {
        options.push({
          selection: { kind: 'missing' },
          value: '__missing__',
          label: 'Missing',
          count: items.filter((item) => facetValues(item, group.key).length === 0).length,
        });
      }
      return { key: group.key, label: groupLabel(group.key), options };
    })
    .filter((group) => group.options.length > 0);
}

// The chip is a checkbox inside its own label, so holding two values at once is
// the control's own semantics rather than a state the runtime paints onto a
// button. The count is part of the label, so the reader hears "Ready 4" and
// knows what selecting it would leave.
function renderFacets(groups, total) {
  const head = `<div class="facets-head"><p id="result-count" class="result-count" role="status" aria-live="polite">Showing ${total} of ${total} ${total === 1 ? 'item' : 'items'}</p><button type="button" id="clear-facets">Clear filters</button></div>`;
  const chips = (group) => group.options.map((option) => {
    const kind = option.selection.kind;
    const dataValue = kind === 'missing' ? '' : ` data-value="${escapeHtml(JSON.stringify(option.selection.value))}"`;
    return `<label class="chip"><input type="checkbox" class="facet" data-group="${escapeHtml(group.key)}" data-kind="${kind}"${dataValue} value="${escapeHtml(option.value)}"><span class="chip-text">${escapeHtml(option.label)}</span> <span class="chip-count">${option.count}</span></label>`;
  }).join('');
  return `<section id="facets" class="facets panel" aria-label="Filter items">${head}<details class="facet-expand" id="facets-expand"><summary>Filters</summary>${groups.map((group) => `<fieldset class="facet-group" data-group="${escapeHtml(group.key)}"><legend>${escapeHtml(group.label)}</legend><div class="chips">${chips(group)}</div></fieldset>`).join('')}</details></section>`;
}

// A named report is one file about one subset, so it says which subset in its
// own voice: the view title, the stable name automation selected it by, and the
// criteria the generator applied. A criterion is a fact about these bytes, not
// a control over them - the reader cannot change what the file contains - so it
// wears the chip vocabulary without an input inside it. The interactive chips
// further down are the only controls, and they narrow this subset alone.
function renderViewContext(view, repositoryName) {
  if (view === null) {
    return '';
  }
  const groups = view.criteria.map((criterion) => {
    const chips = criterion.values
      .map((value) => `<span class="chip chip-fixed">${escapeHtml(optionLabel(criterion.key, value))}</span>`)
      .join('');
    return `<div class="criteria-group"><p class="criteria-label">${escapeHtml(groupLabel(criterion.key))}</p><div class="chips">${chips}</div></div>`;
  }).join('');
  return `
<section class="view-context" aria-label="Custom report view"><p class="eyebrow">Custom view</p><h2>${escapeHtml(view.title)}</h2><p class="view-name"><code>${escapeHtml(view.name)}</code></p><p class="muted">Filtered subset of ${escapeHtml(repositoryName)}. Interactive filters below can narrow this view further.</p><div class="criteria">${groups}</div></section>`;
}

// The artifact ships the rules it uses and no others, so a base report carries
// no styling for a section it does not render. A fixed criterion keeps the chip
// shape and drops the pointer: nothing here responds to a click.
function viewContextStyleSource(view) {
  if (view === null) {
    return '';
  }
  return '.view-context{margin:0 0 22px;border:1px solid var(--line);border-left:3px solid var(--navy);border-radius:12px;background:var(--surface);box-shadow:var(--shadow);padding:18px}.view-context h2{margin:0;font-family:ui-serif,Georgia,serif;color:var(--navy);font-size:clamp(1.2rem,2.4vw,1.6rem);line-height:1.15}.view-context .view-name{margin:7px 0 0}.view-context code{border-radius:4px;background:#eeece6;padding:1px 5px;font-size:.85rem}.view-context .muted{margin:9px 0 0}.criteria{display:grid;gap:9px;margin-top:14px}.criteria-group{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.criteria-label{flex:none;width:104px;margin:0;color:var(--muted);font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.chip-fixed{background:#eef1f4;color:var(--navy);cursor:default}@media(max-width:480px){.criteria-group{align-items:flex-start;flex-direction:column;gap:5px}}';
}

function styleSource() {
  return `:root{color-scheme:light;--canvas:#f3f0e9;--surface:#fffdf8;--ink:#20231f;--muted:#687069;--line:#d9d7ce;--navy:#15324a;--ready:#1e6b4f;--ready-bg:#e6f3ec;--blocked:#9b4b21;--blocked-bg:#f9e9df;--ineligible:#60666a;--ineligible-bg:#eceeef;--focus:#0b67b2;--shadow:0 10px 28px rgba(32,35,31,.07)}*{box-sizing:border-box}html{background:var(--canvas);color:var(--ink);font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0}button,input,select{font:inherit}button,select,input{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}button,select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,.row-link:focus-visible{outline:3px solid color-mix(in srgb,var(--focus) 35%,transparent);outline-offset:2px}.shell{width:min(1500px,100%);margin:auto;padding:28px 36px 56px}.masthead{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:4px 0 26px}.identity{display:flex;align-items:center;gap:16px}.logo{width:48px;height:48px;object-fit:contain}.eyebrow{margin:0 0 4px;color:var(--muted);font-size:.75rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.masthead h1,.section-heading h2{margin:0;font-family:ui-serif,Georgia,serif;color:var(--navy);line-height:1.1}.masthead h1{font-size:clamp(1.8rem,4vw,3rem)}.as-of{text-align:right;color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:16px}.stat,.panel{border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}.stat{padding:14px}.stat strong{display:block;color:var(--navy);font-size:1.55rem}.stat span{color:var(--muted)}.controls{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px;margin-bottom:18px;background:color-mix(in srgb,var(--surface) 95%,transparent);backdrop-filter:blur(10px)}.controls input{min-width:min(320px,100%);flex:1;padding:9px 11px}.controls select,.controls button{padding:8px 10px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:14px}.section-heading p{margin:0}.items{display:grid;gap:18px}.group h2{margin:0 0 8px;color:var(--navy);font:700 1.05rem/1.2 ui-sans-serif,-apple-system,sans-serif}.card-grid{display:grid;grid-template-columns:1fr;gap:12px}.card{min-width:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 3px 12px rgba(32,35,31,.04);overflow:hidden}.card[open]{box-shadow:var(--shadow)}summary{display:block;padding:14px;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.summary-main{display:flex;gap:8px;align-items:baseline}.handle{flex:none;color:var(--navy);font-variant-numeric:tabular-nums;font-weight:800;overflow-wrap:anywhere}.title{font-weight:700;overflow-wrap:anywhere}.badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.badge{display:inline-flex;border-radius:999px;background:#efeee9;padding:2px 8px;color:#4d534e;font-size:.73rem;font-weight:700}.badge.state-ready{background:var(--ready-bg);color:var(--ready)}.badge.state-blocked{background:var(--blocked-bg);color:var(--blocked)}.badge.state-ineligible{background:var(--ineligible-bg);color:var(--ineligible)}.badge.mapped{background:#e8edf2;color:var(--navy)}.card-detail{border-top:1px solid var(--line);padding:16px}.card-detail h3,.batch h3{margin:0 0 7px;color:var(--navy);font-size:.83rem;letter-spacing:.04em;text-transform:uppercase}.card-detail p{margin:0}.basic-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.standard-only,.detailed-only,.body-section{margin-top:18px}.reasons,.decisions{margin:0;padding-left:20px}.relations{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}.relations dt{font-weight:700}.relations dd{margin:0;overflow-wrap:anywhere}.rendered-markdown{overflow-wrap:anywhere}.rendered-markdown h1,.rendered-markdown h2,.rendered-markdown h3{font-family:ui-serif,Georgia,serif;text-transform:none;letter-spacing:0}.rendered-markdown pre,noscript pre{overflow:auto;border-radius:8px;background:#202622;color:#f5f7f3;padding:12px}.rendered-markdown code{border-radius:4px;background:#eeece6;padding:1px 4px}.rendered-markdown pre code{background:transparent;padding:0}.rendered-markdown a{color:#075fa7}.rendered-markdown table,table{width:100%;border-collapse:collapse}.rendered-markdown th,.rendered-markdown td,th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}.panel{margin-top:26px;padding:18px}.facets{margin-top:0;margin-bottom:18px}.facets-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.facets-head button{padding:8px 10px}.result-count{margin:0;color:var(--muted);font-weight:700}.facet-group{margin:0;border:0;padding:12px 0 0}.facet-group>legend{padding:0;color:var(--muted);font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;background:#fff;padding:5px 11px;font-size:.8rem;font-weight:700;cursor:pointer}.chip input{flex:none;width:13px;height:13px;margin:0;border-radius:3px;accent-color:var(--navy)}.chip-count{color:var(--muted);font-variant-numeric:tabular-nums}.chip.selected{border-color:var(--navy);background:var(--navy);color:#fff}.chip.selected .chip-count{color:#c8d3dd}.chip:focus-within{outline:3px solid color-mix(in srgb,var(--focus) 35%,transparent);outline-offset:2px}.table-scroll{overflow-x:auto}.batch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.batch{border:1px solid var(--line);border-radius:9px;padding:12px}.batch ol{margin:0;padding-left:22px}.muted{color:var(--muted)}.empty{padding:32px;text-align:center;color:var(--muted)}body[data-richness="basic"] .standard-only,body[data-richness="basic"] .detailed-only,body[data-richness="standard"] .detailed-only{display:none}.summary-context{display:block;margin-top:9px;color:var(--muted);font-size:.8rem}.summary-preview{display:block;margin-top:7px;padding-left:9px;border-left:2px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.8rem}[hidden]{display:none!important}@media(min-width:851px){.card{scroll-margin-top:140px}}@media(min-width:1100px){#workspace-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:18px;align-items:start}#list-column{min-width:0}#detail-column{min-width:0}#detail-pane:empty{display:none}}#workspace-split{display:block}#list-column{min-width:0}#detail-column{min-width:0;margin-top:18px}@media(min-width:1100px){#detail-column{margin-top:0}}.facet-expand{margin-top:12px}.facet-expand summary{cursor:pointer;font-weight:800}.facet-expand .chips{max-height:32vh;overflow:auto}@media print{.view-nav,#sticky-controls,#facets,#items-presentation,#drilldown-pill{display:none!important}.shell{width:auto;padding:0}.card,.panel{box-shadow:none;break-inside:avoid}.scope-caption{font-weight:700}}@media(max-width:850px){.shell{padding:20px 16px 40px}.stats{grid-template-columns:repeat(3,1fr)}.masthead,.section-heading{align-items:flex-start;flex-direction:column}.as-of{text-align:left}.controls{position:sticky;top:0}.basic-grid{grid-template-columns:1fr}}@media(max-width:480px){.stats{grid-template-columns:repeat(2,1fr)}.controls>*{width:100%}.summary-main{align-items:flex-start;flex-direction:column}.card-detail{padding:13px}}@media(prefers-reduced-motion:no-preference){.card{transition:box-shadow .15s ease,border-color .15s ease}.chip{transition:background-color .15s ease,color .15s ease}}.row-link{display:block;color:inherit;text-decoration:none}.ranked{counter-reset:rank;margin:0;padding:0;list-style:none;display:grid;gap:9px}.ranked li{counter-increment:rank;border:1px solid var(--line);border-radius:9px;background:#fff}.ranked .row-link{position:relative;padding:12px 14px 12px 52px}.ranked .row-link::before{content:counter(rank);position:absolute;left:14px;top:12px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--navy);color:#fff;font-variant-numeric:tabular-nums;font-weight:800;font-size:.8rem}.why{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0}.reason{display:inline-flex;border-radius:999px;background:#eef1f4;padding:2px 9px;color:var(--navy);font-size:.74rem;font-weight:700}.reason-class,.reason-class-unknown,.reason-due{background:var(--blocked-bg);color:var(--blocked)}.reason-leverage,.reason-epic{background:var(--ready-bg);color:var(--ready)}.notice{margin:0 0 12px;border-left:3px solid var(--blocked);background:var(--blocked-bg);padding:8px 12px;color:var(--blocked)}.attention-grid,.evidence-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}.attention-grid h3,.evidence-grid h3,.chart-row h3{margin:0 0 8px;color:var(--navy);font-size:.83rem;letter-spacing:.04em;text-transform:uppercase}.attention-grid p,.evidence-grid p{margin:0}.plain{margin:0;padding:0;list-style:none;display:grid;gap:9px}.plain li{border-bottom:1px solid var(--line)}.plain li:last-child{border-bottom:0}.plain .row-link{padding-bottom:8px}.plain li:last-child .row-link{padding-bottom:0}.chart-row{margin-top:20px}.chart-figure{margin:0 0 12px}.chart{display:block;width:100%;height:auto}.chart-compact{max-width:min(100%,460px)}.chart-axis{stroke:var(--line);stroke-width:1}.chart-grid{stroke:var(--line);stroke-width:1;stroke-dasharray:3 3}.chart-tick{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}.chart-value{fill:var(--navy);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}.chart-total{fill:var(--ink);font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}.chart-head{fill:var(--muted);font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.chart-label{fill:var(--ink);font-size:11px}.bar-arrival{fill:#a8bccb}.bar-closure{fill:var(--ready)}.heat{fill:var(--navy)}.rolling{fill:none;stroke:var(--blocked);stroke-width:2;stroke-linejoin:round}.fan{fill:var(--ready);fill-opacity:.28;stroke:var(--ready);stroke-width:1.5}.mark-50,.mark-85,.mark-95{stroke:var(--navy);stroke-width:1.5;stroke-dasharray:2 2}.band-terminal{fill:var(--ready);fill-opacity:.75}.band-accepted{fill:#7fae97}.band-triage{fill:#cddbd3}.sample{fill:var(--navy);fill-opacity:.55}.percentile-50{stroke:var(--navy);stroke-width:1.5;stroke-dasharray:5 3}.percentile-85{stroke:var(--blocked);stroke-width:1.5;stroke-dasharray:5 3}figcaption{display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;color:var(--muted);font-size:.78rem}.key{display:inline-flex;align-items:center;gap:6px}.key::before{content:"";width:11px;height:11px;border-radius:3px;background:currentColor}.key-arrival{color:#a8bccb}.key-closure,.key-terminal{color:var(--ready)}.key-rolling,.key-p85{color:var(--blocked)}.key-p50{color:var(--navy)}.key-accepted{color:#7fae97}.key-triage{color:#cddbd3}.key-50,.key-85,.key-95{color:var(--ready)}#work-next,#attention,#evidence{margin-top:22px}#drilldown{margin-top:34px;border-top:2px solid var(--line);padding-top:22px}#drilldown .stats{margin-top:14px}`;
}

// The one runtime the report ships. Exported so a test can execute it rather
// than read it: a case that asserts on this string proves nothing about what
// the browser does with it.
export function reportClientSource() {
  return reportSelectionBrowserSource() + `\n'use strict';
const itemRoot=document.getElementById('items');
const cards=Array.from(itemRoot.querySelectorAll('[data-item]'));
const search=document.getElementById('search');
const groupBy=document.getElementById('group-by');
const sortBy=document.getElementById('sort-by');
const richness=document.getElementById('richness');
const empty=document.getElementById('empty');
const resultCount=document.getElementById('result-count');
const facetChips=Array.from(document.querySelectorAll('.facet')).map(input=>({chip:input.parentNode,input:input,count:input.parentNode.querySelector('.chip-count')}));
const chipsByGroup=new Map();
for(const chip of facetChips){const group=chip.input.dataset.group;if(!chipsByGroup.has(group))chipsByGroup.set(group,[]);chipsByGroup.get(group).push(chip);}
const showHistory=document.getElementById('show-history');
const history=document.getElementById('history');
const drilldownPill=document.getElementById('drilldown-pill');
const drilldownLabel=document.getElementById('drilldown-label');
const clearDrilldown=document.getElementById('clear-drilldown');
var drilldown=null;
var scopeListeners=new Set();
var reportData=JSON.parse(document.getElementById('report-data').textContent);var selectionItems=Array.isArray(reportData)?reportData:reportData.items;var workNextIds=Array.isArray(reportData)?selectionItems.map(item=>item.id):reportData.workNextIds;var workNextById=Array.isArray(reportData)?{}:reportData.workNextById;var rawImpact=(Array.isArray(reportData)||!reportData.impactById)?{}:reportData.impactById;var impactById={};for(const key of Object.keys(rawImpact)){var entry=rawImpact[key]||{};var downstream=Array.isArray(entry.downstreamIds)?entry.downstreamIds.slice():[];var ready=Array.isArray(entry.readyIfDoneIds)?entry.readyIfDoneIds.slice():[];impactById[key]=Object.freeze({downstreamIds:Object.freeze(downstream),readyIfDoneIds:Object.freeze(ready)});}Object.freeze(impactById);
var cardByItemId=new Map();
for(const card of cards){var key=card.dataset.itemId||card.id;if(!cardByItemId.has(key))cardByItemId.set(key,card);}
function cardForSelectionId(id){return cardByItemId.get(id)||cards.find(card=>card.id===id);}
function selectedScope(){var facets={};for(const chip of facetChips){if(!chip.input.checked)continue;var group=chip.input.dataset.group;var kind=chip.input.dataset.kind||'value';var selection;if(kind==='missing'){selection={kind:'missing'};}else{var raw=chip.input.dataset.value;var value=raw===undefined?chip.input.value:JSON.parse(raw);selection={kind:'value',value:value};}if(!facets[group])facets[group]=[];facets[group].push(selection);}return {search:search.value,facets:facets};}
function scopeSignature(){return JSON.stringify(selectedScope());}
function getScopeItems(){return selectReportItems(selectionItems,selectedScope());}
var lastScopeSignature=scopeSignature();
function notifyScopeListeners(){var items=getScopeItems();for(const listener of scopeListeners)listener(items);}
const parsedFields=new Map();
function fields(card){if(!parsedFields.has(card))parsedFields.set(card,JSON.parse(card.dataset.fields));return parsedFields.get(card);}
function fieldValue(card,key){const value=fields(card)[key];return value===undefined?'':String(value);}
function groupLabel(card){const key=groupBy.value;if(key==='none')return 'All items';if(key==='readiness')return card.dataset.state;if(key==='status')return card.dataset.status;if(key.startsWith('field:'))return fieldValue(card,key.slice(6))||'Unclassified';return 'Unclassified';}
function compareText(left,right){return left<right?-1:left>right?1:0;}
function clearFacets(){for(const chip of facetChips)chip.input.checked=false;}
function refreshChipsFromSelection(scope){var dimensions=Array.from(chipsByGroup.keys());var counted=countReportFacets(selectionItems,scope,dimensions);var byDim=new Map();for(const entry of counted)byDim.set(entry.dimension,entry.options);for(const [group,chips] of chipsByGroup){var options=byDim.get(group)||[];var countByKey=new Map();for(const option of options)countByKey.set(JSON.stringify(option.selection),option.count);for(const chip of chips){var kind=chip.input.dataset.kind||'value';var sel=kind==='missing'?{kind:'missing'}:{kind:'value',value:chip.input.dataset.value===undefined?chip.input.value:JSON.parse(chip.input.dataset.value)};chip.chip.classList.toggle('selected',chip.input.checked);chip.count.textContent=String(countByKey.get(JSON.stringify(sel))??0);}}}
function compareCards(left,right){const key=sortBy.value;if(key==='default')return Number(left.dataset.order)-Number(right.dataset.order);if(key==='priority'){const a=left.dataset.priority===''?null:Number(left.dataset.priority);const b=right.dataset.priority===''?null:Number(right.dataset.priority);if(a===null||b===null)return a===b?Number(left.dataset.order)-Number(right.dataset.order):a===null?1:-1;return a-b||Number(left.dataset.order)-Number(right.dataset.order);}if(key==='created')return compareText(left.dataset.created,right.dataset.created)||Number(left.dataset.order)-Number(right.dataset.order);if(key==='title')return compareText(left.dataset.title,right.dataset.title)||Number(left.dataset.order)-Number(right.dataset.order);if(key.startsWith('field:'))return compareText(fieldValue(left,key.slice(6)),fieldValue(right,key.slice(6)))||Number(left.dataset.order)-Number(right.dataset.order);return 0;}
function applyHistory(){if(history)history.hidden=!showHistory.checked;apply();}
// Values inside a group are alternatives and groups narrow each other, so each
// chip is counted in the cohort the search and the other groups already left,
// never its own: two selections in one group cannot make their siblings zero.

function apply(){var scope=selectedScope();var scopedItems=selectReportItems(selectionItems,scope);var listState={scope:scope,section:'items',quickView:quickView,showHistory:showHistory.checked,groupBy:groupBy.value,sortBy:sortBy.value,richness:richness.value,selectedId:selectedId,drilldown:drilldown,range:null};var listedItems=selectListItems(selectionItems,listState,workNextIds);var listedCards=listedItems.map(item=>cardForSelectionId(item.id)).filter(card=>card!==undefined);var preserveRank=(quickView==='work-next'&&sortBy.value==='default'&&drilldown===null);if(!preserveRank)listedCards=listedCards.slice().sort(compareCards);var openCards=listedCards;var historyCards=[];if(drilldown===null&&showHistory.checked){var terminal=new Set(['done','killed','archived','deferred']);openCards=[];historyCards=[];for(const card of listedCards){var sel=selectionItems.find(item=>(card.dataset.itemId||card.id)===item.id);var st=sel?sel.status:card.dataset.status;if(terminal.has(st))historyCards.push(card);else openCards.push(card);}}var groups=new Map();for(const card of openCards){var label=groupLabel(card);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(card);}itemRoot.replaceChildren();for(const [label,members] of groups){var section=document.createElement('section');section.className='group';if(groupBy.value!=='none'){var heading=document.createElement('h2');heading.textContent=label+' ('+members.length+')';section.append(heading);}var grid=document.createElement('div');grid.className='card-grid';grid.append(...members);section.append(grid);itemRoot.append(section);}if(historyCards.length>0){var hsection=document.createElement('section');hsection.className='group history-group';var hheading=document.createElement('h2');hheading.textContent='History ('+historyCards.length+')';hsection.append(hheading);var hgrid=document.createElement('div');hgrid.className='card-grid';hgrid.append(...historyCards);hsection.append(hgrid);itemRoot.append(hsection);}if(drilldown===null){if(drilldownPill)drilldownPill.hidden=true;}else{if(drilldownPill)drilldownPill.hidden=false;if(drilldownLabel)drilldownLabel.textContent=drilldown.label+' ('+listedCards.length+')';}var totalVisible=openCards.length+historyCards.length+(drilldown!==null?0:0);var displayCount=drilldown!==null?listedCards.length:openCards.length+historyCards.length;empty.hidden=displayCount!==0;refreshChipsFromSelection(scope);resultCount.textContent='Showing '+displayCount+' of '+cards.length+(cards.length===1?' item':' items');updateActiveScope(scope);if(flowScope)flowScope.textContent='Scope: '+(activeScope?activeScope.textContent:'');if(graphScope)graphScope.textContent='Scope: '+(activeScope?activeScope.textContent:'');if(historyExplain){var wantsTerminal=false;try{var f=scope.facets&&scope.facets.status||[];for(const sel of f){if(sel.kind==='value'&&(sel.value==='done'||sel.value==='killed'||sel.value==='archived'||sel.value==='deferred'))wantsTerminal=true;}}catch(err){}var scopedTerminal=scopedItems.filter(item=>item.status==='done'||item.status==='killed'||item.status==='archived'||item.status==='deferred');historyExplain.hidden=!(wantsTerminal&&!showHistory.checked&&scopedTerminal.length>0&&displayCount===0);}if(itemList){itemList.replaceChildren();var rows=[];var rowItems=drilldown!==null?listedItems:(openCards.map(card=>selectionItems.find(item=>(card.dataset.itemId||card.id)===item.id)).filter(Boolean).concat(historyCards.map(card=>selectionItems.find(item=>(card.dataset.itemId||card.id)===item.id)).filter(Boolean)));for(const item of rowItems){var card=cardForSelectionId(item.id);var anchor=card?card.id:'item-'+item.id;var handle=item.number===null||item.number===undefined?item.id:'#'+item.number;var li=document.createElement('li');var a=document.createElement('a');a.className='row-link';a.setAttribute?a.setAttribute('href','#'+anchor):a.href='#'+anchor;if(a.dataset!==undefined){a.dataset.reveal=anchor;a.dataset.inspect=item.id;}var name=document.createElement('span');name.textContent=handle+' '+item.title;var detail=document.createElement('span');detail.className='muted';var why=workNextById&&workNextById[item.id]&&workNextById[item.id].reasons;if(quickView==='work-next'&&why&&why.length>0)detail.textContent=why.map(r=>r.label).join(' \u00b7 ');else detail.textContent=item.status+' \u00b7 '+(item.readiness&&item.readiness.state||'');a.append(name,detail);a.addEventListener('click',function(ev){var id=this.dataset?this.dataset.inspect||this.dataset.reveal:null;if(id&&reveal(id))ev.preventDefault();});li.append(a);rows.push(li);}itemList.append(...rows);itemList.className=(quickView==='work-next'&&sortBy.value==='default')?'ranked':'plain';}var sig=JSON.stringify(scope)+'|'+quickView+'|'+(showHistory.checked?'h1':'h0');if(sig!==lastScopeSignature){lastScopeSignature=sig;notifyScopeListeners();}}
function renderBody(card){const target=card.querySelector('.rendered-markdown');if(target.dataset.rendered==='1')return;const source=card.querySelector('script[type="text/markdown"]');target.innerHTML=window.renderMarkdown(JSON.parse(source.textContent));target.dataset.rendered='1';}
for(const card of cards){card.addEventListener('toggle',()=>{if(card.open)renderBody(card);});}
function revealOffset(){const controls=document.querySelector('.controls');return window.getComputedStyle(controls).position==='sticky'?controls.getBoundingClientRect().height+12:0;}
function reveal(id){const target=cardForSelectionId(id);if(target===undefined)return false;selectedId=target.dataset.itemId||target.id;const pane=document.getElementById('detail-pane');if(pane&&!target.isConnected)pane.append(target);target.open=true;renderBody(target);var notice=target.querySelector('.outside-notice');if(notice){var scopedIds=new Set(getScopeItems().map(item=>item.id));var tid=target.dataset.itemId||target.id;notice.hidden=scopedIds.has(tid);}target.style.scrollMarginTop=revealOffset()+'px';target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});target.querySelector('summary').focus({preventScroll:true});return true;}
for(const link of document.querySelectorAll('[data-reveal]'))link.addEventListener('click',event=>{if(reveal(link.dataset.reveal))event.preventDefault();});for(const btn of document.querySelectorAll('[data-show-items]'))btn.addEventListener('click',()=>{var raw=btn.dataset.showItems||'';var ids=raw.split(',').map(function(s){return s.trim();}).filter(Boolean);var label=btn.dataset.label||'Selected items';showItems({label:label,itemIds:ids});});for(const btn of document.querySelectorAll('[data-show-numbers]'))btn.addEventListener('click',()=>{var wanted=(btn.dataset.showNumbers||'').split(',').map(function(s){return s.trim();}).filter(Boolean);var ids=selectionItems.filter(function(item){return item.number!==null&&item.number!==undefined&&wanted.indexOf(String(item.number))!==-1;}).map(function(item){return item.id;});if(ids.length===0){var nums=wanted;try{var data=JSON.parse(document.getElementById('report-data').textContent);var all=Array.isArray(data)?data:data.items;ids=(all||[]).filter(function(item){return nums.indexOf(String(item.number))!==-1;}).map(function(item){return item.id;});}catch(e){} }var label=btn.dataset.label||'Selected items';showItems({label:label,itemIds:ids});});for(const btn of document.querySelectorAll('[data-matrix-status]'))btn.addEventListener('click',()=>{var status=btn.dataset.matrixStatus;var area=btn.dataset.matrixArea;var missing=btn.dataset.matrixMissing==='1';var ids=selectionItems.filter(function(item){if(item.status!==status)return false;var value=item.fields&&item.fields.area;var isMissing=!(typeof value==='string'&&value!=='');if(missing)return isMissing;return value===area;}).map(function(item){return item.id;});var label=btn.dataset.label||'Selected items';showItems({label:label,itemIds:ids});});
function clearDrilldownState(){drilldown=null;drilldownPill.hidden=true;}
var quickView='work-next';
var selectedId=null;
var quickButtons=Array.from(document.querySelectorAll('[data-quick]'));
function setQuick(view){quickView=view;for(const button of quickButtons){var pressed=button.dataset.quick===view?'true':'false';if(button.setAttribute)button.setAttribute('aria-pressed',pressed);else button.attributes['aria-pressed']=pressed;}}
for(const button of quickButtons)button.addEventListener('click',()=>{drilldown=null;if(drilldownPill)drilldownPill.hidden=true;setQuick(button.dataset.quick);apply();});
var activeScope=document.getElementById('active-scope');
var historyExplain=document.getElementById('history-explain');
var showHistoryAction=document.getElementById('show-history-action');
var itemList=document.getElementById('item-list');
var flowScope=document.getElementById('flow-scope');
var graphScope=document.getElementById('graph-scope');
function terminalStatus(value){return value==='done'||value==='killed'||value==='archived'||value==='deferred';}
function updateActiveScope(scope){if(!activeScope)return;var parts=[];var q=scope.search.trim();if(q)parts.push('Search: \u201c'+q+'\u201d');for(const [dim,sels] of Object.entries(scope.facets)){var label=dim;try{label=document.querySelector('fieldset[data-group="'+dim+'"] legend')?.textContent||dim;}catch(e){}var names=sels.map(sel=>sel.kind==='missing'?'Missing':String(sel.value)).join(', ');parts.push(label+': '+names);}activeScope.textContent=parts.length===0?'No filters':parts.join(' \u00b7 ');}
search.addEventListener('input',()=>{clearDrilldownState();apply();});groupBy.addEventListener('change',apply);sortBy.addEventListener('change',apply);for(const chip of facetChips)chip.input.addEventListener('change',()=>{clearDrilldownState();apply();});richness.addEventListener('change',()=>{document.body.dataset.richness=richness.value;});
showHistory.addEventListener('change',applyHistory);
document.getElementById('clear-facets').addEventListener('click',()=>{clearFacets();clearDrilldownState();apply();});
clearDrilldown.addEventListener('click',()=>{clearDrilldownState();apply();});
document.getElementById('expand-all').addEventListener('click',()=>{for(const card of itemRoot.querySelectorAll('[data-item]')){card.open=true;renderBody(card);}});
document.getElementById('collapse-all').addEventListener('click',()=>{for(const card of itemRoot.querySelectorAll('[data-item]')){card.open=false;}});
if(showHistoryAction)showHistoryAction.addEventListener('click',()=>{showHistory.checked=true;apply();});
var navButtons=Array.from(document.querySelectorAll('.view-nav [data-section]'));
var sectionByName={};for(const s of Array.from(document.querySelectorAll('[data-section]'))){if(s.id)sectionByName[s.dataset.section]=s;}
var lastFocusBySection={};
function setSection(name,focus){var prev=document.body.dataset.section||'items';try{var active=document.activeElement;if(active&&active.id)lastFocusBySection[prev]=active.id;}catch(e){}document.body.dataset.section=name;for(const b of navButtons){var on=b.dataset.section===name;if(b.setAttribute)b.setAttribute('aria-pressed',on?'true':'false');else b.attributes['aria-pressed']=on?'true':'false';}for(const [key,sec] of Object.entries(sectionByName)){if(sec.id&&sec.id.indexOf('section-')===0)sec.hidden=(key!==name);}if(focus!==false){var target=null;try{target=document.getElementById(lastFocusBySection[name]||'');}catch(e){}if(target)target.focus();}}
for(const b of navButtons)b.addEventListener('click',()=>{setSection(b.dataset.section);});
document.addEventListener('keydown',function(ev){if(ev&&ev.key==='Escape'){for(const d of Array.from(document.querySelectorAll('details.facet-expand[open]')))d.open=false;}});
function subscribeScope(listener){listener(getScopeItems());scopeListeners.add(listener);return function(){scopeListeners.delete(listener);};}
function inspectItem(id){return reveal(id);}
function showItems(selection){drilldown={label:selection.label,itemIds:Array.from(selection.itemIds)};try{if(typeof setSection==='function'&&document.getElementById('section-items'))setSection('items',false);}catch(e){}apply();}
window.wowbaggerReport={getScopeItems:getScopeItems,subscribeScope:subscribeScope,inspectItem:inspectItem,showItems:showItems,impactById:impactById};
setSection('items',false);applyHistory();apply();`;
}

function renderItemList(model) {
  const rows = model.workNext.map((entry) => {
    const anchor = `item-${entry.number === null ? entry.id : entry.number}`;
    const handle = entry.number === null ? entry.id : `#${entry.number}`;
    const reasons = entry.reasons.map((reason) => `<span class="reason reason-${escapeHtml(reason.code)}">${escapeHtml(reason.label)}</span>`).join('');
    return `<li><a class="row-link" href="#${escapeHtml(anchor)}" data-reveal="${escapeHtml(anchor)}" aria-labelledby="row-work-next-${escapeHtml(anchor)}-name" aria-describedby="row-work-next-${escapeHtml(anchor)}-detail"><span class="summary-main" id="row-work-next-${escapeHtml(anchor)}-name"><span class="handle">${escapeHtml(handle)}</span><span class="title">${escapeHtml(entry.title)}</span></span><p class="why" id="row-work-next-${escapeHtml(anchor)}-detail">${reasons}</p></a></li>`;
  }).join('');
  const historyRows = model.terminalItems.map((item) => {
    const anchor = `item-${item.number === null ? item.id : item.number}`;
    const handle = item.number === null ? item.id : `#${item.number}`;
    return `<li><a class="row-link" href="#${escapeHtml(anchor)}" data-reveal="${escapeHtml(anchor)}" aria-labelledby="row-history-${escapeHtml(anchor)}-name" aria-describedby="row-history-${escapeHtml(anchor)}-detail"><span class="summary-main" id="row-history-${escapeHtml(anchor)}-name"><span class="handle">${escapeHtml(handle)}</span><span class="title">${escapeHtml(item.title)}</span></span><p class="why" id="row-history-${escapeHtml(anchor)}-detail"><span class="muted">${escapeHtml(item.status)} \u00b7 terminal</span></p></a></li>`;
  }).join('');
  const unknown = model.unknownClasses.length === 0 ? '' : `<p class="notice">Unrecognised class values, ranked as standard: ${model.unknownClasses.map((entry) => `${escapeHtml(entry.value)} (${entry.numbers.map((number) => `#${number}`).join(', ')})`).join('; ')}</p>`;
  return `${unknown}<ol id="item-list" class="ranked">${rows}</ol>${historyRows === '' ? '' : `<h3>History</h3><ol id="item-history" class="plain">${historyRows}</ol>`}`;
}

export function renderReportHtml(model, { logoDataUrl = null, graphBundle } = {}) {
  const graph = buildGraphModel(model);
  const retainedItems = [...model.items, ...model.terminalItems];
  const selectionItems = retainedItems.map((item, index) => ({
    id: item.id,
    number: item.number,
    title: item.title,
    status: item.status,
    kind: item.kind,
    priority: item.priority,
    created: item.created,
    terminalDate: item.terminalDate,
    readiness: { state: item.readiness.state },
    fields: item.fields,
    order: index,
  }));
  const workNextIds = model.workNext.map((entry) => entry.id);
  const workNextById = Object.fromEntries(model.workNext.map((entry) => [entry.id, { reasons: entry.reasons, number: entry.number, title: entry.title }]));
  const reportDataJson = scriptJson({ items: selectionItems, workNextIds, workNextById, impactById: model.impactById ?? {} });
  const fieldNames = [...new Set(retainedItems.flatMap((item) => Object.keys(item.fields)))].sort();
  const groupOptions = [
    ['none', 'No grouping'],
    ['readiness', 'Readiness'],
    ['status', 'Status'],
    ...fieldNames.map((name) => [`field:${name}`, fieldLabel(name)]),
  ];
  const sortOptions = [
    ['default', 'Report order'],
    ['priority', 'Priority'],
    ['created', 'Created date'],
    ['title', 'Title'],
    ...fieldNames.map((name) => [`field:${name}`, fieldLabel(name)]),
  ];
  const facets = facetGroups(retainedItems, fieldNames);
  const logo = logoDataUrl === null ? '' : `<img class="logo" src="${escapeHtml(logoDataUrl)}" alt="">`;
  const stats = [
    ['Total', model.stats.total],
    ['Open', model.stats.open],
    ['Terminal', model.stats.terminal],
    ['Ready', model.stats.ready],
    ['Blocked', model.stats.blocked],
    ['Ineligible', model.stats.ineligible],
  ];
  const markdownRuntime = markdownBrowserSource().replaceAll('</script', '<\\/script');
  const interactionRuntime = reportClientSource().replaceAll('</script', '<\\/script');
  const graphRuntime = graphClientSource(graph).replaceAll('</script', '<\\/script');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(model.title)}</title><style>${styleSource()}${graphStyleSource()}.history-toggle{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer}.controls .history-toggle input{min-width:0;flex:none;margin:0;padding:0}${viewContextStyleSource(model.view)}</style></head><body data-richness="standard" data-section="items"><main class="shell">
<header class="masthead"><div class="identity">${logo}<div><p class="eyebrow">${escapeHtml(model.repository.name)}</p><h1>${escapeHtml(model.title)}</h1></div></div><div class="as-of">Ledger state<br><strong>${escapeHtml(model.asOf)}</strong></div></header>${renderViewContext(model.view, model.repository.name)}
<nav class="view-nav" aria-label="Report sections"><button type="button" id="nav-items" data-section="items" aria-pressed="true">Items</button><button type="button" id="nav-flow" data-section="flow" aria-pressed="false">Flow</button><button type="button" id="nav-dependencies" data-section="dependencies" aria-pressed="false">Dependencies</button></nav><noscript><p>Sections: <a href="#section-items">Items</a> · <a href="#section-flow">Flow</a> · <a href="#section-dependencies">Dependencies</a>. Fixed scope: all retained items; filters require scripting.</p></noscript>
<section id="section-items" data-section="items"><div class="section-heading"><div><p class="eyebrow">Workspace</p><h2>Items</h2></div><p class="muted">One canonical list and one detail per retained item. Scope narrows summaries, flow, and graph; quick views change only the list.</p></div>
<section class="stats" aria-label="Ledger summary">${stats.map(([label, value]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('')}</section>
<div id="sticky-controls" class="sticky-controls controls panel" aria-label="Scope and display controls"><label class="sr-only" for="search">Search items</label><input id="search" type="search" placeholder="Search ID, number, title, or mapped fields">${renderQuickViews()}<div id="items-presentation"><select id="group-by" aria-label="Group items">${groupOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select><select id="sort-by" aria-label="Sort items">${sortOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select><select id="richness" aria-label="Detail level"><option value="basic">Basic</option><option value="standard" selected>Standard</option><option value="detailed">Detailed</option></select><label class="history-toggle"><input id="show-history" type="checkbox" checked>Show history</label><button type="button" id="expand-all">Expand all</button><button type="button" id="collapse-all">Collapse all</button></div><div id="active-scope" aria-live="polite"></div></div>
${renderFacets(facets, retainedItems.length)}
<section aria-label="Item browser"><div class="section-heading"><div><p class="eyebrow">Current work</p><h2>Ledger items</h2></div><p class="muted">One canonical list and one detail per retained item. Work next keeps its rank and reasons.</p></div>${renderAttentionSummary(model.attention, model.items)}${renderAreaMatrix(model.items, model.itemNumbers)}${renderCoverage(model.fieldCoverage ?? [])}<div id="drilldown-pill" hidden><span id="drilldown-label"></span> <button type="button" id="clear-drilldown">Clear drilldown</button></div><div id="workspace-split"><div id="list-column">${renderItemList(model)}${model.view === null || model.items.length > 0 || model.terminalItems.length > 0 ? `<p id="empty" class="empty" hidden>No items match these filters.</p><p id="history-explain" class="empty" hidden>A terminal status is selected while history is hidden. <button type="button" id="show-history-action">Show history</button></p>` : `<p id="empty" class="empty">No ledger item matches this view's criteria.</p><p id="history-explain" class="empty" hidden>A terminal status is selected while history is hidden. <button type="button" id="show-history-action">Show history</button></p>`}</div><div id="detail-column"><div id="items" class="items">${(() => { const retainedIds = new Set([...model.items, ...model.terminalItems].map((item) => item.id)); return retainedItems.map((item, index) => renderCard(item, index, model.itemNumbers, retainedIds, model.impactById ?? {})).join(''); })()}</div><div id="detail-pane" aria-live="polite"></div></div></div>${renderSwarm(model.swarmBatches, model.swarm)}
</section>
<section id="section-flow" data-section="flow" hidden><div class="section-heading"><div><p class="eyebrow">Flow</p><h2>Flow</h2></div><p class="muted">Scoped cumulative flow, arrivals, completions, closures, age, durations, and forecast.</p></div><p class="scope-caption" id="flow-scope"></p>${renderEvidence(model.evidence, model.asOf)}</section>
<section id="section-dependencies" data-section="dependencies" hidden><div class="section-heading"><div><p class="eyebrow">Dependencies</p><h2>Dependencies</h2></div><p class="muted">Ledger graph and roster share the current scope.</p></div><p class="scope-caption" id="graph-scope"></p>${graphSection(graph, graphBundle.manifest, model.view)}</section>
<script id="report-data" type="application/json">${reportDataJson}</script>
</main><script>${markdownRuntime}</script><script>${interactionRuntime}</script><script>${graphBundle.source}</script><script>${graphRuntime}</script></body></html>`;
}
