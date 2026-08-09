const { createHook } = require('node:async_hooks');
const childProcess = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const auditPath = process.env.WOWBAGGER_ADAPTER_CHILD_PROCESS_AUDIT_PATH;

if (auditPath) {
  const record = (kind) => appendFileSync(auditPath, `${kind}\n`);
  createHook({
    init(asyncId, type) {
      if (type === 'PROCESSWRAP') record(`async:${asyncId}`);
    },
  }).enable();

  for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
    const original = childProcess[name];
    childProcess[name] = function auditedSynchronousLaunch(...args) {
      try {
        const result = Reflect.apply(original, this, args);
        if (name !== 'spawnSync' || Number.isInteger(result?.pid)) record(`sync:${name}`);
        return result;
      } catch (error) {
        if (Number.isInteger(error?.pid)) record(`sync:${name}`);
        throw error;
      }
    };
  }
  syncBuiltinESMExports();
}
