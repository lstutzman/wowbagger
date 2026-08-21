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
    this.style = {};
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
  };
  body.owner = document;

  const slotFilter = element('select', { classes: ['slot-filter'], dataset: { field: fieldName } });
  slotFilter.value = '';
  const filters = ['all', 'ready', 'blocked', 'ineligible'].map((state) => {
    const button = element('button', { dataset: { filter: state }, classes: state === 'all' ? ['filter', 'active'] : ['filter'] });
    return button;
  });
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
    slotFilter,
    ...filters,
    showHistory,
    element('button', { id: 'expand-all' }),
    element('button', { id: 'collapse-all' }),
  );

  const rows = element('ol', { classes: ['ranked'] });
  rows.append(...items.map((item) => {
    const row = element('li');
    row.append(element('a', { classes: ['row-link'], dataset: { reveal: item.id }, attributes: { href: `#${item.id}` } }));
    return row;
  }));

  const itemRoot = element('div', { id: 'items' });
  itemRoot.append(...items.map(card));

  body.append(
    controls,
    rows,
    itemRoot,
    element('p', { id: 'empty' }),
    element('section', { id: 'history' }),
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
    filter: (state) => body.querySelector(`[data-filter="${state}"]`),
    slotFilter,
    controls,
    unstickControls() {
      controls.computed = { position: 'static' };
    },
    search: () => document.getElementById('search'),
  };
}

export function runReportClient(source, dom) {
  new Function('window', 'document', source)(dom.window, dom.document);
}
