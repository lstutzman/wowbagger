#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonNumber, parseJsonRequest } from '../src/request.js';

const defaultFixtureRoot = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));

const SUPPORTED_ASSERTION_TYPES = new Set([
  'core-baseline', 'capability', 'instruction-order', 'path-refusal',
  'output-bound', 'approval-gate', 'resume-plan', 'platform-status',
  'process-outcome', 'path-race', 'path-syntax', 'snapshot-identity',
  'entrypoint-path', 'invoke-version', 'core-probe', 'negotiation',
  'context-validation', 'approval-schema',
]);

export async function runImplementationVectors({
  fixtureRoot = defaultFixtureRoot,
  entrypoint,
  platform,
} = {}) {
  const directories = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const cases = [];
  for (const name of directories) {
    const parsed = parseJsonRequest(
      await readFile(path.join(fixtureRoot, name, 'manifest.json')),
    );
    const manifest = parsed.value;
    const version = manifest.adapter_vector_version;
    const isVersionOne = version === 1 || (version instanceof JsonNumber && version.source === '1');
    if (!isVersionOne) {
      throw new Error(`unsupported adapter_vector_version in ${name}`);
    }
    if (!manifest.targets.includes('claude-code')) {
      continue;
    }
    for (const assertion of manifest.assertions) {
      if (!SUPPORTED_ASSERTION_TYPES.has(assertion.type)) {
        throw new Error(`unknown assertion type ${assertion.type} in ${name}`);
      }
    }
    cases.push({
      case: manifest.case,
      status: 'fail',
      executed_mode: manifest.mode,
      executed_assertions: manifest.assertions.map((assertion) => assertion.id),
      assertion_evidence: manifest.assertions.map((assertion) => ({
        id: assertion.id,
        evidence: 'unimplemented',
      })),
      observed_error_codes: [],
    });
  }

  return {
    status: 'fail',
    implementations: { 'claude-code': 'fail' },
    evidence_platform: platform,
    observed_error_codes: [],
    cases,
  };
}
