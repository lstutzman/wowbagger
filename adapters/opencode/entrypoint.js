#!/usr/bin/env node
import { CORE_COMMAND_ORDER } from '../../src/adapter/core-probe.js';
import { runAdapterEntrypoint } from '../../src/adapter/entrypoint-main.js';

// The honest host declaration for the opencode harness.
// The values match the other adapters because every declaration
// describe this adapter's own launch discipline — argv-array core launch
// without a shell, guarded-relative workspace selection, host-provided
// instructions — which holds identically under opencode. They may diverge as
// platform evidence accumulates; each adapter owns its declaration.
function dynamicResult(manifest) {
  return {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: 1,
    adapter_id: manifest.adapter_id,
    adapter_version: manifest.adapter_version,
    core: {
      required_core_contract_version: 1,
      commands: [...CORE_COMMAND_ORDER],
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

await runAdapterEntrypoint({
  manifestUrl: new URL('./wowbagger-adapter.json', import.meta.url),
  dynamicResult,
});
process.exit(0);
