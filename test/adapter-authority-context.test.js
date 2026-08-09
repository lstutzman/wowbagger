import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { validateInstructionInput } from '../src/adapter/instructions.js';
import { validateHandoffCarrier } from '../src/adapter/handoff.js';
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
