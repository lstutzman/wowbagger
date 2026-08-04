#!/usr/bin/env node
import { loadLedger } from '../src/ledger.js';
import { selectReady } from '../src/ready.js';
import { validateLedger } from '../src/validate.js';

async function main(argumentsList) {
  const command = argumentsList[0];

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

function parseOptions(command, argumentsList) {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--ledger') {
      options.ledger = argumentsList[++index];
    } else if (argument === '--as-of' && command === 'ready') {
      options.asOf = argumentsList[++index];
    } else if (argument !== '--json') {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.ledger || !argumentsList.includes('--json')
    || (command === 'ready' && !options.asOf)) {
    throw new Error(usage(command));
  }

  return options;
}

function usage(command) {
  if (command === 'validate') {
    return 'Usage: wowbagger validate --ledger <dir> --json';
  }

  return 'Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD --json';
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
