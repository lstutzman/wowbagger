import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';

export async function loadLedger(ledgerDirectory) {
  const root = path.resolve(ledgerDirectory);
  const rootStat = await lstat(root);

  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Ledger directory is not a real directory: ${ledgerDirectory}`);
  }

  const files = await collectMarkdownFiles(root);
  const items = [];
  const errors = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const displayPath = ledgerPath(root, file);
    const parsed = parseItem(source);

    if (parsed.error) {
      errors.push({ path: displayPath, ...parsed.error });
      continue;
    }

    items.push({
      path: displayPath,
      sourcePath: file,
      data: parsed.data,
    });
  }

  return { items, errors };
}

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }

  return files;
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
          : error.message,
      },
    };
  }

  const data = document.toJS();

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
