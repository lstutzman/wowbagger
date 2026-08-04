import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreateRequest } from '../src/mutation.js';
import { parseJsonRequest, sortIssues } from '../src/request.js';

test('create aggregates every nested required provenance and relation issue before serialization', () => {
  const request = {
    id: 'not-an-id',
    item: {
      kind: 7,
      provenance: {
        source: '   ',
        recorded_at: false,
      },
      depends_on: [false, 'not-an-id'],
      related: 'not-an-array',
      parent: 7,
      snoozed_until: 'not-a-date',
    },
    body: 7,
  };

  assert.deepEqual(validateCreateRequest(request), [
    { path: '/body', code: 'invalid-type', message: 'Member body must be a string.' },
    { path: '/id', code: 'invalid-value', message: 'Member id must be a canonical Wowbagger item ID.' },
    { path: '/item/depends_on/0', code: 'invalid-value', message: 'Item member depends_on entries must be canonical Wowbagger item IDs.' },
    { path: '/item/depends_on/1', code: 'invalid-value', message: 'Item member depends_on entries must be canonical Wowbagger item IDs.' },
    { path: '/item/kind', code: 'invalid-value', message: 'Item member kind must be task or epic.' },
    { path: '/item/parent', code: 'invalid-value', message: 'Item member parent must be a canonical Wowbagger item ID.' },
    { path: '/item/provenance/recorded_at', code: 'invalid-value', message: 'Provenance member recorded_at must be an RFC 3339 UTC instant.' },
    { path: '/item/provenance/source', code: 'invalid-type', message: 'Provenance member source must be a non-empty string.' },
    { path: '/item/related', code: 'invalid-type', message: 'Item member related must be an array.' },
    { path: '/item/snoozed_until', code: 'invalid-value', message: 'Item member snoozed_until must be an ISO calendar date.' },
    { path: '/item/title', code: 'missing-member', message: 'Required member title is missing.' },
  ]);
});

test('duplicate JSON members do not suppress safely recoverable request issues', () => {
  const parsed = parseJsonRequest(Buffer.from(`{
    "id": "bad",
    "id": "still-bad",
    "item": {"kind": 7, "provenance": {}},
    "extra": true
  }`));
  const issues = validateCreateRequest(parsed.value, parsed.issues);

  assert.deepEqual(issues.map(({ path, code }) => ({ path, code })), [
    { path: '/body', code: 'missing-member' },
    { path: '/extra', code: 'unknown-member' },
    { path: '/id', code: 'duplicate-key' },
    { path: '/id', code: 'invalid-value' },
    { path: '/item/depends_on', code: 'missing-member' },
    { path: '/item/kind', code: 'invalid-value' },
    { path: '/item/provenance/recorded_at', code: 'missing-member' },
    { path: '/item/provenance/source', code: 'missing-member' },
    { path: '/item/title', code: 'missing-member' },
  ]);
});

test('issue ordering compares Unicode scalar values rather than UTF-16 code units', () => {
  const issues = [
    { path: '/\u{10000}', code: 'same', message: 'astral' },
    { path: '/\uE000', code: 'same', message: 'bmp' },
  ];

  assert.deepEqual(sortIssues(issues).map((entry) => entry.message), ['bmp', 'astral']);
});
