const REVISION = /^sha256:[a-f0-9]{64}$/;
const ITEM_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function selectCommittedAdoptions({ namespace, committedEntries, localEntries }) {
  const committed = committedEntries.filter((entry) => entry.type === 'revision-adoption');
  const local = localEntries.filter((entry) => entry.type === 'revision-adoption');
  let previousSeq = 0;
  for (const entry of committed) {
    if (!validAdoption(entry, namespace) || entry.seq <= previousSeq) {
      return { ok: false, error: { code: 'invalid-adoption-order' } };
    }
    previousSeq = entry.seq;
  }

  const localByFrom = new Map();
  const localExact = new Set();
  for (const entry of local) {
    const key = adoptionKey(entry);
    localExact.add(key);
    const fromKey = `${entry.item_id}\0${entry.from_revision}`;
    const prior = localByFrom.get(fromKey);
    if (prior !== undefined && prior !== entry.to_revision) {
      return { ok: false, error: { code: 'conflicting-adoption', item_id: entry.item_id } };
    }
    localByFrom.set(fromKey, entry.to_revision);
  }

  const entries = [];
  let alreadyPresent = 0;
  for (const entry of committed) {
    const fromKey = `${entry.item_id}\0${entry.from_revision}`;
    const prior = localByFrom.get(fromKey);
    if (prior !== undefined && prior !== entry.to_revision) {
      return { ok: false, error: { code: 'conflicting-adoption', item_id: entry.item_id } };
    }
    if (localExact.has(adoptionKey(entry))) {
      alreadyPresent += 1;
    } else {
      entries.push(entry);
    }
  }
  return { ok: true, entries, already_present: alreadyPresent };
}

function validAdoption(entry, namespace) {
  return entry.ledger_namespace === namespace
    && ITEM_ID.test(entry.item_id)
    && REVISION.test(entry.from_revision)
    && REVISION.test(entry.to_revision)
    && entry.from_revision !== entry.to_revision
    && typeof entry.adopted_by === 'string'
    && typeof entry.adopted_at === 'string'
    && /^[0-9a-f]{40}$/.test(entry.git_commit);
}

function adoptionKey(entry) {
  return JSON.stringify([
    entry.item_id,
    entry.from_revision,
    entry.to_revision,
    entry.adopted_by,
    entry.adopted_at,
    entry.git_commit,
    entry.item_path ?? null,
  ]);
}
