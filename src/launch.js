// The published direct-core launch seam.
//
// A host that routes Wowbagger for a UI plugin cannot run a shell, cannot parse
// a platform command shim, and cannot search global npm directories. What it
// can do is resolve this package and read one descriptor: an absolute Node
// executable, an absolute path to the core script, and an argument array that
// goes to the process verbatim. That tuple is the whole contract; everything
// else about the run — working directory, timeout, cancellation, process-tree
// containment, and stream caps — belongs to the host, which is the only party
// that can enforce it.
//
// `docs/host-contract.md` states the requirements this descriptor exists to
// satisfy. Keep the two in step.

import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// The engine floor the package declares. A host that resolves its own Node
// executable rather than reusing `process.execPath` must check it, because a
// Node 18 executable will fail somewhere inside the core rather than at launch.
export const MINIMUM_NODE_MAJOR = 20;

// The absolute path of the core script. It is resolved from this module's own
// URL, so it is correct for a global install, a local install, a workspace
// link, and a plain clone alike, and it never depends on the caller's working
// directory or on PATH.
export const CORE_SCRIPT_PATH = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

/**
 * Build the process tuple for one direct-core invocation.
 *
 * @param {string[]} argv Core arguments, for example `['capabilities', '--json']`.
 * @param {{ nodeExecutable?: string }} [options] `nodeExecutable` defaults to the
 *   running Node executable and must be an absolute path when supplied.
 * @returns {{ executable: string, args: readonly string[], shell: false }}
 */
export function resolveCoreLaunch(argv = [], { nodeExecutable = process.execPath } = {}) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('Core arguments must be an array of strings.');
  }
  // A bare name such as `node` would make the host's spawn search PATH, which
  // is the discovery this seam exists to remove. Refuse it at the door rather
  // than launch whatever the environment happens to expose.
  if (typeof nodeExecutable !== 'string' || !isAbsolute(nodeExecutable)) {
    throw new TypeError('The Node executable must be an absolute path.');
  }
  return Object.freeze({
    executable: nodeExecutable,
    args: Object.freeze([CORE_SCRIPT_PATH, ...argv]),
    shell: false,
  });
}
