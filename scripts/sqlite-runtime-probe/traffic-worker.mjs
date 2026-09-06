import process from 'node:process';
import {
  parentPort,
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

if (parentPort === null) {
  throw new Error('traffic-worker.mjs must run as a worker thread');
}

const { requestJson } = await import('./http-client.mjs');
const abortController = new AbortController();
let configuration = null;
let heavyRequest = null;
let secondaryTrafficStarted = false;
let settled = false;

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

function invariant(condition, message, details) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.code = 'P00_TRAFFIC_INVARIANT';
  error.details = details;
  throw error;
}

function summarizeDurations(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => {
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[index];
  };
  const rounded = (value) => Math.round(value * 1_000) / 1_000;

  return {
    minimumMs: rounded(sorted[0]),
    p50Ms: rounded(percentile(0.5)),
    p95Ms: rounded(percentile(0.95)),
    maximumMs: rounded(sorted.at(-1)),
  };
}

function finishError(error) {
  if (settled) {
    return;
  }
  settled = true;
  clearTimeout(deadline);
  abortController.abort(error);
  parentPort.postMessage({
    type: 'error',
    error: serializeError(error),
    warnings: [...warnings],
  });
  process.exitCode = 1;
  parentPort.close();
}

async function runSecondaryTraffic() {
  if (secondaryTrafficStarted || configuration === null || heavyRequest === null) {
    return;
  }
  secondaryTrafficStarted = true;

  try {
    const pingRequests = Array.from({ length: configuration.pingCount }, (_, index) =>
      requestJson(configuration.origin, `/ping?sequence=${index}`, {
        timeoutMs: configuration.requestTimeoutMs,
        signal: abortController.signal,
      }));

    const lightMutationRequests = Array.from(
      { length: configuration.lightMutationCount },
      (_, index) => requestJson(configuration.origin, '/mutate', {
        method: 'POST',
        body: {
          key: `responsiveness-light-${index}`,
          expectedRevision: 0,
          value: `light-value-${index}`,
          workload: 'light',
        },
        timeoutMs: configuration.requestTimeoutMs,
        signal: abortController.signal,
      }),
    );

    const [heavyResponse, pingResponses, lightMutationResponses] = await Promise.all([
      heavyRequest,
      Promise.all(pingRequests),
      Promise.all(lightMutationRequests),
    ]);

    invariant(heavyResponse.statusCode === 200
      && heavyResponse.body?.outcome === 'committed',
    'Heavy mutation did not commit', heavyResponse);
    invariant(pingResponses.every((response) => response.statusCode === 200),
      'At least one ping request failed', pingResponses);
    invariant(lightMutationResponses.every((response) =>
      response.statusCode === 200 && response.body?.outcome === 'committed'),
    'At least one light mutation failed', lightMutationResponses);

    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    settled = true;
    clearTimeout(deadline);
    parentPort.postMessage({
      type: 'result',
      result: {
        heavyMutation: heavyResponse,
        pings: {
          count: pingResponses.length,
          completedDuringHeavyMutation: pingResponses.filter(
            (response) => response.body?.duringHeavyMutation === true,
          ).length,
          latency: summarizeDurations(pingResponses.map((response) => response.durationMs)),
        },
        lightMutations: {
          count: lightMutationResponses.length,
          latency: summarizeDurations(
            lightMutationResponses.map((response) => response.durationMs),
          ),
          responses: lightMutationResponses,
        },
        warnings: [...warnings],
      },
    });
    parentPort.close();
  } catch (error) {
    finishError(error);
  }
}

function startHeavyRequest(message) {
  invariant(configuration === null, 'Traffic worker received more than one run command');
  configuration = message.configuration;
  heavyRequest = requestJson(configuration.origin, '/mutate', {
    method: 'POST',
    body: {
      key: 'responsiveness-heavy',
      expectedRevision: 0,
      value: 'heavy-value',
      workload: 'heavy',
    },
    timeoutMs: configuration.requestTimeoutMs,
    signal: abortController.signal,
  });
  heavyRequest.catch((error) => {
    finishError(error);
  });
}

const deadline = setTimeout(() => {
  const error = new Error(`Traffic worker exceeded ${workerData.deadlineMs} ms`);
  error.code = 'P00_TRAFFIC_DEADLINE';
  finishError(error);
}, workerData.deadlineMs);

parentPort.on('message', (message) => {
  try {
    switch (message?.type) {
      case 'run':
        startHeavyRequest(message);
        break;
      case 'heavy-started':
        void runSecondaryTraffic();
        break;
      case 'stop': {
        const error = new Error('Traffic worker received a cooperative stop request');
        error.code = 'P00_TRAFFIC_STOPPED';
        finishError(error);
        break;
      }
      default:
        throw new Error(`Unsupported traffic worker message: ${message?.type}`);
    }
  } catch (error) {
    finishError(error);
  }
});
