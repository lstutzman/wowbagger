import process from 'node:process';
import {
  parentPort,
  threadId,
  workerData,
} from 'node:worker_threads';

const warnings = [];
process.on('warning', (warning) => {
  warnings.push({
    name: warning.name,
    code: warning.code ?? null,
    message: warning.message,
    stack: warning.stack ?? null,
  });
});

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    details: error?.details ?? null,
    rollbackError: error?.rollbackError ?? null,
  };
}

function nextTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

if (parentPort === null) {
  throw new Error('database-worker.mjs must run as a worker thread');
}

let owner = null;
let idleDeadline = null;

try {
  const { createDatabaseOwner } = await import('./database-owner.mjs');
  owner = await createDatabaseOwner(workerData.databaseConfiguration);
  await nextTurn();

  if (warnings.length > 0) {
    const warningError = new Error('Database worker emitted a runtime warning during startup');
    warningError.code = 'P00_RUNTIME_WARNING';
    warningError.details = warnings;
    throw warningError;
  }

  parentPort.postMessage({
    type: 'ready',
    metadata: owner.metadata(),
    warnings: [...warnings],
  });

  idleDeadline = setTimeout(() => {
    try {
      const closeResult = owner?.close() ?? null;
      owner = null;
      parentPort.postMessage({
        type: 'deadline',
        closeResult,
        warnings: [...warnings],
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'deadline',
        error: serializeError(error),
        warnings: [...warnings],
      });
    } finally {
      process.exitCode = 1;
      parentPort.close();
    }
  }, workerData.idleDeadlineMs);

  parentPort.on('message', async (message) => {
    if (message?.type !== 'call') {
      return;
    }

    try {
      let value;
      switch (message.method) {
        case 'mutate':
          value = owner.mutate(message.arguments);
          break;
        case 'read':
          value = owner.read(message.arguments);
          break;
        case 'snapshot':
          value = owner.snapshot();
          break;
        case 'exerciseRecovery':
          value = owner.exerciseRecovery(message.arguments);
          break;
        case 'shutdown':
          value = owner.close();
          owner = null;
          clearTimeout(idleDeadline);
          idleDeadline = null;
          await nextTurn();
          parentPort.postMessage({
            type: 'response',
            id: message.id,
            value: {
              ...value,
              workerWarnings: [...warnings],
            },
            warnings: [...warnings],
          });
          parentPort.close();
          return;
        default: {
          const error = new Error(`Unsupported database worker method: ${message.method}`);
          error.code = 'P00_UNKNOWN_METHOD';
          throw error;
        }
      }

      parentPort.postMessage({
        type: 'response',
        id: message.id,
        value,
        warnings: [...warnings],
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'response',
        id: message.id,
        error: serializeError(error),
        warnings: [...warnings],
      });
    }
  });
} catch (error) {
  try {
    owner?.close();
  } catch (closeError) {
    error.closeError = serializeError(closeError);
  }

  parentPort.postMessage({
    type: 'startup-error',
    ownerThreadId: threadId,
    error: serializeError(error),
    warnings: [...warnings],
  });
  process.exitCode = 1;
  parentPort.close();
}
