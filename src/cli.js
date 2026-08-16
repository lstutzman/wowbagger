import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveClaimBackend, resolveWorkClaimCapability } from './claim-capabilities.js';
import {
  appendClaimEntry,
  claimJournalPath,
  claimReconcileLogPath,
  replayClaimJournal,
  writeReconcileLog,
} from './claim-journal.js';
import { claimAcquire, claimRead, claimRelease, claimRenew } from './claim-operations.js';
import {
  publishClaimed,
  reconcileClaimJournal,
  readPublicationOutcome,
  validatePublicationReadRequest,
  validatePublicationRequest,
  verifyClaimJournal,
} from './claim-publication.js';
import { validateClaimRequest } from './claim-request.js';
import {
  claimStorePath,
  resolveGitCommonDir,
  resolveVerifiedGitCommonDir,
  withClaimLock,
  writeClaimState,
} from './claim-store.js';
import { loadLedger } from './ledger.js';
import {
  assertReportOutputOutsideLedger,
  buildReportModel,
  loadReportConfig,
  readLogoDataUrl,
  writeReportFile,
} from './report.js';
import { renderReportHtml } from './report-html.js';
import {
  createItem,
  inspectItem,
  inspectItemByNumber,
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

const MAX_PUBLICATION_REQUEST_BYTES = 11 * 1024 * 1024;
const DISTRIBUTION_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version;

const COMMAND_SUMMARIES = {
  validate: 'Validate a ledger and print the single JSON validation result.',
  ready: 'Validate a ledger and print the readiness queue for a date.',
  report: 'Render one validated ledger as a self-contained HTML report.',
  capabilities: 'Describe the core contract and unbound default claim profile.',
  inspect: 'Inspect one ledger item as a lossless raw-byte snapshot.',
  create: 'Create one ledger item through atomic, no-clobber publication.',
  transition: "Transition one item's lifecycle, guarded by lock and compare-and-swap.",
  patch: "Patch an item's priority and relation lists, guarded the same way.",
  'mint-id': 'Mint a canonical item ID.',
  provision: 'Provision the work-claim namespace.',
  claim: 'Work-claim lifecycle operations on the provisioned store.',
  'publish-claimed': 'Publish ledger results when its claim profile enables protected publication.',
  'claim-verify': 'Reconcile pending and committed claim-protected publications.',
};

const KNOWN_COMMANDS = new Set([
  'validate',
  'ready',
  'report',
  'capabilities',
  'inspect',
  'create',
  'transition',
  'patch',
  'mint-id',
  'provision',
  'claim',
  'publish-claimed',
  'claim-verify',
]);

const CLAIM_SUBCOMMAND_SUMMARIES = {
  capabilities: "Describe the provisioned ledger's work-claim profile.",
  read: 'Read the current claims from the provisioned store.',
  acquire: 'Acquire a cooperative work claim.',
  renew: 'Renew an existing work claim.',
  release: 'Release an owned work claim.',
  verify: 'Read a durable claimed-publication outcome.',
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

  if (command === 'report') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.options.asOf !== undefined
      && !isCalendarDate(parsedOptions.options.asOf)) {
      parsedOptions.issues.push(argumentIssue(-1, 'invalid-value', 'Argument --as-of must be an ISO calendar date.'));
    }
    parsedOptions.issues = sortIssues(parsedOptions.issues);
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    await runReportCommand(parsedOptions.options);
    return;
  }

  if (command === 'inspect') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const options = parsedOptions.options;
    let result;
    let selectorDetails;
    if (options.number !== undefined) {
      const parsedNumber = Number(options.number);
      if (!Number.isSafeInteger(parsedNumber) || parsedNumber < 1) {
        writeInvalidRequest(command, [issue('/arguments', 'invalid-value', 'Argument --number must be a positive integer.')]);
        return;
      }
      result = await inspectItemByNumber(options.ledger, parsedNumber);
      selectorDetails = { number: parsedNumber };
    } else {
      result = await inspectItem(options.ledger, options.id);
      selectorDetails = { id: options.id };
    }
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
          details: selectorDetails,
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

  if (command === 'claim-verify') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const ledgerDirectory = parsedOptions.options.ledger;
    const gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory);
    const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
    const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
    if (!capability.claim_protected_publication) {
      writeClaimEnvelope(claimStoreUnavailable(command,
        gitCommonDir ? 'ledger-namespace-unbound' : 'git-directory-not-found'));
      return;
    }
    writeClaimEnvelope(await verifyClaimJournal({
      ledgerDirectory,
      gitCommonDir,
      namespace,
    }));
    return;
  }

  if (command === 'publish-claimed') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writePublicationInvalidRequest(null, 'The request does not match publish-claimed version 1.', {
        issues: parsedOptions.issues,
      });
      return;
    }
    const gitCommonDir = await resolveVerifiedGitCommonDir(parsedOptions.options.ledger);
    const namespace = gitCommonDir ? await readNamespace(parsedOptions.options.ledger) : null;
    const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
    if (!capability.claim_protected_publication) {
      writeClaimEnvelope({
        exit: 2,
        stdout: {
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
        },
      });
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input, MAX_PUBLICATION_REQUEST_BYTES);
    } catch {
      writePublicationInvalidRequest(null, 'The request does not match publish-claimed version 1.', {
        field: 'input',
      });
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    if (parsedRequest.issues.length > 0) {
      writePublicationInvalidRequest(null, 'The request is not unique-key UTF-8 JSON.', {
        issues: parsedRequest.issues,
      });
      return;
    }
    const request = normalizeJsonValue(parsedRequest.value);
    const invalid = validatePublicationRequest(request);
    if (invalid) {
      writeClaimEnvelope(invalid);
      return;
    }
    writeClaimEnvelope(await publishClaimed({
      ledgerDirectory: parsedOptions.options.ledger,
      gitCommonDir,
      namespace,
      request,
      scenario,
    }));
    return;
  }

  if (command === 'provision') {
    const parsedOptions = parseContractOptions('provision', argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const gitCommonDir = await resolveVerifiedGitCommonDir(parsedOptions.options.ledger);
    if (!gitCommonDir) {
      writeClaimEnvelope(claimStoreUnavailable(command, 'git-directory-not-found'));
      return;
    }
    const { namespace } = await provisionNamespace(parsedOptions.options.ledger);
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
      const gitCommonDir = await resolveVerifiedGitCommonDir(parsedOptions.options.ledger);
      const namespace = gitCommonDir ? await readNamespace(parsedOptions.options.ledger) : null;
      process.stdout.write(`${JSON.stringify({
        ok: true,
        namespace: 'work-claim',
        command: subcommand,
        contract_version: 1,
        result: {
          backend: resolveClaimBackend({ gitCommonDir, namespace }),
          operations: { work_claim: resolveWorkClaimCapability({ gitCommonDir, namespace }) },
        },
      })}\n`);
      return;
    }

    if (subcommand === 'verify') {
      await runPublicationReadCommand(argumentsList.slice(2));
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

async function runReportCommand(options) {
  const ledger = await loadLedger(options.ledger);
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    writeReportFailure('ledger-invalid', 'The configured ledger is invalid.', {
      errors: validation.errors,
    }, 1);
    return;
  }

  try {
    const config = await loadReportConfig(options.ledger, options.out);
    const model = buildReportModel(ledger.items, config, options.asOf);
    const logoDataUrl = await readLogoDataUrl(config.repository.logo);
    const html = renderReportHtml(model, { logoDataUrl });
    await assertReportOutputOutsideLedger(options.ledger, config.outputPath);
    await writeReportFile(config.outputPath, html);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command: 'report',
      contract_version: MUTATION_CONTRACT_VERSION,
      result: {
        report_version: config.reportVersion,
        as_of: options.asOf,
        output: config.outputPath,
        item_count: ledger.items.length,
        ready_count: selectReady(ledger.items, options.asOf).length,
      },
    })}\n`);
  } catch (error) {
    const code = error?.code === 'report-config-invalid'
      || error?.code === 'report-read-failed'
      || error?.code === 'report-write-failed'
      ? error.code
      : 'report-write-failed';
    const exit = code === 'report-config-invalid' ? 2 : 1;
    const details = code === 'report-config-invalid'
      ? { issues: [issue('/configuration', code, error?.message ?? 'Report configuration is invalid.')] }
      : error?.details ?? {};
    writeReportFailure(code, reportFailureMessage(code), details, exit);
  }
}

function reportFailureMessage(code) {
  if (code === 'report-config-invalid') {
    return 'The report configuration is invalid.';
  }
  if (code === 'report-read-failed') {
    return 'A report input could not be read.';
  }
  return 'The report could not be published.';
}

function writeReportFailure(code, message, details, exit) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    command: 'report',
    contract_version: MUTATION_CONTRACT_VERSION,
    error: { code, message, details },
  })}\n`);
  process.exitCode = exit;
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
    ? new Map([['--ledger', 'ledger'], ['--id', 'id'], ['--number', 'number']])
    : command === 'report'
      ? new Map([['--ledger', 'ledger'], ['--as-of', 'asOf'], ['--out', 'out']])
      : command === 'create' || command === 'transition' || command === 'patch'
        || command === 'publish-claimed' || command === 'publication-read'
        || command === 'claim-read' || command === 'claim-acquire' || command === 'claim-renew'
        || command === 'claim-release'
        ? new Map([['--ledger', 'ledger'], ['--input', 'input']])
        : command === 'provision' || command === 'claim-capabilities' || command === 'claim-verify'
          ? new Map([['--ledger', 'ledger']])
          : command === 'mint-id'
            ? new Map([['--date', 'date']])
            : new Map();
  const optionalFlags = command === 'mint-id'
    ? new Set(['--date'])
    : command === 'report'
      ? new Set(['--out'])
      : command === 'inspect'
        ? new Set(['--id', '--number'])
        : new Set();
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
  if (command === 'inspect' && seen.has('--id') === seen.has('--number')) {
    issues.push(argumentIssue(
      -1,
      seen.has('--id') ? 'conflicting-argument' : 'missing-argument',
      'Exactly one of --id or --number is required.',
    ));
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
  if (outcome.stdout) {
    writeClaimEnvelope(outcome);
    return;
  }
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


async function runPublicationReadCommand(argumentsList) {
  const parsedOptions = parseContractOptions('publication-read', argumentsList);
  if (parsedOptions.issues.length > 0) {
    writePublicationInvalidRequest(null, 'The request does not match ledger-publication.read version 1.', {
      issues: parsedOptions.issues,
    });
    return;
  }
  let bytes;
  try {
    bytes = await requestSource(parsedOptions.options.input);
  } catch {
    writePublicationInvalidRequest(null, 'The request does not match ledger-publication.read version 1.', {
      field: 'input',
    });
    return;
  }
  const parsedRequest = parseJsonRequest(bytes);
  const request = normalizeJsonValue(parsedRequest.value);
  const invalid = parsedRequest.issues.length > 0
    ? {
        exit: 2,
        stdout: {
          ok: false,
          namespace: 'ledger-publication',
          command: 'read',
          contract_version: 1,
          state: 'unchanged',
          error: {
            code: 'invalid-request',
            message: 'The request is not unique-key UTF-8 JSON.',
            details: { issues: parsedRequest.issues },
          },
        },
      }
    : validatePublicationReadRequest(request);
  if (invalid) {
    writeClaimEnvelope(invalid);
    return;
  }
  const gitCommonDir = await resolveVerifiedGitCommonDir(parsedOptions.options.ledger);
  const namespace = gitCommonDir ? await readNamespace(parsedOptions.options.ledger) : null;
  if (!gitCommonDir || request.ledger_namespace !== namespace) {
    writeClaimEnvelope({
      exit: 2,
      stdout: {
        ok: false,
        namespace: 'ledger-publication',
        command: 'read',
        contract_version: 1,
        state: 'unchanged',
        operation_id: request.operation_id,
        error: {
          code: 'ledger-namespace-unbound',
          message: 'The ledger namespace is not provisioned for this endpoint.',
          details: {
            ledger_namespace: request.ledger_namespace,
            item_id: request.item_id,
          },
        },
      },
    });
    return;
  }
  writeClaimEnvelope(await readPublicationOutcome({ gitCommonDir, namespace, request }));
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

  const gitCommonDir = await resolveVerifiedGitCommonDir(parsedOptions.options.ledger);
  if (!gitCommonDir) {
    writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'git-directory-not-found'));
    return;
  }

  const namespace = await readNamespace(parsedOptions.options.ledger);
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
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  const operation = CLAIM_OPERATIONS[claimCommand];
  if (claimCommand === 'read') {
    try {
      const replayed = await replayClaimJournal(journalPath, namespace);
      writeClaimEnvelope(operation(replayed.state, request, new Date().toISOString()).envelope);
    } catch {
      writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'claim-store-unreadable'));
    }
    return;
  }
  try {
    const envelope = await withClaimLock(storePath, async () => {
      let replayed;
      try {
        replayed = await replayClaimJournal(journalPath, namespace);
      } catch (error) {
        throw taggedFailure('CLAIM_STORE_UNREADABLE', error);
      }
      const physicalNow = new Date().toISOString();
      let reconciled;
      try {
        reconciled = await reconcileClaimJournal({
          ledgerDirectory: parsedOptions.options.ledger,
          gitCommonDir,
          namespace,
          replayed,
          physicalNow,
        });
      } catch (error) {
        throw taggedFailure(
          error?.code === 'CLOCK_FLOOR_PERSISTENCE_FAILED'
            ? 'CLOCK_FLOOR_PERSISTENCE_FAILED'
            : 'CLAIM_RECONCILIATION_FAILED',
          error,
        );
      }
      if (reconciled.unsafe) {
        return claimStoreUnavailable(claimCommand, 'publication-reconciliation-required', {
          findings: reconciled.findings,
        });
      }
      const applied = operation(reconciled.state, request, physicalNow);
      let persisted;
      try {
        persisted = await appendClaimEntry(journalPath, {
          type: 'claim',
          command: claimCommand,
          physical_now: physicalNow,
          request,
        });
      } catch (error) {
        throw taggedFailure('CLOCK_FLOOR_PERSISTENCE_FAILED', error);
      }
      try {
        await writeReconcileLog(
          claimReconcileLogPath(path.resolve(parsedOptions.options.ledger), namespace),
          namespace,
          [...reconciled.entries, persisted],
        );
      } catch {
        // The tracked reconciliation log is derived. The fsync'd journal
        // already committed the claim and the next operation can rebuild it.
      }
      try {
        await writeClaimState(storePath, applied.state);
      } catch {
        // The snapshot is a rebuildable memo. The fsync'd journal is authoritative.
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
    if (error?.code === 'CLAIM_RECONCILIATION_FAILED') {
      writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'publication-reconciliation-required'));
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

function claimStoreUnavailable(command, reason, details = {}) {
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
        details: { reason, ...details },
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

function writePublicationInvalidRequest(operationId, message, details) {
  writeClaimEnvelope({
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      ...(operationId ? { operation_id: operationId } : {}),
      error: { code: 'invalid-request', message, details },
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

  if (command === 'report') {
    return 'Usage: wowbagger report --ledger <dir> --as-of YYYY-MM-DD [--out <file>] --json';
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

  if (command === 'claim-verify') {
    return 'Usage: wowbagger claim-verify --ledger <dir> --json';
  }

  if (command === 'claim') {
    return 'Usage: wowbagger claim <read|acquire|renew|release|capabilities> [options]';
  }

  if (command === 'inspect') {
    return 'Usage: wowbagger inspect --ledger <dir> (--id <id> | --number <n>) --json';
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
      'Use claim capabilities --ledger <dir> --json to gate work on one provisioned ledger.',
      'The namespace and backend members identify the work-claim capability context.',
      'Use operations.work_claim.api_version to negotiate the work-claim API.',
      'The top-level claim contract_version is a legacy envelope marker.',
      '',
    ].join('\n');
  }

  if (command === 'capabilities') {
    return [
      header,
      '',
      `${usage(command)}`,
      '',
      'Use contract_version to negotiate the core contract.',
      'Use operations.work_claim.api_version to negotiate the work-claim API.',
      'Use claim capabilities --ledger <dir> --json to gate claimed work for one ledger.',
      '',
    ].join('\n');
  }

  if (command === 'provision') {
    return [
      header,
      '',
      `${usage(command)}`,
      '',
      'Requires a Git checkout; the namespace and claim journal use its shared Git directory.',
      'Preflight with claim capabilities --ledger <dir> --json.',
      'Require result.operations.work_claim.supported: true before provisioning.',
      '',
    ].join('\n');
  }

  if (command === 'publish-claimed') {
    return [
      header,
      '',
      `${usage(command)}`,
      '',
      'Requires the ledger-specific claim capability claim_protected_publication: true.',
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

async function requestSource(input, maxBytes = Number.POSITIVE_INFINITY) {
  if (input === '-') {
    const chunks = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      total += chunk.length;
      if (total > maxBytes) throw new Error('request input exceeds its byte limit');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }

  const handle = await open(input, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) {
      throw new Error('request input exceeds its byte limit');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
