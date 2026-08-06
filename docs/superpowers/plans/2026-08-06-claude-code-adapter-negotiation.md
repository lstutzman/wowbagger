# Claude Code Adapter — Plan 1: Conformance Harness and Negotiation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the implementation conformance runner and the shared adapter
engine's negotiation surface, so the Claude Code adapter answers `describe` over
the real bootstrap wire and passes the 81 negotiation-facing vector assertions.

**Architecture:** A shared adapter engine lives in `src/adapter/`. Each harness
adapter is a thin package under `adapters/<harness>/` holding a static manifest
and a Node entrypoint that speaks the §3.3 bootstrap wire on stdio. A new
implementation runner, `spec/run-adapter-implementation.js`, drives that real
entrypoint against the same fixture directory the reference runner uses, and
emits the reference result shape plus an evidence platform. `spec/adapter-reference.js`
stays an independent oracle that the engine never imports; a differential test
pins the two together.

**Tech Stack:** Node (26 and 20), ESM, `node:test`, no runtime dependencies.

## Global Constraints

- Canonical test command: `TMPDIR=/tmp node --test test/*.test.js`. The short
  `TMPDIR` is required — macOS caps `sockaddr_un.sun_path` at 104 bytes.
- Both runtimes must pass: `node` (26) and `/opt/homebrew/opt/node@20/bin/node`.
- Baseline before this plan: 304 tests green on both runtimes.
- `src/` MUST NOT import from `test/` or from `spec/`. The engine re-implements
  the reference model; it never imports it.
- Never `git stash` in this repository. Three worktrees share one stash stack.
- Run everything from a real git checkout. A `10-capabilities-forwarding` byte
  mismatch without `.git` is an environment fault, not a defect.
- No shell anywhere: `command_execution.shell` is always `false`, entrypoints
  are launched with an argument array, and no `.sh`/`.cmd` file is normative.
- Platform values stay `unverified` until native evidence exists. Do not write
  `supported` in any manifest in this plan.
- `integration_mechanisms.mcp` and `.daemon` are `false`. This adapter is a
  command, not a service.
- Adapter identity for this package: `adapter_id` is
  `dev.wowbagger.adapter.claude-code`, `adapter_version` tracks `package.json`.
- Every JSON parse is strict: duplicate members, trailing bytes, and invalid
  UTF-8 are refused. Reuse `parseJsonRequest` from `src/request.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/adapter/manifest.js` | Validate the §3.1 static package manifest, exact root and entrypoint schemas |
| `src/adapter/entrypoint-path.js` | §3.1 no-follow entrypoint path resolution and stable-identity recheck |
| `src/adapter/describe.js` | §3.2 dynamic describe result, capability invariants, static/dynamic identity match |
| `src/adapter/core-probe.js` | §3.3 independent core probe and its exact-member comparison |
| `src/adapter/bootstrap.js` | §3.3 stdio wire: one JSON object in, one JSON object plus LF out |
| `adapters/claude-code/wowbagger-adapter.json` | This package's static manifest |
| `adapters/claude-code/entrypoint.js` | Thin per-harness entrypoint; `describe` and `invoke` subcommands |
| `spec/run-adapter-implementation.js` | Implementation runner over `spec/fixtures/adapters/` |
| `test/adapter-implementation-runner.test.js` | The runner's own behaviour, including fail-closed cases |
| `test/adapter-engine-differential.test.js` | Engine versus `spec/adapter-reference.js` on shared inputs |
| `test/adapter-bootstrap-wire.test.js` | §3.3 wire behaviour against the real entrypoint process |

Later plans add `src/adapter/paths.js`, `limits.js`, `process-outcome.js`,
`invoke.js` (Plan 2) and `approval.js`, `context.js`, `instructions.js`,
`handoff.js` (Plan 3). Do not create them here.

---

### Task 1: Implementation runner skeleton that fails closed

Delivers the RED board. The runner enumerates the fixture cases, refuses
anything it cannot verify, and reports every `claude-code` assertion as failing
because no entrypoint answers yet.

**Files:**
- Create: `spec/run-adapter-implementation.js`
- Test: `test/adapter-implementation-runner.test.js`

**Interfaces:**
- Consumes: `spec/fixtures/adapters/` manifests only. No engine code yet.
- Produces:
  - `runImplementationVectors({ fixtureRoot, entrypoint, platform }) -> Promise<Result>`
  - `Result` is `{ status, implementations, evidence_platform, observed_error_codes, cases }`
  - each case is `{ case, status, executed_mode, executed_assertions, assertion_evidence, observed_error_codes }`
  - `assertion_evidence` entries are `{ id, evidence }`

- [ ] **Step 1: Write the failing test**

```js
// test/adapter-implementation-runner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runImplementationVectors } from '../spec/run-adapter-implementation.js';

test('reports every claude-code assertion as failing when no entrypoint answers', async () => {
  const result = await runImplementationVectors({
    entrypoint: { kind: 'command', executable: 'adapters/claude-code/absent.js', fixed_args: [] },
    platform: 'darwin',
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.implementations['claude-code'], 'fail');
  assert.equal(result.evidence_platform, 'darwin');
  assert.equal(result.cases.length, 15);

  const executed = result.cases.flatMap((entry) => entry.executed_assertions);
  assert.equal(executed.length, 183);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-implementation-runner.test.js`
Expected: FAIL — cannot resolve `../spec/run-adapter-implementation.js`.

- [ ] **Step 3: Write the minimal implementation**

```js
// spec/run-adapter-implementation.js
#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonRequest } from '../src/request.js';

const defaultFixtureRoot = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));

export async function runImplementationVectors({
  fixtureRoot = defaultFixtureRoot,
  entrypoint,
  platform,
} = {}) {
  const directories = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const cases = [];
  for (const name of directories) {
    const manifest = parseJsonRequest(
      await readFile(path.join(fixtureRoot, name, 'manifest.json'), 'utf8'),
    );
    if (manifest.adapter_vector_version !== 1) {
      throw new Error(`unsupported adapter_vector_version in ${name}`);
    }
    if (!manifest.targets.includes('claude-code')) {
      continue;
    }
    cases.push({
      case: manifest.case,
      status: 'fail',
      executed_mode: manifest.mode,
      executed_assertions: manifest.assertions.map((assertion) => assertion.id),
      assertion_evidence: manifest.assertions.map((assertion) => ({
        id: assertion.id,
        evidence: 'unimplemented',
      })),
      observed_error_codes: [],
    });
  }

  return {
    status: 'fail',
    implementations: { 'claude-code': 'fail' },
    evidence_platform: platform,
    observed_error_codes: [],
    cases,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-implementation-runner.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite on both runtimes**

Run: `TMPDIR=/tmp node --test test/*.test.js`
Run: `TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js`
Expected: 304 prior tests plus the new one, all passing.

- [ ] **Step 6: Commit**

```bash
git add spec/run-adapter-implementation.js test/adapter-implementation-runner.test.js
git commit -m "Add the adapter implementation runner skeleton"
```

---

### Task 2: Runner fails closed on unknown assertion types and vector versions

§10 requires the runner to fail closed. Prove it rather than assume it.

**Files:**
- Modify: `spec/run-adapter-implementation.js`
- Test: `test/adapter-implementation-runner.test.js`

**Interfaces:**
- Consumes: `runImplementationVectors` from Task 1.
- Produces: no new exports. Adds a rejection path.

- [ ] **Step 1: Write the failing test**

```js
test('fails closed on an unknown assertion type', async () => {
  const fixtureRoot = await writeTempFixture({
    adapter_vector_version: 1,
    case: 'synthetic',
    coverage: ['capabilities'],
    targets: ['claude-code'],
    mode: 'protocol',
    assertions: [{ id: 'synthetic-1', type: 'not-a-real-type' }],
    artifacts: [],
  });

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot, entrypoint: null, platform: 'darwin' }),
    /unknown assertion type/,
  );
});
```

Add this helper to the same test file:

```js
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

async function writeTempFixture(manifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-vectors-'));
  const directory = path.join(root, '01-synthetic');
  await mkdir(directory);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return root;
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-implementation-runner.test.js`
Expected: FAIL — the runner accepts the unknown type and resolves.

- [ ] **Step 3: Write the minimal implementation**

Add to `spec/run-adapter-implementation.js`, above `runImplementationVectors`:

```js
const SUPPORTED_ASSERTION_TYPES = new Set([
  'core-baseline', 'capability', 'instruction-order', 'path-refusal',
  'output-bound', 'approval-gate', 'resume-plan', 'platform-status',
  'process-outcome', 'path-race', 'path-syntax', 'snapshot-identity',
  'entrypoint-path', 'invoke-version', 'core-probe', 'negotiation',
  'context-validation', 'approval-schema',
]);
```

Inside the per-case loop, before pushing the case:

```js
for (const assertion of manifest.assertions) {
  if (!SUPPORTED_ASSERTION_TYPES.has(assertion.type)) {
    throw new Error(`unknown assertion type ${assertion.type} in ${name}`);
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-implementation-runner.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add spec/run-adapter-implementation.js test/adapter-implementation-runner.test.js
git commit -m "Fail the implementation runner closed on unknown assertion types"
```

---

### Task 3: Static package manifest validation

§3.1. The manifest root and each entrypoint object are exact: every displayed
member required, unknown members refused.

**Files:**
- Create: `src/adapter/manifest.js`
- Test: `test/adapter-engine-differential.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `validateAdapterManifest(value) -> { ok: true, manifest } | { ok: false, error_code, detail }`
  where `error_code` is `invalid-adapter-manifest`.

- [ ] **Step 1: Write the failing test**

```js
// test/adapter-engine-differential.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterManifest } from '../src/adapter/manifest.js';

const BASE_MANIFEST = {
  adapter_manifest_version: 1,
  adapter_id: 'example.reference',
  adapter_version: '1.0.0',
  adapter_contract_versions: [1],
  bootstrap_wire_version: 1,
  required_core_contract_version: 1,
  entrypoints: {
    describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
    invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
  },
  platforms: { darwin: 'unverified', linux: 'unverified', win32: 'unverified' },
};

test('refuses a manifest carrying an unknown root member', () => {
  const result = validateAdapterManifest({ ...BASE_MANIFEST, extra: true });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: FAIL — cannot resolve `../src/adapter/manifest.js`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/adapter/manifest.js
const ROOT_MEMBERS = Object.freeze([
  'adapter_manifest_version', 'adapter_id', 'adapter_version',
  'adapter_contract_versions', 'bootstrap_wire_version',
  'required_core_contract_version', 'entrypoints', 'platforms',
]);

function refuse(detail) {
  return { ok: false, error_code: 'invalid-adapter-manifest', detail };
}

export function validateAdapterManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refuse('manifest is not an object');
  }
  const present = Object.keys(value);
  for (const member of present) {
    if (!ROOT_MEMBERS.includes(member)) {
      return refuse(`unknown root member ${member}`);
    }
  }
  for (const member of ROOT_MEMBERS) {
    if (!present.includes(member)) {
      return refuse(`missing root member ${member}`);
    }
  }
  return { ok: true, manifest: value };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapter/manifest.js test/adapter-engine-differential.test.js
git commit -m "Validate the adapter static manifest root schema"
```

---

### Task 4: Manifest entrypoint schema and relative-path syntax

§3.1 rejects absolute, drive, UNC, device, volume, backslash, control-character,
empty-segment, `.`, and `..` executables on every platform, and refuses control
characters in `fixed_args`. Case `13-negotiation-mismatch` asserts each form.

**Files:**
- Modify: `src/adapter/manifest.js`
- Test: `test/adapter-engine-differential.test.js`

**Interfaces:**
- Consumes: `validateAdapterManifest` from Task 3.
- Produces: `isSafeRelativeExecutable(value) -> boolean`, exported for reuse by
  `src/adapter/entrypoint-path.js` in Task 5.

- [ ] **Step 1: Write the failing test**

```js
import { isSafeRelativeExecutable } from '../src/adapter/manifest.js';

test('refuses every unsafe executable path form on every platform', () => {
  const unsafe = [
    '/absolute/adapter', 'C:/adapter', 'C:\\adapter', 'C:adapter',
    '\\\\server\\share\\adapter', '//server/share/adapter',
    '\\\\.\\device\\adapter', '//./device/adapter', '//?/volume/adapter',
    'bin\\adapter', 'bin//adapter', './bin/adapter', '../bin/adapter',
    'bin/adapter\u0000', '',
  ];

  for (const value of unsafe) {
    assert.equal(isSafeRelativeExecutable(value), false, value);
  }
  assert.equal(isSafeRelativeExecutable('bin/adapter'), true);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: FAIL — `isSafeRelativeExecutable` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `src/adapter/manifest.js`:

```js
export function isSafeRelativeExecutable(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  if (value.includes('\\') || value.startsWith('/')) {
    return false;
  }
  if (/^[A-Za-z]:/.test(value)) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into manifest validation**

In `validateAdapterManifest`, after the root-member checks:

```js
for (const key of ['describe', 'invoke']) {
  const entrypoint = value.entrypoints?.[key];
  if (entrypoint === null || typeof entrypoint !== 'object' || Array.isArray(entrypoint)) {
    return refuse(`entrypoint ${key} is not an object`);
  }
  if (entrypoint.kind === 'host-tool') {
    const members = Object.keys(entrypoint).sort();
    if (members.join(',') !== 'kind,name' || typeof entrypoint.name !== 'string' || entrypoint.name === '') {
      return refuse(`entrypoint ${key} host-tool schema is not exact`);
    }
    continue;
  }
  if (entrypoint.kind !== 'command') {
    return refuse(`entrypoint ${key} kind is unknown`);
  }
  const members = Object.keys(entrypoint).sort();
  if (members.join(',') !== 'executable,fixed_args,kind') {
    return refuse(`entrypoint ${key} command schema is not exact`);
  }
  if (!isSafeRelativeExecutable(entrypoint.executable)) {
    return refuse(`entrypoint ${key} executable is unsafe`);
  }
  if (!Array.isArray(entrypoint.fixed_args)
    || entrypoint.fixed_args.some((arg) => typeof arg !== 'string' || /[\u0000-\u001f\u007f]/.test(arg))) {
    return refuse(`entrypoint ${key} fixed_args are invalid`);
  }
}
```

- [ ] **Step 6: Run the full suite on both runtimes**

Run: `TMPDIR=/tmp node --test test/*.test.js`
Run: `TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/adapter/manifest.js test/adapter-engine-differential.test.js
git commit -m "Refuse unsafe adapter entrypoint paths and arguments"
```

---

### Task 5: No-follow entrypoint resolution with stable-identity recheck

§3.1 resolves the package root, every parent component, and the final regular
file no-follow, and rechecks their stable identities immediately before launch.
A link, junction, reparse point, special file, escaping component, or identity
replacement refuses before the adapter process launches.

**Files:**
- Create: `src/adapter/entrypoint-path.js`
- Test: `test/adapter-engine-differential.test.js`

**Interfaces:**
- Consumes: `isSafeRelativeExecutable` from Task 4.
- Produces: `resolveEntrypointPath({ package_root, executable, before, after }) -> { ok: true, path } | { ok: false, error_code }`
  where `error_code` is `path-rejected` for syntax, link, and missing-identity
  faults, and `path-replaced` when `before` and `after` identities differ.
  `before` and `after` are arrays of `{ path, identity }` snapshots; a `null`
  identity means the component could not be identified.

- [ ] **Step 1: Write the failing test**

```js
import { resolveEntrypointPath } from '../src/adapter/entrypoint-path.js';

test('refuses an entrypoint whose component identity changes before launch', () => {
  const before = [
    { path: '/installed/adapter', identity: 'dev:1,ino:10' },
    { path: '/installed/adapter/bin', identity: 'dev:1,ino:11' },
    { path: '/installed/adapter/bin/adapter', identity: 'dev:1,ino:12' },
  ];
  const after = before.map((entry, index) =>
    index === 2 ? { ...entry, identity: 'dev:1,ino:99' } : entry);

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-replaced');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: FAIL — cannot resolve `../src/adapter/entrypoint-path.js`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/adapter/entrypoint-path.js
import { isSafeRelativeExecutable } from './manifest.js';

function rejected() {
  return { ok: false, error_code: 'path-rejected' };
}

export function resolveEntrypointPath({ package_root: packageRoot, executable, before, after }) {
  if (typeof packageRoot !== 'string' || packageRoot === '') {
    return rejected();
  }
  if (!isSafeRelativeExecutable(executable)) {
    return rejected();
  }
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return rejected();
  }
  if (before.length === 0) {
    return rejected();
  }
  for (const snapshot of [...before, ...after]) {
    if (snapshot === null || typeof snapshot !== 'object'
      || typeof snapshot.path !== 'string'
      || typeof snapshot.identity !== 'string' || snapshot.identity === '') {
      return rejected();
    }
  }
  for (let index = 0; index < before.length; index += 1) {
    if (before[index].path !== after[index].path) {
      return rejected();
    }
    if (before[index].identity !== after[index].identity) {
      return { ok: false, error_code: 'path-replaced' };
    }
  }
  return { ok: true, path: `${packageRoot}/${executable}` };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: PASS.

- [ ] **Step 5: Add the differential test against the oracle**

```js
import { resolveEntrypointPath as referenceResolve } from '../spec/adapter-reference.js';

test('entrypoint resolution matches the reference oracle on every fixture case', async () => {
  const scenarios = JSON.parse(
    await readFile('spec/fixtures/adapters/13-negotiation-mismatch/scenarios.json', 'utf8'),
  );

  for (const input of scenarios.entrypoint_paths) {
    const mine = resolveEntrypointPath(input);
    const theirs = referenceResolve(input);
    assert.deepEqual(mine.ok, theirs.ok, input.id);
    if (!mine.ok) {
      assert.equal(mine.error_code, theirs.error_code, input.id);
    }
  }
});
```

Add `import { readFile } from 'node:fs/promises';` to the test file.

- [ ] **Step 6: Run the test and reconcile any divergence**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: PASS. If a case diverges, fix `src/adapter/entrypoint-path.js` — never
edit the oracle or weaken the assertion.

- [ ] **Step 7: Run the full suite on both runtimes, then commit**

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
git add src/adapter/entrypoint-path.js test/adapter-engine-differential.test.js
git commit -m "Resolve adapter entrypoints no-follow with a stable-identity recheck"
```

---

### Task 6: Dynamic describe result and capability invariants

§3.2. The capability table is the heart of case `13-negotiation-mismatch`:
when `command_execution.supported` is `true`, `arguments_array`, `stdio`,
`process_tree_containment`, `orphan_detection`, `timeout_enforcement`,
`stdout_limit`, and `stderr_limit` are all `true`, `shell` is `false`, and every
advertised byte or time limit is a positive safe integer. When it is `false`,
every dependent Boolean including `shell` is `false` and `core.commands` is
empty.

**Files:**
- Create: `src/adapter/describe.js`
- Create: `src/adapter/core-probe.js`
- Test: `test/adapter-engine-differential.test.js`

`src/adapter/core-probe.js` exports `coreCapabilities()`, returning the engine's
own core capability snapshot, and `verifyCoreProbe(describe, probe)`, returning
`{ ok: true }` or `{ ok: false, error_code }` with `core-contract-version-mismatch`,
`required-core-contract-version-mismatch`, or `core-protocol-error`. The
differential sweep in Step 5 covers both, using `SCENARIOS.core_probe_cases`.
A core probe must never elevate `optional_features.claims` or `.policy`.

**Interfaces:**
- Consumes: `validateAdapterManifest` from Task 3.
- Produces: `describeAdapter(request, manifest, dynamic) -> { ok: true, result } | { ok: false, error_code }`.
  Error codes in precedence order: `invalid-describe-request`,
  `invalid-adapter-manifest`, `unsupported-bootstrap-wire-version`,
  `unsupported-adapter-contract-version`, `invalid-describe-result`,
  `adapter-identity-mismatch`, `adapter-version-mismatch`,
  `adapter-contract-selection-mismatch`, `required-core-contract-version-mismatch`,
  `adapter-platform-mismatch`, `capability-unavailable`.

- [ ] **Step 1: Write the failing test**

Add this load at module scope in the test file, above every test:

```js
const SCENARIOS = JSON.parse(
  await readFile('spec/fixtures/adapters/13-negotiation-mismatch/scenarios.json', 'utf8'),
);
```

Then the test itself:

```js
import { describeAdapter } from '../src/adapter/describe.js';

test('refuses a describe result advertising command execution with a shell', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.command_execution.shell = true;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: FAIL — cannot resolve `../src/adapter/describe.js`.

- [ ] **Step 3: Write the minimal implementation**

```js
// src/adapter/describe.js
const DEPENDENT_EXECUTION_FLAGS = Object.freeze([
  'arguments_array', 'stdio', 'process_tree_containment', 'orphan_detection',
  'timeout_enforcement', 'stdout_limit', 'stderr_limit',
]);

function refuse(error_code, detail) {
  return { ok: false, error_code, detail };
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateExecutionCapabilities(dynamic) {
  const execution = dynamic?.host?.command_execution;
  if (execution === null || typeof execution !== 'object') {
    return refuse('invalid-describe-result', 'command_execution is not an object');
  }
  if (execution.shell !== false) {
    return refuse('invalid-describe-result', 'shell must be false');
  }
  if (execution.supported === true) {
    for (const flag of DEPENDENT_EXECUTION_FLAGS) {
      if (execution[flag] !== true) {
        return refuse('invalid-describe-result', `${flag} must be true`);
      }
    }
    for (const [name, value] of Object.entries(dynamic.limits ?? {})) {
      if (!isPositiveSafeInteger(value)) {
        return refuse('invalid-describe-result', `${name} is not a positive safe integer`);
      }
    }
    return { ok: true };
  }
  if (execution.supported !== false) {
    return refuse('invalid-describe-result', 'supported must be a boolean');
  }
  for (const flag of DEPENDENT_EXECUTION_FLAGS) {
    if (execution[flag] !== false) {
      return refuse('invalid-describe-result', `${flag} must be false`);
    }
  }
  if ((dynamic.core?.commands ?? []).length !== 0) {
    return refuse('invalid-describe-result', 'core.commands must be empty');
  }
  return { ok: true };
}

export function describeAdapter(request, manifest, dynamic) {
  const capabilities = validateExecutionCapabilities(dynamic);
  if (!capabilities.ok) {
    return capabilities;
  }
  return { ok: true, result: dynamic };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
Expected: PASS.

- [ ] **Step 5: Add the full differential sweep over the negotiation scenarios**

```js
import { describeAdapter as referenceDescribe } from '../spec/adapter-reference.js';

test('describe matches the reference oracle on every negotiation scenario', () => {
  for (const scenario of SCENARIOS.cases) {
    const mine = describeAdapter(
      scenario.request ?? SCENARIOS.base_request,
      scenario.manifest ?? SCENARIOS.base_manifest,
      scenario.dynamic ?? SCENARIOS.base_dynamic,
    );
    const theirs = referenceDescribe(
      scenario.request ?? SCENARIOS.base_request,
      scenario.manifest ?? SCENARIOS.base_manifest,
      scenario.dynamic ?? SCENARIOS.base_dynamic,
    );
    assert.equal(mine.ok, theirs.ok, scenario.id);
    if (!mine.ok) {
      assert.equal(mine.error_code, theirs.error_code, scenario.id);
    }
  }
});
```

- [ ] **Step 6: Iterate until the sweep passes**

Run: `TMPDIR=/tmp node --test test/adapter-engine-differential.test.js`
This drives out the remaining §3.2 rules — identity matching, contract
selection, platform map, instruction and workspace invariants, approval
sources, and the error-precedence order listed in the Interfaces block. Add one
rule at a time and re-run. Do not edit `spec/adapter-reference.js`.

- [ ] **Step 7: Run the full suite on both runtimes, then commit**

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
git add src/adapter/describe.js test/adapter-engine-differential.test.js
git commit -m "Implement the adapter describe result and capability invariants"
```

---

### Task 7: The bootstrap wire and the Claude Code entrypoint

§3.3. One strict UTF-8 JSON object in on stdin, stdin closed. One strict JSON
object plus one LF out on stdout, no prefix and no second object. Exit 0 even
for an `ok:false` response. Nonzero exit, signal, timeout, or malformed response
is transport failure.

**Files:**
- Create: `src/adapter/bootstrap.js`
- Create: `adapters/claude-code/wowbagger-adapter.json`
- Create: `adapters/claude-code/entrypoint.js`
- Test: `test/adapter-bootstrap-wire.test.js`

**Interfaces:**
- Consumes: `describeAdapter` from Task 6, `validateAdapterManifest` from Task 3.
- Produces:
  - `readBootstrapRequest(stream) -> Promise<{ ok: true, request } | { ok: false, error_code }>`
  - `writeBootstrapResponse(stream, response) -> Promise<void>` — writes exactly
    one JSON object plus one LF.

- [ ] **Step 1: Write the failing test**

```js
// test/adapter-bootstrap-wire.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('answers describe with exactly one JSON object and exits zero', async () => {
  const request = JSON.stringify({
    bootstrap_wire_version: 1,
    supported_adapter_contract_versions: [1],
    request_id: 'wire-test-0001',
  });

  const child = execFile(process.execPath, ['adapters/claude-code/entrypoint.js', 'describe']);
  child.stdin.end(request);
  const { stdout } = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ stdout: out }) : reject(new Error(`exit ${code}`))));
  });

  assert.equal(stdout.endsWith('\n'), true);
  assert.equal(stdout.trimEnd().includes('\n'), false);
  const response = JSON.parse(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.adapter_id, 'dev.wowbagger.adapter.claude-code');
  assert.equal(response.host.integration_mechanisms.mcp, false);
  assert.equal(response.host.command_execution.shell, false);
  assert.deepEqual(response.platforms, { darwin: 'unverified', linux: 'unverified', win32: 'unverified' });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-bootstrap-wire.test.js`
Expected: FAIL — `adapters/claude-code/entrypoint.js` does not exist.

- [ ] **Step 3: Write the static manifest**

```json
{
  "adapter_manifest_version": 1,
  "adapter_id": "dev.wowbagger.adapter.claude-code",
  "adapter_version": "0.1.0",
  "adapter_contract_versions": [1],
  "bootstrap_wire_version": 1,
  "required_core_contract_version": 1,
  "entrypoints": {
    "describe": {
      "kind": "command",
      "executable": "adapters/claude-code/entrypoint.js",
      "fixed_args": ["describe"]
    },
    "invoke": {
      "kind": "command",
      "executable": "adapters/claude-code/entrypoint.js",
      "fixed_args": ["invoke"]
    }
  },
  "platforms": {
    "darwin": "unverified",
    "linux": "unverified",
    "win32": "unverified"
  }
}
```

- [ ] **Step 4: Write the wire and the entrypoint**

```js
// src/adapter/bootstrap.js
import { parseJsonRequest } from '../request.js';

export async function readBootstrapRequest(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const text = bytes.toString('utf8');
  if (Buffer.compare(Buffer.from(text, 'utf8'), bytes) !== 0) {
    return { ok: false, error_code: 'invalid-describe-request' };
  }
  try {
    return { ok: true, request: parseJsonRequest(text) };
  } catch {
    return { ok: false, error_code: 'invalid-describe-request' };
  }
}

export function writeBootstrapResponse(stream, response) {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(response)}\n`, (error) => (error ? reject(error) : resolve()));
  });
}
```

```js
// adapters/claude-code/entrypoint.js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readBootstrapRequest, writeBootstrapResponse } from '../../src/adapter/bootstrap.js';
import { describeAdapter } from '../../src/adapter/describe.js';

const manifestUrl = new URL('./wowbagger-adapter.json', import.meta.url);

function dynamicResult(manifest) {
  return {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: 1,
    adapter_id: manifest.adapter_id,
    adapter_version: manifest.adapter_version,
    core: {
      required_core_contract_version: 1,
      commands: ['capabilities', 'create', 'inspect', 'ready', 'transition', 'validate'],
    },
    host: {
      command_execution: {
        supported: true,
        arguments_array: true,
        shell: false,
        stdio: true,
        process_tree_containment: true,
        orphan_detection: true,
        timeout_enforcement: true,
        stdout_limit: true,
        stderr_limit: true,
      },
      filesystem: {
        workspace_selection: 'guarded-relative',
        no_follow_resolution: true,
        stable_identity: true,
        component_walk: true,
      },
      model_transport: { available: true, protocol: 'openai-compatible' },
      instruction_input: { mode: 'host-provided', max_sources: 8, max_bytes: 65536 },
      handoff: { supported: true, persistence: 'explicit-only' },
      trusted_approval: { supported: true, sources: ['consumer'] },
      integration_mechanisms: { hooks: false, slash_commands: false, mcp: false, daemon: false },
    },
    optional_features: { claims: false, policy: false },
    limits: {
      max_request_bytes: 65536,
      max_context_bytes: 65536,
      max_stdout_bytes: 1048576,
      max_stderr_bytes: 65536,
      max_timeout_ms: 30000,
    },
    platforms: manifest.platforms,
  };
}

const [operation] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), 'utf8'));
const incoming = await readBootstrapRequest(process.stdin);

if (!incoming.ok) {
  await writeBootstrapResponse(process.stdout, { ok: false, error: { code: incoming.error_code } });
  process.exit(0);
}

if (operation === 'describe') {
  const described = describeAdapter(incoming.request, manifest, dynamicResult(manifest));
  await writeBootstrapResponse(
    process.stdout,
    described.ok ? described.result : { ok: false, error: { code: described.error_code } },
  );
  process.exit(0);
}

await writeBootstrapResponse(process.stdout, { ok: false, error: { code: 'invalid-invocation' } });
process.exit(0);
```

`optional_features.claims` is `false` and stays `false`. Claims are advisory in
the core and the adapter must not advertise them.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-bootstrap-wire.test.js`
Expected: PASS.

- [ ] **Step 6: Add the malformed-input wire tests**

```js
test('refuses a request with trailing bytes and still exits zero', async () => {
  const child = execFile(process.execPath, ['adapters/claude-code/entrypoint.js', 'describe']);
  child.stdin.end('{"bootstrap_wire_version":1}{"extra":true}');
  const { stdout, code } = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (exit) => resolve({ stdout: out, code: exit }));
  });

  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).ok, false);
});
```

- [ ] **Step 7: Run the full suite on both runtimes, then commit**

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
git add src/adapter/bootstrap.js adapters/claude-code test/adapter-bootstrap-wire.test.js
git commit -m "Add the Claude Code adapter entrypoint and bootstrap wire"
```

---

### Task 8: Runner drives the real entrypoint for the negotiation cases

Wire Task 1's runner to the shipped engine so cases `01-capability-separation`,
`09-platform-declaration`, and the describe-driven part of
`13-negotiation-mismatch` report real results — 77 of the 183 assertions. The
four `invoke-version` assertions need `invokeAdapter`, which is Plan 2's Task 1,
so case `13` still ends this plan at `fail`.

**Files:**
- Modify: `spec/run-adapter-implementation.js`
- Modify: `spec/run-adapter-vectors.js` — two declarations become named exports
- Test: `test/adapter-implementation-runner.test.js`

**Interfaces:**
- Consumes: `runImplementationVectors` from Task 1; `describeAdapter` (Task 6),
  `resolveEntrypointPath` (Task 5), `validateAdapterManifest` (Task 3), and
  `verifyCoreProbe` plus `coreCapabilities` from `src/adapter/core-probe.js`.
- Produces: no new exports from the runner.

- [ ] **Step 1: Write the failing test**

```js
test('evaluates the negotiation cases against the shipped engine', async () => {
  const result = await runImplementationVectors({
    entrypoint: {
      kind: 'command',
      executable: 'adapters/claude-code/entrypoint.js',
      fixed_args: [],
    },
    platform: process.platform,
  });

  const byName = new Map(result.cases.map((entry) => [entry.case, entry]));

  assert.equal(byName.get('capability-separation').status, 'pass');
  assert.equal(byName.get('platform-declaration').status, 'pass');
  assert.equal(result.evidence_platform, process.platform);

  const negotiation = byName.get('negotiation-mismatch');
  assert.equal(negotiation.executed_assertions.length, 78);
  assert.equal(negotiation.status, 'fail');

  const unimplemented = negotiation.assertion_evidence
    .filter(({ evidence }) => evidence === 'unimplemented')
    .map(({ id }) => id);
  assert.equal(unimplemented.length, 4, 'only the invoke-version assertions remain');

  const implemented = negotiation.assertion_evidence
    .filter(({ evidence }) => evidence !== 'unimplemented');
  assert.ok(implemented.every(({ evidence }) => evidence.startsWith('src/adapter/')));
  assert.ok(negotiation.observed_error_codes.includes('unsupported-adapter-contract-version'));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TMPDIR=/tmp node --test test/adapter-implementation-runner.test.js`
Expected: FAIL — every assertion still reports evidence `unimplemented`.

**Design note — where the boundary actually is.** The negotiation scenarios
inject a synthetic `manifest` and `dynamic` and then mutate them. The §3.3
bootstrap wire carries only the describe *request*; it has no channel for an
injected manifest or describe result. So these assertions cannot be driven
across the process boundary without adding a test-injection seam to the
entrypoint, and adding one would weaken the shipped binary.

The rule this plan adopts:

- Assertions that inject a manifest or dynamic result are evaluated against the
  **shipped engine modules in `src/adapter/`**, imported directly. That is still
  the installed implementation and not the oracle, which is what §10 requires.
- Assertions that exercise the wire, forwarding bytes, or process behaviour are
  evaluated **across the real process boundary**. Task 7's wire tests already do
  this, and Plan 2's equivalence cases depend on it.

Evidence labels record which boundary ran, so the distinction is visible in the
result rather than hidden.

- [ ] **Step 3: Export the scenario-shaping helpers from the reference runner**

The implementation runner lives in `spec/`, so it may reuse `spec/` helpers that
only *shape scenario inputs*. It must never import the model under test —
`describeAdapter`, `verifyCoreProbe`, and `resolveEntrypointPath` come from
`src/adapter/`, never from `spec/adapter-reference.js`.

In `spec/run-adapter-vectors.js`, change two declarations to named exports.
Change nothing else in that file:

```js
export function mutateObject(target, scenario) {
```

```js
export function applyCapabilityInvariantScenario(dynamic, scenario) {
```

Run `TMPDIR=/tmp node --test test/*.test.js` and confirm the reference runner's
own tests still pass. Adding an export changes no behaviour.

- [ ] **Step 4: Implement the evaluators**

Add these imports to `spec/run-adapter-implementation.js`:

```js
import { applyCapabilityInvariantScenario, mutateObject } from './run-adapter-vectors.js';
import { describeAdapter } from '../src/adapter/describe.js';
import { resolveEntrypointPath } from '../src/adapter/entrypoint-path.js';
import { verifyCoreProbe, coreCapabilities } from '../src/adapter/core-probe.js';
```

`coreCapabilities()` and `verifyCoreProbe` come from `src/adapter/core-probe.js`,
created in Task 6.

Then add the evaluator. It returns `{ ok, evidence, error_code }` per assertion:

```js
const CORE_COMMANDS = ['capabilities', 'create', 'inspect', 'ready', 'transition', 'validate'];

async function evaluateNegotiationAssertion(directory, assertion) {
  const data = await readScenarios(directory);

  if (assertion.type === 'entrypoint-path') {
    const scenario = data.entrypoint_paths.find(({ id }) => id === assertion.scenario);
    const result = resolveEntrypointPath(scenario);
    return {
      ok: result.error_code === scenario.expected,
      evidence: 'src/adapter/entrypoint-path.js',
      error_code: result.error_code,
    };
  }

  if (assertion.type === 'core-probe') {
    const scenario = data.core_probe_cases.find(({ id }) => id === assertion.scenario);
    const describe = structuredClone(data.base_dynamic);
    const probe = coreCapabilities();
    mutateObject(scenario.target === 'probe' ? probe : describe, scenario);
    const result = verifyCoreProbe(describe, probe);
    return {
      ok: result.error_code === scenario.expected,
      evidence: 'src/adapter/core-probe.js',
      error_code: result.error_code,
    };
  }

  if (assertion.type === 'negotiation') {
    const scenario = data.cases.find(({ id }) => id === assertion.scenario);
    const request = { ...data.base_request, ...scenario.request };
    const manifest = { ...data.base_manifest, ...scenario.manifest };
    const dynamic = {
      ...data.base_dynamic,
      ...scenario.dynamic,
      core: { ...data.base_dynamic.core, ...scenario.dynamic?.core },
      platforms: scenario.dynamic?.platforms ?? data.base_dynamic.platforms,
    };
    if (scenario.target) {
      mutateObject({ request, manifest, dynamic }[scenario.target], scenario);
    }
    if (scenario.capability_invariant) {
      applyCapabilityInvariantScenario(dynamic, scenario.capability_invariant);
    }
    const result = scenario.id === 'required-core-version'
      ? verifyCoreProbe(
          {
            core: {
              required_core_contract_version: scenario.required_core_contract_version,
              commands: CORE_COMMANDS,
            },
            optional_features: { claims: false, policy: false },
          },
          coreCapabilities(),
        )
      : describeAdapter(request, manifest, dynamic);
    return {
      ok: result.error_code === scenario.expected,
      evidence: scenario.id === 'required-core-version'
        ? 'src/adapter/core-probe.js'
        : 'src/adapter/describe.js',
      error_code: result.error_code,
    };
  }

  throw new Error(`unhandled negotiation assertion type ${assertion.type}`);
}
```

Add the scenario reader and cache:

```js
const scenarioCache = new Map();

async function readScenarios(directory) {
  if (!scenarioCache.has(directory)) {
    scenarioCache.set(
      directory,
      parseJsonRequest(await readFile(path.join(directory, 'scenarios.json'), 'utf8')),
    );
  }
  return scenarioCache.get(directory);
}
```

- [ ] **Step 5: Implement the `capability` and `platform-status` evaluators**

Case `01-capability-separation` has two `capability` assertions and case
`09-platform-declaration` has one `platform-status` assertion. Both read
committed artifacts rather than mutating scenarios:

```js
async function evaluateCapabilityAssertion(directory, assertion) {
  const capabilities = parseJsonRequest(
    await readFile(path.join(directory, 'adapter-capabilities.json'), 'utf8'),
  );

  if (assertion.expect === 'claims-and-policy-false') {
    const ok = capabilities.optional_features.claims === false
      && capabilities.optional_features.policy === false;
    return { ok, evidence: 'src/adapter/describe.js' };
  }

  if (assertion.expect === 'refuse-before-core-launch') {
    const result = describeAdapter(
      { bootstrap_wire_version: 1, supported_adapter_contract_versions: [1], request_id: assertion.id },
      null,
      capabilities,
    );
    return {
      ok: result.ok === false && result.error_code === 'capability-unavailable',
      evidence: 'src/adapter/describe.js',
      error_code: result.error_code,
    };
  }

  throw new Error(`unknown capability expectation ${assertion.expect}`);
}

async function evaluatePlatformAssertion(directory, assertion) {
  const packageManifest = parseJsonRequest(
    await readFile(path.join(directory, 'package-manifest.json'), 'utf8'),
  );
  const expected = parseJsonRequest(
    await readFile(path.join(directory, assertion.expect), 'utf8'),
  );
  const interpretation = {
    supported_platforms: Object.entries(packageManifest.platforms)
      .filter(([, status]) => status === 'supported').map(([platform]) => platform),
    unverified_platforms: Object.entries(packageManifest.platforms)
      .filter(([, status]) => status === 'unverified').map(([platform]) => platform),
    required_before_support_claim: 'native-common-vector-evidence',
  };
  return {
    ok: JSON.stringify(interpretation) === JSON.stringify(expected),
    evidence: 'src/adapter/manifest.js',
  };
}
```

The `work-claim-advisory` expectation in case `10-capabilities-forwarding`
belongs to Plan 2. Leave its evidence `unimplemented` here.

- [ ] **Step 6: Aggregate case and run status**

In the per-case loop, replace the placeholder push with:

```js
const evaluated = [];
const errorCodes = new Set();
let cased = true;

for (const assertion of manifest.assertions) {
  const outcome = await evaluateAssertion(directory, assertion);
  if (outcome.error_code) {
    errorCodes.add(outcome.error_code);
  }
  if (!outcome.ok) {
    cased = false;
  }
  evaluated.push({ id: assertion.id, evidence: outcome.evidence });
}

cases.push({
  case: manifest.case,
  status: cased ? 'pass' : 'fail',
  executed_mode: manifest.mode,
  executed_assertions: manifest.assertions.map((assertion) => assertion.id),
  assertion_evidence: evaluated,
  observed_error_codes: [...errorCodes].sort(),
});
```

`evaluateAssertion` dispatches on type: `negotiation`, `core-probe`, and
`entrypoint-path` to `evaluateNegotiationAssertion`; `capability` to
`evaluateCapabilityAssertion`; `platform-status` to `evaluatePlatformAssertion`;
`invoke-version` and everything else to
`{ ok: false, evidence: 'unimplemented' }` until Plans 2 and 3 land.

Set the run status last:

```js
const passed = cases.every((entry) => entry.status === 'pass');
return {
  status: passed ? 'pass' : 'fail',
  implementations: { 'claude-code': passed ? 'pass' : 'fail' },
  evidence_platform: platform,
  observed_error_codes: [...new Set(cases.flatMap((entry) => entry.observed_error_codes))].sort(),
  cases,
};
```

`invoke-version` stays unimplemented in Plan 1: its four assertions need
`invokeAdapter`, which is Plan 2's Task 1. Case `13-negotiation-mismatch`
therefore reaches `pass` only after Plan 2 lands. Step 1's test already pins
that: exactly four assertions carry evidence `unimplemented`.

- [ ] **Step 7: Run the test and confirm it passes**

Run: `TMPDIR=/tmp node --test test/adapter-implementation-runner.test.js`
Expected: PASS.

- [ ] **Step 8: Run the runner by hand and read the output**

Run: `node spec/run-adapter-implementation.js`
Expected: JSON with `status: "fail"` overall — twelve cases remain for Plans 2
and 3, and case `13` holds its four `invoke-version` assertions — with `pass`
for `capability-separation` and `platform-declaration`, and a real
`evidence_platform`.

- [ ] **Step 9: Run the full suite on both runtimes, then commit**

```bash
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
git add spec/run-adapter-implementation.js test/adapter-implementation-runner.test.js
git commit -m "Drive the negotiation vectors against the real adapter entrypoint"
```

---

## Definition of Done for Plan 1

- `node spec/run-adapter-implementation.js` reports `pass` for
  `capability-separation` and `platform-declaration`, and carries a real
  `evidence_platform`.
- Case `negotiation-mismatch` reports `fail` with exactly four assertions
  outstanding, all of type `invoke-version`. Every other assertion in that case
  carries evidence naming a `src/adapter/` module. The overall run status is
  `fail` — 77 of 183 assertions are evidenced at the end of this plan.
- The differential tests pass against `spec/adapter-reference.js`, and
  `spec/adapter-reference.js` is unmodified. Verify with
  `git diff --stat main -- spec/adapter-reference.js` showing no changes.
- `spec/run-adapter-vectors.js` differs from `main` only by two added `export`
  keywords.
- The full suite passes on Node 26 and Node 20.
- `src/` imports nothing from `test/` or `spec/`. Verify with
  `grep -rn "from '\.\./\(test\|spec\)/" src/` returning nothing.
- No manifest claims a `supported` platform.
- `docs/adapter-contract.md` §10's status table is unchanged. It moves only when
  all 15 cases pass, at the end of Plan 3.

## Follow-on Plans

- **Plan 2 — Invocation and forwarding:** `src/adapter/paths.js`, `limits.js`,
  `process-outcome.js`, `invoke.js`. Cases `03`, `04`, `05`, `06`, `10`, `11`,
  `12`. 41 assertions.
- **Plan 3 — Authority and context:** `src/adapter/approval.js`, `context.js`,
  `instructions.js`, `handoff.js`. Cases `02`, `07`, `08`, `14`, `15`. 61
  assertions. Ends by updating the §10 status table.
