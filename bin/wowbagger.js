#!/usr/bin/env node
import { loadLedger } from '../src/ledger.js';
import { selectReady } from '../src/ready.js';

async function main(argumentsList) {
  const command = argumentsList[0];

  if (command !== 'ready') {
    throw new Error('Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD --json');
  }

  const options = parseReadyOptions(argumentsList.slice(1));
  const ledger = await loadLedger(options.ledger);

  if (ledger.errors.length > 0) {
    process.stdout.write(`${JSON.stringify({ valid: false, errors: ledger.errors })}\n`);
    process.exitCode = 1;
    return;
  }

  const result = {
    as_of: options.asOf,
    valid: true,
    ready: selectReady(ledger.items, options.asOf),
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseReadyOptions(argumentsList) {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--ledger') {
      options.ledger = argumentsList[++index];
    } else if (argument === '--as-of') {
      options.asOf = argumentsList[++index];
    } else if (argument !== '--json') {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.ledger || !options.asOf || !argumentsList.includes('--json')) {
    throw new Error('Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD --json');
  }

  return options;
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
