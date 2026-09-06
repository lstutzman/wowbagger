import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { threadId } from 'node:worker_threads';

export const HEAVY_WORK_ROWS = 75_000;
export const HEAVY_PAYLOAD_BYTES = 128;

const BUSY_TIMEOUT_MS = 2_000;
const HEAVY_PAYLOAD = 'w'.repeat(HEAVY_PAYLOAD_BYTES);
const WAL_RESET_FIXED_VERSION = '3.51.3';
const WAL_RESET_FIXED_BACKPORTS = new Map([
  ['3.44', 6],
  ['3.50', 7],
]);
const BETTER_SQLITE_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
  'win32-arm64',
  'win32-x64',
]);

function invariant(condition, message, details) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.code = 'P00_INVARIANT';
  if (details !== undefined) {
    error.details = details;
  }
  throw error;
}

function plainRow(row) {
  return row === undefined ? null : { ...row };
}

function firstColumn(row) {
  const values = Object.values(row ?? {});
  invariant(values.length > 0, 'SQLite returned a row without columns', row);
  return values[0];
}

function fileState(filePath) {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }

  const stats = statSync(filePath);
  return {
    exists: true,
    sizeBytes: stats.size,
  };
}

function databaseFiles(databasePath) {
  return {
    database: fileState(databasePath),
    wal: fileState(`${databasePath}-wal`),
    shm: fileState(`${databasePath}-shm`),
  };
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function isWalResetSafe(sqliteVersion) {
  if (compareVersions(sqliteVersion, WAL_RESET_FIXED_VERSION) >= 0) {
    return true;
  }

  const [major, minor, patch] = sqliteVersion.split('.').map(Number);
  const minimumPatch = WAL_RESET_FIXED_BACKPORTS.get(`${major}.${minor}`);
  return minimumPatch !== undefined && patch >= minimumPatch;
}

function currentBetterSqliteTarget() {
  let platform = process.platform;
  if (platform === 'linux') {
    const report = process.report.getReport();
    if (!report.header.glibcVersionRuntime) {
      platform = 'linuxmusl';
    }
  }
  return `${platform}-${process.arch}`;
}

async function loadBinding({ bindingName, moduleRoot }) {
  if (bindingName === 'node:sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    return {
      metadata: {
        name: bindingName,
        packageVersion: process.version,
        packageTarget: `${process.platform}-${process.arch}`,
        resolvedEntrypoint: 'node:sqlite',
      },
      open(databasePath, { readOnly = false } = {}) {
        return new DatabaseSync(databasePath, {
          readOnly,
          timeout: BUSY_TIMEOUT_MS,
        });
      },
    };
  }

  invariant(bindingName === 'better-sqlite3', `Unsupported SQLite binding: ${bindingName}`);
  invariant(typeof moduleRoot === 'string' && moduleRoot.length > 0,
    '--module-root is required for better-sqlite3');

  const packageTarget = currentBetterSqliteTarget();
  invariant(BETTER_SQLITE_TARGETS.has(packageTarget),
    `better-sqlite3@13.0.3 has no declared prebuilt target for ${packageTarget}`);

  const absoluteModuleRoot = path.resolve(moduleRoot);
  const requireFromRoot = createRequire(path.join(absoluteModuleRoot, 'package.json'));
  const targetEntrypoint = `better-sqlite3/${packageTarget}`;
  const resolvedEntrypoint = requireFromRoot.resolve(targetEntrypoint);
  const Database = requireFromRoot(resolvedEntrypoint);
  const packageManifestPath = path.resolve(resolvedEntrypoint, '..', '..', 'package.json');
  const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));

  invariant(packageManifest.name === 'better-sqlite3'
    && packageManifest.version === '13.0.3',
  `Expected better-sqlite3@13.0.3, received ${packageManifest.name}@${packageManifest.version}`);

  return {
    metadata: {
      name: bindingName,
      packageVersion: packageManifest.version,
      packageTarget,
      resolvedEntrypoint,
    },
    open(databasePath, { readOnly = false } = {}) {
      return new Database(databasePath, {
        timeout: BUSY_TIMEOUT_MS,
        ...(readOnly
          ? {
              fileMustExist: true,
              readonly: true,
            }
          : {}),
      });
    },
  };
}

function checkpoint(database, mode = 'TRUNCATE') {
  const row = plainRow(database.prepare(`PRAGMA wal_checkpoint(${mode})`).get());
  invariant(row !== null, 'SQLite did not return a WAL checkpoint result');
  invariant(Number(row.busy) === 0, 'WAL checkpoint reported a busy connection', row);
  return row;
}

function sqliteVersion(database) {
  return String(database.prepare('SELECT sqlite_version() AS sqliteVersion').get().sqliteVersion);
}

function journalMode(database) {
  return String(firstColumn(database.prepare('PRAGMA journal_mode').get())).toLowerCase();
}

function integrityCheck(database) {
  return String(firstColumn(database.prepare('PRAGMA integrity_check').get()));
}

function databaseCounts(database) {
  return plainRow(database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM items) AS itemCount,
      (SELECT COUNT(*) FROM work_log) AS workLogCount
  `).get());
}

function configureExistingDatabase(database) {
  const mode = journalMode(database);
  invariant(mode === 'wal', `Expected WAL journal mode, received ${mode}`);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;
    PRAGMA wal_autocheckpoint = 0;
  `);
  return mode;
}

class DatabaseOwner {
  constructor(binding, databasePath) {
    this.binding = binding;
    this.databasePath = databasePath;
    this.database = null;
    this.initialization = null;
  }

  initialize() {
    invariant(this.database === null, 'Database owner was initialized twice');
    this.database = this.binding.open(this.databasePath);

    const requestedMode = String(firstColumn(
      this.database.prepare('PRAGMA journal_mode = WAL').get(),
    )).toLowerCase();
    invariant(requestedMode === 'wal',
      `SQLite refused WAL journal mode and returned ${requestedMode}`);

    configureExistingDatabase(this.database);
    this.database.exec(`
      CREATE TABLE items (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 0)
      ) STRICT;

      CREATE TABLE work_log (
        mutation_key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (mutation_key, sequence)
      ) STRICT;
    `);

    const embeddedSqliteVersion = sqliteVersion(this.database);
    invariant(isWalResetSafe(embeddedSqliteVersion),
      `SQLite ${embeddedSqliteVersion} is not known to contain the WAL-reset fix`);

    this.initialization = {
      ownerThreadId: threadId,
      binding: this.binding.metadata,
      embeddedSqliteVersion,
      journalMode: requestedMode,
      baselineCheckpoint: checkpoint(this.database),
    };
    return this.initialization;
  }

  metadata() {
    this.#requireOpen();
    return {
      ...this.initialization,
      files: databaseFiles(this.databasePath),
    };
  }

  mutate({ key, expectedRevision, value, workload }) {
    this.#requireOpen();
    invariant(typeof key === 'string' && key.length > 0, 'Mutation key must be a non-empty string');
    invariant(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0,
      'Expected revision must be a non-negative safe integer');
    invariant(typeof value === 'string', 'Mutation value must be a string');
    invariant(workload === 'light' || workload === 'heavy',
      `Unsupported mutation workload: ${workload}`);

    const startedAt = performance.now();
    let transactionActive = false;

    try {
      this.database.exec('BEGIN IMMEDIATE');
      transactionActive = true;

      let current = plainRow(this.database.prepare(
        'SELECT revision, value FROM items WHERE key = ?',
      ).get(key));

      if (current === null) {
        if (expectedRevision !== 0) {
          this.database.exec('ROLLBACK');
          transactionActive = false;
          return {
            ownerThreadId: threadId,
            outcome: 'conflict',
            key,
            expectedRevision,
            actualRevision: null,
            durationMs: performance.now() - startedAt,
          };
        }

        this.database.prepare(
          'INSERT INTO items (key, value, revision) VALUES (?, ?, 0)',
        ).run(key, '');
        current = {
          revision: 0,
          value: '',
        };
      }

      const actualRevision = Number(current.revision);
      if (actualRevision !== expectedRevision) {
        this.database.exec('ROLLBACK');
        transactionActive = false;
        return {
          ownerThreadId: threadId,
          outcome: 'conflict',
          key,
          expectedRevision,
          actualRevision,
          durationMs: performance.now() - startedAt,
        };
      }

      if (workload === 'heavy') {
        this.database.prepare(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 1
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < ?
          )
          INSERT INTO work_log (mutation_key, sequence, payload)
          SELECT ?, value, ? FROM sequence
        `).run(HEAVY_WORK_ROWS, key, HEAVY_PAYLOAD);
      }

      const update = this.database.prepare(`
        UPDATE items
        SET value = ?, revision = revision + 1
        WHERE key = ? AND revision = ?
      `).run(value, key, expectedRevision);
      invariant(Number(update.changes) === 1, 'CAS update did not change exactly one item', update);

      this.database.exec('COMMIT');
      transactionActive = false;

      return {
        ownerThreadId: threadId,
        outcome: 'committed',
        key,
        revision: expectedRevision + 1,
        value,
        workload,
        heavyWorkRows: workload === 'heavy' ? HEAVY_WORK_ROWS : 0,
        durationMs: performance.now() - startedAt,
      };
    } catch (error) {
      if (transactionActive) {
        try {
          this.database.exec('ROLLBACK');
        } catch (rollbackError) {
          error.rollbackError = {
            name: rollbackError.name,
            message: rollbackError.message,
            code: rollbackError.code ?? null,
          };
        }
      }
      throw error;
    }
  }

  read({ key }) {
    this.#requireOpen();
    return {
      ownerThreadId: threadId,
      item: plainRow(this.database.prepare(
        'SELECT key, value, revision FROM items WHERE key = ?',
      ).get(key)),
    };
  }

  snapshot() {
    this.#requireOpen();
    return {
      ownerThreadId: threadId,
      counts: databaseCounts(this.database),
      embeddedSqliteVersion: sqliteVersion(this.database),
      journalMode: journalMode(this.database),
      integrityCheck: integrityCheck(this.database),
      files: databaseFiles(this.databasePath),
    };
  }

  exerciseRecovery({ recoveryDirectory }) {
    this.#requireOpen();
    invariant(typeof recoveryDirectory === 'string' && recoveryDirectory.length > 0,
      'Recovery directory must be a non-empty path');
    invariant(!existsSync(recoveryDirectory),
      `Recovery directory already exists: ${recoveryDirectory}`);

    const rollbackKey = 'recovery-rolled-back';
    const committedKey = 'recovery-committed';
    const baselineCheckpoint = checkpoint(this.database);

    this.database.exec('BEGIN IMMEDIATE');
    this.database.prepare(
      'INSERT INTO items (key, value, revision) VALUES (?, ?, 1)',
    ).run(rollbackKey, 'must-not-survive');
    this.database.exec('ROLLBACK');
    invariant(this.database.prepare('SELECT key FROM items WHERE key = ?').get(rollbackKey) === undefined,
      'Rolled-back item remained visible');

    this.database.exec('BEGIN IMMEDIATE');
    this.database.prepare(
      'INSERT INTO items (key, value, revision) VALUES (?, ?, 1)',
    ).run(committedKey, 'must-survive');
    this.database.exec('COMMIT');

    const sourceWalBeforeCopy = fileState(`${this.databasePath}-wal`);
    invariant(sourceWalBeforeCopy.exists && sourceWalBeforeCopy.sizeBytes > 0,
      'Committed recovery marker did not leave a non-empty WAL file', sourceWalBeforeCopy);

    mkdirSync(recoveryDirectory, {
      mode: 0o700,
      recursive: false,
    });
    const recoveredDatabasePath = path.join(recoveryDirectory, 'recovered.sqlite');
    copyFileSync(this.databasePath, recoveredDatabasePath);
    copyFileSync(`${this.databasePath}-wal`, `${recoveredDatabasePath}-wal`);

    let recoveredDatabase = this.binding.open(recoveredDatabasePath);
    let recoveredBeforeCheckpoint;
    let recoveredCheckpoint;
    try {
      const recoveredMarker = plainRow(recoveredDatabase.prepare(
        'SELECT key, value, revision FROM items WHERE key = ?',
      ).get(committedKey));
      invariant(recoveredMarker?.value === 'must-survive' && Number(recoveredMarker.revision) === 1,
        'Copied WAL did not replay the committed marker', recoveredMarker);
      invariant(recoveredDatabase.prepare('SELECT key FROM items WHERE key = ?').get(rollbackKey) === undefined,
        'Copied WAL exposed the rolled-back marker');
      recoveredBeforeCheckpoint = {
        marker: recoveredMarker,
        rolledBackMarker: plainRow(recoveredDatabase.prepare(
          'SELECT key, value, revision FROM items WHERE key = ?',
        ).get(rollbackKey)),
        counts: databaseCounts(recoveredDatabase),
        integrityCheck: integrityCheck(recoveredDatabase),
        files: databaseFiles(recoveredDatabasePath),
      };
      invariant(recoveredBeforeCheckpoint.integrityCheck === 'ok',
        'Copied WAL database failed integrity_check before checkpoint',
        recoveredBeforeCheckpoint);
      recoveredCheckpoint = checkpoint(recoveredDatabase);
    } finally {
      recoveredDatabase.close();
      recoveredDatabase = null;
    }

    const recoveredReopened = this.binding.open(recoveredDatabasePath, { readOnly: true });
    let recoveredAfterReopen;
    try {
      recoveredAfterReopen = {
        marker: plainRow(recoveredReopened.prepare(
          'SELECT key, value, revision FROM items WHERE key = ?',
        ).get(committedKey)),
        rolledBackMarker: plainRow(recoveredReopened.prepare(
          'SELECT key, value, revision FROM items WHERE key = ?',
        ).get(rollbackKey)),
        counts: databaseCounts(recoveredReopened),
        integrityCheck: integrityCheck(recoveredReopened),
      };
      invariant(recoveredAfterReopen.marker?.value === 'must-survive',
        'Recovered database lost the marker after checkpoint and reopen', recoveredAfterReopen);
      invariant(recoveredAfterReopen.integrityCheck === 'ok',
        'Recovered database failed integrity_check', recoveredAfterReopen);
      invariant(recoveredAfterReopen.rolledBackMarker === null,
        'Recovered database exposed the rolled-back marker after checkpoint and reopen',
        recoveredAfterReopen);
    } finally {
      recoveredReopened.close();
    }

    const sourceCloseStartedAt = performance.now();
    this.database.close();
    this.database = null;
    const sourceCloseDurationMs = performance.now() - sourceCloseStartedAt;
    const sourceFilesAfterClose = databaseFiles(this.databasePath);

    const sourceReopenStartedAt = performance.now();
    this.database = this.binding.open(this.databasePath);
    configureExistingDatabase(this.database);
    const sourceReopenDurationMs = performance.now() - sourceReopenStartedAt;
    const sourceMarkerAfterReopen = plainRow(this.database.prepare(
      'SELECT key, value, revision FROM items WHERE key = ?',
    ).get(committedKey));
    invariant(sourceMarkerAfterReopen?.value === 'must-survive',
      'Source database lost the committed marker after close and reopen', sourceMarkerAfterReopen);
    invariant(this.database.prepare('SELECT key FROM items WHERE key = ?').get(rollbackKey) === undefined,
      'Source database exposed the rolled-back marker after reopen');

    return {
      ownerThreadId: threadId,
      method: 'copied-idle-wal-replay',
      baselineCheckpoint,
      sourceWalBeforeCopy,
      recoveredBeforeCheckpoint,
      recoveredCheckpoint,
      recoveredFilesAfterClose: databaseFiles(recoveredDatabasePath),
      recoveredAfterReopen,
      sourceCloseDurationMs,
      sourceFilesAfterClose,
      sourceReopenDurationMs,
      sourceMarkerAfterReopen,
      limitations: [
        'The source connection was idle and remained alive while the database and WAL files were copied.',
        'The SHM file was intentionally omitted so SQLite rebuilt the WAL index.',
        'This does not prove recovery after a killed process, machine crash, power loss, or torn write.',
      ],
    };
  }

  close() {
    if (this.database === null) {
      return {
        ownerThreadId: threadId,
        alreadyClosed: true,
      };
    }

    const database = this.database;
    this.database = null;
    const filesBefore = databaseFiles(this.databasePath);
    const startedAt = performance.now();
    let finalCheckpoint = null;
    let checkpointError = null;
    let closeError = null;

    try {
      finalCheckpoint = checkpoint(database);
    } catch (error) {
      checkpointError = error;
    }
    try {
      database.close();
    } catch (error) {
      closeError = error;
    }

    const closeResult = {
      ownerThreadId: threadId,
      alreadyClosed: false,
      finalCheckpoint,
      durationMs: performance.now() - startedAt,
      filesBefore,
      filesAfter: databaseFiles(this.databasePath),
    };
    if (checkpointError !== null || closeError !== null) {
      const error = checkpointError ?? closeError;
      error.details = {
        originalDetails: error.details ?? null,
        closeResult,
        secondaryCloseError: checkpointError !== null && closeError !== null
          ? {
              name: closeError.name,
              code: closeError.code ?? null,
              message: closeError.message,
            }
          : null,
      };
      throw error;
    }
    return closeResult;
  }

  #requireOpen() {
    invariant(this.database !== null, 'Database owner is closed');
  }
}

export async function createDatabaseOwner(configuration) {
  const binding = await loadBinding(configuration);
  const owner = new DatabaseOwner(binding, configuration.databasePath);
  try {
    owner.initialize();
    return owner;
  } catch (error) {
    try {
      owner.close();
    } catch (closeError) {
      error.closeError = {
        name: closeError.name,
        code: closeError.code ?? null,
        message: closeError.message,
        details: closeError.details ?? null,
      };
    }
    throw error;
  }
}

export async function inspectClosedDatabase(configuration) {
  const binding = await loadBinding(configuration);
  const filesBefore = databaseFiles(configuration.databasePath);
  const database = binding.open(configuration.databasePath, { readOnly: true });

  try {
    const counts = databaseCounts(database);
    return {
      inspectionThreadId: threadId,
      binding: binding.metadata,
      counts,
      embeddedSqliteVersion: sqliteVersion(database),
      journalMode: journalMode(database),
      integrityCheck: integrityCheck(database),
      committedRecoveryItem: plainRow(database.prepare(
        'SELECT key, value, revision FROM items WHERE key = ?',
      ).get('recovery-committed')),
      rolledBackRecoveryItem: plainRow(database.prepare(
        'SELECT key, value, revision FROM items WHERE key = ?',
      ).get('recovery-rolled-back')),
      filesBefore,
    };
  } finally {
    database.close();
  }
}
