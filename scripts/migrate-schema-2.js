#!/usr/bin/env node
import { formatSchemaMigrationError, runSchema2MigrationCli } from '../src/schema-migration.js';

runSchema2MigrationCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(formatSchemaMigrationError(error));
  process.exitCode = 1;
});
