#!/usr/bin/env node
import { runSchema2MigrationCli } from '../src/schema-migration.js';

runSchema2MigrationCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
