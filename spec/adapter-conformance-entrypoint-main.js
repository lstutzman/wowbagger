import { readFile } from 'node:fs/promises';
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
  });
}
