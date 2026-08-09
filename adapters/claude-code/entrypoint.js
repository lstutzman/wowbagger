#!/usr/bin/env node
import { runAdapterEntrypoint, standardDynamicResult } from '../../src/adapter/entrypoint-main.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The honest host declaration for the Claude Code harness. The shared
// launch discipline applies unchanged; override members here the moment
// this harness's real guarantees diverge.
await runAdapterEntrypoint({
  manifestUrl: process.env.WOWBAGGER_ADAPTER_MANIFEST_PATH
    ? pathToFileURL(path.resolve(process.env.WOWBAGGER_ADAPTER_MANIFEST_PATH))
    : new URL('./wowbagger-adapter.json', import.meta.url),
  packageRoot: fileURLToPath(new URL('../..', import.meta.url)),
  workspaceConfigUrl: process.env.WOWBAGGER_ADAPTER_WORKSPACES_PATH
    ? pathToFileURL(path.resolve(process.env.WOWBAGGER_ADAPTER_WORKSPACES_PATH))
    : undefined,
  dynamicResult: standardDynamicResult,
});
process.exit(0);
