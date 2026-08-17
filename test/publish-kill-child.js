// A publication that stops at one barrier and waits to be killed. The kill
// point tests spawn this, wait for the barrier marker, and send SIGKILL, so
// the namespace process lock is left held by a dead PID exactly as it would be
// after a crash. Arguments: ledger, gitCommonDir, namespace, request JSON
// path, barrier name.
import { readFile } from 'node:fs/promises';

import { publishClaimed } from '../src/claim-publication.js';

const [ledgerDirectory, gitCommonDir, namespace, requestPath, point] = process.argv.slice(2);
const request = JSON.parse(await readFile(requestPath, 'utf8'));

const outcome = await publishClaimed({
  ledgerDirectory,
  gitCommonDir,
  namespace,
  request,
  scenario: `hang:${point}`,
});

// Reached only when the barrier was never hit, which is a broken test rather
// than a recovery case. Say so instead of exiting zero.
process.stdout.write(`${JSON.stringify(outcome)}\n`);
process.exit(90);
