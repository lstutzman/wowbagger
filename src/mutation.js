import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadLedger } from './ledger.js';
import { validateLedger } from './validate.js';

const REQUIRED_CORE_FIELDS = [
  'schema_version',
  'id',
  'title',
  'kind',
  'status',
  'created',
  'updated',
];
const OPTIONAL_CORE_FIELDS = [
  'parent',
  'snoozed_until',
  'completed',
  'killed',
  'archived',
];
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export async function inspectItem(ledgerDirectory, id) {
  const ledger = await loadLedger(ledgerDirectory);
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    return { validation };
  }

  const item = ledger.items.find((candidate) => candidate.data.id === id);
  if (!item) {
    return { item: null };
  }

  return {
    item: {
      id,
      path: item.path.slice(item.path.indexOf('/') + 1),
      revision: revisionFor(item.bytes),
      source_encoding: 'base64',
      source_media_type: 'text/markdown; charset=utf-8',
      source_base64: item.bytes.toString('base64'),
      core: coreView(item.data),
      body: item.body,
    },
  };
}

export function revisionFor(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export async function createItem(ledgerDirectory, request) {
  const root = path.resolve(ledgerDirectory);
  const id = request.id;
  const locks = await acquireLocks(root, [id], 'create');
  let temporaryPath = null;

  try {
    const ledger = await loadLedger(root);
    const validation = validateLedger(ledger);
    if (!validation.valid) {
      throw new Error('Cannot create in an invalid ledger.');
    }

    if (ledger.items.some((item) => item.data.id === id)) {
      throw new Error('Requested ID already exists.');
    }

    const finalPath = path.join(root, `${id}.md`);
    try {
      await lstat(finalPath);
      throw new Error('Default item path is occupied.');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    const date = dateFromId(id);
    const candidate = createData(request, date);
    const candidateValidation = validateLedger({
      items: [...ledger.items, {
        path: `${path.basename(root)}/${id}.md`,
        data: candidate,
      }],
      errors: [],
    });
    if (!candidateValidation.valid) {
      throw new Error('The proposed item would make the ledger invalid.');
    }

    const bytes = Buffer.from(serializeCreate(candidate, request.body), 'utf8');
    temporaryPath = path.join(root, `.wowbagger-tmp-${id}-${randomSuffix()}`);
    const temporary = await open(temporaryPath, 'wx');
    try {
      await temporary.writeFile(bytes);
      await temporary.sync();
    } finally {
      await temporary.close();
    }

    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);
    temporaryPath = null;

    const published = await readRegularFile(finalPath);
    if (!published.equals(bytes)) {
      throw new Error('Published item bytes did not match the requested item.');
    }

    const result = await inspectItem(root, id);
    return result.item;
  } finally {
    if (temporaryPath) {
      await unlink(temporaryPath).catch(() => {});
    }
    await releaseLocks(locks);
  }
}

async function acquireLocks(root, ids, operation) {
  const lockDirectory = path.join(root, '.wowbagger-locks');
  await mkdir(lockDirectory, { recursive: true });
  const locks = [];

  try {
    for (const id of [...new Set(ids)].sort(compareText)) {
      const file = path.join(lockDirectory, `${id}.lock`);
      const handle = await open(file, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({
          lock_version: 1,
          item_id: id,
          operation,
          writer_id: randomSuffix(),
          started_at: new Date().toISOString(),
        })}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      locks.push(file);
    }
    return locks;
  } catch (error) {
    await releaseLocks(locks);
    throw error;
  }
}

async function releaseLocks(locks) {
  await Promise.all(locks.map((file) => unlink(file).catch(() => {})));
}

async function readRegularFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error('Published path is not a regular file.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function createData(request, date) {
  return {
    schema_version: 1,
    id: request.id,
    title: request.item.title,
    kind: request.item.kind,
    status: 'triage',
    created: date,
    updated: date,
    provenance: request.item.provenance,
    depends_on: request.item.depends_on,
    related: request.item.related ?? [],
    ...extensionMembers(request.item),
  };
}

function serializeCreate(data, body) {
  const lines = [
    '---',
    'schema_version: 1',
    `id: ${data.id}`,
    `title: ${quote(data.title)}`,
    `kind: ${data.kind}`,
    'status: triage',
    `created: ${data.created}`,
    `updated: ${data.updated}`,
    'provenance:',
    `  source: ${quote(data.provenance.source)}`,
    `  recorded_at: ${quote(data.provenance.recorded_at)}`,
    `depends_on: ${referenceList(data.depends_on)}`,
    `related: ${referenceList(data.related)}`,
  ];

  for (const [key, value] of Object.entries(extensionMembers(data))) {
    lines.push(...yamlLines(key, value, 0));
  }

  lines.push('---');
  return `${lines.join('\n')}\n${body}`;
}

function extensionMembers(item) {
  const controlled = new Set([
    'schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated',
    'provenance', 'depends_on', 'related', 'parent', 'snoozed_until',
    'completed', 'killed', 'archived', 'decisions', 'body',
  ]);
  return Object.fromEntries(Object.entries(item).filter(([key]) => !controlled.has(key)));
}

function yamlLines(key, value, indentation) {
  const prefix = ' '.repeat(indentation);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}${key}: []`];
    }
    return [
      `${prefix}${key}:`,
      ...value.flatMap((entry) => [`${prefix}  - ${yamlScalar(entry)}`]),
    ];
  }
  if (value !== null && typeof value === 'object') {
    const lines = [`${prefix}${key}:`];
    for (const [childKey, childValue] of Object.entries(value)) {
      lines.push(...yamlLines(childKey, childValue, indentation + 2));
    }
    return lines;
  }
  return [`${prefix}${key}: ${yamlScalar(value)}`];
}

function yamlScalar(value) {
  if (typeof value === 'string') {
    return quote(value);
  }
  if (value === null) {
    return 'null';
  }
  return String(value);
}

function quote(value) {
  return JSON.stringify(value);
}

function referenceList(references) {
  return references.length === 0 ? '[]' : `[${references.join(', ')}]`;
}

function dateFromId(id) {
  const ulid = id.slice(3);
  let milliseconds = 0;
  for (const character of ulid.slice(0, 10)) {
    milliseconds = (milliseconds * 32) + ULID_ALPHABET.indexOf(character);
  }
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function randomSuffix() {
  return createHash('sha256').update(`${process.pid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function coreView(data) {
  const core = {};
  for (const field of REQUIRED_CORE_FIELDS) {
    core[field] = data[field];
  }
  core.provenance = {
    source: data.provenance.source,
    recorded_at: data.provenance.recorded_at,
  };
  core.depends_on = data.depends_on;
  core.related = data.related ?? [];

  for (const field of OPTIONAL_CORE_FIELDS) {
    if (Object.hasOwn(data, field)) {
      core[field] = data[field];
    }
  }

  if (Object.hasOwn(data, 'decisions')) {
    core.decisions = data.decisions.map((decision) => {
      const normalized = {
        action: decision.action,
        date: decision.date,
        summary: decision.summary,
        rationale: decision.rationale,
      };
      if (Object.hasOwn(decision, 'rollup')) {
        normalized.rollup = decision.rollup.map(({ id, status }) => ({ id, status }));
      }
      return normalized;
    });
  }

  return core;
}
