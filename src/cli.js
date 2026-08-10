import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coordinationScope, resolveWorkClaimCapability } from './claim-capabilities.js';
import { claimAcquire, claimRead, claimRelease, claimRenew } from './claim-operations.js';
import { validateClaimRequest } from './claim-request.js';
import { claimStorePath, readClaimState, resolveGitCommonDir, withClaimLock, writeClaimState } from './claim-store.js';
import { loadLedger } from './ledger.js';
import {
  createItem,
  inspectItem,
  patchItem,
  transitionItem,
  validateCreateRequest,
  validatePatchRequest,
  validateTransitionRequest,
} from './mutation.js';
import { mintId } from './mint.js';
import { provisionNamespace, readNamespace } from './namespace.js';
import { normalizeJsonValue, parseJsonRequest, sortIssues } from './request.js';
import { selectReady } from './ready.js';
import { isCalendarDate, validateLedger } from './validate.js';

const CLAIM_OPERATIONS = { read: claimRead, acquire: claimAcquire, renew: claimRenew, release: claimRelease };
const MUTATION_CONTRACT_VERSION = 2;

const DISTRIBUTION_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version;

const COMMAND_SUMMARIES = {
  validate: 'Validate a ledger and print the single JSON validation result.',
  ready: 'Validate a ledger and print the readiness queue for a date.',
  capabilities: "Describe the backend's capabilities and versioned contract surface.",
  inspect: 'Inspect one ledger item as a lossless raw-byte snapshot.',
  create: 'Create one ledger item through atomic, no-clobber publication.',
  transition: "Transition one item's lifecycle, guarded by lock and compare-and-swap.",
  patch: "Patch an item's number and priority fields, guarded the same way.",
  'mint-id': 'Mint a canonical item ID.',
  provision: 'Provision the work-claim namespace.',
  claim: 'Work-claim lifecycle operations on the provisioned store.',
  'publish-claimed': 'Publish claim-protected ledger results (unavailable on an advisory backend).',
};

const KNOWN_COMMANDS = new Set([
  'validate',
  'ready',
  'capabilities',
  'inspect',
  'create',
  'transition',
  'patch',
  'mint-id',
  'provision',
  'claim',
  'publish-claimed',
]);

const CLAIM_SUBCOMMAND_SUMMARIES = {
  capabilities: 'Describe the work-claim backend and its coordination scope.',
  read: 'Read the current claims from the provisioned store.',
  acquire: 'Acquire a cooperative work claim.',
  renew: 'Renew an existing work claim.',
  release: 'Release an owned work claim.',
};

export async function runCli(argumentsList, { scenario } = {}) {
  const command = argumentsList[0];

  if (command === '--help' || command === '-h') {
    process.stdout.write(globalHelp());
    return;
  }

  if (command === '--version' || command === '-v') {
    process.stdout.write(`${DISTRIBUTION_VERSION}\n`);
    return;
  }

  if (command === 'claim' && argumentsList[1] === '--help') {
    process.stdout.write(commandHelp('claim'));
    return;
  }

  if (KNOWN_COMMANDS.has(command) && argumentsList[1] === '--help') {
    process.stdout.write(commandHelp(command));
    return;
  }

  if (command === 'capabilities') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    process.stdout.write(`${JSON.stringify(await capabilities(parsedOptions.options.ledger))}\n`);
    return;
  }

  if (command === 'inspect') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const options = parsedOptions.options;
    const result = await inspectItem(options.ledger, options.id);
    if (result.validation) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        error: {
          code: 'ledger-invalid',
          message: 'The configured ledger is invalid.',
          details: { validation_errors: result.validation.errors },
        },
      })}\n`);
      process.exitCode = 3;
      return;
    }
    if (!result.item) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        error: {
          code: 'item-not-found',
          message: 'The requested item was not found.',
          details: { id: options.id },
        },
      })}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      result: { item: result.item },
    })}\n`);
    return;
  }

  if (command === 'create') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeInvalidRequest(command, [issue('/input', 'invalid-value', 'Request input could not be read.')]);
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    const issues = validateCreateRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await createItem(parsedOptions.options.ledger, parsedRequest.value, scenario));
    return;
  }

  if (command === 'transition') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeInvalidRequest(command, [issue('/input', 'invalid-value', 'Request input could not be read.')]);
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    const issues = validateTransitionRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await transitionItem(parsedOptions.options.ledger, parsedRequest.value, scenario));
    return;
  }

  if (command === 'mint-id') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const date = parsedOptions.options.date;
    if (date !== undefined && !isCalendarDate(date)) {
      writeInvalidRequest(command, [issue('/arguments', 'invalid-value', 'Argument --date must be an ISO calendar date.')]);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      result: { id: mintId(date ?? null) },
    })}\n`);
    return;
  }

  if (command === 'patch') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeInvalidRequest(command, [issue('/input', 'invalid-value', 'Request input could not be read.')]);
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    const issues = validatePatchRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await patchItem(parsedOptions.options.ledger, parsedRequest.value, scenario));
    return;
  }

  if (command === 'publish-claimed') {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'capability-unavailable',
        message: 'Claim-protected publication is unavailable on an advisory backend.',
        details: { reason: 'advisory-capability' },
      },
    })}\n`);
    process.exitCode = 2;
    return;
  }

  if (command === 'provision') {
    const parsedOptions = parseContractOptions('provision', argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const gitCommonDir = await resolveGitCommonDir(parsedOptions.options.ledger);
    if (!gitCommonDir) {
      writeClaimEnvelope(claimStoreUnavailable(command, 'git-directory-not-found'));
      return;
    }
    const { namespace } = await provisionNamespace(path.dirname(gitCommonDir));
    writeClaimEnvelope({
      exit: 0,
      stdout: {
        ok: true,
        namespace: 'work-claim',
        command,
        contract_version: 1,
        state: 'committed',
        result: { ledger_namespace: namespace },
      },
    });
    return;
  }

  if (command === 'claim') {
    const subcommand = argumentsList[1];

    if (subcommand === 'capabilities') {
      const parsedOptions = parseContractOptions('claim-capabilities', argumentsList.slice(2));
      if (parsedOptions.issues.length > 0) {
        writeClaimInvalidRequest(subcommand, parsedOptions.issues);
        return;
      }
      const gitCommonDir = await resolveGitCommonDir(parsedOptions.options.ledger);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        namespace: 'work-claim',
        command: subcommand,
        contract_version: 1,
        result: {
          backend: { name: 'local-filesystem', coordination_scope: coordinationScope({ gitCommonDir }) },
          operations: { work_claim: resolveWorkClaimCapability({ gitCommonDir }) },
        },
      })}\n`);
      return;
    }

    if (Object.hasOwn(CLAIM_OPERATIONS, subcommand)) {
      await runClaimCommand(subcommand, argumentsList.slice(2));
      return;
    }

    throw new Error(unknownCommandMessage(subcommand));
  }

  if (command !== 'validate' && command !== 'ready') {
    throw new Error(unknownCommandMessage(command));
  }

  const options = parseOptions(command, argumentsList.slice(1));
  const ledger = await loadLedger(options.ledger);
  const validation = validateLedger(ledger);

  if (command === 'validate' || !validation.valid) {
    process.stdout.write(`${JSON.stringify(validation)}\n`);
    if (!validation.valid) {
      process.exitCode = 1;
    }
    return;
  }

  const readyIds = selectReady(ledger.items, options.asOf);

  if (!options.json) {
    const byId = new Map(ledger.items.map((item) => [item.data.id, item.data]));
    const lines = readyIds.map((id) => {
      const data = byId.get(id);
      const number = Object.hasOwn(data, 'number') ? `#${data.number}` : '#-';
      const priority = Object.hasOwn(data, 'priority') ? `pri=${data.priority}` : 'pri=-';
      return `${number} ${priority} ${data.title}\n`;
    });
    process.stdout.write(lines.join(''));
    return;
  }

  const result = {
    as_of: options.asOf,
    valid: true,
    ready: readyIds,
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function capabilities(ledger) {
  const gitCommonDir = await resolveGitCommonDir(ledger ?? process.cwd());
  return {
    ok: true,
    command: 'capabilities',
    contract_version: MUTATION_CONTRACT_VERSION,
    result: {
      backend: {
        name: 'local-filesystem',
        coordination_scope: 'same-working-copy-cooperative-writers',
      },
      operations: {
        inspect: {
          supported: true,
          write_scope: 'none',
          cas_scope: 'none',
        },
        create: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'requested-id-lock',
          publication_visibility: 'atomic-no-clobber-or-fail',
          publication_probe: 'per-ledger-operation',
        },
        transition: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'exact-byte-sha256',
        },
        patch: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'exact-byte-sha256',
        },
        work_claim: resolveWorkClaimCapability({ gitCommonDir }),
      },
      durability: {
        temporary_file_sync: 'required-before-publication',
        directory_sync: 'best-effort-when-supported',
        post_publication_verification: 'exact-bytes-required',
        power_loss_guarantee: 'none',
      },
      limits: {
        multi_item_atomicity: false,
        cross_clone_coordination: false,
        cross_worktree_coordination: false,
        cross_machine_coordination: false,
        noncooperating_writer_protection: false,
        automatic_stale_lock_breaking: false,
      },
    },
  };
}

function parseOptions(command, argumentsList) {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--ledger') {
      if (options.ledger) {
        throw new Error(usage(command));
      }
      options.ledger = readOptionValue(command, argument, argumentsList, index);
      index += 1;
    } else if (argument === '--as-of' && command === 'ready') {
      if (options.asOf) {
        throw new Error(usage(command));
      }
      options.asOf = readOptionValue(command, argument, argumentsList, index);
      index += 1;
    } else if (argument === '--id' && command === 'inspect') {
      if (options.id) {
        throw new Error(usage(command));
      }
      options.id = readOptionValue(command, argument, argumentsList, index);
      index += 1;
    } else if (argument === '--input' && command === 'create') {
      if (options.input) {
        throw new Error(usage(command));
      }
      options.input = readOptionValue(command, argument, argumentsList, index);
      index += 1;
    } else if (argument === '--json') {
      if (options.json) {
        throw new Error(usage(command));
      }
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.ledger || (!options.json && command !== 'ready')
    || (command === 'inspect' && !options.id)
    || (command === 'create' && !options.input)
    || (command === 'ready' && !options.asOf)) {
    throw new Error(usage(command));
  }

  if (command === 'ready' && !isCalendarDate(options.asOf)) {
    throw new Error('--as-of must be an ISO calendar date.');
  }

  return options;
}

function parseContractOptions(command, argumentsList) {
  const options = {};
  const issues = [];
  const seen = new Set();
  const valueFlags = command === 'inspect'
    ? new Map([['--ledger', 'ledger'], ['--id', 'id']])
    : command === 'create' || command === 'transition' || command === 'patch'
      || command === 'claim-read' || command === 'claim-acquire' || command === 'claim-renew' || command === 'claim-release'
      ? new Map([['--ledger', 'ledger'], ['--input', 'input']])
      : command === 'provision' || command === 'claim-capabilities'
        ? new Map([['--ledger', 'ledger']])
        : command === 'mint-id'
          ? new Map([['--date', 'date']])
          : new Map();
  const optionalFlags = command === 'mint-id' ? new Set(['--date']) : new Set();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--json') {
      if (seen.has(argument)) {
        issues.push(argumentIssue(index + 1, 'repeated-argument', 'Argument --json must not be repeated.'));
      }
      seen.add(argument);
      options.json = true;
      continue;
    }
    if (!valueFlags.has(argument)) {
      issues.push(argumentIssue(index + 1, 'unknown-argument', `Argument ${argument} is not recognized.`));
      continue;
    }
    const key = valueFlags.get(argument);
    if (seen.has(argument)) {
      issues.push(argumentIssue(index + 1, 'repeated-argument', `Argument ${argument} must not be repeated.`));
      const repeatedValue = argumentsList[index + 1];
      if (repeatedValue && !repeatedValue.startsWith('--')) {
        index += 1;
      }
      continue;
    }
    seen.add(argument);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
      issues.push(argumentIssue(index + 1, 'missing-argument', `Argument ${argument} requires a value.`));
      continue;
    }
    options[key] = value;
    index += 1;
  }
  for (const [flag] of valueFlags) {
    if (!seen.has(flag) && !optionalFlags.has(flag)) {
      issues.push(argumentIssue(-1, 'missing-argument', `Argument ${flag} is required.`));
    }
  }
  if (!seen.has('--json')) {
    issues.push(argumentIssue(-1, 'missing-argument', 'Argument --json is required.'));
  }
  return { options, issues: sortIssues(issues) };
}

function argumentIssue(index, code, message) {
  return {
    path: index < 0 ? '/arguments' : `/arguments/${index}`,
    code,
    message,
  };
}

function writeInvalidRequest(command, issues) {
  const outcome = {
    ok: false,
    exit: 2,
    state: 'unchanged',
    error: {
      code: 'invalid-request',
      message: `The ${command} request is invalid.`,
      details: { issues },
    },
  };
  if (command === 'create' || command === 'transition' || command === 'patch') {
    writeMutation(command, outcome);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    ok: false,
    command,
    contract_version: MUTATION_CONTRACT_VERSION,
    error: outcome.error,
  })}\n`);
  process.exitCode = outcome.exit;
}

function issue(pathValue, code, message) {
  return { path: pathValue, code, message };
}

function writeMutation(command, outcome) {
  const envelope = outcome.ok
    ? {
      ok: true,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      state: outcome.state,
      result: { item: outcome.item },
    }
    : {
      ok: false,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      state: outcome.state,
      error: outcome.error,
    };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = outcome.exit;
}

async function runClaimCommand(claimCommand, argumentsList) {
  const parsedOptions = parseContractOptions(`claim-${claimCommand}`, argumentsList);
  if (parsedOptions.issues.length > 0) {
    writeClaimInvalidRequest(claimCommand, parsedOptions.issues);
    return;
  }

  let bytes;
  try {
    bytes = await requestSource(parsedOptions.options.input);
  } catch {
    writeClaimInvalidRequest(claimCommand, [issue('/input', 'invalid-value', 'Request input could not be read.')]);
    return;
  }
  const parsedRequest = parseJsonRequest(bytes);
  if (parsedRequest.issues.length > 0) {
    writeClaimInvalidRequest(claimCommand, parsedRequest.issues);
    return;
  }
  // normalizeJsonValue rebuilds the whole tree into plain objects/arrays with
  // every JsonNumber unwrapped. The rebuild is load-bearing here beyond the
  // schema check: claim-operations.js compares CAS witnesses with
  // isDeepStrictEqual, which treats a null-prototype object as unequal to an
  // Object.prototype one even with identical properties, so an un-rebuilt
  // nested object silently fails every takeover comparison.
  const request = normalizeJsonValue(parsedRequest.value);
  const validationIssues = validateClaimRequest(claimCommand, request);
  if (validationIssues.length > 0) {
    writeClaimInvalidRequest(claimCommand, validationIssues);
    return;
  }

  const gitCommonDir = await resolveGitCommonDir(parsedOptions.options.ledger);
  if (!gitCommonDir) {
    writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'git-directory-not-found'));
    return;
  }

  const namespace = await readNamespace(path.dirname(gitCommonDir));
  if (request.ledger_namespace !== namespace) {
    writeClaimEnvelope({
      exit: 2,
      stdout: {
        ok: false,
        namespace: 'work-claim',
        command: claimCommand,
        contract_version: 1,
        state: 'unchanged',
        error: {
          code: 'ledger-namespace-unbound',
          message: 'The ledger namespace is not provisioned for this endpoint.',
          details: { requested_namespace: request.ledger_namespace, provisioned_namespace: namespace },
        },
      },
    });
    return;
  }

  const storePath = claimStorePath(gitCommonDir, namespace);
  const operation = CLAIM_OPERATIONS[claimCommand];
  try {
    const envelope = await withClaimLock(storePath, async () => {
      let state;
      try {
        state = await readClaimState(storePath, namespace);
      } catch (error) {
        throw taggedFailure('CLAIM_STORE_UNREADABLE', error);
      }
      const applied = operation(state, request, new Date().toISOString());
      try {
        await writeClaimState(storePath, applied.state);
      } catch (error) {
        throw taggedFailure('CLOCK_FLOOR_PERSISTENCE_FAILED', error);
      }
      return applied.envelope;
    });
    writeClaimEnvelope(envelope);
  } catch (error) {
    if (error?.code === 'CLAIM_LOCK_HELD') {
      writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'claim-store-locked'));
      return;
    }
    if (error?.code === 'CLAIM_STORE_UNREADABLE') {
      writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'claim-store-unreadable'));
      return;
    }
    if (error?.code === 'CLOCK_FLOOR_PERSISTENCE_FAILED') {
      writeClaimEnvelope({
        exit: 6,
        stdout: {
          ok: false,
          namespace: 'work-claim',
          command: claimCommand,
          contract_version: 1,
          state: 'unchanged',
          error: {
            code: 'clock-floor-persistence-failed',
            message: 'The authoritative clock floor could not be persisted.',
            details: {},
          },
        },
      });
      return;
    }
    throw error;
  }
}

function taggedFailure(code, cause) {
  const failure = new Error(code);
  failure.code = code;
  failure.cause = cause;
  return failure;
}

function claimStoreUnavailable(command, reason) {
  return {
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'claim-store-unavailable',
        message: 'The durable claim store is unavailable.',
        details: { reason },
      },
    },
  };
}

function writeClaimEnvelope(envelope) {
  process.stdout.write(`${JSON.stringify(envelope.stdout)}\n`);
  process.exitCode = envelope.exit;
}

function writeClaimInvalidRequest(claimCommand, issues) {
  writeClaimEnvelope({
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: claimCommand,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'invalid-request',
        message: `The ${claimCommand} request is invalid.`,
        details: { issues },
      },
    },
  });
}

function readOptionValue(command, option, argumentsList, index) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(usage(command));
  }
  return value;
}

function usage(command) {
  if (command === 'validate') {
    return 'Usage: wowbagger validate --ledger <dir> --json';
  }

  if (command === 'ready') {
    return 'Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD [--json]';
  }

  if (command === 'capabilities') {
    return 'Usage: wowbagger capabilities --json';
  }

  if (command === 'provision') {
    return 'Usage: wowbagger provision --ledger <dir> --json';
  }

  if (command === 'publish-claimed') {
    return 'Usage: wowbagger publish-claimed';
  }

  if (command === 'claim') {
    return 'Usage: wowbagger claim <read|acquire|renew|release|capabilities> [options]';
  }

  if (command === 'inspect') {
    return 'Usage: wowbagger inspect --ledger <dir> --id <id> --json';
  }

  if (command === 'create') {
    return 'Usage: wowbagger create --ledger <dir> --input <json-file|-> --json';
  }

  if (command === 'transition') {
    return 'Usage: wowbagger transition --ledger <dir> --input <json-file|-> --json';
  }

  if (command === 'patch') {
    return 'Usage: wowbagger patch --ledger <dir> --input <json-file|-> --json';
  }

  if (command === 'mint-id') {
    return 'Usage: wowbagger mint-id [--date YYYY-MM-DD] --json';
  }

  return 'Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD [--json]';
}

function globalHelp() {
  return [
    'wowbagger — standalone Markdown ledger validation, readiness selection, and guarded local mutations.',
    '',
    'Usage:',
    '  wowbagger <command> [options]',
    '  wowbagger --help',
    '  wowbagger --version',
    '',
    'Commands:',
    ...Object.keys(COMMAND_SUMMARIES).map((name) => (
      `  ${name.padEnd(12)} ${COMMAND_SUMMARIES[name]}`
    )),
    '',
    "Run 'wowbagger <command> --help' for the usage of a specific command.",
    '',
  ].join('\n');
}

function commandHelp(command) {
  const header = COMMAND_SUMMARIES[command]
    ? `wowbagger ${command} — ${COMMAND_SUMMARIES[command]}`
    : `wowbagger ${command}`;

  if (command === 'claim') {
    return [
      header,
      '',
      'Usage:',
      '  wowbagger claim <read|acquire|renew|release|capabilities> [options]',
      '',
      'Subcommands:',
      ...Object.keys(CLAIM_SUBCOMMAND_SUMMARIES).map((name) => (
        `  ${name.padEnd(12)} ${CLAIM_SUBCOMMAND_SUMMARIES[name]}`
      )),
      '',
    ].join('\n');
  }

  return [
    header,
    '',
    `${usage(command)}`,
    '',
  ].join('\n');
}

function unknownCommandMessage(command) {
  const suggestion = closestCommand(command);
  if (suggestion) {
    return `Unknown command: ${command}\nDid you mean wowbagger ${suggestion}?`;
  }
  return `Unknown command: ${command}. Run 'wowbagger --help' for the command inventory.`;
}

function closestCommand(command) {
  let best = null;
  let bestDistance = Infinity;
  for (const name of KNOWN_COMMANDS) {
    const distance = editDistance(command, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return bestDistance <= 2 ? best : null;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

async function requestSource(input) {
  if (input === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const { readFile } = await import('node:fs/promises');
  return readFile(input);
}
