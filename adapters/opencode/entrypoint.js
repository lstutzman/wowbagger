#!/usr/bin/env node
import { runAdapterEntrypoint, standardDynamicResult } from '../../src/adapter/entrypoint-main.js';

// The honest host declaration for the opencode harness. The shared launch
// discipline applies unchanged; override members here the moment this
// harness's real guarantees diverge.
await runAdapterEntrypoint({
  manifestUrl: new URL('./wowbagger-adapter.json', import.meta.url),
  dynamicResult: standardDynamicResult,
});
process.exit(0);
