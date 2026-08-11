// Single source of truth for the ship-side Invoke refusal messages. The
// reference model's `OUTER_ERROR_MESSAGES` in spec/adapter-reference.js
// documents the same text; a test pins the two sides so a divergence turns
// red instead of silently diverging the wire from the reference model.
// (Item 39: the message used to exist as a bare literal in the entrypoint
// and in two tables, with nothing pinning it.)
export const INVOKE_MESSAGES = Object.freeze({
  'capability-unavailable': 'The configured host cannot invoke the Wowbagger core.',
  'consumer-approval-required': 'The consumer must approve this ledger mutation.',
  'invalid-invocation': 'The adapter invocation is invalid.',
  'mutation-outcome-unknown': 'The mutation may have been applied; inspect current state before retrying.',
  'output-limit-exceeded': 'The core output exceeded the requested bound.',
  'path-rejected': 'The requested ledger path is not a guarded real directory.',
  'path-replaced': 'A guarded path component changed before core launch.',
});
