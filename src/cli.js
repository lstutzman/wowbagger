import { readFileSync } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveClaimBackend, resolveWorkClaimCapability } from './claim-capabilities.js';
import {
  appendClaimEntry,
  claimJournalPath,
  claimReconcileLogPath,
  parseReconcileLog,
  replayClaimJournal,
  writeReconcileLog,
} from './claim-journal.js';
import { claimAcquire, claimRead, claimRelease, claimRenew } from './claim-operations.js';
import {
  adoptItemRevision,
  hydrateClaimJournalFromHead,
  publishClaimed,
  reconcileClaimJournal,
  readPublicationOutcome,
  validatePublicationReadRequest,
  validatePublicationRequest,
  verifyClaimJournal,
} from './claim-publication.js';
import { loadExtensionDeclaration } from './extensions.js';
import { validateClaimRequest } from './claim-request.js';
import { checkProspectiveMerge } from './claim-prospective.js';
import { proposeExtensionDeclaration } from './extension-provision.js';
import { selectCommittedAdoptions } from './claim-sync.js';
import {
  claimStorePath,
  resolveGitCommonDir,
  resolveVerifiedGitCommonDir,
  withClaimLock,
  writeClaimState,
} from './claim-store.js';
import { readGitTreeFile, readGitTreeLedger } from './git-reconciliation.js';
import { finalizeFromRecoveryToken, withAutoCommit } from './git-autocommit.js';
import { loadLedger } from './ledger.js';
import {
  finalizeNumberRepairCommit,
  isNumberRepairRecoveryToken,
  ledgerRepairInvalidRequest,
  numberRepair,
  numberRepairProposal,
} from './ledger-repair.js';
import { inspectVersionDrift } from './version-drift.js';
import {
  assertReportOutputOutsideLedger,
  buildReportModel,
  failureCause,
  loadReportConfig,
  readLogoDataUrl,
  writeReportFile,
} from './report.js';
import { renderReportHtml } from './report-html.js';
import { loadGraphBundle } from './report-graph.js';
import {
  createItem,
  inspectItem,
  inspectItemByNumber,
  migrateParentItem,
  patchItem,
  revisionFor,
  snoozeItem,
  transitionItem,
  validateCreateRequest,
  validateParentMigrationRequest,
  validatePatchRequest,
  validateSnoozeRequest,
  validateTransitionRequest,
} from './mutation.js';
import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_QUERY_VERSION,
  MAX_ITEM_SOURCE_BYTES,
  MAX_LIST_PAGE_SIZE,
  MAX_LIST_RESPONSE_BYTES,
  MAX_LIST_TITLE_CHARACTERS,
  MAX_WORKBENCH_COLLECTION_ENTRIES,
  MAX_WORKBENCH_RESPONSE_BYTES,
  MAX_WORKBENCH_TITLE_CHARACTERS,
  WORKBENCH_PROJECTION_VERSION,
} from './limits.js';
import { listLedger, validateListQuery } from './list.js';
import { mintId } from './mint.js';
import { provisionNamespace, readNamespace } from './namespace.js';
import { normalizeJsonValue, parseJsonRequest, sortIssues } from './request.js';
import { selectReady } from './ready.js';
import { isCalendarDate, validateLedger } from './validate.js';
import { inspectWorkbench } from './workbench.js';
import { readWorktreeIdentity } from './worktree-identity.js';

const CLAIM_OPERATIONS = { read: claimRead, acquire: claimAcquire, renew: claimRenew, release: claimRelease };
const MUTATION_CONTRACT_VERSION = 5;
const AUTO_COMMIT_COMMANDS = new Set([
  'create',
  'transition',
  'parent-migrate',
  'snooze',
  'patch',
  'publish-claimed',
  'number-repair',
]);
// The report failures this command states. A code outside the set is an
// unexpected condition, never a classification the command can pass through.
const REPORT_FAILURE_CODES = new Set([
  'report-config-invalid',
  'report-view-not-found',
  'report-read-failed',
  'report-write-failed',
]);

const MAX_PUBLICATION_REQUEST_BYTES = 11 * 1024 * 1024;
// A list query is a handful of scalars and short arrays. The bound exists so an
// unbounded input can never be read into memory, not to shape the query.
const MAX_LIST_REQUEST_BYTES = 64 * 1024;
const DISTRIBUTION_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version;

const COMMAND_SUMMARIES = {
  validate: 'Validate a ledger and print the single JSON validation result.',
  ready: 'Validate a ledger and print the readiness queue for a date.',
  report: 'Render one validated ledger as a self-contained HTML report.',
  capabilities: 'Describe the core contract and unbound default claim profile.',
  inspect: 'Inspect one ledger item as a lossless raw-byte snapshot.',
  list: 'List a validated ledger as bounded, paginated item summaries.',
  create: 'Create one ledger item through atomic, no-clobber publication.',
  transition: "Transition one item's lifecycle, guarded by lock and compare-and-swap.",
  'parent-migrate': 'Move one item to or from an epic with CAS fencing.',
  snooze: 'Set or clear an item snooze date with CAS fencing.',
  patch: "Patch an item's priority and relation lists, guarded the same way.",
  'extensions-provision': 'Declare explicitly selected existing extension members.',
  'mint-id': 'Mint a canonical item ID.',
  'publish-claimed': 'Publish ledger results when its claim profile enables protected publication.',
  'claim-merge-verify': 'Validate a prospective Git merge tree against claim-journal semantics.',
  'claim-sync': 'Import committed adoption evidence into the local claim journal.',
  'claim-adopt': 'Rule a committed out-of-protocol item revision legitimate.',
  'mutation-finalize': 'Complete the Git commit an auto-commit mutation could not establish.',
  'version-drift': 'Check installed skill and running core version compatibility.',
  'number-repair': 'Apply a proposed duplicate-number repair to a ledger the mutation gate refuses.',
  provision: 'Provision a Git-backed work-claim namespace.',
  claim: 'Read and coordinate work claims for one ledger.',
  'claim-verify': 'Reconcile the durable claim journal with ledger bytes and Git.',
};

const KNOWN_COMMANDS = new Set([
  'validate',
  'ready',
  'report',
  'capabilities',
  'inspect',
  'list',
  'create',
  'transition',
  'parent-migrate',
  'snooze',
  'patch',
  'extensions-provision',
  'mint-id',
  'provision',
  'claim',
  'publish-claimed',
  'claim-verify',
  'claim-merge-verify',
  'claim-sync',
  'claim-adopt',
  'mutation-finalize',
  'version-drift',
  'number-repair',
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

  if (command === 'version-drift') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    writeClaimEnvelope(await inspectVersionDrift({
      skillPath: parsedOptions.options.skill
        ?? fileURLToPath(new URL('../skills/wowbagger/SKILL.md', import.meta.url)),
      packagePath: fileURLToPath(new URL('../package.json', import.meta.url)),
      runningDistribution: DISTRIBUTION_VERSION,
      runningContractVersion: 5,
    }));
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
    await runReportCommand(parsedOptions.options, scenario);
    return;
  }

  if (command === 'inspect') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const options = parsedOptions.options;
    let selector;
    if (options.number !== undefined) {
      const parsedNumber = Number(options.number);
      if (!Number.isSafeInteger(parsedNumber) || parsedNumber < 1) {
        writeInvalidRequest(command, [issue('/arguments', 'invalid-value', 'Argument --number must be a positive integer.')]);
        return;
      }
      selector = { number: parsedNumber };
    } else {
      selector = { id: options.id };
    }
    // The two reads share one resolution and one pair of refusals. They differ
    // in what a success carries and in what an invalid ledger may carry: the
    // lossless snapshot is bytes the operator repairs around, while a workbench
    // projection is a judgement about a ledger this core has not validated.
    const workbenchRequested = options.workbench === true;
    const result = workbenchRequested
      ? await inspectWorkbench(options.ledger, selector, options.asOf)
      : selector.id === undefined
        ? await inspectItemByNumber(options.ledger, selector.number)
        : await inspectItem(options.ledger, selector.id);
    if (result.validation) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        error: {
          code: 'ledger-invalid',
          message: 'The configured ledger is invalid.',
          details: {
            validation_errors: result.validation.errors,
            ...(result.item ? { item: result.item } : {}),
          },
        },
      })}\n`);
      process.exitCode = 3;
      return;
    }
    if (workbenchRequested ? result.workbench === null : !result.item) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        error: {
          code: 'item-not-found',
          message: 'The requested item was not found.',
          details: selector,
        },
      })}\n`);
      process.exitCode = 2;
      return;
    }
    const response = `${JSON.stringify({
      ok: true,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      result: workbenchRequested ? { workbench: result.workbench } : { item: result.item },
    })}\n`;
    // The advertised bound is measured on the exact bytes this command would
    // write, trailing LF included, and only for the bounded projection: the
    // lossless read is bounded by the item source instead. Over the bound the
    // projection is refused whole rather than written short.
    if (workbenchRequested) {
      const responseBytes = measuredWorkbenchBytes(response, scenario);
      if (responseBytes > MAX_WORKBENCH_RESPONSE_BYTES) {
        process.stdout.write(`${JSON.stringify({
          ok: false,
          command,
          contract_version: MUTATION_CONTRACT_VERSION,
          error: {
            code: 'workbench-response-too-large',
            message: 'The workbench projection does not fit the supported response byte limit.',
            details: {
              id: result.workbench.item.id,
              max_workbench_response_bytes: MAX_WORKBENCH_RESPONSE_BYTES,
              response_bytes: responseBytes,
            },
          },
        })}\n`);
        process.exitCode = 2;
        return;
      }
    }
    process.stdout.write(response);
    return;
  }

  if (command === 'list') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input, MAX_LIST_REQUEST_BYTES);
    } catch {
      writeInvalidRequest(command, [issue('/input', 'invalid-value', 'Request input could not be read.')]);
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    const queryIssues = validateListQuery(parsedRequest.value, parsedRequest.issues);
    if (queryIssues.length > 0) {
      writeInvalidRequest(command, queryIssues);
      return;
    }
    const outcome = await listLedger(
      parsedOptions.options.ledger,
      normalizeJsonValue(parsedRequest.value),
    );
    if (outcome.validation) {
      writeListFailure('ledger-invalid', 'The configured ledger is invalid.', {
        validation_errors: outcome.validation.errors,
      }, 3);
      return;
    }
    if (outcome.snapshotChanged) {
      writeListFailure(
        'list-snapshot-changed',
        'The ledger snapshot the cursor was issued against is no longer current.',
        outcome.snapshotChanged,
        4,
      );
      return;
    }
    // The advertised bound is measured on the exact bytes this command would
    // write, trailing LF included. Over the bound the page is refused whole: a
    // list response is never a partial page.
    const response = `${JSON.stringify({
      ok: true,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      result: outcome.result,
    })}\n`;
    const responseBytes = Buffer.byteLength(response, 'utf8');
    if (responseBytes > MAX_LIST_RESPONSE_BYTES) {
      writeListFailure(
        'list-response-too-large',
        'The requested page does not fit the supported list response byte limit.',
        {
          max_list_response_bytes: MAX_LIST_RESPONSE_BYTES,
          response_bytes: responseBytes,
          page_size: outcome.result.page.size,
        },
        2,
      );
      return;
    }
    process.stdout.write(response);
    return;
  }

  if (command === 'extensions-provision') {
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
    if (parsedRequest.issues.length > 0) {
      writeInvalidRequest(command, parsedRequest.issues);
      return;
    }
    const ledger = await loadLedger(parsedOptions.options.ledger);
    const validation = validateLedger(ledger);
    if (!validation.valid) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        state: 'unchanged',
        error: {
          code: 'ledger-invalid',
          message: 'The configured ledger is invalid.',
          details: { validation_errors: validation.errors },
        },
      })}\n`);
      process.exitCode = 3;
      return;
    }
    const proposal = proposeExtensionDeclaration({
      ledger,
      members: parsedRequest.value?.members,
    });
    if (!proposal.ok) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        state: 'unchanged',
        error: {
          code: proposal.error.code,
          message: 'The extension declaration request is invalid.',
          details: proposal.error,
        },
      })}\n`);
      process.exitCode = 2;
      return;
    }
    const output = path.join(path.resolve(parsedOptions.options.ledger), '.wowbagger', 'extensions.json');
    if (parsedOptions.options.dryRun) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        result: {
          dry_run: true,
          output: '.wowbagger/extensions.json',
          source: proposal.source,
          members: proposal.declaration.members,
          counts: proposal.counts,
        },
      })}\n`);
      return;
    }
    const sameDeclaration = (declaration) => declaration
      && Object.keys(declaration.members).length === Object.keys(proposal.declaration.members).length
      && Object.entries(proposal.declaration.members)
        .every(([name, type]) => declaration.members[name] === type);
    const refuseConflict = () => {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: MUTATION_CONTRACT_VERSION,
        state: 'unchanged',
        error: {
          code: 'extension-declaration-conflict',
          message: 'The ledger already carries a different extension declaration.',
          details: { output: '.wowbagger/extensions.json' },
        },
      })}\n`);
      process.exitCode = 4;
    };
    const existing = await loadExtensionDeclaration(parsedOptions.options.ledger);
    if (existing.declared) {
      if (!sameDeclaration(existing.declaration)) {
        refuseConflict();
        return;
      }
    } else {
      await mkdir(path.dirname(output), { recursive: true });
      if (scenario === 'extension-provision-concurrent-same') {
        await writeFile(
          output,
          '{\n  "extensions_version": 1,\n  "members": {"tags":"string-list"}\n}\n',
          { flag: 'wx' },
        );
      } else if (scenario === 'extension-provision-concurrent-different') {
        await writeFile(
          output,
          '{"extensions_version":1,"members":{"tier":"string"}}\n',
          { flag: 'wx' },
        );
      }
      let handle;
      try {
        handle = await open(output, 'wx');
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const winner = await loadExtensionDeclaration(parsedOptions.options.ledger);
        if (!winner.declared || !sameDeclaration(winner.declaration)) {
          refuseConflict();
          return;
        }
      }
      if (handle) {
        try {
          await handle.writeFile(proposal.source, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      contract_version: MUTATION_CONTRACT_VERSION,
      state: 'committed',
      result: {
        output: '.wowbagger/extensions.json',
        source: proposal.source,
        members: proposal.declaration.members,
        counts: proposal.counts,
      },
    })}\n`);
    return;
  }
  if (command === 'parent-migrate') {
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
    const issues = validateParentMigrationRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await autoCommitted(command, parsedOptions.options, () => (
      migrateParentItem(parsedOptions.options.ledger, parsedRequest.value, scenario)
    ), scenario, null, parsedRequest.value.id));
    return;
  }

  if (command === 'snooze') {
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
    const issues = validateSnoozeRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await autoCommitted(command, parsedOptions.options, () => (
      snoozeItem(parsedOptions.options.ledger, parsedRequest.value, scenario)
    ), scenario, null, parsedRequest.value.id));
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
    writeMutation(command, await autoCommitted(command, parsedOptions.options, () => (
      createItem(parsedOptions.options.ledger, parsedRequest.value, scenario)
    ), scenario, null, parsedRequest.value.id));
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
    writeMutation(command, await autoCommitted(command, parsedOptions.options, () => (
      transitionItem(parsedOptions.options.ledger, parsedRequest.value, scenario)
    ), scenario, null, parsedRequest.value.id));
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
    writeMutation(command, await autoCommitted(command, parsedOptions.options, () => (
      patchItem(parsedOptions.options.ledger, parsedRequest.value, scenario)
    ), scenario, null, parsedRequest.value.id));
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

  if (command === 'claim-merge-verify') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const ledgerDirectory = parsedOptions.options.ledger;
    const gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory);
    const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
    if (!gitCommonDir || !namespace) {
      writeClaimEnvelope(claimStoreUnavailable(command,
        gitCommonDir ? 'ledger-namespace-unbound' : 'git-directory-not-found'));
      return;
    }
    let result;
    try {
      result = await checkProspectiveMerge({
        ledgerDirectory,
        namespace,
        baseRef: parsedOptions.options.base,
        headRef: parsedOptions.options.head,
      });
    } catch {
      result = { ok: false, error: { code: 'prospective-merge-unavailable' } };
    }
    writeClaimEnvelope({
      exit: result.ok ? 0 : 6,
      stdout: {
        ok: result.ok,
        namespace: 'work-claim',
        command,
        contract_version: 1,
        state: result.ok ? 'committed' : 'unchanged',
        ...(result.ok
          ? {
            result: {
              ledger_namespace: namespace,
              base_ref: parsedOptions.options.base,
              head_ref: parsedOptions.options.head,
              candidate_tree: result.candidate,
            },
          }
          : {
            error: {
              code: result.error.code,
              message: 'The prospective merge is not semantically authorized.',
              details: result.error,
            },
          }),
      },
    });
    return;
  }

  if (command === 'claim-sync') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    const ledgerDirectory = parsedOptions.options.ledger;
    const gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory);
    const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
    if (!gitCommonDir || !namespace) {
      writeClaimEnvelope(claimStoreUnavailable(command,
        gitCommonDir ? 'ledger-namespace-unbound' : 'git-directory-not-found'));
      return;
    }
    const storePath = claimStorePath(gitCommonDir, namespace);
    const journalPath = claimJournalPath(gitCommonDir, namespace);
    try {
      const tree = await readGitTreeLedger(ledgerDirectory, 'HEAD');
      const log = await readGitTreeFile(
        ledgerDirectory,
        'HEAD',
        `.wowbagger/reconcile-${namespace}.md`,
      );
      const committed = parseReconcileLog(log, namespace);
      if (committed.error) {
        writeClaimEnvelope({
          exit: 2,
          stdout: {
            ok: false,
            namespace: 'work-claim',
            command,
            contract_version: 1,
            state: 'unchanged',
            error: {
              code: committed.error.code,
              message: 'The committed adoption evidence is invalid.',
              details: committed.error,
            },
          },
        });
        return;
      }
      const envelope = await withClaimLock(storePath, async () => {
        const local = await replayClaimJournal(journalPath, namespace);
        const selected = selectCommittedAdoptions({
          namespace,
          committedEntries: committed,
          localEntries: local.entries,
        });
        if (!selected.ok) {
          return {
            exit: 2,
            stdout: {
              ok: false,
              namespace: 'work-claim',
              command,
              contract_version: 1,
              state: 'unchanged',
              error: {
                code: selected.error.code,
                message: 'The committed adoption evidence conflicts with local claim state.',
                details: selected.error,
              },
            },
          };
        }
        for (const entry of selected.entries) {
          const { seq, ...withoutSequence } = entry;
          const itemPath = withoutSequence.item_path
            ?? `items/${withoutSequence.item_id}.md`;
          const bytes = tree.items.get(itemPath) ?? tree.items.get(`${withoutSequence.item_id}.md`);
          if (!bytes || revisionFor(bytes) !== withoutSequence.to_revision) {
            return {
              exit: 2,
              stdout: {
                ok: false,
                namespace: 'work-claim',
                command,
                contract_version: 1,
                state: 'unchanged',
                error: {
                  code: 'adoption-revision-not-at-head',
                  message: 'The committed adoption does not match candidate item bytes.',
                  details: { item_id: withoutSequence.item_id, expected_revision: withoutSequence.to_revision },
                },
              },
            };
          }
          await appendClaimEntry(journalPath, withoutSequence);
        }
        const replayed = await replayClaimJournal(journalPath, namespace);
        await writeClaimState(storePath, replayed.state);
        return {
          exit: 0,
          stdout: {
            ok: true,
            namespace: 'work-claim',
            command,
            contract_version: 1,
            state: 'committed',
            result: {
              ledger_namespace: namespace,
              imported_items: [...new Set(selected.entries.map((entry) => entry.item_id))],
              imported_count: selected.entries.length,
              already_present: selected.already_present,
            },
          },
        };
      });
      writeClaimEnvelope(envelope);
    } catch {
      writeClaimEnvelope({
        exit: 6,
        stdout: {
          ok: false,
          namespace: 'work-claim',
          command,
          contract_version: 1,
          state: 'unchanged',
          error: {
            code: 'claim-sync-unavailable',
            message: 'Committed adoption evidence could not be synchronized.',
            details: {},
          },
        },
      });
    }
    return;
  }

  if (command === 'mutation-finalize') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    if (isNumberRepairRecoveryToken(parsedOptions.options.recoveryToken)) {
      writeClaimEnvelope(await finalizeNumberRepairCommit({
        ledgerDirectory: parsedOptions.options.ledger,
        token: parsedOptions.options.recoveryToken,
      }));
      return;
    }
    writeClaimEnvelope(await finalizeFromRecoveryToken({
      ledgerDirectory: parsedOptions.options.ledger,
      token: parsedOptions.options.recoveryToken,
    }));
    return;
  }

  // The proposal is request-free and read-only: the ledger is its whole input.
  if (command === 'number-repair-proposal') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimEnvelope(ledgerRepairInvalidRequest(command, parsedOptions.issues));
      return;
    }
    writeClaimEnvelope(await numberRepairProposal(parsedOptions.options.ledger));
    return;
  }

  if (command === 'number-repair') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimEnvelope(ledgerRepairInvalidRequest(command, parsedOptions.issues));
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeClaimEnvelope(ledgerRepairInvalidRequest(command, [
        issue('/input', 'invalid-value', 'Request input could not be read.'),
      ]));
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    if (parsedRequest.issues.length > 0) {
      writeClaimEnvelope(ledgerRepairInvalidRequest(command, parsedRequest.issues));
      return;
    }
    // normalizeJsonValue rebuilds the tree into plain objects with every
    // JsonNumber unwrapped, so the exact-member check cannot be slipped past
    // with a `__proto__` member and the number witnesses compare as numbers.
    writeClaimEnvelope(await numberRepair(normalizeJsonValue(parsedRequest.value), {
      ledgerDirectory: parsedOptions.options.ledger,
      autoCommit: parsedOptions.options.autoCommit === true,
    }));
    return;
  }

  if (command === 'claim-adopt') {
    const parsedOptions = parseContractOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeClaimInvalidRequest(command, [issue('/input', 'invalid-value', 'Request input could not be read.')]);
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    if (parsedRequest.issues.length > 0) {
      writeClaimInvalidRequest(command, parsedRequest.issues);
      return;
    }
    const request = normalizeJsonValue(parsedRequest.value);
    const validationIssues = validateClaimRequest(command, request);
    if (validationIssues.length > 0) {
      writeClaimInvalidRequest(command, validationIssues);
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
    if (request.ledger_namespace !== namespace) {
      writeClaimEnvelope({
        exit: 2,
        stdout: {
          ok: false,
          namespace: 'work-claim',
          command,
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
    writeClaimEnvelope(await adoptItemRevision({
      ledgerDirectory,
      gitCommonDir,
      namespace,
      request,
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
    writeClaimEnvelope(await autoCommitted(command, parsedOptions.options, () => publishClaimed({
      ledgerDirectory: parsedOptions.options.ledger,
      gitCommonDir,
      namespace,
      request,
      scenario,
    }), scenario, request.operation_id, request.item_id));
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

async function runReportCommand(options, scenario) {
  const ledger = await loadLedger(options.ledger);
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    writeReportFailure('ledger-invalid', 'The configured ledger is invalid.', {
      errors: validation.errors,
    }, 1);
    return;
  }

  try {
    const config = await loadReportConfig(options.ledger, options.out, options.view ?? null);
    const model = buildReportModel(ledger.items, config, options.asOf);
    const logoDataUrl = await readLogoDataUrl(config.repository.logo);
    const graphBundle = await loadGraphBundle();
    const html = renderedReport(model, { logoDataUrl, graphBundle }, scenario);
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
        item_count: model.items.length + model.terminalItems.length,
        ready_count: model.stats.ready,
        // Only a named view says which one it is; a base report keeps the
        // result members it has always carried.
        ...(config.view === null ? {} : { view: config.view.name }),
      },
    })}\n`);
  } catch (error) {
    // A failure the report states keeps its own code and its own details. An
    // error no report path throws on purpose is not a proven publication
    // failure either, but nothing reached the output path, so it answers as a
    // failed publication rather than as a success — and it names its kind, so
    // the refusal is never causeless.
    const stated = REPORT_FAILURE_CODES.has(error?.code);
    const code = stated ? error.code : 'report-write-failed';
    // A named view that does not exist is a request refusal, not a failed
    // publication: nothing was rendered and nothing was replaced.
    const exit = code === 'report-config-invalid' || code === 'report-view-not-found' ? 2 : 1;
    const details = reportFailureDetails(code, stated, error);
    writeReportFailure(code, reportFailureMessage(code), details, exit);
  }
}

// The catch-all classification answers an error no report path throws on
// purpose, so the fixture scenario is the only way to execute it. Every other
// run renders normally.
function renderedReport(model, renderOptions, scenario) {
  if (scenario === 'report-render-fails') {
    throw new TypeError('fixture report render failure');
  }
  return renderReportHtml(model, renderOptions);
}

function reportFailureDetails(code, stated, error) {
  if (code === 'report-config-invalid') {
    return { issues: [issue('/configuration', code, error?.message ?? 'Report configuration is invalid.')] };
  }
  if (stated) {
    return error.details ?? {};
  }
  return { operation: 'publish-report', cause: failureCause(error) };
}

function reportFailureMessage(code) {
  if (code === 'report-config-invalid') {
    return 'The report configuration is invalid.';
  }
  if (code === 'report-view-not-found') {
    return 'The requested report view was not found.';
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

// A list refusal is a read-only envelope: no state member, and never a partial
// result beside the error.
function writeListFailure(code, message, details, exit) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    command: 'list',
    contract_version: MUTATION_CONTRACT_VERSION,
    error: { code, message, details },
  })}\n`);
  process.exitCode = exit;
}

// The workbench projection bounds every variable-size field it carries, so the
// largest projection this core can build is well inside the advertised response
// bound. The measurement is the promise rather than a page-size knob: a caller
// has no size to lower, so exceeding it would be a defect in the projection.
// The fixture scenario is the only way to reach the refusal, so the fail-closed
// path is executed by a test instead of trusted.
function measuredWorkbenchBytes(response, scenario) {
  return scenario === 'workbench-response-exceeds-bound'
    ? MAX_WORKBENCH_RESPONSE_BYTES + 1
    : Buffer.byteLength(response, 'utf8');
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
        // The workbench member is how a consumer learns the opt-in affordance
        // projection exists and which projection shape it will receive, without
        // probing a read that a version 4 consumer never sent.
        inspect: {
          supported: true,
          write_scope: 'none',
          cas_scope: 'none',
          workbench: {
            supported: true,
            projection_version: WORKBENCH_PROJECTION_VERSION,
          },
        },
        list: {
          supported: true,
          write_scope: 'none',
          cas_scope: 'none',
          query_version: LIST_QUERY_VERSION,
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
        // The report writes only derived output, never ledger state, so it
        // carries no CAS scope. `config_versions` and `named_views` tell a
        // consumer which report configurations this core accepts.
        report: {
          supported: true,
          write_scope: 'derived-output',
          config_versions: [1, 2],
          named_views: true,
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
        max_item_source_bytes: MAX_ITEM_SOURCE_BYTES,
        default_list_page_size: DEFAULT_LIST_PAGE_SIZE,
        max_list_page_size: MAX_LIST_PAGE_SIZE,
        max_list_title_characters: MAX_LIST_TITLE_CHARACTERS,
        max_list_response_bytes: MAX_LIST_RESPONSE_BYTES,
        max_workbench_title_characters: MAX_WORKBENCH_TITLE_CHARACTERS,
        max_workbench_collection_entries: MAX_WORKBENCH_COLLECTION_ENTRIES,
        max_workbench_response_bytes: MAX_WORKBENCH_RESPONSE_BYTES,
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
  const valueFlags = command === 'version-drift'
    ? new Map([['--skill', 'skill']])
    : command === 'inspect'
      ? new Map([['--ledger', 'ledger'], ['--id', 'id'], ['--number', 'number'], ['--as-of', 'asOf']])
      : command === 'report'
        ? new Map([['--ledger', 'ledger'], ['--as-of', 'asOf'], ['--out', 'out'], ['--view', 'view']])
        : command === 'create' || command === 'transition' || command === 'patch' || command === 'list'
          || command === 'parent-migrate'
          || command === 'snooze'
          || command === 'extensions-provision'
          || command === 'publish-claimed' || command === 'publication-read'
          || command === 'claim-read' || command === 'claim-acquire' || command === 'claim-renew'
          || command === 'claim-release' || command === 'claim-adopt'
          || command === 'number-repair'
          ? new Map([['--ledger', 'ledger'], ['--input', 'input']])
          : command === 'mutation-finalize'
            ? new Map([['--ledger', 'ledger'], ['--recovery-token', 'recoveryToken']])
            : command === 'claim-merge-verify'
              ? new Map([['--ledger', 'ledger'], ['--base', 'base'], ['--head', 'head']])
              : command === 'provision' || command === 'claim-capabilities' || command === 'claim-verify'
                || command === 'claim-sync' || command === 'number-repair-proposal'
                ? new Map([['--ledger', 'ledger']])
                : command === 'mint-id'
                  ? new Map([['--date', 'date']])
                  : new Map();
  // Bare flags carry no value. `--auto-commit` is accepted only on the
  // commands whose Git finalization it folds in; `--workbench` only on the one
  const bareFlags = AUTO_COMMIT_COMMANDS.has(command)
    ? new Map([['--auto-commit', 'autoCommit']])
    : command === 'extensions-provision'
      ? new Map([['--dry-run', 'dryRun']])
      : command === 'inspect'
        ? new Map([['--workbench', 'workbench']])
        : new Map();
  const optionalFlags = command === 'version-drift'
    ? new Set(['--skill'])
    : command === 'mint-id'
      ? new Set(['--date'])
      : command === 'report'
        ? new Set(['--out', '--view'])
        : command === 'inspect'
          ? new Set(['--id', '--number', '--as-of'])
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
    if (bareFlags.has(argument)) {
      if (seen.has(argument)) {
        issues.push(argumentIssue(index + 1, 'repeated-argument', `Argument ${argument} must not be repeated.`));
      }
      seen.add(argument);
      options[bareFlags.get(argument)] = true;
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
  // The workbench projection is a point-in-time read, so the date is part of
  // its grammar rather than a default this core invents. The coupling is
  // refused in both directions: an unpaired `--as-of` would otherwise be
  // silently ignored on a default inspect.
  if (command === 'inspect' && seen.has('--workbench') !== seen.has('--as-of')) {
    issues.push(seen.has('--workbench')
      ? argumentIssue(-1, 'missing-argument', 'Argument --as-of is required with --workbench.')
      : argumentIssue(-1, 'conflicting-argument', 'Argument --as-of is accepted only with --workbench.'));
  } else if (command === 'inspect' && seen.has('--as-of')
    && options.asOf !== undefined && !isCalendarDate(options.asOf)) {
    issues.push(argumentIssue(-1, 'invalid-value', 'Argument --as-of must be an ISO calendar date.'));
  }
  if (!seen.has('--json')) {
    issues.push(argumentIssue(-1, 'missing-argument', 'Argument --json is required.'));
  }
  return { options, issues: sortIssues(issues) };
}

// `--auto-commit` is the only bare flag beyond `--json`, and it changes what
// happens after the mutation, never the mutation itself.
function autoCommitted(command, options, run, scenario, operationId = null, targetItemId = null) {
  if (!options.autoCommit) return run();
  return withAutoCommit({
    ledgerDirectory: options.ledger,
    command,
    operationId,
    targetItemId,
    run,
    scenario,
  });
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
    ...(command === 'parent-migrate' || command === 'snooze' ? { state: 'unchanged' } : {}),
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
      // resultExtra carries the additive auto-commit evidence. Without the
      // flag it is absent and the result member is byte-identical.
      result: {
        item: outcome.item,
        ...(outcome.resultExtra?.commit_paths
          ? { changed_paths: outcome.resultExtra.commit_paths }
          : outcome.changed_paths ? { changed_paths: outcome.changed_paths } : {}),
        ...(outcome.resultExtra ?? {}),
      },
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
      // The lock-free read never writes: it projects committed evidence in
      // memory so an unhydrated worktree still answers with the real claim.
      const replayed = await hydrateClaimJournalFromHead({
        ledgerDirectory: parsedOptions.options.ledger,
        gitCommonDir,
        namespace,
        replayed: await replayClaimJournal(journalPath, namespace),
        persist: false,
      });
      writeClaimEnvelope(operation(replayed.state, request, new Date().toISOString()).envelope);
    } catch {
      writeClaimEnvelope(claimStoreUnavailable(claimCommand, 'claim-store-unreadable'));
    }
    return;
  }
  try {
    const envelope = await withClaimLock(storePath, async () => {
      // A claim lifecycle command classifies item reconciliation and refuses
      // on it, so it must reason from the same writer evidence every other
      // classifying surface uses; otherwise one command grants a claim on
      // exactly the state another command refuses to write. It writes no item
      // byte and no writer-attributed entry, so it reads the identity it
      // already answers to rather than creating one. Journal and identity are
      // both store state this command only reads, so neither reading failure
      // is anything but an unreadable store.
      let replayed;
      let currentWorktreeId;
      try {
        replayed = await replayClaimJournal(journalPath, namespace);
        currentWorktreeId = await readWorktreeIdentity({
          ledgerDirectory: parsedOptions.options.ledger,
          gitCommonDir,
        });
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
          targetItemId: request.item_id,
          currentWorktreeId,
          writeLogOnUnsafe: false,
        });
      } catch (error) {
        throw taggedFailure(
          error?.code === 'CLOCK_FLOOR_PERSISTENCE_FAILED'
            ? 'CLOCK_FLOOR_PERSISTENCE_FAILED'
            : 'CLAIM_RECONCILIATION_FAILED',
          error,
        );
      }
      // Release relinquishes authority; it never extends or grants any. A
      // barrier that refuses it strands the lease in the worktree least able
      // to clear the barrier, because no other worktree can take the item over
      // while the claim is held. Acquire and renew do extend authority against
      // bytes nobody has ruled legitimate, so they keep refusing. Only this
      // classification is bypassed: an unresolvable identity, an unreadable
      // journal, and a clock floor that will not persist all throw before this
      // point, and the tuple compare-and-swap below still rules on the request.
      if (reconciled.unsafe && claimCommand !== 'release') {
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
    return 'Usage: wowbagger report --ledger <dir> --as-of YYYY-MM-DD [--view <name>] [--out <file>] --json';
  }

  if (command === 'capabilities') {
    return 'Usage: wowbagger capabilities --json';
  }

  if (command === 'provision') {
    return 'Usage: wowbagger provision --ledger <dir> --json';
  }

  if (command === 'publish-claimed') {
    return 'Usage: wowbagger publish-claimed --ledger <dir> --input <json-file|-> --json [--auto-commit]';
  }

  if (command === 'claim-adopt') {
    return 'Usage: wowbagger claim-adopt --ledger <dir> --input <request.json> --json';
  }
  if (command === 'claim-verify') {
    return 'Usage: wowbagger claim-verify --ledger <dir> --json';
  }
  if (command === 'snooze') {
    return 'Usage: wowbagger snooze --ledger <dir> --input <request.json> --json [--auto-commit]';
  }
  if (command === 'claim-merge-verify') {
    return 'Usage: wowbagger claim-merge-verify --ledger <dir> --base <ref> --head <ref> --json';
  }
  if (command === 'claim-sync') {
    return 'Usage: wowbagger claim-sync --ledger <dir> --json';
  }

  if (command === 'mutation-finalize') {
    return 'Usage: wowbagger mutation-finalize --ledger <dir> --recovery-token <token> --json';
  }

  if (command === 'version-drift') {
    return 'Usage: wowbagger version-drift [--skill <path>] --json';
  }
  if (command === 'number-repair-proposal') {
    return 'Usage: wowbagger number-repair-proposal --ledger <dir> --json';
  }

  if (command === 'number-repair') {
    return 'Usage: wowbagger number-repair --ledger <dir> --input <json-file|-> --json [--auto-commit]';
  }

  if (command === 'claim') {
    return 'Usage: wowbagger claim <read|acquire|renew|release|capabilities> [options]';
  }

  if (command === 'inspect') {
    return 'Usage: wowbagger inspect --ledger <dir> (--id <id> | --number <n>) --json [--workbench --as-of YYYY-MM-DD]';
  }

  if (command === 'list') {
    return 'Usage: wowbagger list --ledger <dir> --input <json-file|-> --json';
  }

  if (command === 'parent-migrate') {
    return 'Usage: wowbagger parent-migrate --ledger <dir> --input <request.json> --json [--auto-commit]';
  }
  if (command === 'extensions-provision') {
    return 'Usage: wowbagger extensions-provision --ledger <dir> --input <request.json> --json [--dry-run]';
  }
  if (command === 'create') {
    return 'Usage: wowbagger create --ledger <dir> --input <json-file|-> --json [--auto-commit]';
  }

  if (command === 'transition') {
    return 'Usage: wowbagger transition --ledger <dir> --input <json-file|-> --json [--auto-commit]';
  }

  if (command === 'patch') {
    return 'Usage: wowbagger patch --ledger <dir> --input <json-file|-> --json [--auto-commit]';
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

  if (command === 'inspect') {
    return [
      header,
      '',
      `${usage(command)}`,
      '',
      'Without --workbench the response is the lossless raw-byte item snapshot.',
      '--workbench returns a bounded lifecycle projection for one item as of a date:',
      'the item summary, and one transition option per allowed lifecycle target with',
      'its generated action, decision requirement, minimum date, and observed state.',
      'It requires --as-of, changes no ledger state, and is an observation, not a lease:',
      'transition rechecks revision, lock, claim fence, reconciliation, and validity.',
      '',
    ].join('\n');
  }

  if (command === 'list') {
    return [
      header,
      '',
      `${usage(command)}`,
      '',
      'Request JSON members: query_version, as_of, filters, sort, page_size, and cursor.',
      'sort is {field, direction}; direction is ascending or descending.',
      'Use the returned page.next_cursor as cursor to resume a stable snapshot.',
      'A changed snapshot returns list-snapshot-changed; restart without cursor.',
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
