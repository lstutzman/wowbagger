import { normalizeJsonValue, parseJsonRequest } from '../request.js';

// The bootstrap wire (contract section 3.3): exactly one strict UTF-8 JSON
// object in on stdin, then stdin closes; exactly one strict JSON object plus
// one LF out on stdout. `readBootstrapRequest` collects bounded stream
// bytes before parsing — `parseJsonRequest` decodes UTF-8 fatally and reports
// duplicate members and trailing bytes through `issues` rather than
// throwing, so a non-empty `issues` array is the only acceptable-parse gate.
export async function readBootstrapRequest(stream, { maxBytes, errorCode = 'invalid-describe-request' } = {}) {
  const chunks = [];
  let byteLength = 0;
  // A stream error must surface as a refusal, never as an uncaught rejection: the
  // entrypoint has to emit exactly one JSON object plus one LF and exit zero on
  // every path (§3.3), including a stdin read failure.
  try {
    for await (const chunk of stream) {
      byteLength += chunk.length;
      if (maxBytes !== undefined && byteLength > maxBytes) {
        return {
          ok: false,
          error_code: errorCode,
          detail: { member: 'request', reason: 'byte-limit-exceeded', limit_bytes: maxBytes },
        };
      }
      chunks.push(chunk);
    }
  } catch {
    return { ok: false, error_code: errorCode, detail: { member: 'request', reason: 'stream-error' } };
  }
  const bytes = Buffer.concat(chunks);
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) {
    return { ok: false, error_code: errorCode, detail: { member: 'request_json' } };
  }
  return { ok: true, request: normalizeJsonValue(parsed.value), bytes };
}

// Writes exactly one JSON object plus one trailing LF, and nothing else.
export function writeBootstrapResponse(stream, response) {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(response)}\n`, (error) => (error ? reject(error) : resolve()));
  });
}
