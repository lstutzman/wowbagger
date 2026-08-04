#!/usr/bin/env node
import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2), {
  scenario: process.env.WOWBAGGER_TEST_SCENARIO,
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
