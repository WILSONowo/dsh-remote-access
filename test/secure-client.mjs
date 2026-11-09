// Test-only phone side of the secure channel: WebSocket (dsh-e2e.1) → TLS 1.3 → HTTP/1.1, with SPKI pin check.
import http from 'node:http';
import tls from 'node:tls';
import { createHash } from 'node:crypto';
import WebSocket, { createWebSocketStream } from 'ws';

export const pinOf = socket => createHash('sha256').update(socket.getPeerX509Certificate().publicKey.export({ type: 'spki', format: 'der' })).digest('hex');

/** Phones split writes so no WebSocket frame exceeds the 32 KiB relay/plugin frame limit (the app uses 16 KiB). */
export function limitFrames(stream, size = 16384) {
  const write = stream._write.bind(stream);
  stream._write = (chunk, encoding, done) => {
    let offset = 0;
    const next = error => {
      if (error || offset >= chunk.length) return done(error);
      const piece = chunk.subarray(offset, offset + size); offset += size;
      write(piece, encoding, next);
    };
    next();
  };
  return stream;
}

/**
 * Returns a createConnection function (for http.request / new WebSocket) that opens one pinned TLS session
 * per connection. `state.status` receives the HTTP status if the outer WebSocket upgrade is refused.
 */
export function secureConnection(wsUrl, { pin, wsOptions = {}, state = {} } = {}) {
  return () => {
    const ws = new WebSocket(wsUrl, 'dsh-e2e.1', { perMessageDeflate: false, ...wsOptions });
    ws.once('unexpected-response', (_, res) => { state.status = res.statusCode; res.resume(); ws.terminate(); });
    const stream = limitFrames(createWebSocketStream(ws));
    stream.on('error', () => {});
    const socket = tls.connect({ socket: stream, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'], minVersion: 'TLSv1.3', servername: 'test.e2e.dsh.invalid' });
    socket.once('secureConnect', () => {
      socket.observedPin = state.pin = pinOf(socket);
      if (pin && socket.observedPin !== pin) socket.destroy(new Error('pin_mismatch'));
    });
    return socket;
  };
}

/** One request over the secure channel. A refused outer upgrade resolves as { status } like an HTTP error. */
export function secureRequest(wsUrl, path, { method = 'GET', headers = {}, body, pin, wsOptions } = {}) {
  return new Promise((resolve, reject) => {
    const state = {};
    const payload = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const json = payload !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string';
    const req = http.request({ path, method, createConnection: secureConnection(wsUrl, { pin, wsOptions, state }),
      headers: { host: 'test.e2e.dsh.invalid', ...(json && !headers['content-type'] && !headers['Content-Type'] ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks), text = data.toString('utf8');
        let parsed; try { parsed = JSON.parse(text || '{}'); } catch { parsed = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, text, data, pin: state.pin });
      });
      res.on('error', reject);
    });
    req.on('error', error => state.status ? resolve({ status: state.status, body: {} }) : reject(error));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
