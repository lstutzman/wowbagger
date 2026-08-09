import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';

import { loadLedger, parseLedgerItemSource } from './ledger.js';
import { validateLedger } from './validate.js';

const MAINTENANCE_NOTICE = 'NOTICE: This is a quiesced-window maintenance operation. Take a backup before --apply; recovery uses that backup and Git, not the mutation contract.';
const HISTORY_NOTICE = 'NOTICE: Schema 1 cleanup history is unrecoverable. Prerequisites previously moved from depends_on to related stay there; no dependency is inferred.';

export async function runSchema2MigrationCli(argumentsList, streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const options = parseArguments(argumentsList);

  stdout.write(`${MAINTENANCE_NOTICE}\n`);
  stdout.write(`${HISTORY_NOTICE}\n`);
  const result = await migrateSchema2(options.ledger, {
    apply: options.apply,
    onItem: async (change) => {
      stdout.write(`CHANGED ${change.path} (${change.id}): schema_version 1 -> 2\n`);
    },
  });

  if (options.apply) {
    stdout.write(`Summary: ${result.changes.length} ${itemWord(result.changes.length)} changed.\n`);
    stdout.write('Validation: schema version 2 passed.\n');
  } else {
    for (const change of result.changes) {
      stdout.write(`WOULD CHANGE ${change.path} (${change.id}): schema_version 1 -> 2\n`);
    }
    stdout.write(`Summary: ${result.changes.length} ${itemWord(result.changes.length)} would change; 0 files written (dry run).\n`);
  }
}

function itemWord(count) {
  return count === 1 ? 'item' : 'items';
}

export async function migrateSchema2(ledgerDirectory, { apply = false, onItem = async () => {} } = {}) {
  const ledger = await loadLedger(ledgerDirectory);
  const inputValidation = validateLedger(ledger);
  const schemaVersions = new Set(ledger.items.map((item) => item.data.schema_version));
  if (schemaVersions.has(1) && schemaVersions.has(2)) {
    throw new SchemaMigrationError(
      'mixed-schema-versions',
      'The ledger contains schema versions 1 and 2. This is a partial migration state. Restore the complete ledger from the pre-migration backup or Git, validate schema version 1, then rerun the dry run.',
    );
  }
  if (inputValidation.valid && ledger.items.length > 0
    && schemaVersions.size === 1 && schemaVersions.has(2)) {
    throw new SchemaMigrationError(
      'already-schema-2',
      'Every item is already schema version 2. This tool will not run again. Validate the ledger as schema version 2; if validation fails, restore the pre-migration backup or Git.',
    );
  }
  if (!inputValidation.valid) {
    throw new SchemaMigrationError(
      'invalid-schema-1',
      'The ledger must validate completely as schema version 1 before migration. No files were changed.',
      inputValidation.errors,
    );
  }
  const heldLocks = await heldItemLocks(ledgerDirectory);
  if (heldLocks.length > 0) {
    throw new SchemaMigrationError(
      'lock-held',
      `Item locks are held under the ledger: ${heldLocks.join(', ')}. The migration requires a quiesced window. Stop all writers and resolve the locks through audited manual recovery before rerunning the dry run. No files were changed.`,
    );
  }
  const changes = ledger.items.map((item) => {
    const source = schema2Source(item.source);
    return {
      id: item.data.id,
      path: item.path,
      file: item.file,
      before: item.bytes,
      after: Buffer.from(source, 'utf8'),
      source,
    };
  });

  const candidate = {
    errors: [...ledger.errors],
    items: changes.map((change, index) => candidateItem(ledger.items[index], change)),
  };
  const validation = validateLedger(candidate);
  if (!validation.valid || candidate.items.some((item) => item.data.schema_version !== 2)) {
    throw new Error('The planned schema version 2 ledger does not validate.');
  }

  let completed = 0;
  if (apply) {
    for (const change of changes) {
      await atomicRewrite(change);
      completed += 1;
      await onItem(change);
    }

    const migratedLedger = await loadLedger(ledgerDirectory);
    const postValidation = validateLedger(migratedLedger);
    const uniformSchema2 = migratedLedger.items.length > 0
      && migratedLedger.items.every((item) => item.data.schema_version === 2);
    if (!postValidation.valid || !uniformSchema2) {
      throw new SchemaMigrationError(
        'post-validation-failed',
        `The post-migration ledger did not validate as schema version 2 after ${completed} of ${changes.length} item writes. Restore the pre-migration backup or Git before any rerun.`,
        postValidation.errors,
      );
    }
  }

  return { apply, changes, completed };
}

async function heldItemLocks(ledgerDirectory) {
  const lockDirectory = path.join(path.resolve(ledgerDirectory), '.wowbagger-locks');
  let entries;
  try {
    entries = await readdir(lockDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw new SchemaMigrationError(
      'lock-state-unknown',
      'The item-lock directory could not be inspected. Quiescence is not established. No files were changed.',
    );
  }
  return entries
    .filter((entry) => entry.name.endsWith('.lock'))
    .map((entry) => `.wowbagger-locks/${entry.name}`)
    .sort();
}

export function formatSchemaMigrationError(error) {
  if (!(error instanceof SchemaMigrationError)) {
    return `ERROR: ${error.message}\n`;
  }
  const diagnostics = error.diagnostics
    .map((entry) => `${entry.path} ${entry.field} [${entry.code}]: ${entry.message}`)
    .join('\n');
  return `ERROR [${error.code}]: ${error.message}\n${diagnostics ? `${diagnostics}\n` : ''}`;
}

class SchemaMigrationError extends Error {
  constructor(code, message, diagnostics = []) {
    super(message);
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

async function atomicRewrite(change) {
  const sourceHandle = await open(change.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let sourceStat;
  let current;
  try {
    sourceStat = await sourceHandle.stat();
    current = await sourceHandle.readFile();
  } finally {
    await sourceHandle.close();
  }
  if (!sourceStat.isFile() || !current.equals(change.before)) {
    throw new Error(`Item changed after migration preflight: ${change.path}.`);
  }

  const temporary = path.join(
    path.dirname(change.file),
    `.wowbagger-schema-2-${process.pid}-${randomUUID()}.tmp`,
  );
  let temporaryHandle;
  try {
    temporaryHandle = await open(temporary, 'wx', sourceStat.mode & 0o777);
    await temporaryHandle.writeFile(change.after);
    await temporaryHandle.chmod(sourceStat.mode & 0o777);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await rename(temporary, change.file);
  } finally {
    await temporaryHandle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function candidateItem(item, change) {
  const parsed = parseLedgerItemSource(change.source);
  if (parsed.error) {
    return { ...item, data: {}, source: change.source, bytes: change.after };
  }
  return {
    ...item,
    data: parsed.data,
    body: parsed.body,
    source: change.source,
    bytes: change.after,
  };
}

function schema2Source(source) {
  const bounds = frontmatterBounds(source);
  const document = parseDocument(source.slice(bounds.start, bounds.end), {
    prettyErrors: false,
    schema: 'core',
    uniqueKeys: true,
  });
  const schemaVersion = document.get('schema_version', true);
  if (!schemaVersion?.range) {
    throw new Error('The schema_version scalar could not be located.');
  }
  const start = bounds.start + schemaVersion.range[0];
  const end = bounds.start + schemaVersion.range[1];
  return `${source.slice(0, start)}2${source.slice(end)}`;
}

function frontmatterBounds(source) {
  const opening = nextLine(source, 0);
  if (opening.content !== '---' || opening.next === null) {
    throw new Error('The item frontmatter could not be located.');
  }
  const start = opening.next;
  let cursor = start;
  while (cursor < source.length) {
    const line = nextLine(source, cursor);
    if (line.content === '---') {
      return { start, end: cursor };
    }
    if (line.next === null) {
      break;
    }
    cursor = line.next;
  }
  throw new Error('The item frontmatter could not be located.');
}

function nextLine(source, start) {
  const lf = source.indexOf('\n', start);
  if (lf === -1) {
    return { content: source.slice(start), next: null };
  }
  const carriageReturn = lf > start && source[lf - 1] === '\r';
  return {
    content: source.slice(start, carriageReturn ? lf - 1 : lf),
    next: lf + 1,
  };
}

function parseArguments(argumentsList) {
  let ledger;
  let apply = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--ledger' && ledger === undefined && index + 1 < argumentsList.length) {
      ledger = argumentsList[index + 1];
      index += 1;
    } else if (argument === '--apply' && !apply) {
      apply = true;
    } else {
      throw new Error('Usage: node scripts/migrate-schema-2.js --ledger <dir> [--apply]');
    }
  }

  if (ledger === undefined) {
    throw new Error('Usage: node scripts/migrate-schema-2.js --ledger <dir> [--apply]');
  }
  return { ledger, apply };
}
