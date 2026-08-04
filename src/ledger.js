import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_FILE_SYSTEM = { lstat, open, readdir };

export async function loadLedger(ledgerDirectory, fileSystem = DEFAULT_FILE_SYSTEM) {
  const root = path.resolve(ledgerDirectory);
  const rootStat = await fileSystem.lstat(root);

  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Ledger directory is not a real directory: ${ledgerDirectory}`);
  }

  const collected = await collectMarkdownFiles(root, root, fileSystem);
  const items = [];
  const errors = [...collected.errors];

  for (const file of collected.files) {
    const displayPath = ledgerPath(root, file);
    let source;

    try {
      const handle = await fileSystem.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const fileStat = await handle.stat();
        if (!fileStat.isFile()) {
          errors.push(ledgerReadError(displayPath));
          continue;
        }
        const bytes = await handle.readFile();
        try {
          source = UTF8_DECODER.decode(bytes);
        } catch {
          errors.push(invalidUtf8Error(displayPath));
          continue;
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      errors.push(error?.code === 'ELOOP' ? symlinkError(displayPath) : ledgerReadError(displayPath));
      continue;
    }

    const parsed = parseItem(source);

    if (parsed.error) {
      errors.push({ path: displayPath, ...parsed.error });
      continue;
    }

    items.push({
      path: displayPath,
      data: parsed.data,
    });
  }

  return { items, errors };
}

async function collectMarkdownFiles(root, directory, fileSystem) {
  let directoryStat;
  try {
    directoryStat = await fileSystem.lstat(directory);
  } catch {
    return {
      files: [],
      errors: [ledgerReadError(ledgerPath(root, directory))],
    };
  }

  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return {
      files: [],
      errors: [symlinkError(ledgerPath(root, directory))],
    };
  }

  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch {
    return {
      files: [],
      errors: [ledgerReadError(ledgerPath(root, directory))],
    };
  }
  const files = [];
  const errors = [];

  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      errors.push(symlinkError(ledgerPath(root, entryPath)));
      continue;
    }

    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(root, entryPath, fileSystem);
      files.push(...nested.files);
      errors.push(...nested.errors);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }

  return { files, errors };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function symlinkError(displayPath) {
  return {
    path: displayPath,
    field: 'path',
    code: 'symlink-not-allowed',
    message: 'Ledger entries must not be symbolic links.',
  };
}

function ledgerReadError(displayPath) {
  return {
    path: displayPath,
    field: 'path',
    code: 'ledger-read-error',
    message: 'Ledger path could not be read.',
  };
}

function invalidUtf8Error(displayPath) {
  return {
    path: displayPath,
    field: 'encoding',
    code: 'invalid-utf8',
    message: 'Ledger items must be valid UTF-8.',
  };
}

function ledgerPath(root, file) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  return `${path.basename(root)}/${relative}`;
}

function parseItem(source) {
  const frontmatter = extractFrontmatter(source);

  if (frontmatter === null) {
    return {
      error: {
        field: 'frontmatter',
        code: 'malformed-frontmatter',
        message: 'Item must begin with one YAML frontmatter document delimited by --- lines.',
      },
    };
  }

  const document = parseDocument(frontmatter, {
    prettyErrors: false,
    schema: 'core',
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const error = document.errors[0];
    return {
      error: {
        field: 'frontmatter',
        code: error.code === 'DUPLICATE_KEY' ? 'duplicate-yaml-key' : 'invalid-yaml',
        message: error.code === 'DUPLICATE_KEY'
          ? 'YAML mapping keys must be unique.'
          : 'Frontmatter contains invalid YAML.',
      },
    };
  }

  let data;
  try {
    data = document.toJS();
  } catch {
    return {
      error: {
        field: 'frontmatter',
        code: 'invalid-yaml',
        message: 'Frontmatter contains invalid YAML.',
      },
    };
  }

  if (data === null || Array.isArray(data) || typeof data !== 'object') {
    return {
      error: {
        field: 'frontmatter',
        code: 'invalid-frontmatter-type',
        message: 'Frontmatter must be a YAML mapping.',
      },
    };
  }

  return { data };
}

function extractFrontmatter(source) {
  const lines = source.split(/\r?\n/);

  if (lines[0] !== '---') {
    return null;
  }

  const closeIndex = lines.indexOf('---', 1);
  if (closeIndex === -1) {
    return null;
  }

  return lines.slice(1, closeIndex).join('\n');
}
