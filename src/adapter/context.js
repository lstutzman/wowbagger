import { validateHandoffCarrier } from './handoff.js';
import { validateInstructionInput } from './instructions.js';

function refuse(error_code, detail = {}) {
  return { ok: false, error_code, detail };
}

export function validateInvokeContext({
  instruction_input: instructionInput,
  handoff_carrier: handoffCarrier,
  context_bytes: contextBytes,
  instruction_limits: instructionLimits,
  handoff_options: handoffOptions,
}) {
  const instructions = validateInstructionInput(instructionInput, instructionLimits);
  if (!instructions.ok) return instructions;
  const handoff = handoffCarrier === null
    ? { ok: true, byte_length: 0 }
    : validateHandoffCarrier(handoffCarrier, handoffOptions);
  if (!handoff.ok) return handoff;
  if (handoffCarrier !== null
    && handoffCarrier.resume_request.instruction_set_digest !== instructions.instruction_set_digest) {
    return refuse('handoff-instruction-set-mismatch');
  }
  const totalBytes = instructions.total_bytes + handoff.byte_length;
  if (totalBytes > contextBytes) {
    return refuse('context-limit-exceeded', {
      instruction_bytes: instructions.total_bytes,
      handoff_bytes: handoff.byte_length,
      context_bytes: contextBytes,
    });
  }
  return { ok: true, total_bytes: totalBytes, instructions, handoff };
}
