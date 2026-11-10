import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { replyJson, COMPRESS_MIN_BYTES } from '../lib/modern.js';

function capture() {
  const res = { destroyed: false, headers: {}, body: null };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = body => { res.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); };
  return res;
}
const req = encoding => ({ headers: encoding ? { 'accept-encoding': encoding } : {} });

test('large replies are gzip-compressed when the phone accepts gzip', async () => {
  const body = { events: Array.from({ length: 400 }, (_, i) => ({ type: 'assistant/chunk', seq: i, data: { text: 'repeated text ' + i } })) };
  assert.ok(JSON.stringify(body).length > COMPRESS_MIN_BYTES);
  const res = capture();
  await replyJson(req('gzip, deflate, br'), res, 200, body);
  assert.equal(res.headers['Content-Encoding'], 'gzip');
  assert.ok(res.body.length < JSON.stringify(body).length / 4);
  assert.deepEqual(JSON.parse(gunzipSync(res.body).toString()), body);
});

test('small replies and clients without gzip get plain JSON', async () => {
  const big = { text: 'x'.repeat(COMPRESS_MIN_BYTES * 2) };
  for (const [encoding, body] of [['gzip', { ok: true }], [undefined, big], ['identity', big]]) {
    const res = capture();
    await replyJson(req(encoding), res, 200, body);
    assert.equal(res.headers['Content-Encoding'], undefined, String(encoding));
    assert.deepEqual(JSON.parse(res.body.toString()), body);
  }
});
