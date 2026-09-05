// Reproducible synthetic fixture for the decision-focused report redesign.
//
// Builds a fixed-date, deterministic demo ledger in memory and publishes one
// self-contained HTML report through the real pipeline: buildReportModel,
// loadGraphBundle, renderReportHtml, then writeReportFile. The bytes are a
// pure function of the command-line arguments, so identical arguments produce
// identical bytes. Nothing here reads a real ledger, and nothing here
// describes consumer data: the repository name and report title both say
// synthetic. Run with --help for usage.

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadGraphBundle } from '../src/report-graph.js';
import { renderReportHtml } from '../src/report-html.js';
import {
  assertReportOutputOutsideLedger,
  buildReportModel,
  writeReportFile,
} from '../src/report.js';

// The ledger state every artifact claims. Fixed so reruns agree byte for
// byte; the generation duration is measured and printed but never embedded.
const AS_OF = '2026-09-05';
const SYNTHETIC_LABEL = `deterministic demo fixture (as-of ${AS_OF})`;

// The one named view this fixture offers. The Foundations blocker carries an
// area no other item uses, so selecting this view excludes the blocker while
// retaining its blocked Accounts dependent. Readiness is projected before the
// view narrows the set, so the retained dependent still reads blocked and the
// excluded blocker survives only as a number label.
const VIEW_NAME = 'without-foundations';
const VIEW_TITLE = 'Demo without Foundations (synthetic data)';
const VIEW_AREAS = ['Accounts', 'CLI', 'Graph', 'Payments'];
const BLOCKER_AREA = 'Foundations';

const FILLER_AREAS = ['Payments', 'Accounts', 'CLI', 'Graph'];
const FILLER_TAGS = ['customer-visible', 'docs', 'performance', 'regression', 'tech-debt'];
const CORE_COUNT = 22;

function usage() {
  return [
    'Usage: node scripts/report-design-demo.js --out PATH --items N [--view NAME]',
    '',
    'Generate a deterministic synthetic report for the decision-focused redesign.',
    'All content is fixed-date demo data labeled synthetic; nothing is read from',
    'any real ledger.',
    '',
    'Options:',
    '  --out PATH    Output HTML path. Must resolve outside the repository ledger.',
    '  --items N     Positive integer item count. Counts below the core',
    `                fixture (${CORE_COUNT} items) yield its leading prefix; larger counts`,
    '                append seeded filler items deterministically.',
    '  --view NAME   Apply the "without-foundations" named view. It excludes the',
    '                Foundations blocker while retaining its blocked Accounts',
    '                dependent, so the artifact shows number-only references to',
    '                excluded items. Omit for the base report.',
    '  --help, -h    Show this help.',
    '',
    'Examples:',
    '  node scripts/report-design-demo.js --out /private/tmp/wowbagger-report-redesign.html --items 40',
    '  node scripts/report-design-demo.js --out /private/tmp/wowbagger-report-redesign-large.html --items 1744',
    '  node scripts/report-design-demo.js --out /private/tmp/wowbagger-report-redesign-view.html --items 40 --view without-foundations',
    '',
  ].join('\n');
}

function fail(code, message) {
  process.stderr.write(`report-design-demo: error: ${message}\nRun with --help for usage.\n`);
  process.exitCode = code;
}

function splitOption(arg) {
  if (!arg.startsWith('--')) {
    return null;
  }
  const index = arg.indexOf('=');
  if (index === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, index), arg.slice(index + 1)];
}

function parseArgs(argv) {
  const options = { out: undefined, items: undefined, view: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const split = splitOption(arg);
    if (split === null) {
      return { error: `unexpected argument "${arg}".` };
    }
    const [flag, inline] = split;
    if (flag !== '--out' && flag !== '--items' && flag !== '--view') {
      return { error: `unknown option "${arg}".` };
    }
    let value = inline;
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value === '-h') {
        return { error: `${flag} needs a value.` };
      }
      index += 1;
    }
    if (flag === '--out') {
      options.out = value;
    } else if (flag === '--items') {
      options.items = value;
    } else {
      options.view = value;
    }
  }
  return { options };
}

// Fixed-seed sampler so filler items are identical on every run. Same
// arguments consume the same sequence, so a smaller count is always a prefix
// of a larger one.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date, days) {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000);
  return next.toISOString().slice(0, 10);
}

function acceptDecision(date, summary) {
  return [{ action: 'accept', date, summary, rationale: 'Synthetic demo fixture.' }];
}

// Every core entry states its own dates. Updated defaults to a date past all
// of them; terminal entries set it to their departure date instead.
function coreItem(entry) {
  const {
    id, number, title, kind = 'task', status = 'backlog', created,
    updated = '2026-08-30', priority, parent = null, dependsOn = [],
    decisions = [], data = {}, body = '', extra = {},
  } = entry;
  const itemData = {
    schema_version: 2,
    id,
    title,
    kind,
    status,
    created,
    updated,
    depends_on: dependsOn,
    related: [],
    decisions,
    data,
    ...extra,
  };
  if (number !== undefined) {
    itemData.number = number;
  }
  if (priority !== undefined) {
    itemData.priority = priority;
  }
  if (parent !== null) {
    itemData.parent = parent;
  }
  return { data: itemData, body };
}

// The hand-authored edge-case set, ordered so a small count keeps the
// blocker/dependent pair first: diamond dependencies, an epic ancestor, a
// snoozed item, every lifecycle status, done and non-done closures,
// pre-window creation, missing acceptance history, missing and invalid
// metadata, null priorities, a long title, a numberless item, and
// HTML/script-like content.
function coreItems() {
  const longTitle = 'Demonstration item with a deliberately long title that exercises wrapping, truncation, and layout behavior in every report surface that prints it (synthetic data)';
  return [
    coreItem({
      id: 'demo_blocker', number: 1, title: 'Demo blocker holding the Accounts dependent', created: '2026-06-10',
      priority: 1, decisions: acceptDecision('2026-06-12', 'Accepted blocker'),
      data: { area: BLOCKER_AREA, tags: ['blocking', 'infrastructure'], complexity: 'small', class: 'expedite' },
      body: 'Synthetic demo data. Excluded by the without-foundations view.',
    }),
    coreItem({
      id: 'demo_dependent', number: 2, title: 'Demo dependent retained without its blocker', created: '2026-06-11',
      priority: 1, dependsOn: ['demo_blocker'], decisions: acceptDecision('2026-06-13', 'Accepted dependent'),
      data: { area: 'Accounts', tags: ['customer-visible'] },
      body: 'Synthetic demo data. Still reads blocked when the view drops its blocker.',
    }),
    coreItem({
      id: 'demo_diamond_top', number: 3, title: 'Demo diamond prerequisite', created: '2026-06-08',
      priority: 2, decisions: acceptDecision('2026-06-09', 'Accepted diamond top'),
      data: { area: 'Payments', tags: ['regression'], complexity: 'small', class: 'fixed-date', due: '2026-09-10' },
      body: 'Synthetic demo data. Top of the dependency diamond.',
    }),
    coreItem({
      id: 'demo_diamond_left', number: 4, title: 'Demo diamond left branch', created: '2026-06-09',
      priority: 2, dependsOn: ['demo_diamond_top'], decisions: acceptDecision('2026-06-10', 'Accepted diamond left'),
      data: { area: 'Payments', tags: ['regression'] },
      body: 'Synthetic demo data. Left branch of the dependency diamond.',
    }),
    coreItem({
      id: 'demo_diamond_right', number: 5, title: 'Demo diamond right branch', created: '2026-06-09',
      priority: 3, dependsOn: ['demo_diamond_top'], decisions: acceptDecision('2026-06-10', 'Accepted diamond right'),
      data: { area: 'Accounts', tags: ['customer-visible'] },
      body: 'Synthetic demo data. Right branch of the dependency diamond.',
    }),
    coreItem({
      id: 'demo_diamond_bottom', number: 6, title: 'Demo diamond convergence', created: '2026-06-10',
      priority: 2, dependsOn: ['demo_diamond_left', 'demo_diamond_right'],
      decisions: acceptDecision('2026-06-11', 'Accepted diamond bottom'),
      data: { area: 'Accounts', tags: ['customer-visible'] },
      body: 'Synthetic demo data. Converges both diamond branches.',
    }),
    coreItem({
      id: 'demo_epic', number: 7, title: 'Demo epic ancestor', kind: 'epic', created: '2026-05-20',
      decisions: acceptDecision('2026-05-21', 'Accepted epic'),
      data: { area: 'Graph', tags: ['planning'] },
      body: 'Synthetic demo data. Ancestor of the demo child.',
    }),
    coreItem({
      id: 'demo_child', number: 8, title: 'Demo child of the epic ancestor', created: '2026-05-22',
      priority: 4, parent: 'demo_epic', decisions: acceptDecision('2026-05-23', 'Accepted child'),
      data: { area: 'Graph', tags: ['planning'], complexity: 'small', severity: false },
      body: 'Synthetic demo data. Carries an epic ancestor.',
    }),
    coreItem({
      id: 'demo_snoozed', number: 9, title: 'Demo snoozed item', created: '2026-08-01',
      priority: 2, decisions: acceptDecision('2026-08-02', 'Accepted snoozed item'),
      data: { area: 'CLI', tags: ['later'] },
      extra: { snoozed_until: '2026-09-20' },
      body: 'Synthetic demo data. Snoozed past the report as-of date.',
    }),
    coreItem({
      id: 'demo_triage', number: 10, title: 'Demo untriaged item', status: 'triage', created: '2026-08-28',
      body: 'Synthetic demo data. No mapped metadata and no recorded accept decision.',
    }),
    coreItem({
      id: 'demo_in_progress', number: 11, title: 'Demo in-progress item', status: 'in-progress', created: '2026-07-20',
      priority: 1, decisions: acceptDecision('2026-07-22', 'Accepted in-progress item'),
      data: { area: 'Payments', tags: ['regression'] },
      body: 'Synthetic demo data. Separates status from readiness.',
    }),
    coreItem({
      id: 'demo_done', number: 12, title: 'Demo completed item', status: 'done', created: '2026-06-20',
      updated: '2026-08-22', decisions: acceptDecision('2026-07-01', 'Accepted completed item'),
      data: { area: 'Payments', tags: ['customer-visible', 'regression'] },
      extra: { completed: '2026-08-22' },
      body: 'Synthetic demo data. A done closure with acceptance history and no priority.',
    }),
    coreItem({
      id: 'demo_done_no_accept', number: 13, title: 'Demo completed item without acceptance', status: 'done',
      created: '2026-06-25', updated: '2026-07-15', priority: 4,
      data: { area: 'Accounts', tags: ['customer-visible'] },
      extra: { completed: '2026-07-15' },
      body: 'Synthetic demo data. A done closure with missing acceptance history.',
    }),
    coreItem({
      id: 'demo_killed', number: 14, title: 'Demo killed item', status: 'killed', created: '2026-06-05',
      updated: '2026-08-02', priority: 3, decisions: acceptDecision('2026-06-15', 'Accepted killed item'),
      data: { area: 'CLI', tags: ['tech-debt'] },
      extra: { killed: '2026-08-02' },
      body: 'Synthetic demo data. A non-done closure.',
    }),
    coreItem({
      id: 'demo_deferred', number: 15, title: 'Demo deferred item', status: 'deferred', created: '2026-07-08',
      updated: '2026-08-25',
      data: { area: 'Graph', tags: ['later'] },
      extra: { deferred: '2026-08-25' },
      body: 'Synthetic demo data. A non-done closure with missing acceptance history.',
    }),
    coreItem({
      id: 'demo_archived', number: 16, title: 'Demo archived item', status: 'archived', created: '2026-03-02',
      updated: '2026-06-30', decisions: acceptDecision('2026-04-02', 'Accepted archived item'),
      data: { area: 'Payments', tags: ['docs'] },
      extra: { archived: '2026-06-30' },
      body: 'Synthetic demo data. Created before the default evidence window.',
    }),
    coreItem({
      id: 'demo_old', number: 17, title: 'Demo aged backlog item', created: '2026-02-10',
      decisions: acceptDecision('2026-02-12', 'Accepted aged item'),
      data: { area: 'Payments', tags: ['tech-debt'] },
      body: 'Synthetic demo data. Old creation date with no priority.',
    }),
    coreItem({
      id: 'demo_invalid_meta', number: 18, title: 'Demo item with invalid metadata', created: '2026-07-01',
      priority: 2, decisions: acceptDecision('2026-07-02', 'Accepted invalid-metadata item'),
      data: { area: { region: 'nowhere' }, tags: ['ok', 7] },
      body: 'Synthetic demo data. Rejected mappings stay out of fields and count as invalid.',
    }),
    coreItem({
      id: 'demo_scalar_tag', number: 19, title: 'Demo item with a scalar tag source', created: '2026-07-05',
      priority: 3, decisions: acceptDecision('2026-07-06', 'Accepted scalar-tag item'),
      data: { area: 'Accounts', tags: 'single-string', complexity: 'small', severity: 0 },
      body: 'Synthetic demo data. A scalar tag source reads as a one-tag set.',
    }),
    coreItem({
      id: 'demo_numberless', title: 'Demo item without a number', created: '2026-08-05',
      priority: 1, decisions: acceptDecision('2026-08-06', 'Accepted numberless item'),
      data: { area: 'CLI', tags: [] },
      body: 'Synthetic demo data. Renders under its raw ID with missing tags.',
    }),
    coreItem({
      id: 'demo_xss', number: 21, title: '<script>alert("demo")</script> & <b>bold</b> "quoted"', created: '2026-08-10',
      priority: 2, decisions: acceptDecision('2026-08-11', 'Accepted markup probe'),
      data: { area: 'Payments', tags: ['security'] },
      body: '# Markup probe\n\n<img src="x" onerror="alert(1)"> & <script>console.log("demo")</script>\n\nSynthetic demo data. Must render as text, never execute.',
    }),
    coreItem({
      id: 'demo_long', number: 22, title: longTitle, created: '2026-08-12',
      priority: 5, decisions: acceptDecision('2026-08-13', 'Accepted long-title item'),
      data: { area: 'Graph', tags: ['docs', 'planning'] },
      body: 'Synthetic demo data. Exercises long-title layout in every surface.',
    }),
  ];
}

// Seeded filler past the core set: sparse creation dates reaching before the
// default window, a mix of open and terminal statuses, and chains that only
// ever point backward so the graph stays acyclic.
function fillerItems(startIndex, totalCount, random) {
  const items = [];
  for (let index = startIndex; index < totalCount; index += 1) {
    const number = index + 1;
    const id = `demo_filler_${String(number).padStart(4, '0')}`;
    const area = FILLER_AREAS[index % FILLER_AREAS.length];
    const roll = random();
    const status = roll < 0.55 ? 'backlog'
      : roll < 0.65 ? 'triage'
        : roll < 0.75 ? 'in-progress'
          : roll < 0.85 ? 'done'
            : roll < 0.90 ? 'killed'
              : roll < 0.95 ? 'deferred' : 'archived';
    const created = addDays('2026-01-05', (index * 37) % 240);
    let terminal = null;
    if (status !== 'backlog' && status !== 'triage' && status !== 'in-progress') {
      const candidate = addDays(created, 10 + (index % 30));
      terminal = candidate > '2026-09-04' ? '2026-09-04' : candidate;
    }
    const accepted = status !== 'triage' && random() < 0.8;
    const decisions = accepted ? acceptDecision(addDays(created, 2), `Accepted filler ${number}`) : [];
    const tagCount = index % 3;
    const tags = tagCount === 0
      ? undefined
      : [...new Set([FILLER_TAGS[(index * 3) % FILLER_TAGS.length], FILLER_TAGS[(index * 3 + 1) % FILLER_TAGS.length]])]
        .slice(0, tagCount).sort();
    const data = { area, complexity: index % 4 === 0 ? 'large' : 'small' };
    if (tags !== undefined) {
      data.tags = tags;
    }
    const dependsOn = [];
    if ((status === 'backlog' || status === 'in-progress') && index > startIndex && random() < 0.3) {
      dependsOn.push(items[items.length - 1].data.id);
    }
    const item = coreItem({
      id,
      number,
      title: `Demo filler ${number}: ${area} ${status} item`,
      status,
      created,
      updated: terminal ?? created,
      priority: index % 3 === 0 ? undefined : index % 5,
      dependsOn,
      decisions,
      data,
      body: `Synthetic demo data. Deterministic filler item ${number}.`,
      extra: terminal === null ? {} : {
        completed: status === 'done' ? terminal : undefined,
        killed: status === 'killed' ? terminal : undefined,
        deferred: status === 'deferred' ? terminal : undefined,
        archived: status === 'archived' ? terminal : undefined,
      },
    });
    // Drop the undefined terminal keys the status did not select so every
    // item carries exactly the date field its lifecycle allows.
    for (const key of ['completed', 'killed', 'deferred', 'archived']) {
      if (item.data[key] === undefined) {
        delete item.data[key];
      }
    }
    items.push(item);
  }
  return items;
}

function buildFixtureItems(count) {
  const core = coreItems();
  if (count <= core.length) {
    return core.slice(0, count);
  }
  return [...core, ...fillerItems(core.length, count, mulberry32(20260905))];
}

function buildConfig(outputPath, viewName) {
  const view = viewName === undefined ? null : {
    name: VIEW_NAME,
    title: VIEW_TITLE,
    filters: { fields: { area: [...VIEW_AREAS] } },
  };
  return {
    reportVersion: 2,
    repository: { name: 'Wowbagger demo ledger (synthetic data)', logo: null },
    title: view === null ? 'Decision-focused report demo (synthetic data)' : view.title,
    outputPath,
    fields: {
      area: '/data/area', tags: '/data/tags', complexity: '/data/complexity',
      class: '/data/class', due: '/data/due', severity: '/data/severity',
    },
    swarm: { eligibleComplexities: ['small'] },
    view,
  };
}

async function main() {
  const started = performance.now();
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error !== undefined) {
    fail(2, parsed.error);
    return;
  }
  const { options } = parsed;
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.out === undefined || options.out === '') {
    fail(2, '--out PATH is required.');
    return;
  }
  if (options.items === undefined) {
    fail(2, '--items N is required.');
    return;
  }
  if (!/^[0-9]+$/.test(options.items) || !Number.isSafeInteger(Number(options.items)) || Number(options.items) <= 0) {
    fail(2, `--items must be a positive integer (got "${options.items}").`);
    return;
  }
  if (options.view !== undefined && options.view !== VIEW_NAME) {
    fail(2, `unknown view "${options.view}" (supported: "${VIEW_NAME}").`);
    return;
  }
  const count = Number(options.items);
  const absoluteOut = path.resolve(process.cwd(), options.out);

  // Containment first: a rejected output writes nothing. The shared helper
  // resolves symlinks, including symlinked parent directories of outputs that
  // do not exist yet.
  const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    await assertReportOutputOutsideLedger(path.join(repositoryRoot, 'ledger'), absoluteOut);
  } catch (error) {
    fail(2, `${error.message} (output: ${absoluteOut})`);
    return;
  }

  let html;
  let retained;
  try {
    const model = buildReportModel(buildFixtureItems(count), buildConfig(absoluteOut, options.view), AS_OF);
    const graphBundle = await loadGraphBundle();
    // The published bytes are exactly what the renderer returns: never
    // patched, post-processed, or re-timestamped here.
    html = renderReportHtml(model, { graphBundle });
    retained = model.items.length + model.terminalItems.length;
    await writeReportFile(absoluteOut, html);
  } catch (error) {
    process.stderr.write(`report-design-demo: error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const durationMs = Math.round(performance.now() - started);
  process.stdout.write([
    `output: ${absoluteOut}`,
    `synthetic: ${SYNTHETIC_LABEL}`,
    `requested_items: ${count}`,
    `items: ${retained}`,
    `bytes: ${Buffer.byteLength(html, 'utf8')}`,
    `duration_ms: ${durationMs}`,
    `view: ${options.view ?? 'base'}`,
    '',
  ].join('\n'));
}

await main();
