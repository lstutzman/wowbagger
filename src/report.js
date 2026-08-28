import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectReadiness } from './ready.js';
import { buildAttention } from './report-attention.js';
import { buildEvidence } from './report-evidence.js';
import {
  classifyItem,
  collectUnknownClasses,
  computeEpicEnablement,
  computeLeverage,
  rankWorkNext,
} from './report-sequencing.js';
import { randomUUID } from 'node:crypto';
import { matchesReportView, normalizeReportViews, reportViewCriteria } from './report-view.js';

const REPORT_FILE_SYSTEM = { mkdir, open, rename, rm };
const LOGO_MIME_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

const CONFIG_KEYS = new Set(['report_version', 'repository', 'title', 'output', 'fields', 'swarm']);
const CONFIG_KEYS_VERSION_2 = new Set([...CONFIG_KEYS, 'views']);
const REPORT_VERSIONS = new Set([1, 2]);
const REPOSITORY_KEYS = new Set(['name', 'logo']);
const FIELD_KEYS = new Set([
  'area',
  'class',
  'due',
  'rank',
  'score',
  'complexity',
  'tier',
  'mandate',
  'severity',
  'confidence',
  'security',
  'priority_base',
  'priority_component',
  'priority_impact',
  'priority_leverage',
  'priority_rationale',
  'completion_reference',
]);
const SWARM_KEYS = new Set(['eligible_complexities']);

// The readiness vocabulary both report surfaces print. It lives beside the
// model so the HTML report and the graph can never label the same refusal
// differently.
export const READINESS_REASON_LABELS = {
  'kind-not-task': 'Not a task',
  'status-not-backlog': 'Not in backlog',
  snoozed: 'Snoozed',
  'dependency-unsatisfied': 'Dependency is not done',
  'ancestor-not-backlog': 'Ancestor is not in backlog',
};

export class ReportError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

// A failure cause travels as a short, stable token, never as the runtime's
// message: a message carries paths, credentials, and run-specific values that
// a machine-readable envelope must not republish, and it moves between Node
// releases, so a consumer could not branch on it anyway. The error's own code
// answers first, its kind second.
const MAXIMUM_CAUSE_CHARACTERS = 64;

export function failureCause(error) {
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : null;
  const kind = typeof error?.name === 'string' && error.name.length > 0 ? error.name : null;
  return (code ?? kind ?? 'unknown').slice(0, MAXIMUM_CAUSE_CHARACTERS);
}

export function resolvePointer(value, pointer) {
  if (pointer === '') {
    return value;
  }

  let current = value;
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = encodedSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null
      || (typeof current !== 'object' && typeof current !== 'function')
      || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

// Readiness is a fact about the complete ledger, so it is projected before any
// view narrows the set: excluding a blocker can never promote the work it
// holds. Every section below then derives from the one retained projection, so
// the statistics, the ranking, the attention lists, and the graph can never
// describe different populations.
export function buildReportModel(items, config, asOf) {
  const view = config.view ?? null;
  const readinessById = projectReadiness(items, asOf);
  const allProjected = items.map((item) => projectItem(item, config.fields, readinessById.get(item.data.id)));
  const projected = view === null
    ? allProjected
    : allProjected.filter((item) => matchesReportView(item, view.filters));
  const retainedIds = new Set(projected.map((item) => item.id));
  const reportItems = projected
    .filter((item) => item.terminalDate === null)
    .sort(compareProjectedItems);
  const terminalItems = projected
    .filter((item) => item.terminalDate !== null)
    .sort((left, right) => compareText(right.terminalDate, left.terminalDate) || compareText(left.id, right.id));

  const leverageById = computeLeverage(reportItems);
  const epicById = computeEpicEnablement(projected);
  for (const reportItem of reportItems) {
    reportItem.sequencing = {
      ...classifyItem(reportItem, asOf),
      leverage: leverageById.get(reportItem.id),
      epic: epicById.get(reportItem.id),
    };
  }

  const workNext = rankWorkNext(reportItems.filter((item) => item.readiness.state === 'ready'));

  const evidence = buildEvidence(reportItems, terminalItems, asOf);

  const swarmBatches = config.swarm === null
    ? []
    : buildSwarmBatches(reportItems, config.swarm.eligibleComplexities);
  return {
    reportVersion: config.reportVersion,
    repository: config.repository,
    title: view === null ? config.title : view.title,
    asOf,
    items: reportItems,
    terminalItems,
    workNext,
    unknownClasses: collectUnknownClasses(reportItems),
    evidence,
    attention: buildAttention(reportItems, terminalItems, evidence.cycleTime, asOf),
    stats: {
      total: projected.length,
      open: reportItems.length,
      terminal: terminalItems.length,
      ready: reportItems.filter((item) => item.readiness.state === 'ready').length,
      blocked: reportItems.filter((item) => item.readiness.state === 'blocked').length,
      ineligible: reportItems.filter((item) => item.readiness.state === 'ineligible').length,
      triage: projected.filter((item) => item.status === 'triage').length,
      inProgress: projected.filter((item) => item.status === 'in-progress').length,
      snoozed: items.filter((item) => retainedIds.has(item.data.id)
        && item.data.snoozed_until > asOf).length,
      done: terminalItems.filter((item) => item.status === 'done').length,
      killed: terminalItems.filter((item) => item.status === 'killed').length,
      deferred: terminalItems.filter((item) => item.status === 'deferred').length,
      archived: terminalItems.filter((item) => item.status === 'archived').length,
    },
    swarm: config.swarm,
    swarmBatches,
    view: view === null ? null : {
      name: view.name,
      title: view.title,
      criteria: reportViewCriteria(view.filters),
    },
    // Labels only. An excluded item names itself here so an included item that
    // depends on it still prints a number a reader can say out loud, and it
    // carries nothing else the report could show.
    itemNumbers: Object.fromEntries(allProjected.map((item) => [item.id, item.number])),
  };
}

function projectItem(item, fieldMappings, readiness) {
  const { data } = item;
  const fields = {};
  for (const [slot, pointer] of Object.entries(fieldMappings)) {
    const value = resolvePointer(data, pointer);
    if (value !== null && ['string', 'number', 'boolean'].includes(typeof value)) {
      fields[slot] = value;
    }
  }


  return {
    id: data.id,
    number: data.number ?? null,
    title: data.title,
    kind: data.kind,
    status: data.status,
    created: data.created,
    updated: data.updated,
    terminalDate: terminalDate(data),
    priority: data.priority ?? null,
    parent: data.parent ?? null,
    dependsOn: data.depends_on ?? [],
    related: data.related ?? [],
    decisions: data.decisions ?? [],
    body: item.body,
    readiness,
    fields,
  };
}
export function buildSwarmBatches(items, eligibleComplexities) {
  const pool = items.filter((item) => item.readiness.state === 'ready'
    && isNonEmptyString(item.fields.area)
    && isNonEmptyString(item.fields.complexity)
    && eligibleComplexities.includes(item.fields.complexity));
  const batches = [];

  while (pool.length > 0 && batches.length < 8) {
    const batch = [];
    const usedAreas = new Set();
    for (let index = 0; index < pool.length && batch.length < 6;) {
      const candidate = pool[index];
      if (usedAreas.has(candidate.fields.area)) {
        index += 1;
        continue;
      }
      usedAreas.add(candidate.fields.area);
      batch.push(candidate);
      pool.splice(index, 1);
    }
    batches.push(batch);
  }

  return batches;
}

function terminalDate(data) {
  const field = {
    done: 'completed',
    killed: 'killed',
    archived: 'archived',
    deferred: 'deferred',
  }[data.status];
  return field === undefined ? null : data[field];
}

export async function writeReportFile(outputPath, html, overrides = {}) {
  const fileSystem = { ...REPORT_FILE_SYSTEM, ...overrides };
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle = null;

  try {
    await fileSystem.mkdir(directory, { recursive: true });
    handle = await fileSystem.open(temporaryPath, 'wx', 0o644);
    await handle.writeFile(html, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, outputPath);
  } catch (error) {
    if (handle !== null) {
      await handle.close().catch(() => {});
    }
    let cleanupError = null;
    try {
      await fileSystem.rm(temporaryPath, { force: true });
    } catch (candidate) {
      cleanupError = candidate;
    }
    const details = { cause: failureCause(error) };
    if (cleanupError !== null) {
      details.cleanup_cause = failureCause(cleanupError);
      details.leftover_artifact = temporaryPath;
    }
    throw new ReportError('report-write-failed', 'Report publication failed.', details);
  }
}

function compareProjectedItems(left, right) {
  const leftHasRank = typeof left.fields.rank === 'number' && Number.isFinite(left.fields.rank);
  const rightHasRank = typeof right.fields.rank === 'number' && Number.isFinite(right.fields.rank);
  if (leftHasRank !== rightHasRank) {
    return leftHasRank ? -1 : 1;
  }
  if (leftHasRank) {
    if (left.fields.rank !== right.fields.rank) {
      return left.fields.rank - right.fields.rank;
    }
    const rankedPriority = compareOptionalPriority(left, right);
    if (rankedPriority !== 0) {
      return rankedPriority;
    }
  } else {
    const priority = compareOptionalPriority(left, right);
    if (priority !== 0) {
      return priority;
    }
  }
  return compareText(left.created, right.created) || compareText(left.id, right.id);
}

function compareOptionalPriority(left, right) {
  const leftHasPriority = typeof left.priority === 'number';
  const rightHasPriority = typeof right.priority === 'number';
  if (leftHasPriority !== rightHasPriority) {
    return leftHasPriority ? -1 : 1;
  }
  return leftHasPriority ? left.priority - right.priority : 0;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function loadReportConfig(ledgerDirectory, outputOverride, viewName = null) {
  const configPath = path.join(ledgerDirectory, '.wowbagger', 'report.json');
  const configDirectory = path.dirname(configPath);
  let config;

  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ReportError('report-config-invalid', 'Report configuration is missing.');
    }
    if (error instanceof SyntaxError) {
      throw new ReportError('report-config-invalid', 'Report configuration is not valid JSON.');
    }
    throw new ReportError('report-read-failed', 'Report configuration could not be read.', {
      operation: 'read-config',
      path: configPath,
    });
  }

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new ReportError('report-config-invalid', 'Report configuration must be a JSON object.');
  }
  const configuredOutputIsValid = isNonEmptyString(config.output);
  if (!REPORT_VERSIONS.has(config.report_version)
    || !isObject(config.repository)
    || !isNonEmptyString(config.repository.name)
    || !isNonEmptyString(config.title)
    || (config.output !== undefined && !configuredOutputIsValid)
    || (outputOverride === undefined && !configuredOutputIsValid)
    || (outputOverride !== undefined && !isNonEmptyString(outputOverride))) {
    throw new ReportError('report-config-invalid', 'Report configuration has missing or invalid required values.');
  }
  const namesViews = config.report_version === 2;
  if (!hasOnlyKeys(config, namesViews ? CONFIG_KEYS_VERSION_2 : CONFIG_KEYS)
    || !hasOnlyKeys(config.repository, REPOSITORY_KEYS)
    || (isObject(config.fields) && !hasOnlyKeys(config.fields, FIELD_KEYS))
    || (isObject(config.swarm) && !hasOnlyKeys(config.swarm, SWARM_KEYS))) {
    throw new ReportError('report-config-invalid', 'Report configuration contains an unknown key.');
  }
  if (config.repository.logo !== undefined
    && (!isNonEmptyString(config.repository.logo)
      || !LOGO_MIME_TYPES.has(path.extname(config.repository.logo).toLocaleLowerCase('en-US')))) {
    throw new ReportError('report-config-invalid', 'Report logo must use a supported image extension.');
  }
  if (Object.prototype.hasOwnProperty.call(config, 'fields')
    && (!isObject(config.fields)
      || Object.values(config.fields).some((pointer) => !isValidPointer(pointer)))) {
    throw new ReportError('report-config-invalid', 'Report field mappings must be valid RFC 6901 pointers.');
  }
  if (Object.prototype.hasOwnProperty.call(config, 'swarm')) {
    const eligibleComplexities = config.swarm?.eligible_complexities;
    if (!isObject(config.swarm)
      || !Array.isArray(eligibleComplexities)
      || eligibleComplexities.length === 0
      || eligibleComplexities.some((value) => !isNonEmptyString(value))
      || new Set(eligibleComplexities).size !== eligibleComplexities.length
      || !isValidPointer(config.fields?.area)
      || !isValidPointer(config.fields?.complexity)) {
      throw new ReportError('report-config-invalid', 'Report swarm configuration is invalid.');
    }
  }
  // Version 2 exists to name views, so a version 2 configuration without a
  // usable `views` object is invalid rather than a base-only report.
  const views = namesViews ? normalizeReportViews(config.views, config.fields ?? {}) : null;
  if (namesViews && views === null) {
    throw new ReportError('report-config-invalid', 'Report view configuration is invalid.');
  }
  await assertDistinctReportOutputs(ledgerDirectory, configDirectory, config, views);
  const view = selectReportView(views, viewName, configDirectory);
  // The selected report is the one this invocation publishes: the view's own
  // output when a view is named, the base output otherwise, and `--out` over
  // either. Configured paths were already contained above, so only an override
  // still needs the containment rule applied to it.
  const outputPath = outputOverride === undefined
    ? (view === null ? path.resolve(configDirectory, config.output) : view.outputPath)
    : path.resolve(process.cwd(), outputOverride);
  if (outputOverride !== undefined) {
    await assertReportOutputOutsideLedger(ledgerDirectory, outputPath);
  }
  return {
    reportVersion: config.report_version,
    repository: {
      name: config.repository.name,
      logo: config.repository.logo === undefined
        ? null
        : path.resolve(configDirectory, config.repository.logo),
    },
    title: config.title,
    outputPath,
    fields: config.fields ?? {},
    swarm: config.swarm === undefined
      ? null
      : { eligibleComplexities: [...config.swarm.eligible_complexities] },
    view,
  };
}

// Every configured output is checked, and checked against every other, before a
// view is selected: a `--out` override for this invocation never excuses a
// configuration that would publish two reports over one file. Distinctness is
// judged on the canonical physical path, so two spellings or a symlinked
// directory cannot smuggle a collision past the comparison.
async function assertDistinctReportOutputs(ledgerDirectory, configDirectory, config, views) {
  const configuredOutputs = isNonEmptyString(config.output) ? [config.output] : [];
  if (views !== null) {
    configuredOutputs.push(...Object.values(views).map((view) => view.output));
  }

  const canonicalPaths = new Set();
  for (const configuredOutput of configuredOutputs) {
    const canonicalPath = await assertReportOutputOutsideLedger(
      ledgerDirectory,
      path.resolve(configDirectory, configuredOutput),
    );
    if (canonicalPaths.has(canonicalPath)) {
      throw new ReportError('report-config-invalid', 'Report outputs must be distinct.');
    }
    canonicalPaths.add(canonicalPath);
  }
}

// Selection happens after the complete configuration validates, so an unknown
// name never masks a broken view definition. The own-property check matters:
// a portable view name may collide with an inherited object member.
function selectReportView(views, viewName, configDirectory) {
  if (viewName === null || viewName === undefined) {
    return null;
  }
  if (views === null || !Object.prototype.hasOwnProperty.call(views, viewName)) {
    throw new ReportError(
      'report-view-not-found',
      'The requested report view was not found.',
      { view: viewName },
    );
  }
  const view = views[viewName];
  return {
    name: view.name,
    title: view.title,
    outputPath: path.resolve(configDirectory, view.output),
    filters: view.filters,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function readLogoDataUrl(logoPath) {
  if (logoPath === null) {
    return null;
  }
  const mimeType = LOGO_MIME_TYPES.get(path.extname(logoPath).toLocaleLowerCase('en-US'));
  try {
    const bytes = await readFile(logoPath);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  } catch {
    throw new ReportError('report-read-failed', 'Report logo could not be read.', {
      operation: 'read-logo',
      path: logoPath,
    });
  }
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}


function isValidPointer(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !/~(?:[^01]|$)/.test(value);
}

async function resolvePhysicalPath(targetPath) {
  let existingPath = targetPath;
  const missingSegments = [];

  while (true) {
    try {
      const resolvedPath = await realpath(existingPath);
      // Windows realpath reports ENOENT, not ENOTDIR, when a path component
      // is a regular file, so the walk can land on a file that still has
      // segments missing below it. Restate that as the ENOTDIR POSIX raises.
      if (missingSegments.length > 0 && !(await stat(resolvedPath)).isDirectory()) {
        const notADirectory = new Error(`ENOTDIR: not a directory, realpath '${targetPath}'`);
        notADirectory.code = 'ENOTDIR';
        throw notADirectory;
      }
      return path.join(resolvedPath, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      const parent = path.dirname(existingPath);
      if (parent === existingPath) {
        throw error;
      }
      missingSegments.push(path.basename(existingPath));
      existingPath = parent;
    }
  }
}

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

// Returns the canonical physical path so callers comparing several configured
// outputs judge the same identity the containment rule judged.
//
// Resolving a path is a read of the filesystem, and a read that fails is a
// stated failure rather than a raw runtime error escaping into the command's
// catch-all: the caller learns which resolution failed, for which path it
// named, and the cause code the filesystem gave. Nothing is published either
// way, so this is never a publication failure.
export async function assertReportOutputOutsideLedger(ledgerDirectory, outputPath) {
  const ledgerPath = await resolvedOrRefused(
    () => realpath(ledgerDirectory),
    'resolve-ledger-path',
    ledgerDirectory,
  );
  const resolvedOutputPath = await resolvedOrRefused(
    () => resolvePhysicalPath(outputPath),
    'resolve-output-path',
    outputPath,
  );
  if (isInside(ledgerPath, resolvedOutputPath)) {
    throw new ReportError('report-config-invalid', 'Report output must be outside the ledger directory.');
  }
  return resolvedOutputPath;
}

// The path in the details is the one the caller configured or passed, never a
// path the filesystem revealed while resolving it: a link target belongs to the
// host, not to the answer.
async function resolvedOrRefused(resolve, operation, targetPath) {
  try {
    return await resolve();
  } catch (error) {
    throw new ReportError('report-read-failed', 'A report path could not be resolved.', {
      operation,
      path: targetPath,
      cause: failureCause(error),
    });
  }
}