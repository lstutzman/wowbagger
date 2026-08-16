// The dependency graph the report carries: a force-directed 3D view of the
// whole ledger, rendered by a vendored, checksummed build that is inlined into
// the report at generation time. The report keeps its defining property —
// attach it, open it offline, share it — so nothing here is ever fetched, at
// generation time or at view time.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { READINESS_REASON_LABELS, ReportError } from './report.js';
import { daysBetween } from './report-sequencing.js';

const VENDOR_DIRECTORY = new URL('../vendor/3d-force-graph/', import.meta.url);

// One band vocabulary drives the node colour, the legend swatch, and the
// roster stripe. A reader who learns a colour in the graph reads the same
// colour in the list below it.
const BAND_COLORS = {
  ready: '#34d399',
  blocked: '#f97316',
  ineligible: '#64748b',
  done: '#2f7fa0',
  killed: '#a04256',
  deferred: '#7c6bb0',
  archived: '#3b4754',
};

const BAND_LABELS = {
  ready: 'Ready',
  blocked: 'Blocked',
  ineligible: 'Ineligible',
  done: 'Done',
  killed: 'Killed',
  deferred: 'Deferred',
  archived: 'Archived',
};

const DEPENDS_ON_COLOR = '#7dd3fc';
const PARENT_COLOR = '#c4b5fd';

export async function loadGraphBundle(overrides = {}) {
  const read = overrides.readFile ?? readFile;
  const manifest = JSON.parse(await read(new URL('VERSIONS.json', VENDOR_DIRECTORY), 'utf8'));
  const source = await read(new URL(manifest.file, VENDOR_DIRECTORY), 'utf8');
  const digest = createHash('sha256').update(source, 'utf8').digest('hex');
  if (digest !== manifest.sha256) {
    throw new ReportError('report-read-failed', 'The vendored graph bundle does not match its recorded digest.', {
      operation: 'read-graph-bundle',
      expected_sha256: manifest.sha256,
      actual_sha256: digest,
    });
  }
  return { manifest, source };
}

// The graph model is a projection of the report model, never a second
// derivation of it. Every value here already exists on the rendered report:
// readiness from the core projection, leverage and age from the sequencing
// layer, reasons from the same work-next entries the report prints.
export function buildGraphModel(model) {
  const numbersById = new Map([...model.items, ...model.terminalItems].map((item) => [item.id, item.number]));
  const workNextById = new Map(model.workNext.map((entry) => [entry.id, entry.reasons]));
  const nodes = [
    ...model.items.map((item) => openNode(item, workNextById, numbersById)),
    ...model.terminalItems.map((item) => terminalNode(item, model.asOf)),
  ];
  return {
    asOf: model.asOf,
    nodes,
    links: buildLinks([...model.items, ...model.terminalItems], new Set(nodes.map((node) => node.id))),
  };
}

// Both edge kinds point the way work is released: from the prerequisite or the
// parent to the item it unblocks. An edge whose other end is not a node would
// be an edge to nowhere, so it is dropped rather than drawn as a stub.
function buildLinks(items, nodeIds) {
  const links = [];
  for (const item of items) {
    for (const dependencyId of item.dependsOn) {
      if (nodeIds.has(dependencyId)) {
        links.push({ source: dependencyId, target: item.id, kind: 'depends-on' });
      }
    }
    if (item.parent !== null && nodeIds.has(item.parent)) {
      links.push({ source: item.parent, target: item.id, kind: 'parent' });
    }
  }
  return links;
}

function openNode(item, workNextById, numbersById) {
  return {
    id: item.id,
    handle: handleFor(item),
    number: item.number,
    title: item.title,
    status: item.status,
    band: item.readiness.state,
    ageDays: item.sequencing.ageDays,
    leverage: item.sequencing.leverage.count,
    size: 1 + item.sequencing.leverage.count,
    reasons: openReasons(item, workNextById, numbersById),
  };
}

// A ready node repeats the work-next entry verbatim — the same objects the
// report prints — so the two surfaces can never disagree about why an item is
// recommended. An item that is not ready has no such entry, so it states what
// holds it back instead, in the readiness vocabulary the report already uses.
function openReasons(item, workNextById, numbersById) {
  const ranked = workNextById.get(item.id);
  if (ranked !== undefined) {
    return ranked;
  }
  return [
    ...item.readiness.reasons.map((reason) => ({
      code: reason.code,
      label: reason.item_id === undefined
        ? READINESS_REASON_LABELS[reason.code] ?? reason.code
        : `${READINESS_REASON_LABELS[reason.code] ?? reason.code}: ${referenceHandle(reason.item_id, numbersById)}`,
    })),
    { code: 'age', label: `age ${item.sequencing.ageDays}d` },
  ];
}

function referenceHandle(id, numbersById) {
  const number = numbersById.get(id);
  return number === undefined || number === null ? id : `#${number}`;
}

// A terminal item is still a node: dropping it would erase the prerequisite
// that explains why an open item is ready. It carries no sequencing, so it
// carries no leverage and takes the smallest size.
function terminalNode(item, asOf) {
  return {
    id: item.id,
    handle: handleFor(item),
    number: item.number,
    title: item.title,
    status: item.status,
    band: item.status,
    ageDays: daysBetween(item.created, asOf) ?? 0,
    leverage: 0,
    size: 1,
    reasons: [{ code: 'terminal', label: `${item.status} ${item.terminalDate}` }],
  };
}

function handleFor(item) {
  return item.number === null ? item.id : `#${item.number}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// A model literal inside a script element must not be able to close it, and
// must survive the two line terminators JSON leaves bare.
function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

export function graphStyleSource() {
  const bandRules = Object.entries({ ...BAND_COLORS, depends: DEPENDS_ON_COLOR, parent: PARENT_COLOR })
    .map(([band, color]) => `.graph-band-${band}{--graph-band:${color}}`)
    .join('');
  return `${bandRules}
#graph-stage{position:relative;height:min(66vh,620px);border-radius:11px;background:#080b0f;overflow:hidden}
#graph-canvas{position:absolute;inset:0}
#graph-labels{position:absolute;inset:0;pointer-events:none}
.graph-node-label{position:absolute;top:0;left:0;margin:-24px 0 0 9px;padding:1px 5px;border-radius:5px;background:rgba(8,11,15,.62);color:#e6edf3;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;opacity:0;white-space:nowrap;will-change:transform}
#graph-hint{position:absolute;left:13px;bottom:11px;margin:0;color:#8b9bab;font-size:.78rem}
#graph-card{position:absolute;top:13px;right:13px;width:min(320px,calc(100% - 26px));border:1px solid #25313d;border-left:4px solid var(--graph-band,#8b9bab);border-radius:10px;background:rgba(19,26,34,.94);padding:13px;color:#e6edf3}
#graph-card .graph-handle{color:var(--graph-band,#e6edf3);font-variant-numeric:tabular-nums;font-weight:800}
#graph-card .graph-card-title{margin:4px 0 8px;font-weight:700}
#graph-card dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0 0 9px;color:#8b9bab}
#graph-card dt{font-weight:700}
#graph-card dd{margin:0;color:#e6edf3}
.graph-why{display:flex;flex-wrap:wrap;gap:5px;margin:0}
.graph-reason{display:inline-flex;border-radius:999px;background:#1d2833;padding:2px 9px;color:#b7c7d6;font-size:.73rem;font-weight:700}
#graph-nowebgl{margin:12px 0 0;border-left:3px solid var(--navy);background:#eef1f4;padding:10px 13px}
#graph-legend{display:flex;flex-wrap:wrap;gap:8px 15px;margin-top:12px;color:var(--muted)}
.graph-key{display:inline-flex;align-items:center;gap:7px;font-size:.78rem;font-weight:700}
.graph-key::before{content:"";width:11px;height:11px;border-radius:50%;background:var(--graph-band,var(--muted))}
.graph-key-edge::before{width:22px;height:0;border-radius:0;border-top:2px solid var(--graph-band)}
.graph-key-edge-parent::before{border-top-style:dashed}
.graph-fallback{margin-top:14px}
.graph-fallback>summary{cursor:pointer;color:var(--muted);font-weight:700}
.graph-roster{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:8px}
.graph-roster li{border:1px solid var(--line);border-left:4px solid var(--graph-band,var(--muted));border-radius:8px;padding:9px 12px}
.graph-roster .graph-head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;margin:0}
.graph-roster .graph-handle{color:var(--navy);font-variant-numeric:tabular-nums;font-weight:800}
.graph-roster .graph-title{font-weight:700}
.graph-roster .graph-meta{color:var(--muted);font-size:.8rem}
.graph-roster .graph-why{margin-top:7px}
.graph-roster .graph-reason{background:#eef1f4;color:var(--navy)}
@media(max-width:760px){#graph-stage{height:58vh}#graph-card{position:static;width:auto;margin-top:10px}}`;
}

// The roster is not a fallback bolted on for the WebGL-less reader; it is where
// the graph's decision-relevant content lives. The 3D view adds shape and
// adjacency to it and holds nothing the roster does not already say.
function renderRoster(nodes) {
  return `<details class="graph-fallback"><summary>Every node, without the graph</summary><ol class="graph-roster">${nodes.map((node) => `<li class="graph-band-${escapeHtml(node.band)}"><p class="graph-head"><span class="graph-handle">${escapeHtml(node.handle)}</span><span class="graph-title">${escapeHtml(node.title)}</span><span class="graph-meta">${escapeHtml(BAND_LABELS[node.band] ?? node.band)} · ${escapeHtml(node.status)} · age ${escapeHtml(node.ageDays)}d · unblocks ${escapeHtml(node.leverage)}</span></p><p class="graph-why">${node.reasons.map((reason) => `<span class="graph-reason">${escapeHtml(reason.label)}</span>`).join('')}</p></li>`).join('')}</ol></details>`;
}

function renderLegend() {
  const bands = Object.entries(BAND_LABELS)
    .map(([band, label]) => `<span class="graph-key graph-band-${band}">${escapeHtml(label)}</span>`)
    .join('');
  return `<div id="graph-legend">${bands}<span class="graph-key graph-key-edge graph-band-depends">Unblocks (depends_on)</span><span class="graph-key graph-key-edge graph-key-edge-parent graph-band-parent">Parent to child</span></div>`;
}

export function graphSection(model, manifest) {
  return `<section id="graph" class="panel"><div class="section-heading"><div><p class="eyebrow">Dependencies</p><h2>Ledger graph</h2></div><p class="muted">Every item as a node, sized by how much it unblocks. Edges run from a prerequisite or parent to the item it releases.</p></div>
<div id="graph-stage"><div id="graph-canvas"></div><div id="graph-labels" aria-hidden="true"></div><aside id="graph-card" hidden></aside><p id="graph-hint">Drag to orbit · scroll to zoom · hover or click a node</p></div>
<p id="graph-nowebgl" hidden>This browser has no WebGL, so the graph cannot draw. Nothing is lost: every node, its status, its age, and the reasons that place it are listed below, and the graph only adds the shape of the dependencies between them.</p>
${renderLegend()}
${renderRoster(model.nodes)}
<p class="muted">Rendered by ${escapeHtml(manifest.package)} ${escapeHtml(manifest.version)}, vendored and checksummed in this repository and inlined here. This report fetches nothing.</p></section>`;
}

export function graphClientSource(model) {
  return `'use strict';
var GRAPH_MODEL=${scriptJson(model)};
var GRAPH_COLORS=${scriptJson(BAND_COLORS)};
var graphStage=document.getElementById('graph-stage');
var graphNotice=document.getElementById('graph-nowebgl');
var graphFallback=document.querySelector('.graph-fallback');
function graphWebglAvailable(){
  try{
    var probe=document.createElement('canvas');
    return !!(window.WebGLRenderingContext&&(probe.getContext('webgl2')||probe.getContext('webgl')));
  }catch(error){return false;}
}
function graphBandColor(node){return GRAPH_COLORS[node.band]||'#94a3b8';}
function graphRenderCard(card,node){
  card.style.setProperty('--graph-band',graphBandColor(node));
  card.replaceChildren();
  var handle=document.createElement('span');
  handle.className='graph-handle';
  handle.textContent=node.handle;
  var title=document.createElement('p');
  title.className='graph-card-title';
  title.textContent=node.title;
  var facts=document.createElement('dl');
  [['Status',node.status],['Age',node.ageDays+'d'],['Unblocks',String(node.leverage)]].forEach(function(pair){
    var term=document.createElement('dt');
    term.textContent=pair[0];
    var value=document.createElement('dd');
    value.textContent=pair[1];
    facts.append(term,value);
  });
  var why=document.createElement('p');
  why.className='graph-why';
  node.reasons.forEach(function(reason){
    var chip=document.createElement('span');
    chip.className='graph-reason';
    chip.textContent=reason.label;
    why.append(chip);
  });
  card.append(handle,title,facts,why);
  card.hidden=false;
}
if(!window.ForceGraph3D||!graphWebglAvailable()){
  graphStage.hidden=true;
  graphNotice.hidden=false;
  graphFallback.open=true;
}else{
  graphStart();
}
function graphStart(){
  var mount=document.getElementById('graph-canvas');
  var labelLayer=document.getElementById('graph-labels');
  var card=document.getElementById('graph-card');
  var data={
    nodes:GRAPH_MODEL.nodes.map(function(node){return Object.assign({},node);}),
    links:GRAPH_MODEL.links.map(function(link){return Object.assign({},link);})
  };
  var graph=new ForceGraph3D(mount,{controlType:'orbit'})
    .backgroundColor('#080b0f')
    .showNavInfo(false)
    .width(mount.clientWidth)
    .height(mount.clientHeight)
    .nodeId('id')
    .nodeLabel(function(){return '';})
    .nodeRelSize(10)
    .nodeVal(function(node){return node.size;})
    .nodeColor(graphBandColor)
    .nodeOpacity(0.95)
    .nodeResolution(14)
    .linkColor(function(link){return link.kind==='parent'?'${PARENT_COLOR}':'${DEPENDS_ON_COLOR}';})
    .linkWidth(function(link){return link.kind==='parent'?1.4:2.6;})
    .linkOpacity(0.5)
    .linkCurvature(function(link){return link.kind==='parent'?0.35:0;})
    .linkDirectionalArrowLength(function(link){return link.kind==='parent'?0:8;})
    .linkDirectionalArrowRelPos(1)
    .onNodeHover(function(node){if(node)graphRenderCard(card,node);})
    .onNodeClick(function(node){if(node)graphRenderCard(card,node);})
    .onBackgroundClick(function(){card.hidden=true;})
    .cooldownTicks(220)
    .graphData(data);
  graph.d3Force('charge').strength(-40);
  var labels=data.nodes.map(function(node){
    var element=document.createElement('span');
    element.className='graph-node-label';
    element.textContent=node.handle;
    labelLayer.append(element);
    return {node:node,element:element};
  });
  var framed=false;
  graph.onEngineStop(function(){
    if(framed)return;
    framed=true;
    graph.zoomToFit(800,20);
  });
  window.addEventListener('resize',function(){
    graph.width(mount.clientWidth).height(mount.clientHeight);
  });
  var placements=[];
  // Labels are drawn nearest-first into a coarse screen grid: a label whose
  // cell is already taken is dropped for that frame rather than stacked into an
  // unreadable pile. Nothing is lost by it — the roster below names every node,
  // and hovering any node opens its card.
  function graphPlaceLabels(){
    var camera=graph.camera();
    var forward=camera.position.clone();
    camera.getWorldDirection(forward);
    var eye=camera.position;
    var index;
    placements.length=0;
    for(index=0;index<labels.length;index+=1){
      var node=labels[index].node;
      var element=labels[index].element;
      if(typeof node.x!=='number'){element.style.opacity='0';continue;}
      var depth=(node.x-eye.x)*forward.x+(node.y-eye.y)*forward.y+(node.z-eye.z)*forward.z;
      if(depth<=0){element.style.opacity='0';continue;}
      placements.push({element:element,depth:depth,screen:graph.graph2ScreenCoords(node.x,node.y,node.z)});
    }
    placements.sort(function(left,right){return left.depth-right.depth;});
    var nearest=placements.length===0?0:placements[0].depth;
    var farthest=placements.length===0?0:placements[placements.length-1].depth;
    var span=farthest-nearest||1;
    var taken=Object.create(null);
    for(index=0;index<placements.length;index+=1){
      var placement=placements[index];
      var cell=Math.round(placement.screen.x/54)+':'+Math.round(placement.screen.y/17);
      if(taken[cell]){placement.element.style.opacity='0';continue;}
      taken[cell]=true;
      placement.element.style.transform='translate('+placement.screen.x.toFixed(1)+'px,'+placement.screen.y.toFixed(1)+'px)';
      placement.element.style.opacity=(1-0.55*((placement.depth-nearest)/span)).toFixed(2);
    }
    window.requestAnimationFrame(graphPlaceLabels);
  }
  window.requestAnimationFrame(graphPlaceLabels);
}`;
}
