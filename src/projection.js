// The two bounded projections — `list` rows and the `inspect --workbench`
// affordance view — share these shapes. A bounded field always says how much it
// left out, so a consumer never has to guess whether it holds the whole value,
// and both projections name the one ledger snapshot they were read from.
import { revisionFor } from './mutation.js';

// Text is projected by Unicode code point, not byte: a byte cut can land inside
// a character and an excerpt must stay printable text.
export function projectText(text, limit) {
  const characters = [...text];
  return characters.length > limit
    ? { text: characters.slice(0, limit).join(''), truncated: true }
    : { text, truncated: false };
}

// A bounded collection carries its first `limit` entries, the total it was
// projected from, and whether anything was dropped. `total` is the observed
// count, never the returned length.
export function boundedCollection(values, limit) {
  return {
    entries: values.length > limit ? values.slice(0, limit) : values,
    total: values.length,
    truncated: values.length > limit,
  };
}

// The snapshot witness identifies the exact ledger state a projection came
// from. It covers every item's ledger-relative path and exact revision, so any
// item added, removed, renamed, or byte-modified changes it.
export function snapshotWitness(items) {
  const digest = items
    .map((entry) => `${entry.path}\n${revisionFor(entry.bytes)}\n`)
    .sort()
    .join('');
  return {
    revision: revisionFor(Buffer.from(digest, 'utf8')),
    item_count: items.length,
  };
}
