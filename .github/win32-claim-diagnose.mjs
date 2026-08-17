// TEMPORARY diagnostic for the win32 CI failures. Reproduces the
// provisionedLedger fixture sequence and prints the raw error the CLI's
// claim-store-unreadable envelope swallows. Delete once the root cause ships.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repo, 'bin', 'wowbagger.js');
const root = mkdtempSync(path.join(tmpdir(), 'wb-diag-'));
const ledger = path.join(root, 'ledger');
mkdirSync(path.join(ledger, 'items'), { recursive: true });

function sh(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options });
    console.log(`$ ${command} ${args.join(' ')}\n${stdout}`);
    return stdout;
  } catch (error) {
    console.log(`$ ${command} ${args.join(' ')} FAILED status=${error.status}`);
    console.log('stdout:', error.stdout);
    console.log('stderr:', error.stderr);
    return error.stdout ?? '';
  }
}

sh('git', ['init', '--quiet']);
sh('git', ['config', 'user.email', 'diag@example.com']);
sh('git', ['config', 'user.name', 'Diag']);
writeFileSync(path.join(ledger, 'items', 'wb_01ARZ3NDEKTSV4RRFFQ69G5FAV.md'), `---
schema_version: 2
id: wb_01ARZ3NDEKTSV4RRFFQ69G5FAV
title: "Diagnostic item"
kind: task
status: backlog
created: 2026-08-17
updated: 2026-08-17
number: 1
provenance:
  source: maintainer-dogfood
  recorded_at: 2026-08-17T00:00:00.000Z
depends_on: []
related: []
---

Diagnostic body.
`);
sh('git', ['add', '-A']);
sh('git', ['commit', '--quiet', '-m', 'seed']);
sh(process.execPath, [cli, 'provision', '--ledger', 'ledger', '--json']);
sh(process.execPath, [cli, 'claim-verify', '--ledger', 'ledger', '--json']);

// Now the direct call, with the raw stack the CLI hides.
const namespace = readFileSync(path.join(ledger, '.wowbagger', 'namespace'), 'utf8').trim();
console.log('namespace:', namespace);
const claimStore = await import(pathToFileURL(path.join(repo, 'src', 'claim-store.js')));
console.log('claim-store exports:', Object.keys(claimStore));
for (const name of Object.keys(claimStore)) {
  const fn = claimStore[name];
  if (typeof fn !== 'function' || fn.length > 2) continue;
}
try {
  const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const resolved = path.resolve(root, gitCommonDir);
  console.log('gitCommonDir:', resolved);
  const journal = await import(pathToFileURL(path.join(repo, 'src', 'claim-journal.js')));
  console.log('claim-journal exports:', Object.keys(journal));
  if (journal.claimJournalPath && journal.replayClaimJournal) {
    const jp = journal.claimJournalPath(resolved, namespace);
    console.log('journalPath:', jp);
    const replayed = await journal.replayClaimJournal(jp, namespace);
    console.log('replay ok:', JSON.stringify(replayed.state).slice(0, 200));
  }
} catch (error) {
  console.log('RAW ERROR:', error?.code, error?.message);
  console.log(error?.stack);
  if (error?.cause) console.log('CAUSE:', error.cause?.code, error.cause?.message, error.cause?.stack);
}

// Deeper: the CLI's claim-verify maps every reconciliation error to
// claim-store-unreadable. Call the pipeline directly and print the raw stack.
try {
  const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const resolved = path.resolve(root, gitCommonDir);
  const publication = await import(pathToFileURL(path.join(repo, 'src', 'claim-publication.js')));
  process.env.WOWBAGGER_DEBUG_CLAIM_STORE = '1';
  const verified = await publication.verifyClaimJournal({
    ledgerDirectory: ledger,
    gitCommonDir: resolved,
    namespace,
  });
  console.log('verify envelope:', JSON.stringify(verified.stdout).slice(0, 300));
} catch (error) {
  console.log('RECONCILE RAW ERROR:', error?.code, error?.message);
  console.log(error?.stack);
  let cause = error?.cause;
  while (cause) {
    console.log('CAUSE:', cause?.code, cause?.message);
    console.log(cause?.stack);
    cause = cause.cause;
  }
}

// Also run the implementation runner and print each failing assertion in full.
try {
  const runner = path.join(repo, 'spec', 'run-adapter-implementation.js');
  const out = execFileSync(process.execPath, [runner], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const report = JSON.parse(out);
  console.log('runner status:', report.status);
  for (const c of report.cases ?? []) {
    for (const a of c.executed_assertions ?? []) {
      if (a.ok === false) console.log('FAILING', c.case ?? c.id, JSON.stringify(a).slice(0, 2000));
    }
  }
} catch (error) {
  console.log('runner crashed:', error?.message?.slice(0, 500));
  console.log((error?.stdout ?? '').slice(0, 1000));
}
