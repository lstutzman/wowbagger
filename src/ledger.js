import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_FILE_SYSTEM = { lstat, open, readdir };

export async function loadLedger(ledgerDirectory, fileSystem = DEFAULT_FILE_SYSTEM) {
  const root = path.resolve(ledgerDirectory);
  let rootStat;
  try {
    rootStat = await fileSystem.lstat(root);
  } catch {
    return {
      items: [],
      errors: [ledgerReadError(ledgerPath(root, root))],
    };
  }

  if (rootStat.isSymbolicLink()) {
    return {
      items: [],
      errors: [symlinkError(ledgerPath(root, root))],
    };
  }

  if (!rootStat.isDirectory()) {
    return {
      items: [],
      errors: [rootNotDirectoryError(ledgerPath(root, root))],
    };
  }

  const collected = await collectMarkdownFiles(root, root, fileSystem);
  const items = [];
  const errors = [...collected.errors];

  for (const file of collected.files) {
    const displayPath = ledgerPath(root, file);
    let source;
    let bytes;

    try {
      const handle = await fileSystem.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const fileStat = await handle.stat();
        if (!fileStat.isFile()) {
          errors.push(ledgerReadError(displayPath));
          continue;
        }
        bytes = await handle.readFile();
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
      file,
      bytes,
      source,
      body: bodyFromSource(source),
      data: parsed.data,
    });
  }

  return { items, errors };
}

function bodyFromSource(source) {
  let index = 0;
  let lineNumber = 0;

  while (index <= source.length) {
    const lineEnd = source.indexOf('\n', index);
    const nextIndex = lineEnd === -1 ? source.length : lineEnd + 1;
    const rawLine = source.slice(index, lineEnd === -1 ? source.length : lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (lineNumber > 0 && line === '---') {
      return source.slice(nextIndex);
    }

    if (nextIndex === source.length) {
      return '';
    }
    index = nextIndex;
    lineNumber += 1;
  }

  return '';
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
    let entryType = entry;

    if (!entry.isSymbolicLink() && !entry.isDirectory() && !entry.isFile()) {
      try {
        entryType = await fileSystem.lstat(entryPath);
      } catch {
        errors.push(ledgerReadError(ledgerPath(root, entryPath)));
        continue;
      }
    }

    if (entryType.isSymbolicLink()) {
      errors.push(symlinkError(ledgerPath(root, entryPath)));
      continue;
    }

    if (entryType.isDirectory()) {
      const nested = await collectMarkdownFiles(root, entryPath, fileSystem);
      files.push(...nested.files);
      errors.push(...nested.errors);
      continue;
    }

    if (entryType.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
      continue;
    }

    if (entry.name.endsWith('.md')) {
      errors.push(ledgerReadError(ledgerPath(root, entryPath)));
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

function rootNotDirectoryError(displayPath) {
  return {
    path: displayPath,
    field: 'path',
    code: 'ledger-root-not-directory',
    message: 'Ledger root must be a real directory.',
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
  return relative ? `${path.basename(root)}/${relative}` : path.basename(root);
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
