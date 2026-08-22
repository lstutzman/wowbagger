import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_QUERY_VERSION,
  MAX_LIST_PAGE_SIZE,
  MAX_LIST_TITLE_CHARACTERS,
} from './limits.js';
import { JsonNumber, pointer, sortIssues } from './request.js';
import { loadLedger } from './ledger.js';
import { LIFECYCLE_STATUSES } from './lifecycle.js';
import { revisionFor } from './mutation.js';
import { projectText, snapshotWitness } from './projection.js';
import { projectReadiness } from './ready.js';
import { isCalendarDate, validateLedger } from './validate.js';

// The closed query vocabularies. A list query names one sort field and one
// direction; a filter names values from the item vocabularies the ledger
// already validates against.
const SORT_FIELDS = ['created', 'id', 'number', 'priority', 'status', 'title', 'updated'];
const SORT_DIRECTIONS = ['ascending', 'descending'];
const FILTER_KINDS = ['epic', 'task'];
const QUERY_MEMBERS = ['query_version', 'as_of', 'filters', 'sort', 'page_size', 'cursor'];
const FILTER_MEMBERS = ['status', 'kind', 'ready', 'number', 'title_contains'];

// Validates one list query against query version 1 exactly, on the raw parsed
// tree so a non-canonical number literal cannot pass as an integer. Every
// refusal is an `invalid-request` issue in the shared aggregated form.
export function validateListQuery(query, parseIssues = []) {
  const issues = [...parseIssues];
  if (issues.some((entry) => entry.code === 'invalid-json')) {
    return sortIssues(issues);
  }
  if (!isMapping(query)) {
    issues.push(issue('', 'invalid-type', 'Request input must be a JSON object.'));
    return sortIssues(issues);
  }

  closedMembers(query, [], QUERY_MEMBERS, issues, 'Request member');
  for (const member of ['query_version', 'as_of', 'sort']) {
    if (!hasOwn(query, member)) {
      issues.push(issue(pointer([member]), 'missing-member', `Required member ${member} is missing.`));
    }
  }

  if (hasOwn(query, 'query_version') && integerOf(query.query_version) !== LIST_QUERY_VERSION) {
    issues.push(issue('/query_version', 'invalid-value', `Member query_version must be ${LIST_QUERY_VERSION}.`));
  }
  if (hasOwn(query, 'as_of') && !isCalendarDate(query.as_of)) {
    issues.push(issue('/as_of', 'invalid-value', 'Member as_of must be an ISO calendar date.'));
  }
  if (hasOwn(query, 'page_size')) {
    const size = integerOf(query.page_size);
    if (size === null || size < 1 || size > MAX_LIST_PAGE_SIZE) {
      issues.push(issue('/page_size', 'invalid-value', `Member page_size must be an integer from 1 to ${MAX_LIST_PAGE_SIZE}.`));
    }
  }
  if (hasOwn(query, 'cursor')
    && (typeof query.cursor !== 'string' || decodeCursor(query.cursor) === null)) {
    issues.push(issue('/cursor', 'invalid-value', 'Member cursor must be a cursor issued by a previous list response.'));
  }

  validateSort(query.sort, hasOwn(query, 'sort'), issues);
  validateFilters(query.filters, hasOwn(query, 'filters'), issues);

  return sortIssues(issues);
}

function validateSort(sort, present, issues) {
  if (!present) return;
  if (!isMapping(sort)) {
    issues.push(issue('/sort', 'invalid-type', 'Member sort must be an object.'));
    return;
  }
  closedMembers(sort, ['sort'], ['field', 'direction'], issues, 'Sort member');
  for (const member of ['field', 'direction']) {
    if (!hasOwn(sort, member)) {
      issues.push(issue(pointer(['sort', member]), 'missing-member', `Required member sort.${member} is missing.`));
    }
  }
  if (hasOwn(sort, 'field') && !SORT_FIELDS.includes(sort.field)) {
    issues.push(issue('/sort/field', 'invalid-value', `Sort member field must be one of ${SORT_FIELDS.join(', ')}.`));
  }
  if (hasOwn(sort, 'direction') && !SORT_DIRECTIONS.includes(sort.direction)) {
    issues.push(issue('/sort/direction', 'invalid-value', 'Sort member direction must be ascending or descending.'));
  }
}

function validateFilters(filters, present, issues) {
  if (!present) return;
  if (!isMapping(filters)) {
    issues.push(issue('/filters', 'invalid-type', 'Member filters must be an object.'));
    return;
  }
  closedMembers(filters, ['filters'], FILTER_MEMBERS, issues, 'Filter member');
  validateVocabularyFilter(filters, 'status', LIFECYCLE_STATUSES, 'item statuses', issues);
  validateVocabularyFilter(filters, 'kind', FILTER_KINDS, 'item kinds', issues);
  if (hasOwn(filters, 'ready') && typeof filters.ready !== 'boolean') {
    issues.push(issue('/filters/ready', 'invalid-type', 'Filter member ready must be a boolean.'));
  }
  if (hasOwn(filters, 'number') && !isDistinctSet(filters.number, (entry) => {
    const value = integerOf(entry);
    return value !== null && value >= 1 ? value : null;
  })) {
    issues.push(issue('/filters/number', 'invalid-value', 'Filter member number must be a non-empty array of distinct positive integers.'));
  }
  if (hasOwn(filters, 'title_contains')
    && (typeof filters.title_contains !== 'string' || filters.title_contains.length === 0)) {
    issues.push(issue('/filters/title_contains', 'invalid-value', 'Filter member title_contains must be a non-empty string.'));
  }
}

function validateVocabularyFilter(filters, member, vocabulary, noun, issues) {
  if (!hasOwn(filters, member)) return;
  if (!isDistinctSet(filters[member], (entry) => (vocabulary.includes(entry) ? entry : null))) {
    issues.push(issue(
      pointer(['filters', member]),
      'invalid-value',
      `Filter member ${member} must be a non-empty array of distinct ${noun}.`,
    ));
  }
}

// A value filter is a set, so it must be a non-empty array whose entries are
// all in the vocabulary and all distinct. Repeating an entry is a caller
// mistake, not a silently deduplicated request.
function isDistinctSet(value, accept) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set();
  for (const entry of value) {
    const accepted = accept(entry);
    if (accepted === null || seen.has(accepted)) return false;
    seen.add(accepted);
  }
  return true;
}

function closedMembers(value, location, allowed, issues, noun) {
  const allowedMembers = new Set(allowed);
  for (const member of Object.keys(value)) {
    if (!allowedMembers.has(member)) {
      issues.push(issue(pointer([...location, member]), 'unknown-member', `${noun} ${member} is not allowed.`));
    }
  }
}

// A JSON number is an integer only when its literal is canonical: `1` is one,
// `1.0` and `1e0` are not. The raw parse tree is checked so a request cannot
// spell a bound differently than the contract states it.
function integerOf(value) {
  const source = value instanceof JsonNumber ? value.source : null;
  return source !== null && /^(0|[1-9][0-9]*)$/.test(source) ? Number(source) : null;
}

function issue(pathValue, code, message) {
  return { path: pathValue, code, message };
}

function isMapping(value) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value) && !(value instanceof JsonNumber);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// Loads and validates the complete ledger, then answers one list query from
// that single snapshot. An invalid ledger returns its validation instead of any
// rows: the list never reports part of a ledger it could not validate.
export async function listLedger(ledgerDirectory, query) {
  const ledger = await loadLedger(ledgerDirectory);
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    return { validation };
  }

  const snapshot = snapshotWitness(ledger.items);
  const readiness = projectReadiness(ledger.items, query.as_of);
  // Order is decided on the stored frontmatter and only then projected into
  // bounded rows. Sorting projected rows would compare the truncated title
  // excerpt, so two titles sharing a bounded prefix would collapse onto the ID
  // tie-break instead of ordering by their real text.
  const matched = ledger.items
    .filter((entry) => matchesFilters(entry.data, isReady(entry, readiness), query.filters))
    .sort(itemComparator(query.sort))
    .map((entry) => listRow(entry, readiness));

  const digest = queryDigest(query);
  const resume = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const mismatch = cursorMismatch(resume, digest, snapshot.revision);
  if (mismatch) {
    return {
      snapshotChanged: {
        mismatch,
        cursor_snapshot_revision: resume.snapshot,
        current_snapshot_revision: snapshot.revision,
      },
    };
  }

  const offset = resume === null ? 0 : resume.offset;
  const size = query.page_size ?? DEFAULT_LIST_PAGE_SIZE;
  const items = matched.slice(offset, offset + size);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < matched.length;

  return {
    result: {
      query_version: LIST_QUERY_VERSION,
      as_of: query.as_of,
      snapshot,
      page: {
        size,
        offset,
        returned: items.length,
        matched: matched.length,
        has_more: hasMore,
        next_cursor: hasMore
          ? encodeCursor({ query: digest, snapshot: snapshot.revision, offset: nextOffset })
          : null,
      },
      items,
    },
  };
}

// A cursor is honoured only when both bindings still hold. The remedy is the
// same for either mismatch — restart pagination from no cursor — so one refusal
// carries which binding moved rather than two error codes with one repair.
function cursorMismatch(resume, digest, snapshotRevision) {
  if (resume === null) return null;
  if (resume.snapshot !== snapshotRevision) return 'snapshot';
  return resume.query === digest ? null : 'query';
}

// The cursor is opaque to callers and carries no ledger content: the query
// digest it was issued for, the snapshot revision it was issued against, and
// the offset to resume at. Base64url keeps it safe in a shell argument or a
// JSON string.
function encodeCursor(binding) {
  return Buffer.from(JSON.stringify({
    v: LIST_QUERY_VERSION,
    q: binding.query,
    s: binding.snapshot,
    o: binding.offset,
  }), 'utf8').toString('base64url');
}

// Returns the decoded binding, or null when the string is not a cursor this
// core issued. A malformed cursor is a request error, never a silent restart
// from offset zero.
export function decodeCursor(cursor) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  if (decoded.v !== LIST_QUERY_VERSION
    || typeof decoded.q !== 'string'
    || typeof decoded.s !== 'string'
    || !Number.isSafeInteger(decoded.o)
    || decoded.o < 1) {
    return null;
  }
  return { query: decoded.q, snapshot: decoded.s, offset: decoded.o };
}

// The digest covers everything that decides which rows a page contains and in
// what order: the as-of date, the filters, and the sort. Changing any of them
// invalidates a cursor, because the offset would then point into a different
// sequence.
export function queryDigest(query) {
  return revisionFor(Buffer.from(JSON.stringify([
    LIST_QUERY_VERSION,
    query.as_of,
    canonicalFilters(query.filters),
    [query.sort.field, query.sort.direction],
  ]), 'utf8'));
}

// Filter members are digested in one fixed order with their value arrays as the
// caller wrote them, so the digest is a function of the query alone.
function canonicalFilters(filters) {
  if (!filters) return null;
  return FILTER_MEMBERS.map((member) => (
    Object.hasOwn(filters, member) ? [member, filters[member]] : null
  ));
}

// Filters are a closed conjunction: every named filter must accept the item.
// They read the stored frontmatter, so `title_contains` sees the whole title
// rather than the bounded excerpt a row carries.
function matchesFilters(data, ready, filters) {
  if (!filters) return true;
  if (filters.status && !filters.status.includes(data.status)) return false;
  if (filters.kind && !filters.kind.includes(data.kind)) return false;
  if (filters.number && !filters.number.includes(data.number)) return false;
  if (filters.ready !== undefined && filters.ready !== ready) return false;
  // Case-sensitive, code-unit substring containment. No locale collation, case
  // folding, or Unicode normalization: the same query and the same title must
  // decide the same way on every platform.
  if (filters.title_contains !== undefined && !data.title.includes(filters.title_contains)) return false;
  return true;
}

function isReady(entry, readiness) {
  return readiness.get(entry.data.id).state === 'ready';
}

// A row carries identity, lifecycle, dates, the exact revision, and readiness.
// It never carries the body or the item source: one item is read through
// `inspect`.
function listRow(entry, readiness) {
  const data = entry.data;
  const title = projectText(data.title, MAX_LIST_TITLE_CHARACTERS);
  return {
    id: data.id,
    ...(Object.hasOwn(data, 'number') ? { number: data.number } : {}),
    title: title.text,
    title_truncated: title.truncated,
    kind: data.kind,
    status: data.status,
    ...(Object.hasOwn(data, 'priority') ? { priority: data.priority } : {}),
    created: data.created,
    updated: data.updated,
    revision: revisionFor(entry.bytes),
    ready: isReady(entry, readiness),
  };
}

// One selected field decides the primary order; every order then ends in
// ascending immutable ID, so a tie is never resolved by file order and a full
// traversal is stable. `descending` reverses the primary comparison only: the
// ID tie-break stays ascending in both directions.
//
// The comparison reads each item's stored frontmatter, never a projected row:
// every sort field is a frontmatter member, and the row's title is bounded.
function itemComparator(sort) {
  const descending = sort.direction === 'descending';
  return (left, right) => {
    const primary = comparePrimary(left.data, right.data, sort.field);
    return (descending ? -primary : primary) || compareText(left.data.id, right.data.id);
  };
}

function comparePrimary(left, right, field) {
  if (field === 'number' || field === 'priority') {
    return compareOptionalNumber(left[field], right[field]);
  }
  return compareText(left[field], right[field]);
}

// An item without the member sorts after every item that has one in ascending
// order, matching how the readiness queue already treats a missing priority.
function compareOptionalNumber(left, right) {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? 1 : -1;
  }
  return left - right;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
