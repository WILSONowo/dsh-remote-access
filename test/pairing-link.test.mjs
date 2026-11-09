import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { encodeDirectLink, encodePairingLink } from '../lib/pairing-link.js';
import { decodeDirectTestLink, decodePairingTestLink } from './pairing-fixture.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pairing-compact.json', import.meta.url), 'utf8'));

test('compact QR matches the Android vector without shortening ticket or identity', () => {
  const link = encodePairingLink(fixture.payload);
  assert.equal(link, fixture.link);
  assert.deepEqual(decodePairingTestLink(link), fixture.payload);
  const legacy = 'dshremote://pair#' + Buffer.from(JSON.stringify(fixture.payload)).toString('base64url');
  assert.ok(link.length < legacy.length * 0.6);
  assert.ok(QRCode.create(link, { errorCorrectionLevel: 'M' }).modules.size < QRCode.create(legacy, { errorCorrectionLevel: 'M' }).modules.size);
});

test('compact encoder refuses malformed identities, overlong fields and invalid expiry', () => {
  for (const invalid of [{ ticket: 'short' }, { hostId: '../host' }, { computerId: 'hardware' }, { expiresAt: NaN }, { pin: undefined }, { pin: 'ab'.repeat(31) },
    { expiresAt: -1 }, { server: 'x'.repeat(2049) }, { name: '\nname' }, { name: 'x'.repeat(65) }]) {
    assert.throws(() => encodePairingLink({ ...fixture.payload, ...invalid }), /invalid_pairing_payload/);
  }
});

test('v3 carries the 32-byte TLS pin; direct QR matches the Android vector and rejects unsafe addresses', () => {
  assert.ok(fixture.link.startsWith('dshremote://pair#3.'));
  assert.equal(decodePairingTestLink(fixture.link).pin, fixture.payload.pin);
  assert.equal(encodeDirectLink(fixture.direct.payload), fixture.direct.link);
  assert.deepEqual(decodeDirectTestLink(fixture.direct.link), fixture.direct.payload);
  for (const invalid of [{ address: 'ftp://192.0.2.1' }, { address: 'http://user:pw@192.0.2.1' }, { address: 'http://192.0.2.1/path' },
    { address: 'http://192.0.2.1/' }, { address: 'http://192.0.2.1?x=1' }, { pin: 'zz'.repeat(32) }, { name: '' }, { name: 'x'.repeat(65) }]) {
    assert.throws(() => encodeDirectLink({ ...fixture.direct.payload, ...invalid }), /invalid_direct_payload/);
  }
});
