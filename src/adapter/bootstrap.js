import { normalizeJsonValue, parseJsonRequest } from '../request.js';

// The bootstrap wire (contract section 3.3): exactly one strict UTF-8 JSON
// object in on stdin, then stdin closes; exactly one strict JSON object plus
// one LF out on stdout. `readBootstrapRequest` reads the whole stream to
// bytes first — `parseJsonRequest` decodes UTF-8 fatally and reports
// duplicate members and trailing bytes through `issues` rather than
// throwing, so a non-empty `issues` array is the only acceptable-parse gate.
export async function readBootstrapRequest(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) {
    return { ok: false, error_code: 'invalid-describe-request' };
  }
  return { ok: true, request: normalizeJsonValue(parsed.value), bytes };
}

// Writes exactly one JSON object plus one trailing LF, and nothing else.
export function writeBootstrapResponse(stream, response) {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(response)}\n`, (error) => (error ? reject(error) : resolve()));
  });
}
