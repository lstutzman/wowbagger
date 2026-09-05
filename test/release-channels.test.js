import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALPHA_1,
  DEPRECATION_MESSAGE,
  checkChannels,
  planRepair,
  runChannels,
} from '../scripts/release-channels.js';
import { publicationTag } from '../scripts/cut-release.js';

const PACKAGE = 'wowbagger';
const CURRENT = '9.9.0-alpha.6';
const STABLE = '9.9.0';

function healthy() {
  return {
    packageName: PACKAGE,
    version: CURRENT,
    distTags: { latest: CURRENT, next: CURRENT },
    deprecated: DEPRECATION_MESSAGE,
  };
}

test('the prerelease policy is latest and next both at the published version', () => {
  assert.deepEqual(checkChannels(healthy()), { ok: true, problems: [] });
});

test('a stable target requires latest and next at the published version', () => {
  assert.deepEqual(checkChannels({
    ...healthy(),
    version: STABLE,
    distTags: { latest: STABLE, next: STABLE },
  }), { ok: true, problems: [] });
});

test('a stable cut publishes on the latest channel', () => {
  assert.equal(publicationTag(STABLE), 'latest');
});

test('a prerelease cut publishes on the next channel', () => {
  assert.equal(publicationTag(CURRENT), 'next');
});

test('a prerelease target preserves a stable latest dist-tag', () => {
  const result = checkChannels({
    ...healthy(),
    distTags: { latest: '9.9.0', next: CURRENT },
  });

  assert.deepEqual(result, { ok: true, problems: [] });
});

test('a stale latest dist-tag on an all-prerelease package fails the check', () => {
  const result = checkChannels({ ...healthy(), distTags: { latest: '0.1.0-alpha.1', next: CURRENT } });

  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ code }) => code), ['latest-stale']);
});

test('a missing or stale next dist-tag fails the check', () => {
  assert.deepEqual(
    checkChannels({ ...healthy(), distTags: {} }).problems.map(({ code }) => code),
    ['latest-missing', 'next-missing'],
  );
  assert.deepEqual(
    checkChannels({ ...healthy(), distTags: { latest: CURRENT, next: '9.9.0-alpha.5' } }).problems.map(({ code }) => code),
    ['next-stale'],
  );
});

test('an undeprecated alpha.1 fails the check', () => {
  assert.deepEqual(
    checkChannels({ ...healthy(), deprecated: null }).problems.map(({ code }) => code),
    ['alpha-1-not-deprecated'],
  );
  assert.deepEqual(
    checkChannels({ ...healthy(), deprecated: 'something else' }).problems.map(({ code }) => code),
    ['alpha-1-not-deprecated'],
  );
});

test('the deprecation message names the stable channel and the exact core pairing', () => {
  assert.match(DEPRECATION_MESSAGE, /wowbagger@latest/);
  assert.match(DEPRECATION_MESSAGE, /exact/i);
  assert.doesNotMatch(DEPRECATION_MESSAGE, /0\.1\.0-alpha\.[2-9]/, 'the message must not name a version that moves');
});

test('repair of a healthy registry plans nothing', () => {
  assert.deepEqual(planRepair(healthy()), []);
});

test('repair of a stable target moves latest and next to the published version', () => {
  const commands = planRepair({
    ...healthy(),
    version: STABLE,
    distTags: { latest: '9.8.0', next: CURRENT },
  });

  assert.deepEqual(commands.map(({ args }) => args), [
    ['dist-tag', 'add', `${PACKAGE}@${STABLE}`, 'next'],
    ['dist-tag', 'add', `${PACKAGE}@${STABLE}`, 'latest'],
  ]);
});

test('repair of a prerelease preserves a stable latest dist-tag', () => {
  const commands = planRepair({
    ...healthy(),
    distTags: { latest: '9.9.0', next: '9.9.0-alpha.5' },
  });

  assert.deepEqual(commands.map(({ args }) => args), [
    ['dist-tag', 'add', `${PACKAGE}@${CURRENT}`, 'next'],
  ]);
});

test('repair plans only the writes the live state is missing, and never unpublishes', () => {
  const commands = planRepair({
    packageName: PACKAGE,
    version: CURRENT,
    distTags: { latest: '0.1.0-alpha.1', next: '9.9.0-alpha.5' },
    deprecated: null,
  });

  assert.deepEqual(commands.map(({ args }) => args), [
    ['dist-tag', 'add', `${PACKAGE}@${CURRENT}`, 'next'],
    ['dist-tag', 'add', `${PACKAGE}@${CURRENT}`, 'latest'],
    ['deprecate', `${PACKAGE}@${ALPHA_1}`, DEPRECATION_MESSAGE],
  ]);
  assert.equal(commands.every(({ args }) => args[0] !== 'unpublish'), true);
});

test('repair is idempotent: a partly repaired registry plans only the remainder', () => {
  const commands = planRepair({
    packageName: PACKAGE,
    version: CURRENT,
    distTags: { latest: CURRENT, next: CURRENT },
    deprecated: null,
  });

  assert.deepEqual(commands.map(({ args }) => args[0]), ['deprecate']);
});

test('a dry-run repair prints the writes and executes none of them', () => {
  const printed = [];
  const executed = [];
  const status = runChannels({
    argumentsList: ['repair', CURRENT, '--dry-run'],
    readRegistry: () => ({ packageName: PACKAGE, distTags: { latest: '0.1.0-alpha.1' }, deprecated: null }),
    execute: (command) => { executed.push(command); return { ok: true }; },
    write: (line) => printed.push(line),
  });

  assert.equal(status, 0);
  assert.deepEqual(executed, []);
  assert.match(printed.join('\n'), /npm dist-tag add wowbagger@9\.9\.0-alpha\.6 next/);
  assert.match(printed.join('\n'), /npm dist-tag add wowbagger@9\.9\.0-alpha\.6 latest/);
  assert.match(printed.join('\n'), /npm deprecate wowbagger@0\.1\.0-alpha\.1/);
  assert.match(printed.join('\n'), /dry run/i);
});

test('a failing check exits nonzero and names every violated rule', () => {
  const printed = [];
  const status = runChannels({
    argumentsList: ['check', CURRENT],
    readRegistry: () => ({ packageName: PACKAGE, distTags: { latest: '0.1.0-alpha.1' }, deprecated: null }),
    execute: () => assert.fail('check must never write to the registry'),
    write: (line) => printed.push(line),
  });

  assert.equal(status, 1);
  assert.match(printed.join('\n'), /latest-stale/);
  assert.match(printed.join('\n'), /next-missing/);
  assert.match(printed.join('\n'), /alpha-1-not-deprecated/);
});

test('a passing check exits zero, describes the policy, and writes nothing to the registry', () => {
  const printed = [];
  const status = runChannels({
    argumentsList: ['check', CURRENT],
    readRegistry: () => ({ packageName: PACKAGE, distTags: { latest: CURRENT, next: CURRENT }, deprecated: DEPRECATION_MESSAGE }),
    execute: () => assert.fail('check must never write to the registry'),
    write: (line) => printed.push(line),
  });

  assert.equal(status, 0);
  assert.match(printed.join('\n'), /matches the channel policy/);
});
