import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  isMainThread,
  threadId,
  Worker,
} from 'node:worker_threads';

import { requestJson } from './http-client.mjs';

const EXACT_NODE_VERSION = 'v24.20.0';
const REQUEST_TIMEOUT_MS = 20_000;
const OWNER_RPC_TIMEOUT_MS = 30_000;
const TRAFFIC_DEADLINE_MS = 45_000;
const TRAFFIC_PARENT_DEADLINE_MS = 50_000;
const DATABASE_WORKER_IDLE_DEADLINE_MS = 90_000;
const SERVER_OPERATION_DEADLINE_MS = 10_000;
const PING_COUNT = 32;
const LIGHT_MUTATION_COUNT = 8;
const CAS_REQUEST_COUNT = 12;
const EXPECTED_ITEM_COUNT = 1 + 1 + LIGHT_MUTATION_COUNT + 1 + 1;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);

const mainWarnings = [];
process.on('warning', (warning) => {
  mainWarnings.push({
    origin: 'main',
    name: warning.name,
    code: warning.code ?? null,
    message: warning.message,
    stack: warning.stack ?? null,
  });
});

const probeDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceManifestPath = path.join(probeDirectory, 'primary-sources.json');

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

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    details: error?.details ?? null,
    rollbackError: error?.rollbackError ?? null,
    cleanupErrors: error?.cleanupErrors ?? [],
  };
}

function errorFromSerialized(serialized) {
  const error = new Error(serialized?.message ?? 'Worker failed without an error message');
  error.name = serialized?.name ?? 'Error';
  error.code = serialized?.code ?? null;
  error.details = serialized?.details ?? null;
  error.workerStack = serialized?.stack ?? null;
  return error;
}

function nextTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function withDeadline(promise, timeoutMs, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} exceeded ${timeoutMs} ms`);
      error.code = 'P00_DEADLINE';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timer);
  });
}

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function summarizeDurations(values) {
  invariant(values.length > 0, 'Cannot summarize an empty duration set');
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => {
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[index];
  };

  return {
    minimumMs: roundMilliseconds(sorted[0]),
    p50Ms: roundMilliseconds(percentile(0.5)),
    p95Ms: roundMilliseconds(percentile(0.95)),
    maximumMs: roundMilliseconds(sorted.at(-1)),
  };
}

function parseArguments(argumentsList) {
  const options = {
    bindingName: 'node:sqlite',
    moduleRoot: null,
  };

  for (const argument of argumentsList) {
    if (argument.startsWith('--binding=')) {
      options.bindingName = argument.slice('--binding='.length);
      continue;
    }
    if (argument.startsWith('--module-root=')) {
      options.moduleRoot = path.resolve(argument.slice('--module-root='.length));
      continue;
    }
    throw new Error(`Unknown probe argument: ${argument}`);
  }

  invariant(options.bindingName === 'node:sqlite' || options.bindingName === 'better-sqlite3',
    `Unsupported binding: ${options.bindingName}`);
  if (options.bindingName === 'better-sqlite3') {
    invariant(options.moduleRoot !== null,
      '--module-root is required when --binding=better-sqlite3');
    const relativeModuleRoot = path.relative(probeDirectory, options.moduleRoot);
    invariant(relativeModuleRoot !== '..'
      && !relativeModuleRoot.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeModuleRoot),
    'The better-sqlite3 module root must remain inside the assigned p00-runtime directory');
  } else {
    invariant(options.moduleRoot === null,
      '--module-root is only valid when --binding=better-sqlite3');
  }

  return options;
}

function runtimeMetadata() {
  return {
    node: process.version,
    nodeEmbeddedSqlite: process.versions.sqlite ?? null,
    platform: process.platform,
    arch: process.arch,
    execArgv: [...process.execArgv],
    temporaryEnvironment: process.platform === 'win32'
      ? {
          TEMP: process.env.TEMP ?? null,
          TMP: process.env.TMP ?? null,
        }
      : {
          TMPDIR: process.env.TMPDIR ?? null,
        },
    osRelease: os.release(),
  };
}

function assertRuntime() {
  invariant(isMainThread && threadId === 0, 'probe.mjs must run on the main thread');
  invariant(process.version === EXACT_NODE_VERSION,
    `P00 requires ${EXACT_NODE_VERSION}; received ${process.version}`);
  invariant(SUPPORTED_PLATFORMS.has(process.platform),
    `P00 supports only darwin, linux, and win32; received ${process.platform}`);
  invariant(process.execArgv.includes('--pending-deprecation'),
    'P00 requires --pending-deprecation');
  invariant(process.execArgv.includes('--throw-deprecation'),
    'P00 requires --throw-deprecation');
  invariant(typeof process.versions.sqlite === 'string',
    'The exact Node runtime did not report process.versions.sqlite');

  if (process.platform === 'win32') {
    invariant(Boolean(process.env.TEMP) && Boolean(process.env.TMP),
      'Windows runs must pin both TEMP and TMP to a private runner temporary directory');
  } else {
    invariant(process.env.TMPDIR === '/tmp',
      `POSIX runs require TMPDIR=/tmp; received ${process.env.TMPDIR ?? '<unset>'}`);
  }
}

function createRunDirectory(bindingName) {
  const runsRoot = path.join(probeDirectory, 'runs');
  mkdirSync(runsRoot, {
    mode: 0o700,
    recursive: true,
  });
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const bindingLabel = bindingName.replace(':', '-');
  return mkdtempSync(path.join(
    runsRoot,
    `${timestamp}-${process.platform}-${process.arch}-${bindingLabel}-`,
  ));
}

function warningCollector() {
  const warnings = [];
  const signatures = new Set();

  return {
    add(origin, incoming) {
      for (const warning of incoming ?? []) {
        const normalized = {
          origin,
          name: warning.name,
          code: warning.code ?? null,
          message: warning.message,
          stack: warning.stack ?? null,
        };
        const signature = JSON.stringify(normalized);
        if (!signatures.has(signature)) {
          signatures.add(signature);
          warnings.push(normalized);
        }
      }
    },
    values() {
      return [...warnings];
    },
  };
}

function recordOwnerThread(ownerThreadIds, value) {
  if (Number.isInteger(value?.ownerThreadId)) {
    ownerThreadIds.add(value.ownerThreadId);
  }
}

async function createInProcessOwner(databaseApi, databaseConfiguration) {
  const warningsBeforeImport = mainWarnings.length;
  const database = await databaseApi.createDatabaseOwner(databaseConfiguration);
  await nextTurn();

  if (mainWarnings.length > warningsBeforeImport) {
    const closeResult = database.close();
    const error = new Error('In-process SQLite binding emitted a runtime warning during startup');
    error.code = 'P00_RUNTIME_WARNING';
    error.details = {
      warnings: mainWarnings.slice(warningsBeforeImport),
      closeResult,
    };
    throw error;
  }

  const ownerThreadIds = new Set();
  const metadata = database.metadata();
  recordOwnerThread(ownerThreadIds, metadata);
  let closed = false;
  let shutdownResult = null;

  return {
    metadata,
    ownerThreadIds,
    workerWarnings: [],
    async call(method, argumentsValue = undefined) {
      invariant(!closed, `Cannot call ${method} after in-process owner shutdown`);
      let value;
      switch (method) {
        case 'mutate':
          value = database.mutate(argumentsValue);
          break;
        case 'read':
          value = database.read(argumentsValue);
          break;
        case 'snapshot':
          value = database.snapshot();
          break;
        case 'exerciseRecovery':
          value = database.exerciseRecovery(argumentsValue);
          break;
        default:
          throw new Error(`Unsupported in-process owner method: ${method}`);
      }
      recordOwnerThread(ownerThreadIds, value);
      return value;
    },
    isClosed() {
      return closed;
    },
    async shutdown() {
      if (closed) {
        return shutdownResult;
      }
      shutdownResult = database.close();
      recordOwnerThread(ownerThreadIds, shutdownResult);
      closed = true;
      return shutdownResult;
    },
  };
}

async function createDatabaseWorkerOwner(databaseConfiguration, collectedWarnings) {
  const worker = new Worker(new URL('./database-worker.mjs', import.meta.url), {
    workerData: {
      databaseConfiguration,
      idleDeadlineMs: DATABASE_WORKER_IDLE_DEADLINE_MS,
    },
  });
  const ownerThreadIds = new Set();
  const pending = new Map();
  let nextRequestId = 1;
  let readySettled = false;
  let exited = false;
  let exitCode = null;
  let closed = false;
  let shutdownResult = null;

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  worker.on('message', (message) => {
    collectedWarnings.add('database-worker', message.warnings);

    switch (message?.type) {
      case 'ready':
        readySettled = true;
        recordOwnerThread(ownerThreadIds, message.metadata);
        resolveReady(message.metadata);
        break;
      case 'startup-error':
        readySettled = true;
        rejectReady(errorFromSerialized(message.error));
        break;
      case 'response': {
        const entry = pending.get(message.id);
        if (entry === undefined) {
          break;
        }
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          entry.reject(errorFromSerialized(message.error));
        } else {
          recordOwnerThread(ownerThreadIds, message.value);
          entry.resolve(message.value);
        }
        break;
      }
      case 'deadline': {
        const error = message.error
          ? errorFromSerialized(message.error)
          : new Error('Database worker reached its cooperative idle deadline');
        error.code ??= 'P00_DATABASE_WORKER_DEADLINE';
        rejectPending(error);
        break;
      }
      default:
        break;
    }
  });

  worker.on('error', (error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    rejectPending(error);
  });

  worker.on('exit', (code) => {
    exited = true;
    exitCode = code;
    const error = new Error(`Database worker exited with code ${code}`);
    error.code = 'P00_DATABASE_WORKER_EXIT';
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    rejectPending(error);
    resolveExit(code);
  });

  const metadata = await withDeadline(
    readyPromise,
    OWNER_RPC_TIMEOUT_MS,
    'database worker startup',
  );
  invariant(collectedWarnings.values().length === 0,
    'Database worker emitted a runtime warning during startup', collectedWarnings.values());

  const call = (method, argumentsValue = undefined) => {
    invariant(!exited, `Cannot call ${method} after database worker exit`);
    invariant(!closed, `Cannot call ${method} after database worker shutdown`);
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`Database worker ${method} call exceeded ${OWNER_RPC_TIMEOUT_MS} ms`);
        error.code = 'P00_DATABASE_RPC_DEADLINE';
        reject(error);
      }, OWNER_RPC_TIMEOUT_MS);

      pending.set(id, {
        resolve,
        reject,
        timer,
      });

      try {
        worker.postMessage({
          type: 'call',
          id,
          method,
          arguments: argumentsValue,
        });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  };

  return {
    metadata,
    ownerThreadIds,
    get workerWarnings() {
      return collectedWarnings.values();
    },
    call,
    isClosed() {
      return closed || exited;
    },
    async shutdown() {
      if (shutdownResult !== null) {
        return shutdownResult;
      }
      if (exited) {
        invariant(exitCode === 0, `Database worker exited before shutdown with code ${exitCode}`);
        closed = true;
        shutdownResult = {
          alreadyExited: true,
          exitCode,
        };
        return shutdownResult;
      }

      const startedAt = performance.now();
      const databaseClose = await call('shutdown');
      closed = true;
      const code = await withDeadline(
        exitPromise,
        OWNER_RPC_TIMEOUT_MS,
        'database worker exit',
      );
      invariant(code === 0, `Database worker exited with code ${code}`);
      shutdownResult = {
        databaseClose,
        exitCode: code,
        roundTripAndExitDurationMs: performance.now() - startedAt,
      };
      return shutdownResult;
    },
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.byteLength;
      if (size > 64 * 1_024) {
        const error = new Error('Probe request body exceeded 64 KiB');
        error.code = 'P00_REQUEST_TOO_LARGE';
        reject(error);
        request.destroy(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(statusCode, {
    connection: 'close',
    'content-length': payload.byteLength,
    'content-type': 'application/json',
  });
  response.end(payload);
}

async function createHttpService(owner, modeName) {
  let notifyHeavyStart = null;
  let heavyMutationActive = false;
  let heavyMutationSeen = false;
  let closed = false;
  let closeResult = null;

  const server = http.createServer((request, response) => {
    const handleRequest = async () => {
      const url = new URL(request.url, 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/ping') {
        writeJson(response, 200, {
          ok: true,
          mode: modeName,
          duringHeavyMutation: heavyMutationActive,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/mutate') {
        const body = await readJsonBody(request);
        const isHeavy = body.workload === 'heavy';

        if (isHeavy) {
          invariant(!heavyMutationSeen, 'Each mode permits exactly one heavy mutation');
          invariant(typeof notifyHeavyStart === 'function',
            'Heavy mutation arrived before the traffic worker was armed');
          heavyMutationSeen = true;
          heavyMutationActive = true;
          notifyHeavyStart();
        }

        let result;
        try {
          result = await owner.call('mutate', body);
        } finally {
          if (isHeavy) {
            heavyMutationActive = false;
          }
        }

        writeJson(response, result.outcome === 'committed' ? 200 : 409, result);
        return;
      }

      writeJson(response, 404, {
        error: 'not-found',
      });
    };

    handleRequest().catch((error) => {
      if (!response.headersSent) {
        writeJson(response, 500, {
          error: serializeError(error),
        });
      } else {
        response.destroy(error);
      }
    });
  });

  await withDeadline(new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(error);
    };
    server.once('error', onError);
    server.listen({
      host: '127.0.0.1',
      port: 0,
      exclusive: true,
    }, () => {
      server.off('error', onError);
      resolve();
    });
  }), SERVER_OPERATION_DEADLINE_MS, `${modeName} HTTP listen`);

  const address = server.address();
  invariant(address !== null && typeof address !== 'string',
    'HTTP server did not return a TCP address', address);
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    serverThreadId: threadId,
    setHeavyNotifier(notifier) {
      notifyHeavyStart = notifier;
    },
    isClosed() {
      return closed;
    },
    async close() {
      if (closed) {
        return closeResult;
      }
      const startedAt = performance.now();
      await withDeadline(new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }), SERVER_OPERATION_DEADLINE_MS, `${modeName} HTTP close`);
      closed = true;
      closeResult = {
        durationMs: performance.now() - startedAt,
      };
      return closeResult;
    },
  };
}

async function runTrafficScenario(service, modeName) {
  const collectedWarnings = warningCollector();
  const worker = new Worker(new URL('./traffic-worker.mjs', import.meta.url), {
    workerData: {
      deadlineMs: TRAFFIC_DEADLINE_MS,
    },
  });
  let exited = false;
  let resultSettled = false;

  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  worker.on('message', (message) => {
    collectedWarnings.add('traffic-worker', message.warnings ?? message.result?.warnings);
    if (message?.type === 'result') {
      resultSettled = true;
      resolveResult(message.result);
    } else if (message?.type === 'error') {
      resultSettled = true;
      rejectResult(errorFromSerialized(message.error));
    }
  });
  worker.on('error', (error) => {
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(error);
    }
  });
  worker.on('exit', (code) => {
    exited = true;
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(new Error(`Traffic worker exited before returning a result (code ${code})`));
    }
    resolveExit(code);
  });

  service.setHeavyNotifier(() => {
    worker.postMessage({ type: 'heavy-started' });
  });
  worker.postMessage({
    type: 'run',
    configuration: {
      origin: service.origin,
      pingCount: PING_COUNT,
      lightMutationCount: LIGHT_MUTATION_COUNT,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    },
  });

  try {
    const result = await withDeadline(
      resultPromise,
      TRAFFIC_PARENT_DEADLINE_MS,
      `${modeName} responsiveness traffic`,
    );
    const exitCode = await withDeadline(
      exitPromise,
      REQUEST_TIMEOUT_MS,
      `${modeName} traffic worker exit`,
    );
    invariant(exitCode === 0, `${modeName} traffic worker exited with code ${exitCode}`);
    invariant(collectedWarnings.values().length === 0,
      `${modeName} traffic worker emitted a runtime warning`, collectedWarnings.values());
    return {
      ...result,
      workerExitCode: exitCode,
      workerWarnings: collectedWarnings.values(),
    };
  } catch (error) {
    if (!exited) {
      worker.postMessage({ type: 'stop' });
      try {
        await withDeadline(exitPromise, REQUEST_TIMEOUT_MS, `${modeName} stopped traffic worker exit`);
      } catch (exitError) {
        error.cleanupErrors ??= [];
        error.cleanupErrors.push(serializeError(exitError));
      }
    }
    throw error;
  } finally {
    service.setHeavyNotifier(null);
  }
}

async function runWarmup(origin) {
  const response = await requestJson(origin, '/mutate', {
    method: 'POST',
    body: {
      key: 'warmup',
      expectedRevision: 0,
      value: 'warmup-value',
      workload: 'light',
    },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  invariant(response.statusCode === 200 && response.body?.outcome === 'committed',
    'Warm-up mutation did not commit', response);
  return response;
}

async function runCasScenario(origin, owner) {
  const responses = await withDeadline(Promise.all(
    Array.from({ length: CAS_REQUEST_COUNT }, (_, index) =>
      requestJson(origin, '/mutate', {
        method: 'POST',
        body: {
          key: 'cas-shared',
          expectedRevision: 0,
          value: `cas-value-${index}`,
          workload: 'light',
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
      })),
  ), REQUEST_TIMEOUT_MS, 'CAS contention requests');

  const committed = responses.filter((response) =>
    response.statusCode === 200 && response.body?.outcome === 'committed');
  const conflicts = responses.filter((response) =>
    response.statusCode === 409 && response.body?.outcome === 'conflict');
  invariant(committed.length === 1,
    `CAS contention committed ${committed.length} requests instead of one`, responses);
  invariant(conflicts.length === CAS_REQUEST_COUNT - 1,
    `CAS contention returned ${conflicts.length} conflicts instead of ${CAS_REQUEST_COUNT - 1}`,
    responses);

  const finalRead = await owner.call('read', { key: 'cas-shared' });
  invariant(Number(finalRead.item?.revision) === 1,
    'CAS item did not finish at revision 1', finalRead);

  return {
    requestCount: CAS_REQUEST_COUNT,
    committedCount: committed.length,
    conflictCount: conflicts.length,
    latency: summarizeDurations(responses.map((response) => response.durationMs)),
    finalItem: finalRead.item,
    responses,
  };
}

async function verifyHttpClosed(origin) {
  try {
    const response = await requestJson(origin, '/ping', {
      timeoutMs: 1_000,
    });
    const error = new Error('HTTP server accepted a request after close completed');
    error.code = 'P00_HTTP_STILL_OPEN';
    error.details = response;
    throw error;
  } catch (error) {
    if (error.code === 'P00_HTTP_STILL_OPEN') {
      throw error;
    }
    invariant(error.code === 'ECONNREFUSED',
      'HTTP close produced an unexpected connection result', serializeError(error));
    return {
      refused: true,
      code: error.code,
      message: error.message,
    };
  }
}

async function runMode({
  modeName,
  modeDirectory,
  databaseApi,
  bindingOptions,
}) {
  mkdirSync(modeDirectory, {
    mode: 0o700,
    recursive: false,
  });
  const databasePath = path.join(modeDirectory, 'ledger.sqlite');
  const databaseConfiguration = {
    bindingName: bindingOptions.bindingName,
    moduleRoot: bindingOptions.moduleRoot,
    databasePath,
  };
  const databaseWorkerWarnings = warningCollector();
  const owner = modeName === 'in-process'
    ? await createInProcessOwner(databaseApi, databaseConfiguration)
    : await createDatabaseWorkerOwner(databaseConfiguration, databaseWorkerWarnings);
  let service = null;
  let failure = null;

  try {
    service = await createHttpService(owner, modeName);
    const warmup = await runWarmup(service.origin);
    const responsiveness = await runTrafficScenario(service, modeName);
    const cas = await runCasScenario(service.origin, owner);
    const recovery = await owner.call('exerciseRecovery', {
      recoveryDirectory: path.join(modeDirectory, 'copied-wal-recovery'),
    });
    invariant(Number(recovery.recoveredBeforeCheckpoint.counts.itemCount)
      === EXPECTED_ITEM_COUNT,
    `${modeName} copied WAL replay recovered an unexpected number of items`,
    recovery.recoveredBeforeCheckpoint);
    invariant(Number(recovery.recoveredBeforeCheckpoint.counts.workLogCount)
      === databaseApi.HEAVY_WORK_ROWS,
    `${modeName} copied WAL replay recovered an unexpected number of work rows`,
    recovery.recoveredBeforeCheckpoint);
    invariant(Number(recovery.recoveredAfterReopen.counts.itemCount)
      === EXPECTED_ITEM_COUNT,
    `${modeName} recovered database lost or added items after checkpoint and reopen`,
    recovery.recoveredAfterReopen);
    invariant(Number(recovery.recoveredAfterReopen.counts.workLogCount)
      === databaseApi.HEAVY_WORK_ROWS,
    `${modeName} recovered database lost or added work rows after checkpoint and reopen`,
    recovery.recoveredAfterReopen);
    const preShutdown = await owner.call('snapshot');

    invariant(preShutdown.integrityCheck === 'ok',
      `${modeName} database failed integrity_check before shutdown`, preShutdown);
    invariant(Number(preShutdown.counts.itemCount) === EXPECTED_ITEM_COUNT,
      `${modeName} stored an unexpected number of items`, preShutdown.counts);
    invariant(Number(preShutdown.counts.workLogCount) === databaseApi.HEAVY_WORK_ROWS,
      `${modeName} stored an unexpected number of heavy work rows`, preShutdown.counts);

    const httpClose = await service.close();
    const refusedAfterHttpClose = await verifyHttpClosed(service.origin);
    const databaseClose = await owner.shutdown();
    await nextTurn();

    const postShutdown = await databaseApi.inspectClosedDatabase(databaseConfiguration);
    invariant(postShutdown.integrityCheck === 'ok',
      `${modeName} database failed integrity_check after shutdown`, postShutdown);
    invariant(Number(postShutdown.counts.itemCount) === EXPECTED_ITEM_COUNT,
      `${modeName} lost or added items during shutdown`, postShutdown.counts);
    invariant(Number(postShutdown.counts.workLogCount) === databaseApi.HEAVY_WORK_ROWS,
      `${modeName} lost or added work rows during shutdown`, postShutdown.counts);
    invariant(postShutdown.committedRecoveryItem?.value === 'must-survive',
      `${modeName} lost the committed recovery item`, postShutdown);
    invariant(postShutdown.rolledBackRecoveryItem === null,
      `${modeName} persisted the rolled-back recovery item`, postShutdown);

    const ownerThreadIds = [...owner.ownerThreadIds].sort((left, right) => left - right);
    invariant(ownerThreadIds.length === 1,
      `${modeName} used more than one database owner thread`, ownerThreadIds);
    if (modeName === 'in-process') {
      invariant(ownerThreadIds[0] === 0,
        'In-process database owner did not run on thread 0', ownerThreadIds);
    } else {
      invariant(ownerThreadIds[0] > 0,
        'Dedicated database worker did not use a nonzero worker thread', ownerThreadIds);
    }

    return {
      modeName,
      databasePath,
      http: {
        origin: service.origin,
        serverThreadId: service.serverThreadId,
      },
      owner: {
        metadata: owner.metadata,
        threadIds: ownerThreadIds,
        workerWarnings: owner.workerWarnings,
      },
      warmup,
      responsiveness,
      cas,
      recovery,
      preShutdown,
      shutdown: {
        httpClose,
        refusedAfterHttpClose,
        databaseClose,
      },
      postShutdown,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (service !== null && !service.isClosed()) {
      try {
        await service.close();
      } catch (error) {
        cleanupErrors.push(serializeError(error));
      }
    }
    if (!owner.isClosed()) {
      try {
        await owner.shutdown();
      } catch (error) {
        cleanupErrors.push(serializeError(error));
      }
    }

    if (cleanupErrors.length > 0) {
      if (failure !== null) {
        failure.cleanupErrors ??= [];
        failure.cleanupErrors.push(...cleanupErrors);
      } else {
        const error = new Error(`${modeName} cleanup failed`);
        error.code = 'P00_CLEANUP_FAILED';
        error.details = cleanupErrors;
        throw error;
      }
    }
  }
}

function compareModes(inProcess, dedicatedWorker) {
  const inProcessPings = inProcess.responsiveness.pings;
  const workerPings = dedicatedWorker.responsiveness.pings;
  const inProcessHeavyDuration = inProcess.responsiveness.heavyMutation.body.durationMs;
  const workerHeavyDuration = dedicatedWorker.responsiveness.heavyMutation.body.durationMs;

  return {
    pingResponsesCompletedDuringHeavyMutation: {
      inProcess: inProcessPings.completedDuringHeavyMutation,
      dedicatedWorker: workerPings.completedDuringHeavyMutation,
    },
    pingMaximumLatencyMs: {
      inProcess: inProcessPings.latency.maximumMs,
      dedicatedWorker: workerPings.latency.maximumMs,
    },
    heavySqliteMutationDurationMs: {
      inProcess: roundMilliseconds(inProcessHeavyDuration),
      dedicatedWorker: roundMilliseconds(workerHeavyDuration),
    },
    dedicatedWorkerRemovedObservedEventLoopBlocking:
      inProcessPings.completedDuringHeavyMutation === 0
      && workerPings.completedDuringHeavyMutation > 0,
    ownership: {
      inProcessThreadIds: inProcess.owner.threadIds,
      dedicatedWorkerThreadIds: dedicatedWorker.owner.threadIds,
    },
  };
}

const runDirectory = createRunDirectory('probe');
const resultPath = path.join(runDirectory, 'result.json');
const startedAt = performance.now();
const result = {
  schemaVersion: 1,
  status: 'running',
  runtime: runtimeMetadata(),
  bindingRequest: null,
  runDirectory,
  resultPath,
  sourceManifest: null,
  workload: {
    pingCount: PING_COUNT,
    lightMutationCount: LIGHT_MUTATION_COUNT,
    casRequestCount: CAS_REQUEST_COUNT,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    trafficDeadlineMs: TRAFFIC_DEADLINE_MS,
  },
  modes: {},
  comparison: null,
  warnings: [],
  limitations: [
    `This result is native evidence only for ${process.platform}-${process.arch} on ${process.version}.`,
    'A macOS result does not prove Linux or Windows behavior; each required platform must run the probe natively.',
    'The copied-WAL exercise is not killed-process, machine-crash, power-loss, or torn-write recovery evidence.',
    'The fixed synthetic workload reveals blocking under this workload; it is not a production throughput benchmark.',
    'Mode order is fixed as in-process then dedicated worker; each mode uses a fresh private database and a warm-up mutation.',
    'The probe exercises locally saved SQLite state only. It does not model GitHub publication, and unpublished acknowledgments remain outside the total storage-loss recovery guarantee.',
  ],
};

try {
  assertRuntime();
  const bindingOptions = parseArguments(process.argv.slice(2));
  result.bindingRequest = bindingOptions;
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  result.sourceManifest = {
    path: sourceManifestPath,
    capturedOn: sourceManifest.capturedOn,
    candidates: sourceManifest.candidates,
  };
  const databaseApi = await import('./database-owner.mjs');

  result.workload.heavyWorkRows = databaseApi.HEAVY_WORK_ROWS;
  result.workload.heavyPayloadBytes = databaseApi.HEAVY_PAYLOAD_BYTES;
  result.modes.inProcess = await runMode({
    modeName: 'in-process',
    modeDirectory: path.join(runDirectory, 'in-process'),
    databaseApi,
    bindingOptions,
  });
  result.modes.dedicatedWorker = await runMode({
    modeName: 'dedicated-worker',
    modeDirectory: path.join(runDirectory, 'dedicated-worker'),
    databaseApi,
    bindingOptions,
  });
  result.comparison = compareModes(
    result.modes.inProcess,
    result.modes.dedicatedWorker,
  );

  await nextTurn();
  result.warnings = [...mainWarnings];
  invariant(result.warnings.length === 0,
    'Main process emitted a runtime warning', result.warnings);
  invariant(result.modes.dedicatedWorker.owner.workerWarnings.length === 0,
    'Database worker emitted a runtime warning',
    result.modes.dedicatedWorker.owner.workerWarnings);
  invariant(result.modes.inProcess.responsiveness.workerWarnings.length === 0
    && result.modes.dedicatedWorker.responsiveness.workerWarnings.length === 0,
  'Traffic worker emitted a runtime warning');

  result.status = 'passed';
} catch (error) {
  await nextTurn();
  result.status = 'failed';
  result.error = serializeError(error);
  result.warnings = [...mainWarnings];
  process.exitCode = 1;
} finally {
  result.durationMs = roundMilliseconds(performance.now() - startedAt);
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
