import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  canonicalInvocationDigest,
  invokeAdapter,
  mapProcessOutcome,
  referenceCoreCapabilities,
} from '../spec/adapter-reference.js';
import { createCandidateSource } from '../src/mutation.js';
import {
  adapterManifest,
  describeRequest,
  dynamicDescribe,
} from './adapter-contract-fixtures.js';

const CREATE_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

function processObservation(stdout, overrides = {}) {
  return {
    started: true,
    process_tree_contained: true,
    orphaned: false,
    exit_code: 0,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: Buffer.from(`${JSON.stringify(stdout)}\n`).toString('base64'),
    stderr_base64: '',
    ...overrides,
  };
}

test('returns unknown when create has an incomplete success envelope', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-incomplete-0001',
    command: 'create',
    item_id: 'wb_01KDWPVNG00000000000000000',
    expected_revision: null,
    process: processObservation({ ok: true }),
  });

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.mutation_outcome, 'unknown');
  assert.equal(result.error.details.recovery.action, 'inspect-caller-known-id');
});

test('treats a missing mutation started observation as unknown', () => {
  const process = processObservation({ ok: true });
  delete process.started;
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-missing-started-0001',
    command: 'create',
    item_id: CREATE_ID,
    expected_revision: null,
    process,
  });

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.mutation_outcome, 'unknown');
});

test('treats a contradicted mutation not-started observation as unknown', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-contradicted-started-0001',
    command: 'create',
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({ ok: true }, {
      started: false,
      exit_code: null,
      stdout_complete: false,
      stdout_base64: '',
    }),
  });

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.mutation_outcome, 'unknown');
});

test('forwards a definitive invalid create request response for invalid request bytes', async () => {
  const request = mutationInvocation();
  const coreResponse = {
    ok: false,
    command: 'create',
    contract_version: 2,
    state: 'unchanged',
    error: {
      code: 'invalid-request',
      message: 'The create request is invalid.',
      details: {
        issues: [{
          path: '/body',
          code: 'missing-member',
          message: 'Required member body is missing.',
        }],
      },
    },
  };
  let launches = 0;
  const result = await invokeAdapter(
    Buffer.from(`${JSON.stringify(request)}\n`),
    mutationRuntime(request, dynamicDescribe(), async () => {
      launches += 1;
      return processObservation(coreResponse, { exit_code: 2 });
    }),
  );

  assert.equal(launches, 1);
  assert.equal(result.ok, true);
  assert.equal(result.result.core_exit_code, 2);
  assert.equal(
    Buffer.from(result.result.stdout.data, 'base64').toString('utf8'),
    `${JSON.stringify(coreResponse)}\n`,
  );
});

test('returns unknown when invalid-request issues are not in canonical order', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-invalid-request-issue-order-0001',
    command: 'create',
    core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
    mutation_request: { id: CREATE_ID },
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: false,
      command: 'create',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'invalid-request',
        message: 'The create request is invalid.',
        details: {
          issues: [
            {
              path: '/id',
              code: 'invalid-value',
              message: 'Member id must be a canonical Wowbagger item ID.',
            },
            {
              path: '/body',
              code: 'missing-member',
              message: 'Required member body is missing.',
            },
          ],
        },
      },
    }, { exit_code: 2 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('requires every forwarded core response to match its exact request', () => {
  const alternateId = 'wb_01Q45X474N28T5CY4GNF6YY4HN';
  const createRequest = {
    id: CREATE_ID,
    item: {
      title: 'Map a fictional moon route',
      kind: 'task',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
    },
    body: validCoreItem().body,
  };
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const transitionRequest = {
    id: CREATE_ID,
    expected_revision: expectedRevision,
    to_status: 'backlog',
    date: '2030-01-11',
    decision: {
      summary: 'Accept the fictional item.',
      rationale: 'The fictional scope is ready.',
    },
  };
  const cases = [
    {
      command: 'ready',
      core_request: { command: 'ready', ledger: 'ledger', as_of: '2030-01-15' },
      stdout: { as_of: '2030-01-16', valid: true, ready: [] },
      expected: 'core-protocol-error',
    },
    {
      command: 'inspect',
      core_request: { command: 'inspect', ledger: 'ledger', id: CREATE_ID },
      stdout: {
        ok: true,
        command: 'inspect',
        contract_version: 2,
        result: { item: coreItemWithId(validCoreItem(), alternateId) },
      },
      expected: 'core-protocol-error',
    },
    {
      command: 'inspect',
      core_request: { command: 'inspect', ledger: 'ledger', id: CREATE_ID },
      stdout: {
        ok: false,
        command: 'inspect',
        contract_version: 2,
        error: {
          code: 'item-not-found',
          message: 'The requested item was not found.',
          details: { id: alternateId },
        },
      },
      exit_code: 2,
      expected: 'core-protocol-error',
    },
    {
      command: 'create',
      core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
      mutation_request: createRequest,
      item_id: CREATE_ID,
      stdout: {
        ok: true,
        command: 'create',
        contract_version: 2,
        state: 'committed',
        result: { item: coreItemWithId(validCoreItem(), alternateId) },
      },
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'create',
      core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
      mutation_request: {
        ...createRequest,
        item: { ...createRequest.item, fictional_label: 'nebula-7' },
      },
      item_id: CREATE_ID,
      stdout: {
        ok: true,
        command: 'create',
        contract_version: 2,
        state: 'committed',
        result: { item: validCoreItem() },
      },
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'create',
      core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
      mutation_request: createRequest,
      item_id: CREATE_ID,
      stdout: {
        ok: true,
        command: 'create',
        contract_version: 2,
        state: 'committed',
        result: { item: { ...validCoreItem(), path: `nested/${CREATE_ID}.md` } },
      },
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'create',
      core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
      mutation_request: createRequest,
      item_id: CREATE_ID,
      stdout: {
        ok: false,
        command: 'create',
        contract_version: 2,
        state: 'unchanged',
        error: {
          code: 'path-collision',
          message: 'The default item path is occupied by a different item.',
          details: { id: CREATE_ID, path: `nested/${CREATE_ID}.md`, occupant_kind: 'directory' },
        },
      },
      exit_code: 4,
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'create',
      core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
      mutation_request: createRequest,
      item_id: CREATE_ID,
      stdout: {
        ok: false,
        command: 'create',
        contract_version: 2,
        state: 'unchanged',
        error: {
          code: 'invalid-request',
          message: 'The create request is invalid.',
          details: {
            issues: [{
              path: '/body',
              code: 'invalid-type',
              message: 'Request input must be a JSON object.',
            }],
          },
        },
      },
      exit_code: 2,
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'transition',
      core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
      mutation_request: transitionRequest,
      item_id: CREATE_ID,
      expected_revision: expectedRevision,
      stdout: {
        ok: false,
        command: 'transition',
        contract_version: 2,
        state: 'unchanged',
        error: {
          code: 'revision-conflict',
          message: 'The item changed after it was inspected.',
          details: {
            id: CREATE_ID,
            expected_revision: `sha256:${'b'.repeat(64)}`,
            actual_revision: `sha256:${'c'.repeat(64)}`,
          },
        },
      },
      exit_code: 4,
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'transition',
      core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
      mutation_request: transitionRequest,
      item_id: CREATE_ID,
      expected_revision: expectedRevision,
      stdout: {
        ok: false,
        command: 'transition',
        contract_version: 2,
        state: 'committed',
        error: {
          code: 'post-commit-recovery-required',
          message: 'The item was committed, but cleanup requires recovery.',
          details: {
            id: CREATE_ID,
            revision: expectedRevision,
            recovery_artifacts: [],
            recovery_artifacts_truncated: false,
          },
        },
      },
      exit_code: 6,
      expected: 'mutation-outcome-unknown',
    },
    {
      command: 'transition',
      core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
      mutation_request: transitionRequest,
      item_id: CREATE_ID,
      expected_revision: expectedRevision,
      stdout: {
        ok: true,
        command: 'transition',
        contract_version: 2,
        state: 'committed',
        result: { item: validCoreItem() },
      },
      expected: 'mutation-outcome-unknown',
    },
  ];

  for (const scenario of cases) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: `review-correlation-${scenario.command}-0001`,
      ...scenario,
      process: processObservation(scenario.stdout, { exit_code: scenario.exit_code ?? 0 }),
    });

    assert.equal(result?.error?.code, scenario.expected, scenario.command);
  }
});

test('forwards a create success with the exact canonical candidate source', () => {
  const request = {
    id: CREATE_ID,
    item: {
      title: 'Map a fictional moon route',
      kind: 'task',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
      fictional_label: 'nebula-7',
    },
    body: validCoreItem().body,
  };
  const source = createCandidateSource(request);
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-canonical-create-source-0001',
    command: 'create',
    core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: true,
      command: 'create',
      contract_version: 2,
      state: 'committed',
      result: {
        item: {
          ...validCoreItem(),
          revision: digest(source),
          source_base64: source.toString('base64'),
        },
      },
    }),
  });

  assert.equal(result, null);
});

test('returns unknown when committed create recovery reports a different candidate revision', () => {
  const request = {
    id: CREATE_ID,
    item: {
      title: 'Map a fictional moon route',
      kind: 'task',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
      fictional_label: 'nebula-7',
    },
    body: validCoreItem().body,
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-recovery-revision-0001',
    command: 'create',
    core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: false,
      command: 'create',
      contract_version: 2,
      state: 'committed',
      error: {
        code: 'post-commit-recovery-required',
        message: 'The item was committed, but cleanup requires recovery.',
        details: {
          id: CREATE_ID,
          revision: `sha256:${'b'.repeat(64)}`,
          recovery_artifacts: [],
          recovery_artifacts_truncated: false,
        },
      },
    }, { exit_code: 6 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('returns unknown when recovery artifacts are not in canonical order', () => {
  const request = {
    id: CREATE_ID,
    item: {
      title: 'Map a fictional moon route',
      kind: 'task',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
    },
    body: validCoreItem().body,
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-recovery-artifact-order-0001',
    command: 'create',
    core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: false,
      command: 'create',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'operation-failed',
        message: 'The mutation operation failed before a commit was established.',
        details: {
          id: CREATE_ID,
          operation: 'publish',
          reason: 'io-error',
          recovery_artifacts: [
            { path: 'z.lock', kind: 'lock-file', sha256: null, size_bytes: null },
            { path: 'a.tmp', kind: 'temporary-file', sha256: null, size_bytes: null },
          ],
          recovery_artifacts_truncated: false,
        },
      },
    }, { exit_code: 6 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('returns unknown when recovery artifacts repeat a path under different kinds', () => {
  const request = {
    id: CREATE_ID,
    item: {
      title: 'Map a fictional moon route',
      kind: 'task',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
    },
    body: validCoreItem().body,
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-recovery-artifact-path-uniqueness-0001',
    command: 'create',
    core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: false,
      command: 'create',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'operation-failed',
        message: 'The mutation operation failed before a commit was established.',
        details: {
          id: CREATE_ID,
          operation: 'publish',
          reason: 'io-error',
          recovery_artifacts: [
            { path: 'same-path', kind: 'lock-file', sha256: null, size_bytes: null },
            { path: 'same-path', kind: 'temporary-file', sha256: null, size_bytes: null },
          ],
          recovery_artifacts_truncated: false,
        },
      },
    }, { exit_code: 6 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('returns unknown when a revision conflict reports the expected revision as actual', () => {
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const request = {
    id: CREATE_ID,
    expected_revision: expectedRevision,
    to_status: 'backlog',
    date: '2030-01-11',
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-revision-conflict-same-revision-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: expectedRevision,
    process: processObservation({
      ok: false,
      command: 'transition',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'revision-conflict',
        message: 'The item changed after it was inspected.',
        details: {
          id: CREATE_ID,
          expected_revision: expectedRevision,
          actual_revision: expectedRevision,
        },
      },
    }, { exit_code: 4 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('returns unknown when atomic scope required has no blockers', () => {
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const request = {
    id: CREATE_ID,
    expected_revision: expectedRevision,
    to_status: 'killed',
    date: '2030-01-11',
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-atomic-scope-empty-blockers-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: expectedRevision,
    process: processObservation({
      ok: false,
      command: 'transition',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'atomic-scope-required',
        message: 'The requested transition requires multi-item atomicity.',
        details: {
          id: CREATE_ID,
          blockers: [],
          precondition_issues: [],
        },
      },
    }, { exit_code: 5 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('returns unknown when atomic scope required blockers are not in canonical order', () => {
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const request = {
    id: CREATE_ID,
    expected_revision: expectedRevision,
    to_status: 'killed',
    date: '2030-01-11',
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-atomic-scope-blocker-order-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: expectedRevision,
    process: processObservation({
      ok: false,
      command: 'transition',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'atomic-scope-required',
        message: 'The requested transition requires multi-item atomicity.',
        details: {
          id: CREATE_ID,
          blockers: [
            {
              code: 'dependent-disposition',
              item_id: 'wb_01Q45X474N28T5CY4GNF6YY4HN',
              field: 'depends_on',
            },
            {
              code: 'child-disposition',
              item_id: 'wb_01Q45X474N28T5CY4GNF6YY4HP',
              field: 'parent',
            },
          ],
          precondition_issues: [],
        },
      },
    }, { exit_code: 5 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('returns unknown when transition blocker or issue fields contradict their codes', () => {
  const cases = [
    {
      request_id: 'review-atomic-blocker-field-0001',
      exit_code: 5,
      state: 'unchanged',
      error: {
        code: 'atomic-scope-required',
        message: 'The requested transition requires multi-item atomicity.',
        details: {
          id: CREATE_ID,
          blockers: [{
            code: 'child-disposition',
            item_id: 'wb_01Q45X474N28T5CY4GNF6YY4HN',
            field: 'depends_on',
          }],
          precondition_issues: [],
        },
      },
    },
    {
      request_id: 'review-transition-issue-field-0001',
      exit_code: 2,
      state: 'unchanged',
      error: {
        code: 'transition-precondition-failed',
        message: 'The requested lifecycle transition failed its preconditions.',
        details: {
          id: CREATE_ID,
          issues: [{
            code: 'invalid-edge',
            field: 'date',
            message: 'The requested lifecycle edge is not allowed for this item.',
            related_ids: [],
          }],
        },
      },
    },
  ];
  for (const scenario of cases) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: scenario.request_id,
      command: 'transition',
      process: processObservation({
        ok: false,
        command: 'transition',
        contract_version: 2,
        state: scenario.state,
        error: scenario.error,
      }, { exit_code: scenario.exit_code }),
    });

    assert.equal(result?.error?.code, 'mutation-outcome-unknown', scenario.request_id);
  }
});

test('returns unknown when transition precondition issues are not in canonical order', () => {
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const request = {
    id: CREATE_ID,
    expected_revision: expectedRevision,
    to_status: 'backlog',
    date: '2030-01-11',
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-transition-issue-order-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: request,
    item_id: CREATE_ID,
    expected_revision: expectedRevision,
    process: processObservation({
      ok: false,
      command: 'transition',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'transition-precondition-failed',
        message: 'The requested lifecycle transition failed its preconditions.',
        details: {
          id: CREATE_ID,
          issues: [
            {
              code: 'invalid-edge',
              field: 'to_status',
              message: 'The requested lifecycle edge is not allowed for this item.',
              related_ids: [],
            },
            {
              code: 'date-before-created',
              field: 'date',
              message: 'Transition date must not be earlier than the current created date.',
              related_ids: [],
            },
          ],
        },
      },
    }, { exit_code: 2 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
});

test('rejects source-consistent items that violate ledger semantic invariants', () => {
  const dependencyId = 'wb_01KDWPVNG00000000000000002';
  const item = validCoreItem();
  const doneSource = (changes = '') => Buffer.from(item.source_base64, 'base64').toString('utf8')
    .replace('status: triage', 'status: done')
    .replace('updated: 2030-01-10', 'updated: 2030-01-10\ncompleted: 2030-01-10')
    .replace('depends_on: []', `depends_on: [${dependencyId}]`)
    .replace('related: []', `related: [${dependencyId}]${changes}`);
  const completeDecision = `\ndecisions:\n  - action: complete\n    date: 2030-01-10\n    summary: Complete the fictional route.\n    rationale: The fictional scope is complete.\n`;
  const cases = [
    coreItemWithSource(item,
      Buffer.from(item.source_base64, 'base64').toString('utf8')
        .replace('kind: task', 'kind: epic')
        .replace('status: triage', 'status: in-progress'),
      { ...item.core, kind: 'epic', status: 'in-progress' }),
    coreItemWithSource(item,
      Buffer.from(item.source_base64, 'base64').toString('utf8')
        .replace('created: 2030-01-10', 'created: 2030-01-11')
        .replace('updated: 2030-01-10', 'updated: 2030-01-11'),
      { ...item.core, created: '2030-01-11', updated: '2030-01-11' }),
    coreItemWithSource(item, doneSource(), {
      ...item.core,
      status: 'done',
      completed: '2030-01-10',
      depends_on: [dependencyId],
      related: [dependencyId],
    }),
    coreItemWithSource(item,
      Buffer.from(item.source_base64, 'base64').toString('utf8')
        .replace('depends_on: []', `depends_on: [${CREATE_ID}]`),
      { ...item.core, depends_on: [CREATE_ID] }),
    coreItemWithSource(item,
      doneSource(completeDecision)
        .replace('kind: task', 'kind: epic')
        .replace(`depends_on: [${dependencyId}]`, 'depends_on: []')
        .replace(`related: [${dependencyId}]`, 'related: []'),
      {
        ...item.core,
        kind: 'epic',
        status: 'done',
        completed: '2030-01-10',
        decisions: [{
          action: 'complete',
          date: '2030-01-10',
          summary: 'Complete the fictional route.',
          rationale: 'The fictional scope is complete.',
        }],
      }),
  ];

  for (const invalidItem of cases) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: 'review-semantic-inspect-0001',
      command: 'inspect',
      core_request: { command: 'inspect', ledger: 'ledger', id: CREATE_ID },
      process: processObservation({
        ok: true,
        command: 'inspect',
        contract_version: 2,
        result: { item: invalidItem },
      }),
    });

    assert.equal(result?.error?.code, 'core-protocol-error');
  }

  const transition = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-semantic-transition-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: {
      id: CREATE_ID,
      expected_revision: `sha256:${'a'.repeat(64)}`,
      to_status: 'in-progress',
      date: '2030-01-10',
    },
    item_id: CREATE_ID,
    expected_revision: `sha256:${'a'.repeat(64)}`,
    process: processObservation({
      ok: true,
      command: 'transition',
      contract_version: 2,
      state: 'committed',
      result: {
        item: coreItemWithSource(item,
          Buffer.from(item.source_base64, 'base64').toString('utf8')
            .replace('kind: task', 'kind: epic')
            .replace('status: triage', 'status: in-progress'),
          { ...item.core, kind: 'epic', status: 'in-progress' }),
      },
    }),
  });

  assert.equal(transition?.error?.code, 'mutation-outcome-unknown');
});

test('rejects an inspect success whose nested item omits contract fields', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-missing-item-field-0001',
    command: 'inspect',
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item: {} },
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
  assert.equal(result?.process.core_envelope_valid, false);
});

test('forwards an exact inspect success envelope at exit zero', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-success-0001',
    command: 'inspect',
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item: validCoreItem() },
    }),
  });

  assert.equal(result, null);
});

test('rejects an inspect success whose core view has an undocumented member', () => {
  const item = validCoreItem();
  item.core.extension_data = 'must remain only in source_base64';
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-extra-core-member-0001',
    command: 'inspect',
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item },
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
});

test('rejects an inspect success whose core view disagrees with its source bytes', () => {
  const item = validCoreItem();
  item.core.id = 'wb_01Q45X474N28T5CY4GNF6YY4HN';
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-source-core-mismatch-0001',
    command: 'inspect',
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item },
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
});

test('rejects an inspect success whose source-consistent core status is outside version 1', () => {
  const item = validCoreItem();
  const source = Buffer.from(item.source_base64, 'base64').toString('utf8')
    .replace('status: triage', 'status: invented');
  const bytes = Buffer.from(source);
  item.source_base64 = bytes.toString('base64');
  item.revision = digest(bytes);
  item.core.status = 'invented';
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-invalid-core-status-0001',
    command: 'inspect',
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item },
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
});

test('rejects an inspect success when invalid source relations normalize into a core view', () => {
  const item = validCoreItem();
  const source = Buffer.from(item.source_base64, 'base64').toString('utf8')
    .replace('related: []', 'related: null');
  const bytes = Buffer.from(source);
  item.source_base64 = bytes.toString('base64');
  item.revision = digest(bytes);
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-invalid-source-relation-0001',
    command: 'inspect',
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item },
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
});

test('returns unknown when create success does not have exit zero', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-exit-0001',
    command: 'create',
    item_id: 'wb_01KDWPVNG00000000000000001',
    expected_revision: null,
    process: processObservation({
      ok: true,
      command: 'create',
      contract_version: 2,
      state: 'committed',
      result: { item: validCoreItem() },
    }, { exit_code: 2 }),
  });

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.process.core_envelope_valid, false);
});

test('returns unknown when a committed create result has unauthenticated source bytes', () => {
  const item = validCoreItem();
  item.source_base64 = '';
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-source-digest-0001',
    command: 'create',
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: true,
      command: 'create',
      contract_version: 2,
      state: 'committed',
      result: { item },
    }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
  assert.equal(result?.process.core_envelope_valid, false);
});

test('returns unknown when transition declares an unknown core mutation state', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-transition-unknown-0001',
    command: 'transition',
    item_id: 'wb_01KDWPVNG00000000000000002',
    expected_revision: `sha256:${'a'.repeat(64)}`,
    process: processObservation({
      ok: false,
      command: 'transition',
      contract_version: 2,
      state: 'unknown',
      error: {
        code: 'write-outcome-unknown',
        message: 'The transition publication outcome could not be verified.',
        details: {
          id: 'wb_01KDWPVNG00000000000000002',
          recovery_artifacts: [],
          recovery_artifacts_truncated: false,
        },
      },
    }, { exit_code: 6 }),
  });

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.process.core_envelope_valid, true);
  assert.equal(result.error.details.recovery.action, 'validate-inspect-and-compare-revision');
});

test('returns unknown when create reports a transition-only core error code', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-create-wrong-error-code-0001',
    command: 'create',
    item_id: CREATE_ID,
    expected_revision: null,
    process: processObservation({
      ok: false,
      command: 'create',
      contract_version: 2,
      state: 'unchanged',
      error: {
        code: 'item-not-found',
        message: 'The requested item was not found.',
        details: { id: CREATE_ID },
      },
    }, { exit_code: 2 }),
  });

  assert.equal(result?.error?.code, 'mutation-outcome-unknown');
  assert.equal(result?.process.core_envelope_valid, false);
});

test('forwards the documented invalid-ledger ready envelope at exit one', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-ready-invalid-ledger-0001',
    command: 'ready',
    process: processObservation({
      valid: false,
      errors: [{
        path: 'ledger/bad.md',
        field: 'title',
        code: 'missing-required-field',
        message: 'Item is missing a required title.',
      }],
    }, { exit_code: 1 }),
  });

  assert.equal(result, null);
});

test('rejects an invalid-ledger ready envelope with no validation errors', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-ready-empty-errors-0001',
    command: 'ready',
    process: processObservation({ valid: false, errors: [] }, { exit_code: 1 }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
  assert.equal(result?.process?.core_envelope_valid, false);
});

test('rejects validation errors that are not in canonical order', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-validation-error-order-0001',
    command: 'ready',
    process: processObservation({
      valid: false,
      errors: [
        {
          path: 'ledger/z.md',
          field: 'title',
          code: 'missing-required-field',
          message: 'Item is missing a required title.',
        },
        {
          path: 'ledger/a.md',
          field: 'title',
          code: 'missing-required-field',
          message: 'Item is missing a required title.',
        },
      ],
    }, { exit_code: 1 }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
  assert.equal(result?.process?.core_envelope_valid, false);
});

test('rejects validate and capabilities envelopes at inconsistent exits', () => {
  for (const [command, stdout] of [
    ['validate', { valid: true, errors: [] }],
    ['capabilities', referenceCoreCapabilities()],
  ]) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: `review-${command}-exit-0001`,
      command,
      process: processObservation(stdout, { exit_code: 1 }),
    });

    assert.equal(result?.error?.code, 'core-protocol-error', command);
    assert.equal(result?.process.core_envelope_valid, false, command);
  }
});

test('rejects a complete core envelope that omits its required final LF', () => {
  const stdout = { as_of: '2030-01-15', valid: true, ready: [] };
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-missing-final-lf-0001',
    command: 'ready',
    process: processObservation(stdout, {
      stdout_base64: Buffer.from(JSON.stringify(stdout)).toString('base64'),
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
  assert.equal(result?.process?.core_envelope_valid, false);
});

test('rejects a noncompact core envelope before its required final LF', () => {
  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-noncompact-core-envelope-0001',
    command: 'ready',
    process: processObservation({ as_of: '2030-01-15', valid: true, ready: [] }, {
      stdout_base64: Buffer.from('{"as_of": "2030-01-15","valid":true,"ready":[]}\n').toString('base64'),
    }),
  });

  assert.equal(result?.error?.code, 'core-protocol-error');
  assert.equal(result?.process?.core_envelope_valid, false);
});

test('refuses approved mutations when trusted approval is unavailable', async () => {
  for (const configureUnavailable of [
    (dynamic) => { dynamic.host.trusted_approval.supported = false; },
    (dynamic) => { delete dynamic.host.trusted_approval; },
  ]) {
    const request = mutationInvocation();
    const dynamic = dynamicDescribe();
    configureUnavailable(dynamic);
    let launches = 0;
    const result = await invokeAdapter(
      Buffer.from(`${JSON.stringify(request)}\n`),
      mutationRuntime(request, dynamic, async () => {
        launches += 1;
        return processObservation({
          ok: true,
          command: 'create',
          contract_version: 2,
          state: 'committed',
          result: { item: {} },
        });
      }),
    );

    assert.equal(result.error.code, 'capability-unavailable');
    assert.deepEqual(result.error.details, { missing: ['trusted-approval'] });
    assert.equal(launches, 0);
  }
});

test('refuses a non-null handoff before launch when the host cannot carry handoff state', async () => {
  for (const [configure, expected] of [
    [(dynamic) => { dynamic.host.handoff.supported = false; }, 'capability-unavailable'],
    [(dynamic) => { delete dynamic.host.handoff; }, 'invalid-describe-result'],
  ]) {
    const request = readyInvocation();
    request.handoff_carrier = {};
    const dynamic = dynamicDescribe();
    configure(dynamic);
    let launches = 0;
    const result = await invokeAdapter(
      Buffer.from(`${JSON.stringify(request)}\n`),
      readyRuntime(dynamic, 65536, async () => {
        launches += 1;
        return processObservation({ as_of: '2030-01-15', valid: true, ready: [] });
      }),
    );

    assert.equal(result.error.code, expected);
    if (expected === 'capability-unavailable') {
      assert.deepEqual(result.error.details, { missing: ['handoff'] });
    }
    assert.equal(launches, 0);
  }
});

test('requires explicit support for the active Darwin Linux or Windows platform before launch', async () => {
  for (const activePlatform of ['darwin', 'linux', 'win32']) {
    const platforms = {
      darwin: activePlatform === 'darwin' ? 'supported' : 'unsupported',
      linux: activePlatform === 'linux' ? 'supported' : 'unsupported',
      win32: activePlatform === 'win32' ? 'supported' : 'unsupported',
    };
    const dynamic = dynamicDescribe({ platforms });
    let launches = 0;
    const runtime = readyRuntime(dynamic, 65536, async () => {
      launches += 1;
      return processObservation({ as_of: '2030-01-15', valid: true, ready: [] });
    });
    runtime.manifest = adapterManifest({ platforms });
    runtime.platform = activePlatform;

    const result = await invokeAdapter(
      Buffer.from(`${JSON.stringify(readyInvocation())}\n`),
      runtime,
    );

    assert.equal(result.ok, true, activePlatform);
    assert.equal(launches, 1, activePlatform);
  }

  const platforms = { darwin: 'unsupported', linux: 'unsupported', win32: 'unsupported' };
  let launches = 0;
  const runtime = readyRuntime(dynamicDescribe({ platforms }), 65536, async () => {
    launches += 1;
    return processObservation({ as_of: '2030-01-15', valid: true, ready: [] });
  });
  runtime.manifest = adapterManifest({ platforms });
  runtime.platform = 'linux';
  const refusal = await invokeAdapter(Buffer.from(`${JSON.stringify(readyInvocation())}\n`), runtime);

  assert.equal(refusal.error.code, 'adapter-platform-mismatch');
  assert.deepEqual(refusal.error.details, {
    platform: 'linux', status: 'unsupported', required: 'supported',
  });
  assert.equal(launches, 0);
});

test('applies the described request byte limit below the local runtime ceiling', async () => {
  const request = readyInvocation();
  const requestBytes = Buffer.from(`${JSON.stringify(request)}\n`);
  const dynamic = dynamicDescribe();
  dynamic.limits.max_request_bytes = 64;
  let launches = 0;

  const result = await invokeAdapter(requestBytes, readyRuntime(dynamic, 65536, async () => {
    launches += 1;
    return processObservation({ as_of: '2030-01-15', valid: true, ready: [] });
  }));

  assert.ok(requestBytes.length > dynamic.limits.max_request_bytes);
  assert.equal(result.error.code, 'invalid-invocation');
  assert.deepEqual(result.error.details, {
    member: 'request', reason: 'byte-limit-exceeded', limit_bytes: 64,
  });
  assert.equal(launches, 0);
});

test('rejects captured streams over the requested limits despite complete runner flags', async () => {
  for (const [stream, processOverrides] of [
    ['stdout', {}],
    ['stderr', { stderr_base64: Buffer.from('diagnostic\n').toString('base64') }],
  ]) {
    const request = readyInvocation();
    request.limits[`${stream}_bytes`] = 0;
    const result = await invokeAdapter(
      Buffer.from(`${JSON.stringify(request)}\n`),
      readyRuntime(dynamicDescribe(), 65536, async () => processObservation({
        as_of: '2030-01-15', valid: true, ready: [],
      }, processOverrides)),
    );

    assert.equal(result.error.code, 'output-limit-exceeded');
    assert.deepEqual(result.error.details, { streams: [stream] });
    assert.equal(result.process[`${stream}_complete`], true);
  }
});

function mutationInvocation() {
  return {
    adapter_contract_version: 2,
    request_id: 'review-approval-unavailable-0001',
    workspace: { workspace_id: 'review-workspace', cwd: '.' },
    core_request: {
      command: 'create',
      ledger: 'ledger',
      input_base64: Buffer.from(`${JSON.stringify({ id: CREATE_ID })}\n`).toString('base64'),
    },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
}

function readyInvocation() {
  return {
    adapter_contract_version: 2,
    request_id: 'review-request-limit-0001',
    workspace: { workspace_id: 'review-workspace', cwd: '.' },
    core_request: { command: 'ready', ledger: 'ledger', as_of: '2030-01-15' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
}

function mutationRuntime(request, dynamic, launch) {
  const coreInput = Buffer.from(request.core_request.input_base64, 'base64');
  const binding = {
    request_id: request.request_id,
    adapter: {
      id: dynamic.adapter_id,
      version: dynamic.adapter_version,
      contract_version: dynamic.selected_adapter_contract_version,
    },
    core: {
      executable_identity: `sha256:${'a'.repeat(64)}`,
      contract_version: 2,
      argv: ['create', '--ledger', '/approved/workspace/ledger', '--input', '-', '--json'],
      input_base64: coreInput.toString('base64'),
    },
    workspace: {
      id: 'review-workspace',
      root: '/approved/workspace',
      cwd: '/approved/workspace',
      ledger: '/approved/workspace/ledger',
    },
    limits: request.limits,
    instruction_set_digest: digest(Buffer.from('[]')),
    handoff_digest: null,
  };
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic,
    core_probe: referenceCoreCapabilities(),
    package_root: '/installed/adapter',
    workspaces: {
      'review-workspace': {
        root: '/approved/workspace',
        before: {
          '.': { kind: 'directory', identity: 'root-1' },
          ledger: { kind: 'directory', identity: 'ledger-1' },
        },
        after: {
          '.': { kind: 'directory', identity: 'root-1' },
          ledger: { kind: 'directory', identity: 'ledger-1' },
        },
      },
    },
    approval: {
      approval_version: 1,
      source: 'consumer',
      nonce: 'review-approval-unavailable-0001',
      issued_at: '2030-01-15T12:00:00Z',
      expires_at: '2030-01-15T12:05:00Z',
      invocation_digest: canonicalInvocationDigest(binding).digest,
    },
    now: '2030-01-15T12:01:00Z',
    redeemed_nonces: new Set(),
    core_executable_identity: `sha256:${'a'.repeat(64)}`,
    launch,
  };
}

function readyRuntime(dynamic, maxRequestBytes, launch) {
  return {
    max_request_bytes: maxRequestBytes,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic,
    core_probe: referenceCoreCapabilities(),
    package_root: '/installed/adapter',
    workspaces: {
      'review-workspace': {
        root: '/approved/workspace',
        before: {
          '.': { kind: 'directory', identity: 'root-1' },
          ledger: { kind: 'directory', identity: 'ledger-1' },
        },
        after: {
          '.': { kind: 'directory', identity: 'root-1' },
          ledger: { kind: 'directory', identity: 'ledger-1' },
        },
      },
    },
    launch,
  };
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

test('accepts a core inspect envelope whose item carries number and priority', () => {
  const item = consumerCoreItem();

  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-inspect-consumer-core-0001',
    command: 'inspect',
    core_request: { command: 'inspect', ledger: 'ledger', id: item.id },
    item_id: item.id,
    process: processObservation({
      ok: true,
      command: 'inspect',
      contract_version: 2,
      result: { item },
    }),
  });

  assert.notEqual(result?.error?.code, 'core-protocol-error', JSON.stringify(result));
});

test('reference oracle correlates a patch success with the requested fields', () => {
  const before = consumerCoreItem();
  const source = Buffer.from(before.source_base64, 'base64').toString('utf8')
    .replace('priority: 5', 'priority: 1')
    .replace('updated: 2030-01-10', 'updated: 2030-01-15');
  const after = coreItemWithSource(before, source, {
    ...before.core,
    priority: 1,
    updated: '2030-01-15',
  });
  const request = {
    id: before.id,
    expected_revision: before.revision,
    date: '2030-01-15',
    set: { priority: 1 },
  };
  const response = processObservation({
    ok: true,
    command: 'patch',
    contract_version: 2,
    state: 'committed',
    result: { item: after },
  });
  const outcome = (mutationRequest) => mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'review-patch-success-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_request: mutationRequest,
    item_id: before.id,
    expected_revision: before.revision,
    process: response,
  });

  assert.equal(outcome(request), null);
  assert.equal(outcome({ ...request, set: { priority: 2 } }).error.code, 'mutation-outcome-unknown');
  assert.equal(outcome({ ...request, date: '2030-01-16' }).error.code, 'mutation-outcome-unknown');
  assert.equal(outcome({ ...request, id: 'wb_01Q45X474N28T5CY4GNF6YY4HN' }).error.code,
    'mutation-outcome-unknown');
  assert.equal(outcome({ ...request, set: { priority: 1, depends_on: [] } }), null);
  assert.equal(outcome({ ...request, set: { priority: 1, related: null } }), null);
  assert.equal(
    outcome({ ...request, set: { priority: 1, related: [CREATE_ID] } }).error.code,
    'mutation-outcome-unknown',
  );
  assert.equal(
    outcome({ ...request, set: { priority: 1, depends_on: [CREATE_ID] } }).error.code,
    'mutation-outcome-unknown',
  );
});

// The consumer-supplied schema-1 fields (number, priority) belong to the core
// view; the oracle must accept an engine item that reports them.
function consumerCoreItem() {
  const id = CREATE_ID;
  const body = '\nPlot a fictional route from Brindle Station to Lumen Reef.\n';
  const source = Buffer.from(`---\nschema_version: 1\nid: ${id}\nnumber: 7\ntitle: Map a fictional moon route\nkind: task\npriority: 5\nstatus: triage\ncreated: 2030-01-10\nupdated: 2030-01-10\nprovenance:\n  source: fixture/mutations\n  recorded_at: 2030-01-10T12:34:56.789Z\ndepends_on: []\nrelated: []\n---\n${body}`);
  return {
    id,
    path: `${id}.md`,
    revision: digest(source),
    source_encoding: 'base64',
    source_media_type: 'text/markdown; charset=utf-8',
    source_base64: source.toString('base64'),
    core: {
      schema_version: 1,
      id,
      title: 'Map a fictional moon route',
      kind: 'task',
      status: 'triage',
      created: '2030-01-10',
      updated: '2030-01-10',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
      number: 7,
      priority: 5,
    },
    body,
  };
}

function validCoreItem() {
  const id = CREATE_ID;
  const body = '\nPlot a fictional route from Brindle Station to Lumen Reef.\n';
  const source = Buffer.from(`---\nschema_version: 1\nid: ${id}\ntitle: Map a fictional moon route\nkind: task\nstatus: triage\ncreated: 2030-01-10\nupdated: 2030-01-10\nprovenance:\n  source: fixture/mutations\n  recorded_at: 2030-01-10T12:34:56.789Z\ndepends_on: []\nrelated: []\n---\n${body}`);
  return {
    id,
    path: `${id}.md`,
    revision: digest(source),
    source_encoding: 'base64',
    source_media_type: 'text/markdown; charset=utf-8',
    source_base64: source.toString('base64'),
    core: {
      schema_version: 1,
      id,
      title: 'Map a fictional moon route',
      kind: 'task',
      status: 'triage',
      created: '2030-01-10',
      updated: '2030-01-10',
      provenance: {
        source: 'fixture/mutations',
        recorded_at: '2030-01-10T12:34:56.789Z',
      },
      depends_on: [],
      related: [],
    },
    body,
  };
}

function coreItemWithId(item, id) {
  const source = Buffer.from(item.source_base64, 'base64').toString('utf8')
    .replace(CREATE_ID, id);
  const bytes = Buffer.from(source);
  return {
    ...item,
    id,
    revision: digest(bytes),
    source_base64: bytes.toString('base64'),
    core: { ...item.core, id },
  };
}

function coreItemWithSource(item, source, core) {
  const bytes = Buffer.from(source);
  return {
    ...item,
    revision: digest(bytes),
    source_base64: bytes.toString('base64'),
    core,
  };
}
