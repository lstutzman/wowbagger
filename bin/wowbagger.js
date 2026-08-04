#!/usr/bin/env node
import { loadLedger } from '../src/ledger.js';
import {
  createItem,
  inspectItem,
  transitionItem,
  validateCreateRequest,
  validateTransitionRequest,
} from '../src/mutation.js';
import { parseJsonRequest, sortIssues } from '../src/request.js';
import { selectReady } from '../src/ready.js';
import { isCalendarDate, validateLedger } from '../src/validate.js';

async function main(argumentsList) {
  const command = argumentsList[0];

  if (command === 'capabilities') {
    if (argumentsList.length !== 2 || argumentsList[1] !== '--json') {
      throw new Error('Usage: wowbagger capabilities --json');
    }
    process.stdout.write(`${JSON.stringify(capabilities())}\n`);
    return;
  }

  if (command === 'inspect') {
    const options = parseOptions(command, argumentsList.slice(1));
    const result = await inspectItem(options.ledger, options.id);
    if (result.validation) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        contract_version: 1,
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
        contract_version: 1,
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
      contract_version: 1,
      result: { item: result.item },
    })}\n`);
    return;
  }

  if (command === 'create') {
    const parsedOptions = parseMutationOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeMutation(command, {
        ok: false,
        exit: 6,
        state: 'unchanged',
        error: {
          code: 'operation-failed',
          message: 'The mutation operation failed before a commit was established.',
          details: {
            id: 'unknown',
            operation: 'prepare-temporary',
            reason: 'io-error',
            recovery_artifacts: [],
            recovery_artifacts_truncated: false,
          },
        },
      });
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    const issues = validateCreateRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await createItem(parsedOptions.options.ledger, parsedRequest.value));
    return;
  }

  if (command === 'transition') {
    const parsedOptions = parseMutationOptions(command, argumentsList.slice(1));
    if (parsedOptions.issues.length > 0) {
      writeInvalidRequest(command, parsedOptions.issues);
      return;
    }
    let bytes;
    try {
      bytes = await requestSource(parsedOptions.options.input);
    } catch {
      writeMutation(command, {
        ok: false,
        exit: 6,
        state: 'unchanged',
        error: {
          code: 'operation-failed',
          message: 'The mutation operation failed before a commit was established.',
          details: {
            id: 'unknown',
            operation: 'prepare-temporary',
            reason: 'io-error',
            recovery_artifacts: [],
            recovery_artifacts_truncated: false,
          },
        },
      });
      return;
    }
    const parsedRequest = parseJsonRequest(bytes);
    const issues = validateTransitionRequest(parsedRequest.value, parsedRequest.issues);
    if (issues.length > 0) {
      writeInvalidRequest(command, issues);
      return;
    }
    writeMutation(command, await transitionItem(parsedOptions.options.ledger, parsedRequest.value));
    return;
  }

  if (command !== 'validate' && command !== 'ready') {
    throw new Error(usage());
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

  const result = {
    as_of: options.asOf,
    valid: true,
    ready: selectReady(ledger.items, options.asOf),
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function capabilities() {
  return {
    ok: true,
    command: 'capabilities',
    contract_version: 1,
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
        work_claim: {
          supported: false,
          reason: 'not-implemented',
        },
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

  if (!options.ledger || !options.json
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

function parseMutationOptions(command, argumentsList) {
  const options = {};
  const issues = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--json') {
      if (options.json) {
        issues.push(argumentIssue(index + 1, 'repeated-argument', 'Argument --json must not be repeated.'));
      }
      options.json = true;
      continue;
    }
    if (argument !== '--ledger' && argument !== '--input') {
      issues.push(argumentIssue(index + 1, 'unknown-argument', `Argument ${argument} is not recognized.`));
      continue;
    }
    const key = argument === '--ledger' ? 'ledger' : 'input';
    if (hasOwn(options, key)) {
      issues.push(argumentIssue(index + 1, 'repeated-argument', `Argument ${argument} must not be repeated.`));
      const repeatedValue = argumentsList[index + 1];
      if (repeatedValue && !repeatedValue.startsWith('--')) {
        index += 1;
      }
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
      issues.push(argumentIssue(index + 1, 'missing-argument', `Argument ${argument} requires a value.`));
      continue;
    }
    options[key] = value;
    index += 1;
  }
  for (const [key, flag] of [['ledger', '--ledger'], ['input', '--input']]) {
    if (!hasOwn(options, key)) {
      issues.push(argumentIssue(-1, 'missing-argument', `Argument ${flag} is required.`));
    }
  }
  if (!options.json) {
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
  writeMutation(command, {
    ok: false,
    exit: 2,
    state: 'unchanged',
    error: {
      code: 'invalid-request',
      message: `The ${command} request is invalid.`,
      details: { issues },
    },
  });
}

function writeMutation(command, outcome) {
  const envelope = outcome.ok
    ? {
      ok: true,
      command,
      contract_version: 1,
      state: outcome.state,
      result: { item: outcome.item },
    }
    : {
      ok: false,
      command,
      contract_version: 1,
      state: outcome.state,
      error: outcome.error,
    };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = outcome.exit;
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

  if (command === 'inspect') {
    return 'Usage: wowbagger inspect --ledger <dir> --id <id> --json';
  }

  if (command === 'create') {
    return 'Usage: wowbagger create --ledger <dir> --input <json-file|-> --json';
  }

  if (command === 'transition') {
    return 'Usage: wowbagger transition --ledger <dir> --input <json-file|-> --json';
  }

  return 'Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD --json';
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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
