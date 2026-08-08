import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readBootstrapRequest, writeBootstrapResponse } from './bootstrap.js';
import { describeAdapter } from './describe.js';
import { validateAdapterManifest } from './manifest.js';
import { normalizeJsonValue, parseJsonRequest } from '../request.js';

// The installed package's own manifest file is read as bytes and parsed
// with the same strict-JSON parser used for the wire request (section 3.1
// declares the manifest is "strict JSON", the same standard section 10
// holds the fixtures to). A missing/unreadable file, syntactically invalid
// JSON, or a duplicate top-level member (e.g. a hostile second adapter_id
// that a lenient last-wins parser would silently accept) all resolve to
// `undefined` rather than throwing; `validateAdapterManifest(undefined)`
// already refuses with `invalid-adapter-manifest`, so the caller does not
// need a separate load-failure branch.
async function loadManifest(manifestUrl) {
  let bytes;
  try {
    bytes = await readFile(fileURLToPath(manifestUrl));
  } catch {
    return undefined;
  }
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) {
    return undefined;
  }
  return normalizeJsonValue(parsed.value);
}

// The shared §3.3 entrypoint flow every adapter package runs: load and
// validate its own manifest, read one bootstrap request, answer describe or
// refuse. Each adapter supplies only its manifest location and its honest
// host declaration through `dynamicResult(manifest)`.
export async function runAdapterEntrypoint({ manifestUrl, dynamicResult, argv = process.argv }) {
  const [operation] = argv.slice(2);
  const manifest = await loadManifest(manifestUrl);

  // §3.1: the package's own manifest is validated before it is advertised.
  const validated = validateAdapterManifest(manifest);
  if (!validated.ok) {
    await writeBootstrapResponse(process.stdout, { ok: false, error: { code: validated.error_code } });
    return;
  }

  const incoming = await readBootstrapRequest(process.stdin);
  if (!incoming.ok) {
    await writeBootstrapResponse(process.stdout, { ok: false, error: { code: incoming.error_code } });
    return;
  }

  if (operation === 'describe') {
    const described = describeAdapter(incoming.request, manifest, dynamicResult(manifest));
    await writeBootstrapResponse(
      process.stdout,
      described.ok ? described.result : { ok: false, error: { code: described.error_code } },
    );
    return;
  }

  await writeBootstrapResponse(process.stdout, { ok: false, error: { code: 'invalid-invocation' } });
}
