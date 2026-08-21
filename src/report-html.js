import { markdownBrowserSource } from './report-markdown.js';
import { READINESS_REASON_LABELS } from './report.js';
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
    badges.push(`<span class="badge mapped">${escapeHtml(fieldLabel(name))}: ${escapeHtml(value)}</span>`);
  }
  return badges.join('');
}

function renderReasons(item, numbersById) {
  if (item.readiness.reasons.length === 0) {
    return '<span class="muted">No blockers.</span>';
  }
  return `<ul class="reasons">${item.readiness.reasons.map((reason) => {
    const label = READINESS_REASON_LABELS[reason.code] ?? reason.code;
    const related = reason.item_id === undefined ? '' : `: ${escapeHtml(handleFor(reason.item_id, numbersById))}`;
    return `<li>${escapeHtml(label)}${related}</li>`;
  }).join('')}</ul>`;
}

// An item the ledger knows is named by its number. An ID with no number is
// either a schema-1 item or a dangling reference, and the raw ID is then the
// only handle there is.
function handleFor(id, numbersById) {
  const number = numbersById.get(id);
  return number === undefined || number === null ? id : `#${number}`;
}

function renderRelations(item, numbersById) {
  const rows = [
    ['Parent', item.parent === null ? [] : [item.parent]],
    ['Depends on', item.dependsOn],
    ['Related', item.related],
  ].filter(([, values]) => values.length > 0);
  if (rows.length === 0) {
    return '<span class="muted">No relations.</span>';
  }
  return `<dl class="relations">${rows.map(([label, values]) => `<dt>${label}</dt><dd>${values.map((value) => escapeHtml(handleFor(value, numbersById))).join(', ')}</dd>`).join('')}</dl>`;
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

function renderCard(item, index, numbersById) {
  const handle = item.number === null ? item.id : `#${item.number}`;
  const searchText = [handle, item.id, item.title, item.kind, item.status, ...Object.values(item.fields)]
    .join(' ')
    .toLocaleLowerCase('en-US');
  const latestDecision = item.decisions.at(-1);
  const summaryPreview = bodyExcerpt(item.body, 120);
  return `<details class="card" id="${itemAnchor(item)}" data-item data-order="${index}" data-state="${escapeHtml(item.readiness.state)}" data-status="${escapeHtml(item.status)}" data-kind="${escapeHtml(item.kind)}" data-priority="${item.priority ?? ''}" data-created="${escapeHtml(item.created)}" data-title="${escapeHtml(item.title.toLocaleLowerCase('en-US'))}" data-fields="${escapeHtml(JSON.stringify(item.fields))}" data-search="${escapeHtml(searchText)}">
<summary><span class="summary-main"><span class="handle">${escapeHtml(handle)}</span><span class="title">${escapeHtml(item.title)}</span></span><span class="badges">${renderBadges(item)}</span><span class="summary-context standard-only">${summaryContext(item)}</span>${summaryPreview === '' ? '' : `<span class="summary-preview detailed-only">${escapeHtml(summaryPreview)}</span>`}</summary>
<div class="card-detail">
<div class="basic-grid"><section><h3>Readiness</h3>${renderReasons(item, numbersById)}</section><section><h3>Dates</h3><p>Created ${escapeHtml(item.created)}<br>Updated ${escapeHtml(item.updated)}</p></section></div>
<section class="standard-only"><h3>Relations</h3>${renderRelations(item, numbersById)}</section>
<section class="standard-only"><h3>Latest decision</h3>${latestDecision === undefined ? '<span class="muted">No decisions.</span>' : renderDecisions({ decisions: [latestDecision] })}</section>
<section class="body-excerpt standard-only"><h3>Body excerpt</h3><p>${escapeHtml(bodyExcerpt(item.body))}</p></section>
<section class="detailed-only"><h3>Decision history</h3>${renderDecisions(item)}</section>
<section class="body-section detailed-only"><h3>Item body</h3><script type="text/markdown">${scriptJson(item.body)}</script><div class="rendered-markdown" data-rendered="0"></div><noscript><pre>${escapeHtml(item.body)}</pre></noscript></section>
</div>
</details>`;
}

function numberHandle(item) {
  return item.number === null ? item.id : `#${item.number}`;
}

// An item named above the drill-down is a way into it. The whole row is the
// link, so the pointer target is the reading target, and the href alone
// reaches the canonical card when scripting is off.
//
// A free-text aria-label would replace every node inside the anchor, costing
// the reader the reasons and facts the row exists to state, so the row names
// itself with its own handle and title and describes itself with its own detail
// line. The collection scope keeps the ids unique where one item is on two
// lists.
function rowLink(entry, scope, content) {
  const anchor = itemAnchor(entry);
  const nameId = `row-${scope}-${anchor}-name`;
  const detailId = `row-${scope}-${anchor}-detail`;
  return `<a class="row-link" href="#${anchor}" data-reveal="${anchor}" aria-labelledby="${nameId}" aria-describedby="${detailId}">${content(nameId, detailId)}</a>`;
}

// The ranked list is the report. Each entry states the factors that placed it,
// in the order the comparison steps ran, so the reader can disagree with a
// position by pointing at a reason instead of at a score.
function renderWorkNext(entries, unknownClasses) {
  const notice = unknownClasses.length === 0
    ? ''
    : `<p class="notice">Unrecognised class values, ranked as standard: ${unknownClasses.map((entry) => `${escapeHtml(entry.value)} (${entry.numbers.map((number) => `#${number}`).join(', ')})`).join('; ')}</p>`;
  const body = entries.length === 0
    ? '<p class="muted">No ready items.</p>'
    : `<ol class="ranked">${entries.map((entry) => `<li>${rowLink(entry, 'work-next', (nameId, detailId) => `<span class="summary-main" id="${nameId}"><span class="handle">${escapeHtml(numberHandle(entry))}</span><span class="title">${escapeHtml(entry.title)}</span></span><p class="why" id="${detailId}">${entry.reasons.map((reason) => `<span class="reason reason-${escapeHtml(reason.code)}">${escapeHtml(reason.label)}</span>`).join('')}</p>`)}</li>`).join('')}</ol>`;
  return `<section id="work-next" class="panel"><div class="section-heading"><div><p class="eyebrow">Recommended order</p><h2>Work next</h2></div><p class="muted">Ready items only. Derived at render time; the deterministic <code>ready</code> queue is unchanged.</p></div>${notice}${body}</section>`;
}

// Every attention row is the same shape: the handle and title as the row's
// name, one muted line of the facts that put the item on this list, and the
// whole row as the way into the item.
function attentionList(entries, scope, emptyMessage, detail) {
  if (entries.length === 0) {
    return `<p class="muted">${emptyMessage}</p>`;
  }
  return `<ul class="plain">${entries.map((entry) => `<li>${rowLink(entry, scope, (nameId, detailId) => `<span class="row-name" id="${nameId}"><span class="handle">${escapeHtml(numberHandle(entry))}</span> ${escapeHtml(entry.title)}</span><br><span class="muted" id="${detailId}">${detail(entry)}</span>`)}</li>`).join('')}</ul>`;
}

function renderAttention(attention) {
  const blocked = attentionList(attention.blocked, 'blocked', 'Nothing blocked.', (entry) => `blocked by ${entry.blockers.map((blocker) => `${escapeHtml(numberHandle(blocker))}${blocker.status === null ? '' : ` (${escapeHtml(blocker.status)})`}`).join(', ')} · age ${entry.ageDays}d`);
  const aging = attentionList(attention.aging, 'aging', 'No open items.', (entry) => `age ${entry.ageDays}d · ${escapeHtml(entry.status)} · ${escapeHtml(entry.state)}`);
  const stuck = attentionList(attention.stuck, 'stuck', 'Nothing started is past the historical 85th percentile.', (entry) => `${entry.elapsedDays}d since accept ${escapeHtml(entry.startedOn)} · p85 ${entry.thresholdDays}d`);

  return `<section id="attention" class="panel"><div class="section-heading"><div><p class="eyebrow">Needs a decision</p><h2>Attention</h2></div><p class="muted">Blocked work, the oldest open work, and started work past this ledger's own 85th-percentile cycle time.</p></div><div class="attention-grid"><section><h3>Blocked</h3>${blocked}${renderTruncation(attention.blocked, attention.blockedTotal)}</section><section><h3>Aging</h3>${aging}${renderTruncation(attention.aging, attention.agingTotal)}</section><section><h3>Past p85</h3>${stuck}${renderTruncation(attention.stuck, attention.stuckTotal)}</section></div></section>`;
}

// A shortened list has to say so. Silent truncation reads as "that is all of
// it", which is the one thing an attention list must never imply.
function renderTruncation(shown, total) {
  return shown.length >= total
    ? ''
    : `<p class="muted truncation">Showing ${shown.length} of ${total}. The rest are in the drill-down.</p>`;
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
  const flow = `<div class="table-scroll"><table><thead><tr><th>Week</th><th>Arrivals</th><th>Completions</th><th>Net</th><th>4-week mean</th></tr></thead><tbody>${evidence.weeks.map((week) => `<tr><td>${escapeHtml(week.weekStart)}</td><td>${week.arrivals}</td><td>${week.completions}</td><td>${week.arrivals - week.completions > 0 ? '+' : ''}${week.arrivals - week.completions}</td><td>${week.rolling === null ? '—' : week.rolling}</td></tr>`).join('')}</tbody></table></div>`;
  const cycle = evidence.cycleTime.sampleCount === 0
    ? '<p class="muted">No accept-to-complete history yet.</p>'
    : `<p>Median <strong>${evidence.cycleTime.medianDays}d</strong> · p85 <strong>${evidence.cycleTime.p85Days}d</strong><br><span class="muted">${evidence.cycleTime.sampleCount} completed items, accept to complete.</span></p>`;
  const forecast = evidence.forecast === null
    ? '<p class="muted">No completions in the window, so no forecast.</p>'
    : `<p><strong>${evidence.forecast.remaining}</strong> open items remaining.<br>50% by <strong>${escapeHtml(evidence.forecast.date50)}</strong> (${evidence.forecast.weeks50} weeks)<br>85% by <strong>${escapeHtml(evidence.forecast.date85)}</strong> (${evidence.forecast.weeks85} weeks)<br>95% by <strong>${escapeHtml(evidence.forecast.date95)}</strong> (${evidence.forecast.weeks95} weeks)<br><span class="muted">${evidence.forecast.trials} Monte Carlo trials resampling observed weekly throughput.</span></p>`;

  const rows = [
    chartRow(
      'Chance of finishing by',
      forecastChart(evidence.forecast, asOf),
      '<span class="key key-50">50%</span><span class="key key-85">85%</span><span class="key key-95">95%</span> of Monte Carlo trials.',
    ),
    chartRow(
      'Arrivals against completions',
      weeklyFlowChart(evidence.weeks),
      '<span class="key key-arrival">Arrivals</span><span class="key key-completion">Completions</span>',
      flow,
    ),
    chartRow(
      'Throughput and its four-week mean',
      throughputChart(evidence.weeks),
      '<span class="key key-completion">Completions</span><span class="key key-rolling">4-week mean</span>',
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

  return `<section id="evidence" class="panel"><div class="section-heading"><div><p class="eyebrow">Evidence</p><h2>Flow and forecast</h2></div><p class="muted">Reconstructed from item dates in this ledger. No stored snapshots.</p></div><div class="evidence-grid"><section><h3>Throughput</h3><p><strong>${evidence.throughput.perWeek}</strong> items/week<br><span class="muted">${evidence.throughput.total} completions over ${evidence.throughput.windowWeeks} weeks.</span></p></section><section><h3>Cycle time</h3>${cycle}</section><section><h3>Forecast</h3>${forecast}</section></div>${rows}</section>`;
}

function renderTerminalTable(items) {
  if (items.length === 0) {
    return '<p class="muted">No completed, killed, deferred, or archived items.</p>';
  }
  return `<div class="table-scroll"><table><thead><tr><th>Item</th><th>Title</th><th>Status</th><th>Date</th><th>Decision</th></tr></thead><tbody>${items.map((item) => {
    const handle = item.number === null ? item.id : `#${item.number}`;
    const decision = item.decisions.at(-1)?.summary ?? '';
    return `<tr><td>${escapeHtml(handle)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.terminalDate)}</td><td>${escapeHtml(decision)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderSwarm(batches) {
  if (batches.length === 0) {
    return '';
  }
  return `<section class="panel swarm"><div class="section-heading"><div><p class="eyebrow">Parallel work</p><h2>Swarm candidates</h2></div><p class="muted">Ready items only. Each batch contains no repeated mapped area.</p></div><div class="batch-grid">${batches.map((batch, index) => `<section class="batch"><h3>Batch ${index + 1}</h3><ol>${batch.map((item) => `<li><span>${escapeHtml(item.number === null ? item.id : `#${item.number}`)}</span> ${escapeHtml(item.title)}</li>`).join('')}</ol></section>`).join('')}</div></section>`;
}

// A facet group is one dimension of the open set: readiness, lifecycle status,
// kind, and one group for every configured mapped field. A mapped field the
// item does not carry has no value in that dimension, so it answers no chip
// there rather than answering all of them.
function facetValue(item, key) {
  if (key === 'readiness') {
    return item.readiness.state;
  }
  if (key === 'status') {
    return item.status;
  }
  if (key === 'kind') {
    return item.kind;
  }
  const value = item.fields[key.slice(6)];
  return value === undefined ? null : String(value);
}

function observedValues(items, key) {
  return [...new Set(items.map((item) => facetValue(item, key)).filter((value) => value !== null))].sort();
}

// Readiness and kind are the schema's own closed vocabularies, so every value
// is offered whether or not the open set currently holds one; a chip counting
// zero is a fact about the ledger. Status and the mapped fields are open, so
// only what the open cards actually carry is offered.
function facetGroups(items, fieldNames) {
  const declared = [
    { key: 'readiness', label: 'Readiness', values: ['ready', 'blocked', 'ineligible'] },
    { key: 'status', label: 'Status', values: observedValues(items, 'status') },
    { key: 'kind', label: 'Kind', values: ['task', 'epic'] },
    ...fieldNames.map((name) => ({
      key: `field:${name}`,
      label: fieldLabel(name),
      values: observedValues(items, `field:${name}`),
    })),
  ];
  return declared.filter((group) => group.values.length > 0).map((group) => ({
    key: group.key,
    label: group.label,
    options: group.values.map((value) => ({
      value,
      label: group.key === 'readiness' ? READINESS_LABELS[value] : value,
      count: items.filter((item) => facetValue(item, group.key) === value).length,
    })),
  }));
}

// The chip is a checkbox inside its own label, so holding two values at once is
// the control's own semantics rather than a state the runtime paints onto a
// button. The count is part of the label, so the reader hears "Ready 4" and
// knows what selecting it would leave.
function renderFacets(groups, total) {
  const head = `<div class="facets-head"><p id="result-count" class="result-count" role="status" aria-live="polite">Showing ${total} of ${total} ${total === 1 ? 'item' : 'items'}</p><button type="button" id="clear-facets">Clear filters</button></div>`;
  const chips = (group) => group.options.map((option) => `<label class="chip"><input type="checkbox" class="facet" data-group="${escapeHtml(group.key)}" value="${escapeHtml(option.value)}"><span class="chip-text">${escapeHtml(option.label)}</span> <span class="chip-count">${option.count}</span></label>`).join('');
  return `<section id="facets" class="facets panel" aria-label="Filter items">${head}${groups.map((group) => `<fieldset class="facet-group" data-group="${escapeHtml(group.key)}"><legend>${escapeHtml(group.label)}</legend><div class="chips">${chips(group)}</div></fieldset>`).join('')}</section>`;
}

function styleSource() {
  return `:root{color-scheme:light;--canvas:#f3f0e9;--surface:#fffdf8;--ink:#20231f;--muted:#687069;--line:#d9d7ce;--navy:#15324a;--ready:#1e6b4f;--ready-bg:#e6f3ec;--blocked:#9b4b21;--blocked-bg:#f9e9df;--ineligible:#60666a;--ineligible-bg:#eceeef;--focus:#0b67b2;--shadow:0 10px 28px rgba(32,35,31,.07)}*{box-sizing:border-box}html{background:var(--canvas);color:var(--ink);font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0}button,input,select{font:inherit}button,select,input{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}button,select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,.row-link:focus-visible{outline:3px solid color-mix(in srgb,var(--focus) 35%,transparent);outline-offset:2px}.shell{width:min(1500px,100%);margin:auto;padding:28px 36px 56px}.masthead{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:4px 0 26px}.identity{display:flex;align-items:center;gap:16px}.logo{width:48px;height:48px;object-fit:contain}.eyebrow{margin:0 0 4px;color:var(--muted);font-size:.75rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.masthead h1,.section-heading h2{margin:0;font-family:ui-serif,Georgia,serif;color:var(--navy);line-height:1.1}.masthead h1{font-size:clamp(1.8rem,4vw,3rem)}.as-of{text-align:right;color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:16px}.stat,.panel{border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}.stat{padding:14px}.stat strong{display:block;color:var(--navy);font-size:1.55rem}.stat span{color:var(--muted)}.controls{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px;margin-bottom:18px;background:color-mix(in srgb,var(--surface) 95%,transparent);backdrop-filter:blur(10px)}.controls input{min-width:min(320px,100%);flex:1;padding:9px 11px}.controls select,.controls button{padding:8px 10px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:14px}.section-heading p{margin:0}.items{display:grid;gap:18px}.group h2{margin:0 0 8px;color:var(--navy);font:700 1.05rem/1.2 ui-sans-serif,-apple-system,sans-serif}.card-grid{display:grid;grid-template-columns:1fr;gap:12px}.card{min-width:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 3px 12px rgba(32,35,31,.04);overflow:hidden}.card[open]{box-shadow:var(--shadow)}summary{display:block;padding:14px;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.summary-main{display:flex;gap:8px;align-items:baseline}.handle{flex:none;color:var(--navy);font-variant-numeric:tabular-nums;font-weight:800}.title{font-weight:700;overflow-wrap:anywhere}.badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.badge{display:inline-flex;border-radius:999px;background:#efeee9;padding:2px 8px;color:#4d534e;font-size:.73rem;font-weight:700}.badge.state-ready{background:var(--ready-bg);color:var(--ready)}.badge.state-blocked{background:var(--blocked-bg);color:var(--blocked)}.badge.state-ineligible{background:var(--ineligible-bg);color:var(--ineligible)}.badge.mapped{background:#e8edf2;color:var(--navy)}.card-detail{border-top:1px solid var(--line);padding:16px}.card-detail h3,.batch h3{margin:0 0 7px;color:var(--navy);font-size:.83rem;letter-spacing:.04em;text-transform:uppercase}.card-detail p{margin:0}.basic-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.standard-only,.detailed-only,.body-section{margin-top:18px}.reasons,.decisions{margin:0;padding-left:20px}.relations{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}.relations dt{font-weight:700}.relations dd{margin:0;overflow-wrap:anywhere}.rendered-markdown{overflow-wrap:anywhere}.rendered-markdown h1,.rendered-markdown h2,.rendered-markdown h3{font-family:ui-serif,Georgia,serif;text-transform:none;letter-spacing:0}.rendered-markdown pre,noscript pre{overflow:auto;border-radius:8px;background:#202622;color:#f5f7f3;padding:12px}.rendered-markdown code{border-radius:4px;background:#eeece6;padding:1px 4px}.rendered-markdown pre code{background:transparent;padding:0}.rendered-markdown a{color:#075fa7}.rendered-markdown table,table{width:100%;border-collapse:collapse}.rendered-markdown th,.rendered-markdown td,th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}.panel{margin-top:26px;padding:18px}.facets{margin-top:0;margin-bottom:18px}.facets-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.facets-head button{padding:8px 10px}.result-count{margin:0;color:var(--muted);font-weight:700}.facet-group{margin:0;border:0;padding:12px 0 0}.facet-group>legend{padding:0;color:var(--muted);font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;background:#fff;padding:5px 11px;font-size:.8rem;font-weight:700;cursor:pointer}.chip input{flex:none;width:13px;height:13px;margin:0;border-radius:3px;accent-color:var(--navy)}.chip-count{color:var(--muted);font-variant-numeric:tabular-nums}.chip.selected{border-color:var(--navy);background:var(--navy);color:#fff}.chip.selected .chip-count{color:#c8d3dd}.chip:focus-within{outline:3px solid color-mix(in srgb,var(--focus) 35%,transparent);outline-offset:2px}.table-scroll{overflow-x:auto}.batch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.batch{border:1px solid var(--line);border-radius:9px;padding:12px}.batch ol{margin:0;padding-left:22px}.muted{color:var(--muted)}.empty{padding:32px;text-align:center;color:var(--muted)}body[data-richness="basic"] .standard-only,body[data-richness="basic"] .detailed-only,body[data-richness="standard"] .detailed-only{display:none}.summary-context{display:block;margin-top:9px;color:var(--muted);font-size:.8rem}.summary-preview{display:block;margin-top:7px;padding-left:9px;border-left:2px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.8rem}[hidden]{display:none!important}@media(min-width:851px){.card{scroll-margin-top:140px}}@media(max-width:850px){.shell{padding:20px 16px 40px}.stats{grid-template-columns:repeat(3,1fr)}.masthead,.section-heading{align-items:flex-start;flex-direction:column}.as-of{text-align:left}.controls{position:static}.basic-grid{grid-template-columns:1fr}}@media(max-width:480px){.stats{grid-template-columns:repeat(2,1fr)}.controls>*{width:100%}.summary-main{align-items:flex-start;flex-direction:column}.card-detail{padding:13px}}@media(prefers-reduced-motion:no-preference){.card{transition:box-shadow .15s ease,border-color .15s ease}.chip{transition:background-color .15s ease,color .15s ease}}.row-link{display:block;color:inherit;text-decoration:none}.ranked{counter-reset:rank;margin:0;padding:0;list-style:none;display:grid;gap:9px}.ranked li{counter-increment:rank;border:1px solid var(--line);border-radius:9px;background:#fff}.ranked .row-link{position:relative;padding:12px 14px 12px 52px}.ranked .row-link::before{content:counter(rank);position:absolute;left:14px;top:12px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--navy);color:#fff;font-variant-numeric:tabular-nums;font-weight:800;font-size:.8rem}.why{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0}.reason{display:inline-flex;border-radius:999px;background:#eef1f4;padding:2px 9px;color:var(--navy);font-size:.74rem;font-weight:700}.reason-class,.reason-class-unknown,.reason-due{background:var(--blocked-bg);color:var(--blocked)}.reason-leverage,.reason-epic{background:var(--ready-bg);color:var(--ready)}.notice{margin:0 0 12px;border-left:3px solid var(--blocked);background:var(--blocked-bg);padding:8px 12px;color:var(--blocked)}.attention-grid,.evidence-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}.attention-grid h3,.evidence-grid h3,.chart-row h3{margin:0 0 8px;color:var(--navy);font-size:.83rem;letter-spacing:.04em;text-transform:uppercase}.attention-grid p,.evidence-grid p{margin:0}.plain{margin:0;padding:0;list-style:none;display:grid;gap:9px}.plain li{border-bottom:1px solid var(--line)}.plain li:last-child{border-bottom:0}.plain .row-link{padding-bottom:8px}.plain li:last-child .row-link{padding-bottom:0}.chart-row{margin-top:20px}.chart-figure{margin:0 0 12px}.chart{display:block;width:100%;height:auto}.chart-compact{max-width:min(100%,460px)}.chart-axis{stroke:var(--line);stroke-width:1}.chart-grid{stroke:var(--line);stroke-width:1;stroke-dasharray:3 3}.chart-tick{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}.chart-value{fill:var(--navy);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}.chart-total{fill:var(--ink);font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}.chart-head{fill:var(--muted);font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.chart-label{fill:var(--ink);font-size:11px}.bar-arrival{fill:#a8bccb}.bar-completion{fill:var(--ready)}.heat{fill:var(--navy)}.rolling{fill:none;stroke:var(--blocked);stroke-width:2;stroke-linejoin:round}.fan{fill:var(--ready);fill-opacity:.28;stroke:var(--ready);stroke-width:1.5}.mark-50,.mark-85,.mark-95{stroke:var(--navy);stroke-width:1.5;stroke-dasharray:2 2}.band-terminal{fill:var(--ready);fill-opacity:.75}.band-accepted{fill:#7fae97}.band-triage{fill:#cddbd3}.sample{fill:var(--navy);fill-opacity:.55}.percentile-50{stroke:var(--navy);stroke-width:1.5;stroke-dasharray:5 3}.percentile-85{stroke:var(--blocked);stroke-width:1.5;stroke-dasharray:5 3}figcaption{display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;color:var(--muted);font-size:.78rem}.key{display:inline-flex;align-items:center;gap:6px}.key::before{content:"";width:11px;height:11px;border-radius:3px;background:currentColor}.key-arrival{color:#a8bccb}.key-completion,.key-terminal{color:var(--ready)}.key-rolling,.key-p85{color:var(--blocked)}.key-p50{color:var(--navy)}.key-accepted{color:#7fae97}.key-triage{color:#cddbd3}.key-50,.key-85,.key-95{color:var(--ready)}#work-next,#attention,#evidence{margin-top:22px}#drilldown{margin-top:34px;border-top:2px solid var(--line);padding-top:22px}#drilldown .stats{margin-top:14px}`;
}

// The one runtime the report ships. Exported so a test can execute it rather
// than read it: a case that asserts on this string proves nothing about what
// the browser does with it.
export function reportClientSource() {
  return `'use strict';
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
const parsedFields=new Map();
function fields(card){if(!parsedFields.has(card))parsedFields.set(card,JSON.parse(card.dataset.fields));return parsedFields.get(card);}
function fieldValue(card,key){const value=fields(card)[key];return value===undefined?'':String(value);}
function groupLabel(card){const key=groupBy.value;if(key==='none')return 'All items';if(key==='readiness')return card.dataset.state;if(key==='status')return card.dataset.status;if(key.startsWith('field:'))return fieldValue(card,key.slice(6))||'Unclassified';return 'Unclassified';}
function compareText(left,right){return left<right?-1:left>right?1:0;}
function facetDimension(card,group){if(group==='readiness')return card.dataset.state;if(group==='status')return card.dataset.status;if(group==='kind')return card.dataset.kind;if(group.startsWith('field:')){const value=fields(card)[group.slice(6)];return value===undefined?undefined:String(value);}return undefined;}
function selectedFacets(){const groups=new Map();for(const chip of facetChips){if(!chip.input.checked)continue;const key=chip.input.dataset.group;if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(chip.input.value);}return groups;}
function clearFacets(){for(const chip of facetChips)chip.input.checked=false;}
function matchesFacets(card,groups,except){for(const [key,values] of groups){if(key!==except&&!values.has(facetDimension(card,key)))return false;}return true;}
function matchesSearch(card,term){return !term||card.dataset.search.includes(term);}
function compareCards(left,right){const key=sortBy.value;if(key==='default')return Number(left.dataset.order)-Number(right.dataset.order);if(key==='priority'){const a=left.dataset.priority===''?null:Number(left.dataset.priority);const b=right.dataset.priority===''?null:Number(right.dataset.priority);if(a===null||b===null)return a===b?Number(left.dataset.order)-Number(right.dataset.order):a===null?1:-1;return a-b||Number(left.dataset.order)-Number(right.dataset.order);}if(key==='created')return compareText(left.dataset.created,right.dataset.created)||Number(left.dataset.order)-Number(right.dataset.order);if(key==='title')return compareText(left.dataset.title,right.dataset.title)||Number(left.dataset.order)-Number(right.dataset.order);if(key.startsWith('field:'))return compareText(fieldValue(left,key.slice(6)),fieldValue(right,key.slice(6)))||Number(left.dataset.order)-Number(right.dataset.order);return 0;}
function applyHistory(){history.hidden=!showHistory.checked;}
// Values inside a group are alternatives and groups narrow each other, so each
// chip is counted in the cohort the search and the other groups already left,
// never its own: two selections in one group cannot make their siblings zero.
function refreshChips(searched,chosen){for(const [group,chips] of chipsByGroup){const counts=new Map();for(const card of searched){if(!matchesFacets(card,chosen,group))continue;const value=facetDimension(card,group);counts.set(value,(counts.get(value)??0)+1);}for(const chip of chips){chip.chip.classList.toggle('selected',chip.input.checked);chip.count.textContent=String(counts.get(chip.input.value)??0);}}}
function apply(){const term=search.value.trim().toLocaleLowerCase('en-US');const chosen=selectedFacets();const searched=cards.filter(card=>matchesSearch(card,term));const visible=searched.filter(card=>matchesFacets(card,chosen)).sort(compareCards);const groups=new Map();for(const card of visible){const label=groupLabel(card);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(card);}itemRoot.replaceChildren();for(const [label,members] of groups){const section=document.createElement('section');section.className='group';if(groupBy.value!=='none'){const heading=document.createElement('h2');heading.textContent=label+' ('+members.length+')';section.append(heading);}const grid=document.createElement('div');grid.className='card-grid';grid.append(...members);section.append(grid);itemRoot.append(section);}empty.hidden=visible.length!==0;refreshChips(searched,chosen);resultCount.textContent='Showing '+visible.length+' of '+cards.length+(cards.length===1?' item':' items');}
function renderBody(card){const target=card.querySelector('.rendered-markdown');if(target.dataset.rendered==='1')return;const source=card.querySelector('script[type="text/markdown"]');target.innerHTML=window.renderMarkdown(JSON.parse(source.textContent));target.dataset.rendered='1';}
for(const card of cards){card.addEventListener('toggle',()=>{if(card.open)renderBody(card);});}
function revealOffset(){const controls=document.querySelector('.controls');return window.getComputedStyle(controls).position==='sticky'?controls.getBoundingClientRect().height+12:0;}
function reveal(id){const target=cards.find(card=>card.id===id);if(target===undefined)return false;search.value='';clearFacets();apply();target.open=true;renderBody(target);target.style.scrollMarginTop=revealOffset()+'px';target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});target.querySelector('summary').focus({preventScroll:true});return true;}
for(const link of document.querySelectorAll('[data-reveal]'))link.addEventListener('click',event=>{if(reveal(link.dataset.reveal))event.preventDefault();});
search.addEventListener('input',apply);groupBy.addEventListener('change',apply);sortBy.addEventListener('change',apply);for(const chip of facetChips)chip.input.addEventListener('change',apply);richness.addEventListener('change',()=>{document.body.dataset.richness=richness.value;});
showHistory.addEventListener('change',applyHistory);
document.getElementById('clear-facets').addEventListener('click',()=>{clearFacets();apply();});
document.getElementById('expand-all').addEventListener('click',()=>{for(const card of cards){if(card.isConnected){card.open=true;renderBody(card);}}});
document.getElementById('collapse-all').addEventListener('click',()=>{for(const card of cards)card.open=false;});
applyHistory();apply();`;
}

export function renderReportHtml(model, { logoDataUrl = null, graphBundle } = {}) {
  const graph = buildGraphModel(model);
  const numbersById = new Map([...model.items, ...model.terminalItems].map((item) => [item.id, item.number]));
  const fieldNames = [...new Set(model.items.flatMap((item) => Object.keys(item.fields)))].sort();
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
  const facets = facetGroups(model.items, fieldNames);
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

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(model.title)}</title><style>${styleSource()}${graphStyleSource()}.history-toggle{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer}.controls .history-toggle input{min-width:0;flex:none;margin:0;padding:0}</style></head><body data-richness="standard"><main class="shell">
<header class="masthead"><div class="identity">${logo}<div><p class="eyebrow">${escapeHtml(model.repository.name)}</p><h1>${escapeHtml(model.title)}</h1></div></div><div class="as-of">Ledger state<br><strong>${escapeHtml(model.asOf)}</strong></div></header>
${renderWorkNext(model.workNext, model.unknownClasses)}
${renderAttention(model.attention)}
${renderEvidence(model.evidence, model.asOf)}
${graphSection(graph, graphBundle.manifest)}
<section id="drilldown"><div class="section-heading"><div><p class="eyebrow">Drill-down</p><h2>Every item</h2></div><p class="muted">State counts and item detail below the decision surface.</p></div>
<section class="stats" aria-label="Ledger summary">${stats.map(([label, value]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('')}</section>
<section class="controls panel" aria-label="Report controls"><label class="sr-only" for="search">Search items</label><input id="search" type="search" placeholder="Search ID, number, title, or mapped fields"><select id="group-by" aria-label="Group items">${groupOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select><select id="sort-by" aria-label="Sort items">${sortOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select><select id="richness" aria-label="Detail level"><option value="basic">Basic</option><option value="standard" selected>Standard</option><option value="detailed">Detailed</option></select><label class="history-toggle"><input id="show-history" type="checkbox" checked>Show history</label><button type="button" id="expand-all">Expand all</button><button type="button" id="collapse-all">Collapse all</button></section>
${renderFacets(facets, model.items.length)}
<section><div class="section-heading"><div><p class="eyebrow">Current work</p><h2>Ledger items</h2></div><p class="muted">Priority, then created date, then immutable ID.</p></div><div id="items" class="items">${model.items.map((item, index) => renderCard(item, index, numbersById)).join('')}</div><p id="empty" class="empty" hidden>No items match these filters.</p></section>
${renderSwarm(model.swarmBatches)}
</section>
<section id="history" class="panel"><div class="section-heading"><div><p class="eyebrow">History</p><h2>Terminal items</h2></div><p class="muted">Completed, killed, deferred, and archived.</p></div>${renderTerminalTable(model.terminalItems)}</section>
</main><script>${markdownRuntime}</script><script>${interactionRuntime}</script><script>${graphBundle.source}</script><script>${graphRuntime}</script></body></html>`;
}
