import http from 'node:http';
import { performance } from 'node:perf_hooks';

export function requestJson(origin, pathname, {
  method = 'GET',
  body,
  timeoutMs,
  signal,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('requestJson requires a positive finite timeoutMs');
  }
  const url = new URL(pathname, origin);
  const payload = body === undefined
    ? null
    : Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    const request = http.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      agent: false,
      signal,
      headers: {
        connection: 'close',
        ...(payload === null
          ? {}
          : {
              'content-length': payload.byteLength,
              'content-type': 'application/json',
            }),
      },
    }, (response) => {
      const chunks = [];

      response.on('data', (chunk) => {
        chunks.push(chunk);
      });

      response.on('error', (error) => {
        finish(reject, error);
      });

      response.on('end', () => {
        const completedAt = performance.now();
        const text = Buffer.concat(chunks).toString('utf8');
        let parsedBody = null;

        if (text.length > 0) {
          try {
            parsedBody = JSON.parse(text);
          } catch (error) {
            const parseError = new Error(`Invalid JSON response from ${url.href}`);
            parseError.cause = error;
            parseError.responseText = text;
            finish(reject, parseError);
            return;
          }
        }

        finish(resolve, {
          statusCode: response.statusCode,
          body: parsedBody,
          durationMs: completedAt - startedAt,
          completedAt,
        });
      });
    });

    request.on('error', (error) => {
      finish(reject, error);
    });

    request.setTimeout(timeoutMs, () => {
      const error = new Error(`HTTP request exceeded ${timeoutMs} ms: ${method} ${url.href}`);
      error.code = 'P00_HTTP_TIMEOUT';
      request.destroy(error);
    });

    if (payload !== null) {
      request.write(payload);
    }
    request.end();
  });
}
