export type PairingPayload = { v: number; server: string; hostId: string; computerId: string; name: string; ticket: string; expiresAt: number; pin: string };
export type DirectPayload = { address: string; name: string; pin: string };

const PIN = /^[a-f0-9]{64}$/;
const validName = (name: string, bytes: Buffer) => !!name.trim() && name.length <= 64 && !/[\x00-\x1f\x7f]/.test(name) && bytes.length <= 256;
const field = (value: Buffer) => { const out = Buffer.alloc(2 + value.length); out.writeUInt16BE(value.length, 0); value.copy(out, 2); return out; };

/** Compact v3: v2 fields plus the computer's 32-byte TLS public-key pin (see docs/e2e-secure-channel.md). */
export function encodePairingLink(payload: PairingPayload): string {
  const server = Buffer.from(payload.server, 'utf8'), name = Buffer.from(payload.name, 'utf8');
  if (payload.v !== 1 || !/^[a-f0-9]{32}$/.test(payload.hostId) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.computerId) ||
      !/^[a-f0-9]{64}$/.test(payload.ticket) || !PIN.test(payload.pin) || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= 0 ||
      !server.length || server.length > 2048 || !validName(payload.name, name)) {
    throw new Error('invalid_pairing_payload');
  }
  const head = Buffer.alloc(104);
  head.writeBigUInt64BE(BigInt(payload.expiresAt), 0);
  Buffer.from(payload.hostId, 'hex').copy(head, 8);
  Buffer.from(payload.computerId.replaceAll('-', ''), 'hex').copy(head, 24);
  Buffer.from(payload.ticket, 'hex').copy(head, 40);
  Buffer.from(payload.pin, 'hex').copy(head, 72);
  return 'dshremote://pair#3.' + Buffer.concat([head, field(server), field(name)]).toString('base64url');
}

/** Direct address QR: pin, base address and display name. Scanning still requires the code or desktop approval. */
export function encodeDirectLink(payload: DirectPayload): string {
  const address = Buffer.from(payload.address, 'utf8'), name = Buffer.from(payload.name, 'utf8');
  let url: URL;
  try { url = new URL(payload.address); } catch { throw new Error('invalid_direct_payload'); }
  if (!PIN.test(payload.pin) || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.search || url.hash || !['', '/'].includes(url.pathname) || payload.address.endsWith('/') || !address.length || address.length > 2048 || !validName(payload.name, name)) {
    throw new Error('invalid_direct_payload');
  }
  return 'dshremote://direct#1.' + Buffer.concat([Buffer.from(payload.pin, 'hex'), field(address), field(name)]).toString('base64url');
}
