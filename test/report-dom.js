// A DOM small enough to read and large enough to run the report's own browser
// runtime. The report ships one inline script; a test that asserts on that
// script's text proves nothing, so the script is executed here against a
// fixture shaped like the report's own markup. The fixture drifting from the
// real render shows up as a failure in these cases, which is the point.

function camel(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseSelector(selector) {
  const [, tag, rest] = /^([a-z0-9-]*)(.*)$/i.exec(selector);
  const parts = rest.match(/\.[^.#[\]]+|#[^.#[\]]+|\[[^\]]+\]/g) ?? [];
  return { tag, parts };
}

class FakeElement {
  constructor(tag, { id = '', dataset = {}, classes = [], attributes = {}, textContent = '' } = {}) {
    this.tag = tag;
    this.id = id;
    this.dataset = { ...dataset };
    this.attributes = { ...attributes };
    this.classes = new Set(classes);
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.textContent = textContent;
    this.innerHTML = '';
    this.hidden = false;
    this.open = false;
    this.value = '';
    this.checked = false;
    this.scrolls = [];
    this.focuses = 0;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.rect = { top: 0, height: 0 };
    this.computed = { position: 'static' };
  }

  getBoundingClientRect() {
    return this.rect;
  }

  get classList() {
    const classes = this.classes;
    return {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
    };
  }

  set className(value) {
    this.classes = new Set(String(value).split(' ').filter((part) => part !== ''));
  }

  get className() {
    return [...this.classes].join(' ');
  }

  get parentNode() {
    return this.parent;
  }

  get isConnected() {
    let node = this;
    while (node.parent !== null) {
      node = node.parent;
    }
    return node.root === true;
  }

  getAttribute(name) {
    if (name.startsWith('data-')) {
      const value = this.dataset[camel(name.slice(5))];
      return value === undefined ? null : String(value);
    }
    if (name === 'id') {
      return this.id === '' ? null : this.id;
    }
    if (name === 'class') {
      return this.className;
    }
    const value = this.attributes[name];
    return value === undefined ? null : String(value);
  }

  matches(selector) {
    const { tag, parts } = parseSelector(selector);
    if (tag !== '' && this.tag !== tag) {
      return false;
    }
    return parts.every((part) => {
      if (part.startsWith('.')) {
        return this.classes.has(part.slice(1));
      }
      if (part.startsWith('#')) {
        return this.id === part.slice(1);
      }
      const [, name, value] = /^\[([^=\]]+)(?:="?([^"\]]*)"?)?\]$/.exec(part);
      const actual = this.getAttribute(name);
      return actual !== null && (value === undefined || actual === value);
    });
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parent !== null) {
        node.parent.children = node.parent.children.filter((child) => child !== node);
      }
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) {
      child.parent = null;
    }
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  dispatch(type) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
  }

  scrollIntoView(options) {
    this.scrolls.push(options);
  }

  focus(options) {
    this.focuses += 1;
    this.focusOptions = options;
    let node = this;
    while (node.parent !== null) {
      node = node.parent;
    }
    if (node.owner !== undefined) {
      node.owner.activeElement = this;
    }
  }
}

function element(tag, options) {
  return new FakeElement(tag, options);
}

function control(tag, id, value = '') {
  const node = element(tag, { id });
  node.value = value;
  return node;
}

function card(item) {
  const details = element('details', {
    id: item.id,
    classes: ['card'],
    dataset: {
      item: '',
      order: String(item.order),
      state: item.state,
      status: item.status,
      kind: item.kind ?? 'task',
      priority: item.priority ?? '',
      created: item.created,
      title: item.title.toLocaleLowerCase('en-US'),
      fields: JSON.stringify(item.fields),
      search: item.search,
    },
  });
  const summary = element('summary');
  const source = element('script', { attributes: { type: 'text/markdown' } });
  source.textContent = JSON.stringify(item.body);
  const rendered = element('div', { classes: ['rendered-markdown'], dataset: { rendered: '0' } });
  const detail = element('div', { classes: ['card-detail'] });
  detail.append(source, rendered);
  details.append(summary, detail);
  return details;
}

// The fixture mirrors the ids, classes, and data attributes `renderReportHtml`
// emits: one control strip, the ranked rows above the drill-down, and the
// canonical cards inside it.
export function reportDom({ items, fieldName = 'area' }) {
  const body = element('body');
  body.root = true;
  const document = {
    body,
    activeElement: null,
    createElement: (tag) => element(tag),
    getElementById: (id) => body.descendants().find((node) => node.id === id) ?? null,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
    addEventListener: () => {},
  };
  body.owner = document;

  const showHistory = element('input', { id: 'show-history' });
  showHistory.checked = true;
  // The report's control strip sticks to the top of the viewport above 850px,
  // so it covers whatever a bare scroll-to-top lands on.
  const controls = element('section', { classes: ['controls'] });
  controls.rect = { top: 0, height: 129 };
  controls.computed = { position: 'sticky' };
  controls.append(
    control('input', 'search'),
    control('select', 'group-by', 'none'),
    control('select', 'sort-by', 'default'),
    control('select', 'richness', 'standard'),
    showHistory,
    element('button', { id: 'expand-all' }),
    element('button', { id: 'collapse-all' }),
  );
  // Five quick views filter the same scoped population without changing scope.
  // Work next preserves rank order and reasons; the others filter honestly.
  const quickButtons = ['work-next', 'in-progress', 'blocked', 'triage', 'all-open'].map((view, index) => {
    const button = element('button', { dataset: { quick: view }, attributes: { 'aria-pressed': index === 0 ? 'true' : 'false' } });
    return button;
  });
  const activeScope = element('div', { id: 'active-scope' });
  const historyExplain = element('p', { id: 'history-explain' });
  historyExplain.hidden = true;
  const showHistoryAction = element('button', { id: 'show-history-action' });
  historyExplain.append(showHistoryAction);

  // One chip per value the fixture's own cards carry, grouped exactly as
  // `renderFacets` groups them: readiness, status, kind, then the mapped field.
  const chips = new Map();
  const resultCount = element('p', { id: 'result-count' });
  const clearFacets = element('button', { id: 'clear-facets' });
  const facets = element('section', { id: 'facets', classes: ['facets'] });
  // Visible drilldown state: showItems sets the label and narrows the list to
  // the named IDs intersected with scope; clearing restores the previous view.
  const drilldownPill = element('div', { id: 'drilldown-pill' });
  drilldownPill.hidden = true;
  const drilldownLabel = element('span', { id: 'drilldown-label' });
  const clearDrilldown = element('button', { id: 'clear-drilldown' });
  drilldownPill.append(drilldownLabel, clearDrilldown);
  facets.append(resultCount, clearFacets);
  const groupValues = [
    ['readiness', items.map((item) => item.state)],
    ['status', items.map((item) => item.status)],
    ['kind', items.map((item) => item.kind ?? 'task')],
    [`field:${fieldName}`, items.map((item) => item.fields[fieldName]).filter((value) => value !== undefined)],
  ];
  for (const [group, values] of groupValues) {
    const fieldset = element('fieldset', { classes: ['facet-group'], dataset: { group } });
    for (const value of [...new Set(values)].sort()) {
      const chip = element('label', { classes: ['chip'] });
      const input = element('input', { classes: ['facet'], dataset: { group, kind: 'value', value: JSON.stringify(value) } });
      input.value = value;
      const count = element('span', { classes: ['chip-count'] });
      chip.append(input, element('span', { classes: ['chip-text'], textContent: value }), count);
      fieldset.append(chip);
      chips.set(`${group}=${value}`, { chip, input, count });
    }
    facets.append(fieldset);
  }

  const rows = element('ol', { classes: ['ranked'] });
  rows.append(...items.map((item) => {
    const row = element('li');
    row.append(element('a', { classes: ['row-link'], dataset: { reveal: item.id }, attributes: { href: `#${item.id}` } }));
    return row;
  }));

  const itemRoot = element('div', { id: 'items' });
  itemRoot.append(...items.map(card));
  // Inspecting an item outside the current scope must not reset that scope:
  // a detached canonical card moves here so it is visible while the filtered
  // list in #items stays exactly where it was. One canonical node, reused.
  const detailPane = element('div', { id: 'detail-pane' });
  // Typed selection population the runtime filters with the shared selection
  // module instead of reparsing card markup on every keystroke.
  const selectionItems = items.map((item) => ({
    id: item.id,
    number: null,
    title: item.title,
    status: item.status,
    kind: item.kind ?? 'task',
    priority: item.priority ?? null,
    created: item.created,
    readiness: { state: item.state },
    fields: item.fields,
  }));
  const reportData = element('script', { id: 'report-data', attributes: { type: 'application/json' } });
  reportData.textContent = JSON.stringify({
    items: selectionItems,
    workNextIds: items.map((item) => item.id),
    workNextById: Object.fromEntries(items.map((item) => [item.id, { reasons: [], number: null, title: item.title }])),
  });

  // The report is one document: the ledger graph's own status chips share the
  // chip vocabulary further down the page, and the drill-down runtime has to
  // leave them alone.
  const graphChip = element('label', { classes: ['chip'] });
  graphChip.append(element('input', { classes: ['graph-status'] }), element('span', { classes: ['chip-count'] }));

  body.append(
    controls,
    ...quickButtons,
    activeScope,
    historyExplain,
    facets,
    drilldownPill,
    rows,
    itemRoot,
    detailPane,
    reportData,
    element('p', { id: 'empty' }),
    element('section', { id: 'history' }),
    graphChip,
  );

  const reduced = new Set();
  const window = {
    renderMarkdown: (markdown) => `<p>${markdown}</p>`,
    matchMedia: (query) => ({ matches: reduced.has(query) }),
    getComputedStyle: (node) => node.computed,
  };

  return {
    document,
    window,
    prefersReducedMotion() {
      reduced.add('(prefers-reduced-motion: reduce)');
    },
    card: (id) => document.getElementById(id),
    link: (id) => body.querySelector(`[data-reveal="${id}"]`),
    controls,
    unstickControls() {
      controls.computed = { position: 'static' };
    },
    search: () => document.getElementById('search'),
    chip: (group, value) => chips.get(`${group}=${value}`).input,
    chipState: (group, value) => chips.get(`${group}=${value}`).chip,
    chipCount: (group, value) => chips.get(`${group}=${value}`).count.textContent,
    resultCount: () => resultCount.textContent,
    clearFacets,
    select(group, value) {
      const input = chips.get(`${group}=${value}`).input;
      input.checked = true;
      input.dispatch('change');
    },
    quick: (view) => body.querySelector(`[data-quick="${view}"]`),
    activeScope: () => document.getElementById('active-scope').textContent,
    historyExplain: () => document.getElementById('history-explain'),
    showHistoryAction: () => document.getElementById('show-history-action'),
    visible: () => itemRoot.querySelectorAll('[data-item]').map((node) => node.id),
  };
}

// The renderer the graph runtime drives, reduced to what the runtime asks of
// it: a chainable builder that records what it was handed. Every chained call
// is recorded, so a case can read the data the graph was last given and the
// handlers it registered instead of asserting on the runtime's own text.
function forceGraphStub() {
  const calls = [];
  const handlers = {};
  const holder = {};
  const base = {
    calls,
    handlers,
    camera: () => ({
      position: { x: 0, y: 0, z: 120, clone: () => ({ x: 0, y: 0, z: 0 }) },
      getWorldDirection: (target) => Object.assign(target, { x: 0, y: 0, z: -1 }),
    }),
    graph2ScreenCoords: (x, y) => ({ x, y }),
    d3Force: () => ({ strength: () => undefined }),
  };
  holder.graph = new Proxy(base, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      return (...args) => {
        calls.push([property, ...args]);
        if (property.startsWith('on') && typeof args[0] === 'function') {
          handlers[property] = args[0];
        }
        return holder.graph;
      };
    },
  });
  return holder.graph;
}

// The graph fixture mirrors what `graphSection` emits: the status chips above
// the stage, the stage and its card, the honest empty statement, and the roster
// rows the same filter hides.
export function graphDom(model, { webgl = true } = {}) {
  const body = element('body');
  body.root = true;
  const document = {
    body,
    activeElement: null,
    createElement: (tag) => element(tag),
    getElementById: (id) => body.descendants().find((node) => node.id === id) ?? null,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  };
  body.owner = document;

  const chips = new Map();
  const group = element('fieldset', { classes: ['facet-group'], dataset: { group: 'graph-status' } });
  for (const status of [...new Set(model.nodes.map((node) => node.status))].sort()) {
    const chip = element('label', { classes: ['chip'] });
    const input = element('input', { classes: ['graph-status'] });
    input.value = status;
    input.checked = true;
    chip.append(input, element('span', { classes: ['chip-text'], textContent: status }));
    group.append(chip);
    chips.set(status, { chip, input });
  }
  const nodeCount = element('p', { id: 'graph-node-count' });
  const selectAll = element('button', { id: 'graph-status-all' });
  const clear = element('button', { id: 'graph-status-clear' });
  const filter = element('div', { id: 'graph-filter' });
  filter.append(group, nodeCount, selectAll, clear);

  const labelLayer = element('div', { id: 'graph-labels' });
  const card = element('aside', { id: 'graph-card' });
  card.hidden = true;
  const mount = element('div', { id: 'graph-canvas' });
  mount.clientWidth = 800;
  mount.clientHeight = 600;
  const stage = element('div', { id: 'graph-stage' });
  stage.append(mount, labelLayer, card);
  const notice = element('p', { id: 'graph-nowebgl' });
  notice.hidden = true;
  const emptyState = element('p', { id: 'graph-empty' });
  emptyState.hidden = true;

  const roster = element('ol', { classes: ['graph-roster'] });
  roster.append(...model.nodes.map((node) => element('li', {
    classes: [`graph-band-${node.band}`],
    dataset: { nodeStatus: node.status },
  })));
  const fallback = element('details', { classes: ['graph-fallback'] });
  fallback.append(roster);

  body.append(filter, stage, notice, emptyState, fallback);

  const frames = [];
  const reduced = new Set();
  let renderer = null;
  const window = {
    ForceGraph3D: webgl ? function ForceGraph3D() { renderer = forceGraphStub(); return renderer; } : undefined,
    WebGLRenderingContext: webgl ? function WebGLRenderingContext() {} : undefined,
    requestAnimationFrame: (callback) => frames.push(callback),
    addEventListener: () => undefined,
    matchMedia: (query) => ({ matches: reduced.has(query) }),
    getComputedStyle: (node) => node.computed,
  };
  document.createElement = (tag) => {
    const node = element(tag);
    if (tag === 'canvas') {
      node.getContext = () => (webgl ? {} : null);
    }
    return node;
  };

  return {
    document,
    window,
    stage,
    card,
    notice,
    emptyState,
    fallback,
    nodeCount: () => nodeCount.textContent,
    // The data the graph was last handed, and the handlers it registered.
    renderer: () => renderer,
    lastData: () => renderer.calls.filter(([name]) => name === 'graphData').at(-1)[1],
    hover: (node) => renderer.handlers.onNodeHover(node),
    statusChip: (status) => chips.get(status).input,
    only(...statuses) {
      for (const [status, entry] of chips) {
        entry.input.checked = statuses.includes(status);
      }
      [...chips.values()][0].input.dispatch('change');
    },
    selectAll,
    clear,
    labels: () => labelLayer.children,
    rosterStatuses: () => roster.children.filter((node) => !node.hidden).map((node) => node.dataset.nodeStatus),
  };
}

export function runReportClient(source, dom) {
  new Function('window', 'document', source)(dom.window, dom.document);
}
