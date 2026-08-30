import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const SKILL_DISTRIBUTION = /requires distribution version[\s`*:-]+`([^`]+)`/u;
const SKILL_CONTRACT = /core[\s`*:-]+`contract_version:\s*(\d+)`/u;

export async function inspectVersionDrift({
  skillPath,
  packagePath,
  runningDistribution,
  runningContractVersion,
}) {
  let skillSource;
  let packageManifest;
  try {
    [skillSource, packageManifest] = await Promise.all([
      readFile(skillPath, 'utf8'),
      readFile(packagePath, 'utf8').then((source) => JSON.parse(source)),
    ]);
  } catch {
    return unavailable('Could not read the skill or core package metadata.', {
      skill_path: skillPath,
      package_path: packagePath,
    });
  }
  const distribution = SKILL_DISTRIBUTION.exec(skillSource)?.[1] ?? null;
  const contract = Number(SKILL_CONTRACT.exec(skillSource)?.[1] ?? NaN);
  const requiredDistribution = packageManifest.version;
  const requiredContract = 5;
  const details = {
    installed_distribution: distribution,
    required_distribution: requiredDistribution,
    running_distribution: runningDistribution ?? requiredDistribution,
    installed_contract_version: Number.isSafeInteger(contract) ? contract : null,
    required_contract_version: requiredContract,
    running_contract_version: runningContractVersion ?? requiredContract,
    provenance: await classifyProvenance(skillPath),
  };
  const drift = details.installed_distribution !== details.required_distribution
    || details.running_distribution !== details.required_distribution
    || details.installed_contract_version !== details.required_contract_version
    || details.running_contract_version !== details.required_contract_version;
  if (drift) {
    return {
      exit: 4,
      stdout: {
        ok: false,
        command: 'version-drift',
        contract_version: requiredContract,
        error: {
          code: 'version-drift-detected',
          message: 'The installed skill and running core do not satisfy the required versions.',
          details: {
            ...details,
            remediation: 'Update the skill package or linked checkout, then rerun version-drift before mutation.',
          },
        },
      },
    };
  }
  return {
    exit: 0,
    stdout: {
      ok: true,
      command: 'version-drift',
      contract_version: requiredContract,
      result: details,
    },
  };
}

async function classifyProvenance(skillPath) {
  try {
    const info = await lstat(skillPath);
    if (info.isSymbolicLink()) {
      return { kind: 'global-link', path: skillPath };
    }
  } catch {
    return { kind: 'unknown', path: skillPath };
  }
  const normalized = path.resolve(skillPath).split(path.sep).join('/');
  if (normalized.includes('/node_modules/')) return { kind: 'registry-package', path: skillPath };
  if (normalized.includes('/.claude/plugins/cache/')) return { kind: 'plugin-cache', path: skillPath };
  if (normalized.includes('/.git/')) return { kind: 'git-tag', path: skillPath };
  return { kind: 'direct-path', path: skillPath };
}

function unavailable(message, details) {
  return {
    exit: 5,
    stdout: {
      ok: false,
      command: 'version-drift',
      contract_version: 5,
      error: { code: 'version-drift-unavailable', message, details },
    },
  };
}
