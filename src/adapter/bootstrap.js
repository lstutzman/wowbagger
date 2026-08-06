import { JsonNumber, parseJsonRequest } from '../request.js';

// src/request.js builds every object with a null prototype and boxes every
// bare number as a JsonNumber (see src/cli.js's normalizeClaimRequest for
// the same problem elsewhere). describeAdapter's schema checks compare
// against plain JS numbers, so the parsed request tree is rebuilt into
// ordinary objects/arrays with JsonNumber unwrapped before it is handed off.
function normalizeParsedJson(value) {
  if (value instanceof JsonNumber) {
    return Number(value.source);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeParsedJson);
  }
  if (value !== null && typeof value === 'object') {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeParsedJson(entry);
    }
    return normalized;
  }
  return value;
}

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
  const parsed = parseJsonRequest(Buffer.concat(chunks));
  if (parsed.issues.length > 0) {
    return { ok: false, error_code: 'invalid-describe-request' };
  }
  return { ok: true, request: normalizeParsedJson(parsed.value) };
}

// Writes exactly one JSON object plus one trailing LF, and nothing else.
export function writeBootstrapResponse(stream, response) {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(response)}\n`, (error) => (error ? reject(error) : resolve()));
  });
}
