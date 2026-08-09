const { createHook } = require('node:async_hooks');
const { appendFileSync } = require('node:fs');

const auditPath = process.env.WOWBAGGER_ADAPTER_CHILD_PROCESS_AUDIT_PATH;

if (auditPath) {
  createHook({
    init(asyncId, type) {
      if (type === 'PROCESSWRAP') appendFileSync(auditPath, `${asyncId}\n`);
    },
  }).enable();
}
