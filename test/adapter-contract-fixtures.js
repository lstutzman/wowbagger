export function describeRequest(overrides = {}) {
  return {
    bootstrap_wire_version: 1,
    supported_adapter_contract_versions: [1, 2],
    request_id: 'describe-request-0001',
    ...overrides,
  };
}

export function adapterManifest(overrides = {}) {
  return {
    adapter_manifest_version: 1,
    adapter_id: 'example.reference',
    adapter_version: '1.0.0',
    adapter_contract_versions: [2],
    bootstrap_wire_version: 1,
    required_core_contract_version: 4,
    entrypoints: {
      describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
      invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
    },
    platforms: { darwin: 'supported', linux: 'supported', win32: 'supported' },
    ...overrides,
  };
}

export function dynamicDescribe(overrides = {}) {
  return {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: 2,
    adapter_id: 'example.reference',
    adapter_version: '1.0.0',
    core: {
      required_core_contract_version: 4,
      commands: ['capabilities', 'create', 'inspect', 'patch', 'ready', 'transition', 'validate'],
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
    platforms: { darwin: 'supported', linux: 'supported', win32: 'supported' },
    ...overrides,
  };
}
