import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  launchCoreProcess,
  runAdapterEntrypoint as runProductionEntrypoint,
  standardDynamicResult,
} from '../src/adapter/entrypoint-main.js?conformance-real';
import { normalizeJsonValue, parseJsonRequest } from '../src/request.js';

export { launchCoreProcess, standardDynamicResult };

async function loadRuntimeConfig() {
  const runtimeConfigPath = process.env.WOWBAGGER_ADAPTER_RUNTIME_CONFIG_PATH;
  if (!runtimeConfigPath) throw new Error('conformance runtime config is required');
  const parsed = parseJsonRequest(await readFile(runtimeConfigPath));
  if (parsed.issues.length > 0) throw new Error('conformance runtime config must be strict JSON');
  const config = normalizeJsonValue(parsed.value);
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('conformance runtime config must be an object');
  }
  return config;
}

export async function runAdapterEntrypoint(options) {
  const runtimeConfig = await loadRuntimeConfig();
  if (runtimeConfig.probe_forbidden_core_launch) {
    await launchCoreProcess({
      executable: fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url)),
      argv: ['capabilities', '--json'],
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      input: Buffer.alloc(0),
      limits: { stdout_bytes: 1048576, stderr_bytes: 65536, timeout_ms: 30000 },
    });
  }
  if (runtimeConfig.probe_forbidden_core_launch_sync) {
    spawnSync(process.execPath, [
      fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url)),
      'capabilities',
      '--json',
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  }
  const dynamicResult = Object.hasOwn(runtimeConfig, 'dynamic_result')
    ? () => structuredClone(runtimeConfig.dynamic_result)
    : options.dynamicResult;
  const launch = Object.hasOwn(runtimeConfig, 'process_observation')
    ? async () => structuredClone(runtimeConfig.process_observation)
    : runtimeConfig.forbid_core_launch
      ? async () => { throw new Error('core launch forbidden by conformance scenario'); }
      : undefined;

  await runProductionEntrypoint({
    ...options,
    dynamicResult,
    coreProbe: runtimeConfig.core_probe,
    launch,
    hostRuntime: conformanceHostRuntime(runtimeConfig),
  });
}

// A conformance host that wires the code-level approval provider. Only the
// declining provider exists: it is what separates "this host cannot approve at
// all" from "this host can approve and did not approve this invocation", the
// two refusals case 07 pins. An unknown mode is a fixture defect, refused
// rather than silently downgraded to no provider at all.
function conformanceHostRuntime(runtimeConfig) {
  if (!Object.hasOwn(runtimeConfig, 'host_approval')) return undefined;
  if (runtimeConfig.host_approval !== 'decline') {
    throw new Error(`unknown conformance host_approval mode ${runtimeConfig.host_approval}`);
  }
  return {
    approval: () => null,
    now: () => '2030-01-15T12:01:00Z',
    redeemedNonces: new Set(),
    coreExecutableIdentity: `sha256:${'a'.repeat(64)}`,
  };
}
