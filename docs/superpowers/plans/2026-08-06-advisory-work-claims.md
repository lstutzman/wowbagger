# Advisory Work Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement advisory work claims — `acquire`, `renew`, `release`, `read` — in the core CLI, with honest capability reporting and an explicit refusal of claim-protected publication.

**Architecture:** Claim semantics are pure functions of `(state, request, physicalNow) → {envelope, state}`, mirroring the shape of the already-verified reference model so the two can be compared directly in tests. A thin I/O layer locates the claim store under the git common directory, reads and writes it atomically under the existing cooperative lock, and the CLI wires commands on top. No fencing, no transactional coordinator.

**Tech Stack:** Node.js 20+, no runtime dependencies beyond the existing `yaml`, `node:test`, plain filesystem I/O.

**Spec:** `docs/superpowers/specs/2026-08-06-advisory-work-claims-design.md`

## Global Constraints

- Node.js 20 or later; verify on Node 20 and Node 26.
- **Run tests with a short `TMPDIR`** (e.g. `TMPDIR=/tmp`). The default macOS temporary path makes the lock socket exceed the 104-byte `sun_path` limit and `test/mutation-hardening.test.js` fails with `EINVAL`.
- **The core must stay subprocess-free.** Never invoke the `git` binary. Resolve the git layout by reading the filesystem.
- Instants are exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`. `lease_duration_ms` is an integer from 1 through 86,400,000.
- Epochs are canonical unsigned 64-bit decimal strings. Active epochs match `[1-9][0-9]{0,19}`, maximum `18446744073709551615`. `"0"` is only the unallocated high-water mark.
- `ledger_namespace` matches `wbns_[a-f0-9]{32}`. `item_id` matches `wb_[0-9A-HJKMNP-TV-Z]{26}`. `owner_id` matches `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`.
- Error codes and messages are fixed by `docs/work-claim-contract.md` section 8 and must be reproduced verbatim. Never invent wording.
- Exit codes: 0 committed, 2 invalid request, 4 CAS conflict/held/expired, 6 clock-floor failure, epoch exhausted, or claim store unavailable.
- Success envelopes contain exactly `ok`, `namespace: "work-claim"`, `command`, `contract_version: 1`, `state: "committed"`, `result`. Semantic failures replace `result` with `error` and use `state: "unchanged"`.
- **No capability fact may be computed in two places.** One resolver; every surface renders it.
- TDD: one failing test before each behaviour. Never write implementation first.
- Work on branch `feature/advisory-work-claims` in `/Users/leestutzman/Documents/GitHub/wowbagger`. Do not merge; a separate review gates that.

## File Structure

| File | Responsibility |
|---|---|
| `src/namespace.js` | Provision and read `.wowbagger/namespace` |
| `src/claim-store.js` | Locate the store via the git layout; read and write state atomically |
| `src/claim-operations.js` | Pure claim semantics: read, acquire, renew, release |
| `src/claim-capabilities.js` | The single capability resolver |
| `src/cli.js` | Command wiring (modified) |
| `test/namespace.test.js` | Provisioning behaviour |
| `test/claim-store.test.js` | Git resolution and atomic I/O |
| `test/claim-operations.test.js` | Claim semantics, including CAS precedence and clock floor |
| `test/claim-cli.test.js` | End-to-end command behaviour |
| `test/claim-conformance.test.js` | Envelope equality against the reference model, plus cross-worktree |

---

### Task 1: Namespace provisioning

**Files:**
- Create: `src/namespace.js`
- Create: `test/namespace.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `provisionNamespace(repoRoot) → Promise<{namespace, created}>` and `readNamespace(repoRoot) → Promise<string|null>`. Later tasks call `readNamespace` to validate that a request's `ledger_namespace` is the provisioned one.

- [ ] **Step 1: Write the failing test**

```js
// test/namespace.test.js
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { provisionNamespace, readNamespace } from '../src/namespace.js';

test('provision creates a canonical namespace and reads it back', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-ns-'));
  const first = await provisionNamespace(root);
  assert.equal(first.created, true);
  assert.match(first.namespace, /^wbns_[a-f0-9]{32}$/);
  assert.equal(await readNamespace(root), first.namespace);
  const onDisk = await readFile(path.join(root, '.wowbagger', 'namespace'), 'utf8');
  assert.equal(onDisk, `${first.namespace}\n`);
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `TMPDIR=/tmp node --test test/namespace.test.js`
Expected: FAIL — cannot resolve `../src/namespace.js`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/namespace.js
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const NAMESPACE = /^wbns_[a-f0-9]{32}$/;

function namespaceFile(repoRoot) {
  return path.join(repoRoot, '.wowbagger', 'namespace');
}

export async function readNamespace(repoRoot) {
  try {
    const text = await readFile(namespaceFile(repoRoot), 'utf8');
    const value = text.trim();
    return NAMESPACE.test(value) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function provisionNamespace(repoRoot) {
  const existing = await readNamespace(repoRoot);
  if (existing) return { namespace: existing, created: false };
  await mkdir(path.dirname(namespaceFile(repoRoot)), { recursive: true });
  const namespace = `wbns_${randomBytes(16).toString('hex')}`;
  const handle = await open(namespaceFile(repoRoot), 'wx');
  try {
    await handle.writeFile(`${namespace}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { namespace, created: true };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `TMPDIR=/tmp node --test test/namespace.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for idempotent re-provision**

The contract forbids rebinding a namespace to different ledger history, so a second call must return the existing value rather than a new one.

```js
test('provision never rebinds an existing namespace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-ns-'));
  const first = await provisionNamespace(root);
  const second = await provisionNamespace(root);
  assert.equal(second.created, false);
  assert.equal(second.namespace, first.namespace);
});

test('an absent namespace reads as null rather than throwing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-ns-'));
  assert.equal(await readNamespace(root), null);
});
```

- [ ] **Step 6: Run both**

Run: `TMPDIR=/tmp node --test test/namespace.test.js`
Expected: PASS — the Step 3 implementation already satisfies these; if either fails, fix the implementation, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/namespace.js test/namespace.test.js
git commit -m "Provision the ledger namespace"
```

---

### Task 2: Claim store location and atomic I/O

**Files:**
- Create: `src/claim-store.js`
- Create: `test/claim-store.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `resolveGitCommonDir(startDir) → Promise<string|null>` — null when no git layout is found.
  - `claimStorePath(commonDir, namespace) → string`
  - `readClaimState(storePath, namespace) → Promise<state>` — returns an empty state when absent.
  - `writeClaimState(storePath, state) → Promise<void>` — atomic.
  - `withClaimLock(storePath, fn) → Promise<any>` — runs `fn` holding an `O_EXCL` lock beside the store.
  - State shape: `{schema_version: 1, ledger_namespace, clock_floor, claims: [{item_id, last_epoch, active}]}`.

**On the lock:** `src/mutation.js` has an `acquireLocks` helper, but it is **not exported** and it locks per item ID under `<ledger>/.wowbagger-locks/`. Do not export it and do not reach into that module. The claim store is a single file under the git directory, so it gets its own lock beside itself. This keeps the two modules decoupled and leaves `src/mutation.js` untouched.

- [ ] **Step 1: Write the failing test for a plain repository**

```js
// test/claim-store.test.js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimStorePath, readClaimState, resolveGitCommonDir, writeClaimState } from '../src/claim-store.js';

const NS = 'wbns_0123456789abcdef0123456789abcdef';

test('a .git directory is the common directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'ledger'));
  assert.equal(await resolveGitCommonDir(path.join(root, 'ledger')), path.join(root, '.git'));
});

test('no git layout resolves to null', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  await mkdir(path.join(root, 'ledger'));
  assert.equal(await resolveGitCommonDir(path.join(root, 'ledger')), null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `TMPDIR=/tmp node --test test/claim-store.test.js`
Expected: FAIL — cannot resolve `../src/claim-store.js`.

- [ ] **Step 3: Implement resolution and I/O**

`commondir` holds a path **relative to the worktree gitdir** (verified in this repository: it contains `../..`), so it must be resolved against that directory, not the cwd.

```js
// src/claim-store.js
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function resolveGitCommonDir(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, '.git');
    let info = null;
    try {
      info = await stat(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (info?.isDirectory()) return candidate;
    if (info?.isFile()) {
      const text = await readFile(candidate, 'utf8');
      const match = /^gitdir:\s*(.+)\s*$/m.exec(text);
      if (!match) return null;
      const gitDir = path.resolve(current, match[1].trim());
      try {
        const commonText = await readFile(path.join(gitDir, 'commondir'), 'utf8');
        return path.resolve(gitDir, commonText.trim());
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        return gitDir;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function claimStorePath(commonDir, namespace) {
  return path.join(commonDir, 'wowbagger', `claims-${namespace}.json`);
}

export function emptyClaimState(namespace) {
  return { schema_version: 1, ledger_namespace: namespace, clock_floor: null, claims: [] };
}

export async function readClaimState(storePath, namespace) {
  try {
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    if (parsed?.ledger_namespace !== namespace) return emptyClaimState(namespace);
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyClaimState(namespace);
    throw error;
  }
}

export async function writeClaimState(storePath, state) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const ordered = {
    ...state,
    claims: [...state.claims].sort((left, right) => (left.item_id < right.item_id ? -1 : left.item_id > right.item_id ? 1 : 0)),
  };
  const temporary = `${storePath}.tmp`;
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, storePath);
}

export async function withClaimLock(storePath, fn) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const lockPath = `${storePath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const held = new Error('claim store lock is held');
      held.code = 'CLAIM_LOCK_HELD';
      throw held;
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
```

`rm` joins the imports from `node:fs/promises`.

- [ ] **Step 4: Run and confirm both pass**

Run: `TMPDIR=/tmp node --test test/claim-store.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for worktree resolution and round-tripping**

This is the behaviour that makes claims visible across worktrees, so it must be tested against a real git layout on disk, not a mock.

```js
test('a .git file follows gitdir and commondir to the shared directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  const main = path.join(root, 'main');
  const tree = path.join(root, 'tree');
  await mkdir(path.join(main, '.git', 'worktrees', 'tree'), { recursive: true });
  await mkdir(path.join(tree, 'ledger'), { recursive: true });
  await writeFile(path.join(main, '.git', 'worktrees', 'tree', 'commondir'), '../..\n');
  await writeFile(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'tree')}\n`);
  assert.equal(await resolveGitCommonDir(path.join(tree, 'ledger')), path.join(main, '.git'));
});

test('claim state round-trips and is absent-safe', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  const storePath = claimStorePath(root, NS);
  const empty = await readClaimState(storePath, NS);
  assert.deepEqual(empty, { schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [] });
  empty.clock_floor = '2026-08-06T09:00:00.000Z';
  empty.claims.push({ item_id: 'wb_01Q4837BM01W70T30B184GG1R6', last_epoch: '1', active: null });
  await writeClaimState(storePath, empty);
  assert.deepEqual(await readClaimState(storePath, NS), empty);
});

test('state written for another namespace is not readable as this one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  const storePath = claimStorePath(root, NS);
  await writeClaimState(storePath, { schema_version: 1, ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff', clock_floor: null, claims: [] });
  assert.deepEqual(await readClaimState(storePath, NS), { schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [] });
});
```

- [ ] **Step 6: Run all four**

Run: `TMPDIR=/tmp node --test test/claim-store.test.js`
Expected: PASS. If worktree resolution fails, fix `resolveGitCommonDir` — do not weaken the test.

- [ ] **Step 7: Commit**

```bash
git add src/claim-store.js test/claim-store.test.js
git commit -m "Locate and persist the advisory claim store"
```

---

### Task 3: Claim semantics — read and acquire

**Files:**
- Create: `src/claim-operations.js`
- Create: `test/claim-operations.test.js`

**Interfaces:**
- Consumes: the state shape from Task 2.
- Produces: `claimRead(state, request, physicalNow) → {envelope, state}` and `claimAcquire(state, request, physicalNow) → {envelope, state}`. `envelope` is `{exit, stdout}`, matching the reference model so Task 8 can compare them directly. Every operation returns the next state; callers persist it.

- [ ] **Step 1: Write the failing test for read of an untouched tuple**

```js
// test/claim-operations.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { claimAcquire, claimRead } from '../src/claim-operations.js';

const NS = 'wbns_0123456789abcdef0123456789abcdef';
const ITEM = 'wb_01Q4837BM01W70T30B184GG1R6';
const empty = () => ({ schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [] });

test('read of a never-claimed tuple returns the empty state', () => {
  const { envelope } = claimRead(empty(), { ledger_namespace: NS, item_id: ITEM }, '2026-08-06T09:00:00.000Z');
  assert.deepEqual(envelope, {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'read',
      contract_version: 1,
      state: 'committed',
      result: {
        read_back: {
          ledger_namespace: NS,
          item_id: ITEM,
          observed_at: '2026-08-06T09:00:00.000Z',
          last_epoch: '0',
          active: null,
        },
      },
    },
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `TMPDIR=/tmp node --test test/claim-operations.test.js`
Expected: FAIL — cannot resolve `../src/claim-operations.js`.

- [ ] **Step 3: Implement the shared helpers and `claimRead`**

```js
// src/claim-operations.js
import { isDeepStrictEqual } from 'node:util';

const MAX_EPOCH = 18446744073709551615n;

export function advanceClockFloor(state, physicalNow) {
  const floor = state.clock_floor;
  const effective = floor === null || physicalNow > floor ? physicalNow : floor;
  state.clock_floor = effective;
  return effective;
}

export function findOrCreateClaim(state, itemId) {
  let record = state.claims.find((entry) => entry.item_id === itemId);
  if (!record) {
    record = { item_id: itemId, last_epoch: '0', active: null };
    state.claims.push(record);
  }
  return record;
}

export function readBack(namespace, itemId, observedAt, record) {
  return {
    ledger_namespace: namespace,
    item_id: itemId,
    observed_at: observedAt,
    last_epoch: record.last_epoch,
    active: record.active === null ? null : { ...record.active },
  };
}

function success(command, request, observedAt, record, extra) {
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'committed',
      result: { ...extra, read_back: readBack(request.ledger_namespace, request.item_id, observedAt, record) },
    },
  };
}

export function claimError(command, code, message, request, observedAt, record, exit = 4) {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code,
        message,
        details: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  };
}

export function claimRead(state, request, physicalNow) {
  const next = structuredClone(state);
  const observedAt = advanceClockFloor(next, physicalNow);
  const record = findOrCreateClaim(next, request.item_id);
  return { state: next, envelope: success('read', request, observedAt, record, {}) };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `TMPDIR=/tmp node --test test/claim-operations.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for acquire, covering all four precedence branches**

The contract's precedence is normative and order-sensitive: unequal witness, then held, then exhausted, then allocate.

```js
const witness = (last_epoch, active) => ({ last_epoch, active });

test('acquire allocates exactly one epoch above the high-water mark', () => {
  const { envelope, state } = claimAcquire(empty(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 300000,
    expected: witness('0', null),
  }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.deepEqual(envelope.stdout.result.claim, {
    owner_id: 'agent-a', epoch: '1',
    issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z',
  });
  assert.equal(state.claims[0].last_epoch, '1');
});

test('acquire with an unequal witness is a conflict and changes nothing', () => {
  const { envelope, state } = claimAcquire(empty(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 300000,
    expected: witness('7', null),
  }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.exit, 4);
  assert.equal(envelope.stdout.error.code, 'claim-conflict');
  assert.equal(envelope.stdout.error.message, 'The observed claim state no longer matches this request.');
  assert.equal(state.claims[0].active, null);
});

test('acquire against an unexpired active claim is held', () => {
  const held = empty();
  held.claims.push({ item_id: ITEM, last_epoch: '3', active: {
    owner_id: 'agent-b', epoch: '3', issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z' } });
  const { envelope } = claimAcquire(held, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 300000,
    expected: witness('3', held.claims[0].active),
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.exit, 4);
  assert.equal(envelope.stdout.error.code, 'claim-held');
  assert.equal(envelope.stdout.error.message, 'The item has an unexpired active claim.');
});

test('acquiring an expired claim is takeover and advances the epoch', () => {
  const stale = empty();
  stale.claims.push({ item_id: ITEM, last_epoch: '3', active: {
    owner_id: 'agent-b', epoch: '3', issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z' } });
  const { envelope } = claimAcquire(stale, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 60000,
    expected: witness('3', stale.claims[0].active),
  }, '2026-08-06T09:05:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.equal(envelope.stdout.result.claim.epoch, '4');
});

test('an exhausted high-water mark refuses rather than wrapping', () => {
  const full = empty();
  full.claims.push({ item_id: ITEM, last_epoch: '18446744073709551615', active: null });
  const { envelope } = claimAcquire(full, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 60000,
    expected: witness('18446744073709551615', null),
  }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.exit, 6);
  assert.equal(envelope.stdout.error.code, 'epoch-exhausted');
  assert.equal(envelope.stdout.error.message, 'The epoch high-water mark is exhausted.');
});

test('the clock floor never moves backwards', () => {
  const seeded = empty();
  seeded.clock_floor = '2026-08-06T10:00:00.000Z';
  const { envelope } = claimRead(seeded, { ledger_namespace: NS, item_id: ITEM }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.stdout.result.read_back.observed_at, '2026-08-06T10:00:00.000Z');
});
```

- [ ] **Step 6: Run and confirm they fail**

Run: `TMPDIR=/tmp node --test test/claim-operations.test.js`
Expected: FAIL — `claimAcquire` is not exported. The clock-floor test should already pass.

- [ ] **Step 7: Implement `claimAcquire`**

```js
export function addMilliseconds(instant, milliseconds) {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}

export function claimAcquire(state, request, physicalNow) {
  const next = structuredClone(state);
  const observedAt = advanceClockFloor(next, physicalNow);
  const record = findOrCreateClaim(next, request.item_id);
  const observed = { last_epoch: record.last_epoch, active: record.active };
  if (!isDeepStrictEqual(observed, { last_epoch: request.expected.last_epoch, active: request.expected.active })) {
    return { state: next, envelope: claimError('acquire', 'claim-conflict',
      'The observed claim state no longer matches this request.', request, observedAt, record) };
  }
  if (record.active !== null && observedAt < record.active.expires_at) {
    return { state: next, envelope: claimError('acquire', 'claim-held',
      'The item has an unexpired active claim.', request, observedAt, record) };
  }
  if (BigInt(record.last_epoch) >= MAX_EPOCH) {
    return { state: next, envelope: claimError('acquire', 'epoch-exhausted',
      'The epoch high-water mark is exhausted.', request, observedAt, record, 6) };
  }
  const epoch = (BigInt(record.last_epoch) + 1n).toString();
  record.last_epoch = epoch;
  record.active = {
    owner_id: request.owner_id,
    epoch,
    issued_at: observedAt,
    expires_at: addMilliseconds(observedAt, request.lease_duration_ms),
  };
  return { state: next, envelope: success('acquire', request, observedAt, record, { claim: { ...record.active } }) };
}
```

- [ ] **Step 8: Run the full file**

Run: `TMPDIR=/tmp node --test test/claim-operations.test.js`
Expected: PASS, all seven tests.

- [ ] **Step 9: Commit**

```bash
git add src/claim-operations.js test/claim-operations.test.js
git commit -m "Implement claim read and acquire semantics"
```

---

### Task 4: Claim semantics — renew and release

**Files:**
- Modify: `src/claim-operations.js`
- Modify: `test/claim-operations.test.js`

**Interfaces:**
- Consumes: `advanceClockFloor`, `findOrCreateClaim`, `claimError`, `addMilliseconds` from Task 3.
- Produces: `claimRenew(state, request, physicalNow)` and `claimRelease(state, request, physicalNow)`, same `{envelope, state}` shape.

Note the message difference the contract requires: renew and release use `The active claim tuple no longer matches this request.`, **not** acquire's wording. Getting these two confused is the likeliest defect in this task.

- [ ] **Step 1: Write the failing tests**

```js
import { claimRelease, claimRenew } from '../src/claim-operations.js';

const active = (over = {}) => ({
  owner_id: 'agent-a', epoch: '3',
  issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z', ...over,
});
const seeded = () => {
  const state = empty();
  state.claims.push({ item_id: ITEM, last_epoch: '3', active: active() });
  return state;
};

test('renew extends expiry while retaining issued_at and epoch', () => {
  const { envelope } = claimRenew(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.deepEqual(envelope.stdout.result.claim, {
    owner_id: 'agent-a', epoch: '3',
    issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:06:00.000Z',
  });
});

test('renew with a mismatched tuple conflicts using the renew wording', () => {
  const { envelope } = claimRenew(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-b', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.stdout.error.code, 'claim-conflict');
  assert.equal(envelope.stdout.error.message, 'The active claim tuple no longer matches this request.');
});

test('renew of an exactly matching but expired tuple is claim-expired', () => {
  const { envelope } = claimRenew(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
  }, '2026-08-06T09:05:00.000Z');
  assert.equal(envelope.exit, 4);
  assert.equal(envelope.stdout.error.code, 'claim-expired');
  assert.equal(envelope.stdout.error.message, 'The matching claim has expired.');
});

test('release clears active and retains the high-water mark', () => {
  const { envelope, state } = claimRelease(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z',
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.equal(envelope.stdout.result.read_back.active, null);
  assert.equal(envelope.stdout.result.read_back.last_epoch, '3');
  assert.equal(state.claims[0].active, null);
});

test('a released item cannot be reacquired at the same epoch', () => {
  const released = claimRelease(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z',
  }, '2026-08-06T09:01:00.000Z').state;
  const { envelope } = claimAcquire(released, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 60000,
    expected: { last_epoch: '3', active: null },
  }, '2026-08-06T09:02:00.000Z');
  assert.equal(envelope.stdout.result.claim.epoch, '4');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `TMPDIR=/tmp node --test test/claim-operations.test.js`
Expected: FAIL — `claimRenew` and `claimRelease` are not exported.

- [ ] **Step 3: Implement both**

```js
function tupleMatches(active, request) {
  return active !== null
    && active.owner_id === request.owner_id
    && active.epoch === request.epoch
    && active.expires_at === request.expected_expires_at;
}

function renewOrRelease(command, state, request, physicalNow, apply) {
  const next = structuredClone(state);
  const observedAt = advanceClockFloor(next, physicalNow);
  const record = findOrCreateClaim(next, request.item_id);
  if (!tupleMatches(record.active, request)) {
    return { state: next, envelope: claimError(command, 'claim-conflict',
      'The active claim tuple no longer matches this request.', request, observedAt, record) };
  }
  if (observedAt >= record.active.expires_at) {
    return { state: next, envelope: claimError(command, 'claim-expired',
      'The matching claim has expired.', request, observedAt, record) };
  }
  return apply(next, record, observedAt);
}

export function claimRenew(state, request, physicalNow) {
  return renewOrRelease('renew', state, request, physicalNow, (next, record, observedAt) => {
    record.active = { ...record.active, expires_at: addMilliseconds(observedAt, request.lease_duration_ms) };
    return { state: next, envelope: success('renew', request, observedAt, record, { claim: { ...record.active } }) };
  });
}

export function claimRelease(state, request, physicalNow) {
  return renewOrRelease('release', state, request, physicalNow, (next, record, observedAt) => {
    const released = { ...record.active };
    record.active = null;
    return { state: next, envelope: success('release', request, observedAt, record, { released_claim: released }) };
  });
}
```

- [ ] **Step 4: Run the full file**

Run: `TMPDIR=/tmp node --test test/claim-operations.test.js`
Expected: PASS, all twelve tests.

- [ ] **Step 5: Commit**

```bash
git add src/claim-operations.js test/claim-operations.test.js
git commit -m "Implement claim renew and release semantics"
```

---

### Task 5: One capability resolver, two surfaces

**Files:**
- Create: `src/claim-capabilities.js`
- Modify: `src/cli.js`
- Create: `test/claim-capabilities.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveWorkClaimCapability({gitCommonDir}) → {supported, api_version, mode, claim_protected_publication, fencing_enforced_at, safe_exclusive_dispatch}` and `coordinationScope({gitCommonDir}) → string`. Task 7 renders these into the `claim capabilities` command; `src/cli.js` renders them into the existing `capabilities` command.

The existing `capabilities` output currently hard-codes `work_claim: {supported: false, reason: 'not-implemented'}` in `src/cli.js`. That literal is replaced by a call to the resolver. **No capability fact may be stated in both files.**

- [ ] **Step 1: Write the failing test**

```js
// test/claim-capabilities.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { coordinationScope, resolveWorkClaimCapability } from '../src/claim-capabilities.js';

test('the backend reports advisory and never claims safe dispatch', () => {
  const capability = resolveWorkClaimCapability({ gitCommonDir: '/repo/.git' });
  assert.deepEqual(capability, {
    supported: true,
    api_version: 1,
    mode: 'advisory',
    claim_protected_publication: false,
    fencing_enforced_at: 'none',
    safe_exclusive_dispatch: false,
  });
});

test('without git the capability is unsupported', () => {
  const capability = resolveWorkClaimCapability({ gitCommonDir: null });
  assert.equal(capability.supported, false);
  assert.equal(capability.safe_exclusive_dispatch, false);
});

test('coordination scope names the shared git directory only when it exists', () => {
  assert.equal(coordinationScope({ gitCommonDir: '/repo/.git' }), 'shared-git-directory-cooperative-writers');
  assert.equal(coordinationScope({ gitCommonDir: null }), 'same-working-copy-cooperative-writers');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `TMPDIR=/tmp node --test test/claim-capabilities.test.js`
Expected: FAIL — cannot resolve `../src/claim-capabilities.js`.

- [ ] **Step 3: Implement the resolver**

```js
// src/claim-capabilities.js
export function resolveWorkClaimCapability({ gitCommonDir }) {
  if (!gitCommonDir) {
    return {
      supported: false,
      api_version: 1,
      mode: 'advisory',
      claim_protected_publication: false,
      fencing_enforced_at: 'none',
      safe_exclusive_dispatch: false,
    };
  }
  return {
    supported: true,
    api_version: 1,
    mode: 'advisory',
    claim_protected_publication: false,
    fencing_enforced_at: 'none',
    safe_exclusive_dispatch: false,
  };
}

export function coordinationScope({ gitCommonDir }) {
  return gitCommonDir ? 'shared-git-directory-cooperative-writers' : 'same-working-copy-cooperative-writers';
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `TMPDIR=/tmp node --test test/claim-capabilities.test.js`
Expected: PASS.

- [ ] **Step 5: Replace the hard-coded literal in `src/cli.js`**

In `src/cli.js`, the `capabilities()` function currently contains:

```js
      "work_claim": {
        "supported": false,
        "reason": "not-implemented"
      }
```

Replace that object with `resolveWorkClaimCapability({ gitCommonDir })`, set `backend.coordination_scope` from `coordinationScope({ gitCommonDir })`, and set `limits.cross_worktree_coordination` to `Boolean(gitCommonDir)`. `limits.noncooperating_writer_protection` stays `false`. Make `capabilities()` async and resolve `gitCommonDir` from the ledger option, defaulting to the current working directory when `--ledger` is absent.

- [ ] **Step 6: Verify the existing suite still passes**

Run: `TMPDIR=/tmp node --test test/*.test.js`
Expected: 230 pre-existing tests plus the new ones, 0 fail. `test/cli.test.js` asserts on capabilities output — if it fails, its expectation must be updated to the new truthful values, which is a legitimate change, not a weakened test.

- [ ] **Step 7: Commit**

```bash
git add src/claim-capabilities.js src/cli.js test/claim-capabilities.test.js test/cli.test.js
git commit -m "Report the advisory work-claim capability from one resolver"
```

---

### Task 6: `publish-claimed` refuses

**Files:**
- Modify: `src/cli.js`
- Create: `test/claim-publish-refusal.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a `publish-claimed` command that always refuses. Task 8 asserts this matches the reference model's advisory fixtures exactly.

- [ ] **Step 1: Write the failing test**

```js
// test/claim-publish-refusal.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../src/cli.js';

test('publish-claimed refuses with the contract capability-unavailable envelope', async () => {
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  try {
    await runCli(['publish-claimed', '--ledger', 'ledger', '--input', '/dev/null', '--json']);
  } finally {
    process.stdout.write = write;
  }
  const envelope = JSON.parse(written.join(''));
  assert.equal(envelope.ok, false);
  assert.equal(envelope.namespace, 'ledger-publication');
  assert.equal(envelope.command, 'publish-claimed');
  assert.equal(envelope.state, 'unchanged');
  assert.equal(envelope.error.code, 'capability-unavailable');
  assert.equal(envelope.error.message, 'Claim-protected publication is unavailable on an advisory backend.');
  assert.deepEqual(envelope.error.details, { reason: 'advisory-capability' });
  assert.equal(process.exitCode, 2);
  process.exitCode = 0;
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `TMPDIR=/tmp node --test test/claim-publish-refusal.test.js`
Expected: FAIL — unknown command, so no envelope with that code is written.

- [ ] **Step 3: Implement the refusal**

Add to `runCli` in `src/cli.js`, before the unknown-command fallthrough. It refuses before reading or parsing the input file, because the contract requires refusal "before preflight or commit":

```js
  if (command === 'publish-claimed') {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'capability-unavailable',
        message: 'Claim-protected publication is unavailable on an advisory backend.',
        details: { reason: 'advisory-capability' },
      },
    })}\n`);
    process.exitCode = 2;
    return;
  }
```

- [ ] **Step 4: Run and confirm pass**

Run: `TMPDIR=/tmp node --test test/claim-publish-refusal.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js test/claim-publish-refusal.test.js
git commit -m "Refuse claim-protected publication on the advisory backend"
```

---

### Task 7: Wire the CLI commands

**Files:**
- Modify: `src/cli.js`
- Create: `test/claim-cli.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `provision`, `claim read|acquire|renew|release`, and `claim capabilities`.

Each claim command: parse options, read the namespace, resolve the git common directory, refuse with `claim-store-unavailable` if absent, take the existing cooperative lock, read state, apply the pure operation, write state, release the lock, print the envelope, set `process.exitCode` from `envelope.exit`.

- [ ] **Step 1: Write the failing end-to-end test**

```js
// test/claim-cli.test.js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';

async function capture(argumentsList) {
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  process.exitCode = 0;
  try {
    await runCli(argumentsList);
  } finally {
    process.stdout.write = write;
  }
  const exit = process.exitCode;
  process.exitCode = 0;
  return { envelope: JSON.parse(written.join('')), exit };
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-cli-'));
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'ledger'));
  return root;
}

test('a claim acquired through the CLI is visible to a later read', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = path.join(root, 'acquire.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(acquired.exit, 0);
  assert.equal(acquired.envelope.result.claim.epoch, '1');

  const readRequest = path.join(root, 'read.json');
  await writeFile(readRequest, JSON.stringify({
    ledger_namespace: namespace, item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const observed = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', readRequest, '--json']);
  assert.equal(observed.envelope.result.read_back.active.owner_id, 'agent-a');
  assert.equal(observed.envelope.result.read_back.last_epoch, '1');
});

test('claim commands refuse outside a git repository', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-nogit-'));
  await mkdir(path.join(root, 'ledger'));
  await mkdir(path.join(root, '.wowbagger'));
  await writeFile(path.join(root, '.wowbagger', 'namespace'), 'wbns_0123456789abcdef0123456789abcdef\n');
  const request = path.join(root, 'read.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: 'wbns_0123456789abcdef0123456789abcdef',
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 6);
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.message, 'The durable claim store is unavailable.');
  assert.equal(refused.envelope.error.details.reason, 'git-directory-not-found');
  assert.equal(refused.envelope.state, 'unchanged');
});

test('a request naming an unprovisioned namespace is rejected', async () => {
  const root = await repository();
  await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const request = path.join(root, 'read.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff',
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'ledger-namespace-unbound');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `TMPDIR=/tmp node --test test/claim-cli.test.js`
Expected: FAIL — `provision` and `claim` are unknown commands.

- [ ] **Step 3: Implement the wiring**

Add `provision` and a `claim` dispatcher to `runCli`. The repository root is the directory containing the resolved `.git`; the namespace file is read from there. Reuse the lock helper already used by `create` and `transition` so claim writes serialize with each other. Set `process.exitCode = envelope.exit` and print `envelope.stdout`.

Order of checks in every claim command, which is normative:
1. Parse options and the JSON request; malformed input is exit 2 `invalid-request`.
2. Resolve the git common directory; absent is exit 6 `claim-store-unavailable` with `details.reason: "git-directory-not-found"`.
3. Read the provisioned namespace; a request naming a different one is exit 2 `ledger-namespace-unbound` with message `The ledger namespace is not provisioned for this endpoint.`
4. `withClaimLock` around: read state, apply the operation, write state. A held lock (`CLAIM_LOCK_HELD`) is exit 6 `claim-store-unavailable` with `details.reason: "claim-store-locked"` — the store was genuinely unavailable to this caller, and no decision was taken.

`claim capabilities` accepts exactly `{}` and returns `{ok: true, namespace: 'work-claim', command: 'capabilities', contract_version: 1, result: {backend: {...}, operations: {work_claim: resolveWorkClaimCapability(...)}}}`.

- [ ] **Step 4: Run the new tests and the full suite**

Run: `TMPDIR=/tmp node --test test/claim-cli.test.js` then `TMPDIR=/tmp node --test test/*.test.js`
Expected: new tests PASS; full suite 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js test/claim-cli.test.js
git commit -m "Wire the provision and claim commands"
```

---

### Task 8: Conformance against the reference model, and cross-worktree visibility

**Files:**
- Create: `test/claim-conformance.test.js`

**Interfaces:**
- Consumes: the pure operations from Tasks 3-4 and the CLI from Task 7.
- Produces: nothing consumed later.

The reference model is already independently verified by literal hand-authored goldens in `test/work-claim-independent-goldens.test.js`, so it is a sound oracle for the new implementation. The code under test is the implementation, not the model.

Only `work-claim.*` actions are in conformance scope. The reference model's claim operations do not consult the backend's coordination scope — only publication does — so those actions replay against an advisory backend. `ledger-publication.*` actions are out of scope except the advisory refusal fixtures.

- [ ] **Step 1: Write the failing conformance test**

```js
// test/claim-conformance.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { claimAcquire, claimRead, claimRelease, claimRenew } from '../src/claim-operations.js';
import { runReferenceVector } from './work-claim-reference.js';

const fixtureRoot = new URL('../spec/fixtures/work-claims/', import.meta.url);
const NS = 'wbns_11111111111111111111111111111111';

function manifest(name) {
  return JSON.parse(readFileSync(new URL(`${name}/manifest.json`, fixtureRoot), 'utf8'));
}

const operations = {
  'work-claim.read': claimRead,
  'work-claim.acquire': claimAcquire,
  'work-claim.renew': claimRenew,
  'work-claim.release': claimRelease,
};

// Translate a fixture's durable claim state into our store shape.
function toStoreState(durable) {
  const record = durable.claims.find((entry) => entry.ledger_namespace === NS);
  const floor = durable.clock_floors.find((entry) => entry.ledger_namespace === NS);
  return {
    schema_version: 1,
    ledger_namespace: NS,
    clock_floor: floor ? floor.observed_at : null,
    claims: record ? [{ item_id: record.item_id, last_epoch: record.last_epoch, active: record.active }] : [],
  };
}

for (const name of ['acquire-contention', 'expiry-takeover', 'renew-release-restart-aba', 'epoch-exhaustion']) {
  test(`${name}: implementation envelopes match the reference model`, () => {
    const source = manifest(name);
    const claimActions = source.actions.filter((action) => operations[action.operation]);
    assert.ok(claimActions.length > 0, 'fixture has no claim actions');

    const expected = runReferenceVector({ initial: source.initial, actions: source.actions });
    let state = toStoreState(source.initial.durable);
    let index = 0;
    for (const [position, action] of source.actions.entries()) {
      if (!operations[action.operation]) continue;
      const result = operations[action.operation](state, action.request, action.physical_now);
      state = result.state;
      assert.deepEqual(result.envelope, expected.transcript[position],
        `${name} action ${index} (${action.operation}) diverged from the reference model`);
      index += 1;
    }
  });
}
```

- [ ] **Step 2: Run and confirm failure or divergence**

Run: `TMPDIR=/tmp node --test test/claim-conformance.test.js`
Expected: FAIL initially. Any divergence is a defect in `src/claim-operations.js` — the reference model and the fixtures are the normative side. **Fix the implementation; never edit a fixture or loosen an assertion.**

If a fixture's actions include operations outside the four claim commands, they are skipped by the filter; that is intended. If a fixture turns out to contain no claim actions at all, remove its name from the list and say so in the report rather than weakening the assertion.

- [ ] **Step 3: Make the implementation match**

Correct `src/claim-operations.js` until every listed fixture matches. No changes to `spec/fixtures/**` or `test/work-claim-reference.js` are permitted in this task.

- [ ] **Step 4: Write the failing cross-worktree test**

This is the behaviour that justifies the whole design, so it runs against a real git worktree layout on disk.

```js
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimStorePath, readClaimState, resolveGitCommonDir, writeClaimState } from '../src/claim-store.js';

test('a claim taken in one worktree is visible from another', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-wt-'));
  const main = path.join(root, 'main');
  const tree = path.join(root, 'tree');
  await mkdir(path.join(main, '.git', 'worktrees', 'tree'), { recursive: true });
  await mkdir(path.join(main, 'ledger'), { recursive: true });
  await mkdir(path.join(tree, 'ledger'), { recursive: true });
  await writeFile(path.join(main, '.git', 'worktrees', 'tree', 'commondir'), '../..\n');
  await writeFile(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'tree')}\n`);

  const fromMain = await resolveGitCommonDir(path.join(main, 'ledger'));
  const fromTree = await resolveGitCommonDir(path.join(tree, 'ledger'));
  assert.equal(fromMain, fromTree);

  const storePath = claimStorePath(fromMain, NS);
  const state = { schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [
    { item_id: 'wb_01Q4837BM01W70T30B184GG1R6', last_epoch: '1', active: {
      owner_id: 'agent-in-main', epoch: '1',
      issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z' } },
  ] };
  await writeClaimState(storePath, state);

  const seen = await readClaimState(claimStorePath(fromTree, NS), NS);
  assert.equal(seen.claims[0].active.owner_id, 'agent-in-main');
});
```

- [ ] **Step 5: Run the full suite on both runtimes**

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
```
Expected: 0 fail on both.

- [ ] **Step 6: Commit**

```bash
git add test/claim-conformance.test.js src/claim-operations.js
git commit -m "Prove claim conformance against the reference model"
```

---

### Task 9: Ledger bookkeeping and documentation

**Files:**
- Modify: `ledger/2026-08-06-implement-fenced-work-claims.md`
- Create (via CLI, then rename): `ledger/2026-08-06-fenced-work-claims-coordinator.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: an accurate ledger and README.

Closing the current item as written would assert that fencing exists. That is the failure corrected on 2026-08-06, when an item marked done had no implementation behind it.

- [ ] **Step 1: Retitle the current item**

In `ledger/2026-08-06-implement-fenced-work-claims.md`, change the title to `"Implement advisory work claims in the core CLI"`, set `updated: 2026-08-06`, and append to `decisions:`:

```yaml
  - action: record
    date: 2026-08-06
    summary: "Narrowed to advisory claims. Fencing needs a transactional coordinator and is tracked separately."
    rationale: "The contract defines a local-filesystem backend as advisory regardless of its write paths, so the core CLI cannot be fenced. Closing this item as written would assert that fencing exists."
```

Leave `status: backlog` — a later step closes it only if the reviewer approves.

- [ ] **Step 2: File the fencing item through the CLI**

Generate the ULID and timestamp — both are runtime values, so substitute the printed results into the JSON below:

```bash
export SCRATCH=$(mktemp -d)
python3 -c "
import time, secrets, datetime
A='0123456789ABCDEFGHJKMNPQRSTVWXYZ'
def enc(n,l):
    s=''
    for _ in range(l): s=A[n&31]+s; n>>=5
    return s
print('ULID     =', 'wb_'+enc(int(time.time()*1000),10)+enc(secrets.randbits(80),16))
print('TIMESTAMP=', datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'))
"
cat > "$SCRATCH/req.json" <<'JSON'
{
  "id": "<GENERATED_ULID>",
  "item": {
    "title": "Implement fenced work claims with a transactional coordinator",
    "kind": "task",
    "parent": "wb_01KZ77NSW8PNA4S48NYT26AGMH",
    "provenance": { "source": "repository-backlog", "recorded_at": "<UTC_TIMESTAMP>" },
    "depends_on": [],
    "related": ["wb_01KZAZW75CWEG3R4BH4MZJAA7G"]
  },
  "body": "\nAdvisory claims coordinate cooperating agents but enforce nothing. Fenced\nclaims require one transactional coordinator that serializes claim decisions,\nthe clock floor, every write path that can mutate a claimed item, the ledger\npublication, and its idempotency outcome.\n\nThe open question this item carries: what the coordinator is, and whether\nledger bytes must live inside it for publication to commit atomically with the\nfence check. A coordinator beside a plain file rename is advisory by the\ncontract's own definition, so a design that keeps Markdown files authoritative\nneeds to explain how it reaches atomicity.\n\nThis item gates any consumer whose agents write a backlog from several\nworktrees at once.\n"
}
JSON
./bin/wowbagger.js create --ledger ledger --input "$SCRATCH/req.json" --json
```

Then `inspect` to get the revision, `transition` it to `backlog` with `date: 2026-08-06`, `git add` the created file, and `git mv` it to `ledger/2026-08-06-fenced-work-claims-coordinator.md`.

`create` writes `<ledger>/<id>.md` and leaves the file untracked, so the `git add` before `git mv` is required.

- [ ] **Step 3: Update the README**

`README.md` line 16 currently states that fenced work claims "are not available from the core CLI". Replace that sentence with text saying the core implements advisory work claims — `acquire`, `renew`, `release`, `read` — visible across the worktrees of one repository, and that fenced claims still require a transactional coordinator and are not available. Do not overstate: a reader must not conclude that claims are safe for exclusive dispatch.

- [ ] **Step 4: Verify**

```bash
./bin/wowbagger.js validate --ledger ledger --json
./bin/wowbagger.js ready --ledger ledger --as-of 2026-08-06 --json
```
Expected: valid; ready grows by one (the new fencing item), and the retitled item remains present.

- [ ] **Step 5: Commit**

```bash
git add ledger/ README.md
git commit -m "Narrow the claim item to advisory and track fencing separately"
```

---

## Verification before review

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
./bin/wowbagger.js validate --ledger ledger --json
git diff --check
```

All suites 0 fail on both runtimes, ledger valid, no whitespace errors.

## Out of scope

Fencing, any transactional coordinator, a working `publish-claimed`, PropertyCompass migration, and the Claude Code skill.
