#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readBootstrapRequest, writeBootstrapResponse } from '../../src/adapter/bootstrap.js';
import { describeAdapter } from '../../src/adapter/describe.js';
import { validateAdapterManifest } from '../../src/adapter/manifest.js';

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

// §3.1: the package's own manifest is validated before it is advertised.
const validated = validateAdapterManifest(manifest);
if (!validated.ok) {
  await writeBootstrapResponse(process.stdout, { ok: false, error: { code: validated.error_code } });
  process.exit(0);
}

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
