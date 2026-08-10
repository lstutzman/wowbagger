import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { validateInstructionInput } from '../src/adapter/instructions.js';
import { validateHandoffCarrier, validateHandoffResume } from '../src/adapter/handoff.js';
import { validateInvokeContext } from '../src/adapter/context.js';

const contextScenarios = JSON.parse(
  await readFile('spec/fixtures/adapters/14-context-validation/scenarios.json', 'utf8'),
);

test('accepts instruction bytes at the exact advertised limit', () => {
  const result = validateInstructionInput(contextScenarios.base_instruction, {
    max_sources: 1,
    max_bytes: 6,
  });

  assert.equal(result.ok, true);
  assert.equal(result.total_bytes, 6);
});

test('accepts handoff bytes at the exact advertised limit', () => {
  const result = validateHandoffCarrier(contextScenarios.base_handoff_carrier, {
    ...contextScenarios.handoff_options,
    max_bytes: 295,
  });

  assert.equal(result.ok, true);
  assert.equal(result.byte_length, 295);
});

test('accepts combined context bytes at the exact invocation limit', () => {
  const result = validateInvokeContext({
    instruction_input: contextScenarios.base_instruction,
    handoff_carrier: contextScenarios.base_handoff_carrier,
    context_bytes: 301,
    instruction_limits: contextScenarios.instruction_limits,
    handoff_options: contextScenarios.handoff_options,
  });

  assert.equal(result.ok, true);
  assert.equal(result.total_bytes, 301);
});

test('rejects an instruction source whose source_id is not a string (null)', () => {
  const bytes = Buffer.from('hi');
  const digest = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const result = validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [{
      source_id: null,
      origin: 'consumer',
      content_encoding: 'base64',
      content_base64: bytes.toString('base64'),
      sha256: digest(bytes),
      byte_length: bytes.length,
    }],
  }, { max_sources: 8, max_bytes: 65536 });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-instruction-source');
});

test('rejects a handoff resume whose bytes are not strict JSON', () => {
  const bytes = Buffer.from('this is not json at all');
  const digest = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const result = validateHandoffResume({
    handoff_bytes: bytes,
    handoff_digest: digest(bytes),
    resume_request: {
      item_id: 'wb_01KDWPVNG00000000000000000',
      instruction_set_digest: `sha256:${'c'.repeat(64)}`,
      expected_revision: `sha256:${'d'.repeat(64)}`,
    },
    current: {
      item_id: 'wb_01KDWPVNG00000000000000000',
      instruction_set_digest: `sha256:${'c'.repeat(64)}`,
      revision: `sha256:${'d'.repeat(64)}`,
    },
    max_bytes: 10000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-handoff-json');
});

test('accepts a handoff resume whose bytes are strict JSON matching the digest', () => {
  const bytes = Buffer.from('{"handoff":"bytes"}');
  const digest = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const result = validateHandoffResume({
    handoff_bytes: bytes,
    handoff_digest: digest(bytes),
    resume_request: {
      item_id: 'wb_01KDWPVNG00000000000000000',
      instruction_set_digest: `sha256:${'c'.repeat(64)}`,
      expected_revision: `sha256:${'d'.repeat(64)}`,
    },
    current: {
      item_id: 'wb_01KDWPVNG00000000000000000',
      instruction_set_digest: `sha256:${'c'.repeat(64)}`,
      revision: `sha256:${'d'.repeat(64)}`,
    },
    max_bytes: 10000,
  });

  assert.equal(result.ok, true);
});
