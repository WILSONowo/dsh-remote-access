import { X509Certificate, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import type { Server } from 'node:http';
import { WebSocketServer, createWebSocketStream, type WebSocket } from 'ws';

/** WebSocket subprotocol carrying raw TLS records between the phone and this computer. */
export const SECURE_PROTOCOL = 'dsh-e2e.1';
export const SECURE_PATH = '/api/remote-access/secure';
/** Matches the tunnel CHUNK so one frame never needs to be split by the relay. */
export const SECURE_MAX_FRAME = 32768;
const HANDSHAKE_TIMEOUT = 15000;

export type SecureMaterial = { key: string; cert: string; pin: string; safetyCode: string };

// Minimal DER writer: just enough for one self-signed ECDSA P-256 certificate.
const length = (n: number) => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
const tlv = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  if (body.length > 0xffff) throw new Error('der_too_large');
  return Buffer.concat([Buffer.from([tag, ...length(body.length)]), body]);
};
const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
const oid = (value: string) => {
  const [a, b, ...rest] = value.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const integer = (bytes: Buffer) => tlv(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
const name = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from('DSH Remote')))));

/** Pin = SHA-256 of SubjectPublicKeyInfo. Phones check only this, never chain, name or validity. */
export const spkiPin = (spki: Buffer) => createHash('sha256').update(spki).digest('hex');
export const safetyCode = (pin: string) => pin.slice(0, 12).toUpperCase().match(/.{4}/g)!.join('-');

export function createSelfSignedCertificate(privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;
  const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] |= 0x01;
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(serial), ECDSA_SHA256, name,
    seq(tlv(0x17, Buffer.from('000101000000Z')), tlv(0x18, Buffer.from('99991231235959Z'))),
    name, spki,
  );
  const signature = sign('sha256', tbs, key);
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.from([0]), signature));
  return '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g)!.join('\n') + '\n-----END CERTIFICATE-----\n';
}

/** One long-term key per installation identity; a broken file refuses remote access instead of silently re-keying. */
export function loadSecureMaterial(home: string): SecureMaterial {
  const directory = join(home, 'remote-access'), file = join(directory, 'secure-channel.json');
  let value: { version: number; key: string; cert: string };
  if (existsSync(file)) {
    value = JSON.parse(readFileSync(file, 'utf8'));
    if (value?.version !== 1 || typeof value.key !== 'string' || typeof value.cert !== 'string') throw new Error('Invalid secure channel key; remote access refused');
  } else {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const key = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    value = { version: 1, key, cert: createSelfSignedCertificate(key) };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }
  const certificate = new X509Certificate(value.cert);
  const spki = certificate.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const keySpki = createPublicKey(createPrivateKey(value.key)).export({ type: 'spki', format: 'der' }) as Buffer;
  if (!spki.equals(keySpki) || !certificate.verify(certificate.publicKey)) throw new Error('Invalid secure channel key; remote access refused');
  const pin = spkiPin(spki);
  return { key: value.key, cert: value.cert, pin, safetyCode: safetyCode(pin) };
}

export const PEER_ADDRESS = Symbol('dsh.secure.peer');

/** Terminates the phone's TLS inside this process and hands plaintext HTTP to the private gateway. */
export function createSecureTerminator(material: SecureMaterial, gateway: Server) {
  const context = tls.createSecureContext({ key: material.key, cert: material.cert, minVersion: 'TLSv1.3' });
  const live = new Set<Duplex>();
  return {
    accept(transport: Duplex, peer?: string) {
      transport.on('error', () => {});
      const socket = new tls.TLSSocket(transport, { isServer: true, secureContext: context, ALPNProtocols: ['http/1.1'], requestCert: false });
      (socket as any)[PEER_ADDRESS] = peer;
      live.add(transport);
      const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT); timer.unref();
      const close = () => { clearTimeout(timer); live.delete(transport); transport.destroy(); };
      socket.on('error', () => socket.destroy());
      socket.once('close', close);
      transport.once('close', () => socket.destroy());
      socket.once('secure', () => { clearTimeout(timer); gateway.emit('connection', socket); });
      return socket;
    },
    get size() { return live.size; },
    close() { for (const transport of live) transport.destroy(); live.clear(); },
  };
}

/** Direct LAN/public entry: a WebSocket on the host port whose binary frames are the TLS byte stream. */
export function createDirectSecureEndpoint(terminator: ReturnType<typeof createSecureTerminator>, maxConnections = 64) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: SECURE_MAX_FRAME, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(SECURE_PROTOCOL) ? SECURE_PROTOCOL : false });
  return {
    handleUpgrade(req: any, socket: Duplex, head: Buffer) {
      socket.on('error', () => {});
      if (terminator.size >= maxConnections) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
      wss.handleUpgrade(req, socket as any, head, (ws: WebSocket) => {
        if (ws.protocol !== SECURE_PROTOCOL) { ws.close(1002, 'protocol'); return; }
        ws.on('message', (_, binary) => { if (!binary) ws.terminate(); });
        const stream = createWebSocketStream(ws);
        terminator.accept(stream, req.socket?.remoteAddress);
      });
    },
    close() { for (const client of wss.clients) client.terminate(); wss.close(); },
  };
}
