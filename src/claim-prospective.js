import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseLedgerItemSource } from './ledger.js';
import { readGitTreeFile, readGitTreeLedger } from './git-reconciliation.js';
import { revisionFor } from './mutation.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const AUTHORIZING_TYPES = new Set(['legacy-mutation', 'revision-adoption', 'publish-final']);

export function checkProspectiveLedger({ namespace, items, entries, parents, candidate }) {
  const bySequence = new Map();
  for (const entry of entries) {
    const entryNamespace = entry.ledger_namespace
      ?? entry.request?.ledger_namespace
      ?? entry.fence?.ledger_namespace;
    if (!Number.isInteger(entry.seq) || entry.seq < 1
      || (entryNamespace !== undefined && entryNamespace !== namespace)) {
      return { ok: false, error: { code: 'ambiguous-journal', parents, candidate } };
    }
    const existing = bySequence.get(entry.seq);
    const serialized = JSON.stringify(entry);
    if (existing !== undefined && existing !== serialized) {
      return { ok: false, error: { code: 'ambiguous-journal', sequence: entry.seq, parents, candidate } };
    }
    bySequence.set(entry.seq, serialized);
  }

  const ordered = [...entries].sort((left, right) => left.seq - right.seq);
  const authorizations = new Map();
  for (const entry of ordered) {
    if (!AUTHORIZING_TYPES.has(entry.type)) continue;
    const revision = entry.type === 'revision-adoption'
      ? entry.to_revision
      : entry.type === 'legacy-mutation'
        ? entry.committed_revision
        : entry.outcome?.stdout?.state === 'committed'
          ? entry.outcome.stdout.result.committed_revision
          : null;
    if (typeof revision !== 'string') continue;
    const prior = authorizations.get(entry.item_id) ?? [];
    prior.push({ revision, seq: entry.seq });
    authorizations.set(entry.item_id, prior);
  }

  for (const [itemKey, item] of items) {
    const bytes = item.bytes ?? item;
    const parsed = parseLedgerItemSource(bytes.toString('utf8'));
    const itemId = parsed.error ? itemKey : parsed.data.id;
    const history = authorizations.get(itemId);
    if (!history) continue;
    const expected = history.at(-1);
    const actual = revisionFor(bytes);
    if (actual === expected.revision) continue;
    return {
      ok: false,
      error: {
        code: 'unauthorized-revision',
        item_id: itemId,
        actual_revision: actual,
        expected_revision: expected.revision,
        decisive_sequences: history.map((entry) => entry.seq),
        parents,
        candidate,
      },
    };
  }
  return { ok: true };
}

export function parseReconcileLog(bytes, namespace) {
  const lines = bytes.toString('utf8').split('\n');
  const start = lines.indexOf('```jsonl');
  if (start < 0) return [];
  const end = lines.indexOf('```', start + 1);
  if (end < 0) return { error: { code: 'ambiguous-journal', reason: 'unterminated-jsonl-block' } };
  const entries = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '') continue;
    try {
      const entry = JSON.parse(line);
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return { error: { code: 'ambiguous-journal', reason: 'entry-not-object' } };
      }
      entries.push(entry);
    } catch {
      return { error: { code: 'ambiguous-journal', reason: 'entry-not-json' } };
    }
  }
  const namespaceIssue = entries.find((entry) => {
    const entryNamespace = entry.ledger_namespace
      ?? entry.request?.ledger_namespace
      ?? entry.fence?.ledger_namespace;
    return entryNamespace !== undefined && entryNamespace !== namespace;
  });
  return entries;
}

export async function checkProspectiveMerge({ ledgerDirectory, namespace, baseRef, headRef }) {
  const root = (await gitText(ledgerDirectory, ['rev-parse', '--show-toplevel'])).trim();
  const base = (await gitText(root, ['rev-parse', '--verify', baseRef])).trim();
  const head = (await gitText(root, ['rev-parse', '--verify', headRef])).trim();
  let mergeOutput;
  try {
    mergeOutput = await gitText(root, ['merge-tree', '--write-tree', base, head]);
  } catch (error) {
    const [candidate] = String(error.stdout ?? '').trim().split('\n');
    return {
      ok: false,
      error: {
        code: 'merge-conflict',
        parents: { base, head },
        ...(candidate ? { candidate } : {}),
      },
    };
  }
  const [candidate] = mergeOutput.trim().split('\n');
  const parents = { base, head };
  if (!/^[0-9a-f]{40}$/.test(candidate ?? '')) {
    return { ok: false, error: { code: 'merge-conflict', parents } };
  }
  const tree = await readGitTreeLedger(ledgerDirectory, candidate);
  let entries = [];
  try {
    const log = await readGitTreeFile(ledgerDirectory, candidate, `.wowbagger/reconcile-${namespace}.md`);
    const parsed = parseReconcileLog(log, namespace);
    if (parsed.error) return { ok: false, error: { ...parsed.error, parents, candidate } };
    entries = parsed;
  } catch (error) {
    if (error?.code !== 128) throw error;
  }
  const checked = checkProspectiveLedger({
    namespace,
    items: tree.items,
    entries,
    parents,
    candidate,
  });
  return checked.ok ? { ok: true, parents, candidate } : checked;
}

async function gitText(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  });
  return stdout;
}
