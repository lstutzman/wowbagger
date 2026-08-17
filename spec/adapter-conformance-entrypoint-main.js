import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
    // Passing `coreProbe: undefined` would override the production default and
    // silence the live probe. A scenario that declares no probe result gets the
    // production behaviour: launch the real core and read its capabilities.
    ...(Object.hasOwn(runtimeConfig, 'core_probe') ? { coreProbe: runtimeConfig.core_probe } : {}),
    launch,
    hostRuntime: conformanceHostRuntime(runtimeConfig),
  });
}

// A conformance host that wires the code-level approval provider. Two modes
// exist. `decline` is a host that CAN approve and did not approve this
// invocation — what separates `consumer-approval-required` from the bare
// entrypoint's `capability-unavailable`, the two refusals case 07 pins.
// `grant` is a host that really approves, and it exists only so the
// end-to-end core-outcome vectors can carry a mutation through the production
// engine into the real core (case 16). An unknown mode is a fixture defect,
// refused rather than silently downgraded to no provider at all.
//
// This is a conformance host, not a live consumer. Evidence it produces is
// "the production adapter engine under a conformance host approval provider",
// never "a live consumer approval mechanism" — adapter contract section 10
// says so in the same words.
function conformanceHostRuntime(runtimeConfig) {
  if (!Object.hasOwn(runtimeConfig, 'host_approval')) return undefined;
  if (runtimeConfig.host_approval === 'decline') {
    return {
      approval: () => null,
      now: () => '2030-01-15T12:01:00Z',
      redeemedNonces: new Set(),
      coreExecutableIdentity: `sha256:${'a'.repeat(64)}`,
    };
  }
  if (runtimeConfig.host_approval !== 'grant') {
    throw new Error(`unknown conformance host_approval mode ${runtimeConfig.host_approval}`);
  }
  return grantingHostRuntime();
}

// The binding an approval covers — argv, the absolute temp workspace paths,
// the instruction and handoff digests — does not exist until the adapter has
// resolved it, so the approval is minted from that binding, here, in this
// process. Nothing about it is reachable from the bootstrap request.
//
// The digest is canonicalized by the independent reference model. A shipped
// canonicalizer that drifted would then refuse its own approval instead of
// quietly agreeing with itself.
function grantingHostRuntime() {
  const canonicalNow = (offsetSeconds) => new Date(
    Math.floor(Date.now() / 1000) * 1000 + offsetSeconds * 1000,
  ).toISOString().replace('.000Z', 'Z');
  const issuedAt = canonicalNow(0);
  const expiresAt = canonicalNow(300);
  const redeemedNonces = new Set();
  let minted = 0;
  return {
    now: () => issuedAt,
    redeemedNonces,
    coreExecutableIdentity: coreExecutableDigest(),
    approval: async ({ binding }) => {
      const { canonicalInvocationDigest } = await import('./adapter-reference.js');
      minted += 1;
      return {
        approval_version: 1,
        source: 'consumer',
        nonce: `conformance-host-approval-${String(minted).padStart(4, '0')}`,
        issued_at: issuedAt,
        expires_at: expiresAt,
        invocation_digest: canonicalInvocationDigest(binding).digest,
      };
    },
  };
}

// The identity the host attests for the executable the adapter is about to
// launch. `runAdapterEntrypoint` defaults the core executable to the package's
// own `bin/wowbagger.js`, and no shipped adapter overrides it.
function coreExecutableDigest() {
  const executable = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
  return `sha256:${createHash('sha256').update(readFileSync(executable)).digest('hex')}`;
}
