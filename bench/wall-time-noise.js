// Bounded CPU load for proving the benchmark flags its own wall times.
//
// Not part of the default test run. It runs one command under artificial load
// and owns the load's whole lifetime:
//
//   TMPDIR=/tmp node bench/wall-time-noise.js --seconds 120 -- \
//     node bench/mutation-latency.bench.js --items 1500
//
// This repository has already paid for an unbounded load generator: a
// reproduction helper with a bare `for (;;)` loop and no teardown orphaned to
// PID 1 and burned 7.4 cores for fifteen hours. Every bound that failed then is
// structural here.
//
//   - Each burner carries its own wall-clock deadline and exits at it. Orphaned
//     by any means, including SIGKILL of this process, it still stops on time.
//   - Each burner leads its own process group, and teardown kills the group, so
//     anything a burner started dies with it.
//   - Teardown runs from exit, SIGINT and SIGTERM, and from the deadline timer,
//     so no exit path leaves load running.
//   - The worker count stays below the core count, and the duration is clamped
//     to NOISE_MAXIMUM_SECONDS.
//
// The command is always the last thing to be started and the first thing to be
// waited on: the load exists to make its timings noisy, nothing more.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const NOISE_MAXIMUM_SECONDS = 1800;

// Two cores are left for the process under measurement and for the operating
// system. Burners sized at or above the core count starve the thing being
// measured and corrupt the timings the load exists to produce.
const RESERVED_CORES = 2;

export function resolveNoisePlan({ workers, seconds, cpuCount }) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`load generation needs a positive number of seconds, got ${JSON.stringify(seconds)}`);
  }
  return {
    workers: Math.max(1, Math.min(workers, cpuCount - RESERVED_CORES)),
    durationMs: Math.min(seconds, NOISE_MAXIMUM_SECONDS) * 1000,
  };
}

// The burner. `while (Date.now() < deadline)` and nothing else: the deadline is
// read once at startup from the environment, so a burner that loses its parent
// still stops at the time it was started with.
const BURNER_SOURCE = `
const deadline = Date.now() + Number(process.env.WOWBAGGER_NOISE_DURATION_MS);
if (!Number.isFinite(deadline)) {
  process.exit(1);
}
let sink = 0;
while (Date.now() < deadline) {
  for (let step = 0; step < 200000; step += 1) {
    sink = (sink + Math.sqrt(step)) % 1000000;
  }
}
process.exit(sink === Number.NEGATIVE_INFINITY ? 1 : 0);
`;

function parseNoiseArguments(argumentList) {
  const separator = argumentList.indexOf('--');
  if (separator === -1 || separator === argumentList.length - 1) {
    throw new Error('usage: wall-time-noise.js [--seconds N] [--workers N] -- command [args...]');
  }
  const flags = argumentList.slice(0, separator);
  const options = { seconds: 120, workers: os.cpus().length };
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] === '--seconds' || flags[index] === '--workers') {
      options[flags[index].slice(2)] = Number(flags[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`unknown option ${flags[index]}`);
  }
  return { options, command: argumentList.slice(separator + 1) };
}

function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    // ESRCH means the burner already reached its own deadline, which is the
    // expected outcome, not a failure. Anything else is reported and ignored:
    // teardown must keep going through the remaining burners.
    if (error.code !== 'ESRCH') {
      process.stderr.write(`wall-time-noise: could not kill group ${pid}: ${error.message}\n`);
    }
  }
}

async function main() {
  const { options, command } = parseNoiseArguments(process.argv.slice(2));
  const plan = resolveNoisePlan({ ...options, cpuCount: os.cpus().length });

  // Every child this process starts — burners and the command alike — leads its
  // own process group, and teardown kills each group. A SIGKILL of this process
  // cannot run teardown at all; the burners survive that because each carries
  // its own deadline, but an arbitrary command cannot be given one, so
  // SIGKILLing this process can leave the command running. Signal it, do not
  // SIGKILL it.
  const groups = [];
  let tornDown = false;
  const tearDown = () => {
    if (tornDown) {
      return;
    }
    tornDown = true;
    for (const pid of groups) {
      killGroup(pid);
    }
  };

  process.on('exit', tearDown);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      tearDown();
      process.exit(130);
    });
  }
  // Belt to the burners' own braces: even if the command never returns, the
  // load stops at the deadline this process was started with.
  const deadlineTimer = setTimeout(tearDown, plan.durationMs);

  for (let worker = 0; worker < plan.workers; worker += 1) {
    groups.push(spawn(process.execPath, ['-e', BURNER_SOURCE], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, WOWBAGGER_NOISE_DURATION_MS: String(plan.durationMs) },
    }).pid);
  }
  process.stderr.write(`wall-time-noise: ${plan.workers} burners on ${os.cpus().length} cores`
    + ` for up to ${plan.durationMs / 1000}s; load average now ${os.loadavg()[0].toFixed(2)}\n`);

  const code = await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', detached: true });
    groups.push(child.pid);
    child.on('exit', (exitCode, signal) => resolve(signal ? 128 : exitCode ?? 1));
    child.on('error', (error) => {
      process.stderr.write(`wall-time-noise: ${error.message}\n`);
      resolve(1);
    });
  });

  clearTimeout(deadlineTimer);
  tearDown();
  process.exit(code);
}

// Only the direct invocation generates load; importing the module for its
// planner must never start a burner.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
