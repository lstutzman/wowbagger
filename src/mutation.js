import { createHash } from 'node:crypto';
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
