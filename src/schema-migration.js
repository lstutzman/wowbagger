import { parseDocument } from 'yaml';

import { loadLedger, parseLedgerItemSource } from './ledger.js';
import { validateLedger } from './validate.js';

const MAINTENANCE_NOTICE = 'NOTICE: This is a quiesced-window maintenance operation. Take a backup before --apply; recovery uses that backup and Git, not the mutation contract.';
const HISTORY_NOTICE = 'NOTICE: Schema 1 cleanup history is unrecoverable. Prerequisites previously moved from depends_on to related stay there; no dependency is inferred.';

export async function runSchema2MigrationCli(argumentsList, streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const options = parseArguments(argumentsList);
  const result = await migrateSchema2(options.ledger, { apply: options.apply });

  stdout.write(`${MAINTENANCE_NOTICE}\n`);
  stdout.write(`${HISTORY_NOTICE}\n`);
  for (const change of result.changes) {
    stdout.write(`WOULD CHANGE ${change.path} (${change.id}): schema_version 1 -> 2\n`);
  }
  stdout.write(`Summary: ${result.changes.length} items would change; 0 files written (dry run).\n`);
}

export async function migrateSchema2(ledgerDirectory, { apply = false } = {}) {
  const ledger = await loadLedger(ledgerDirectory);
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

  return { apply, changes };
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
