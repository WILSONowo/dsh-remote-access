// Protocol contract: drives the modern adapter against a scripted fake DSH host and checks
//  1. every host endpoint the plugin calls is listed in protocol-contract.json (and every listed one is used),
//  2. the phone RPCs it serves match the contract,
//  3. the frames it sends to the phone match test/fixtures/protocol/*.json byte for byte.
// The app keeps a copy of those fixtures (app/src/test/resources/protocol) and parses them in its own tests,
// so a wire change has to update both sides. Set DSH_APP_REPO=../dsh-remote to check the copies match.
// Regenerate after an intended change: UPDATE_PROTOCOL_FIXTURES=1 npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModernAdapter, VERIFIED_HOST_SERIES, hostVerified } from '../lib/modern.js';
import { DEVICE_ID } from '../lib/security.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(join(root, 'protocol-contract.json'), 'utf8'));
const fixtureDir = join(root, 'test', 'fixtures', 'protocol');
const update = process.env.UPDATE_PROTOCOL_FIXTURES === '1';

// Session events shaped like DSH's SessionEventMap (0.2.x). They pass through the plugin untouched;
// the fixture documents what the app has to parse.
const events = [
  { type: 'session/title', seq: 1, time: 1000, data: { title: '修复登录' } },
  { type: 'turn/start', seq: 2, time: 1000, data: { turn: 1 } },
  { type: 'user/message', seq: 3, time: 1001, surfaceOp: 'append', data: { id: 'm1', content: [{ type: 'text', text: '帮我修一下登录' }], source: { kind: 'user' } } },
  { type: 'user/message', seq: 4, time: 1001, surfaceOp: 'append', data: { id: 'm2', content: [{ type: 'text', text: 'SKILL BODY' }], source: { kind: 'skill-invocation', name: 'pdf' } } },
  { type: 'tool/call', seq: 5, time: 1002, data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"rm -rf build"}' } },
  { type: 'approval/asked', seq: 6, time: 1002, data: { id: 'ap-1', toolName: 'bash', callId: 'call-1', reason: 'run command' } },
  { type: 'approval/decided', seq: 7, time: 1003, data: { id: 'ap-1', outcome: 'allowed-once' } },
  { type: 'tool/result', seq: 8, time: 1004, data: { turn: 1, step: 1, message: { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'ok' }] }] } } },
  { type: 'todo/write', seq: 9, time: 1005, data: { todos: [{ content: '定位问题', status: 'completed' }, { content: '修复', status: 'in_progress' }] } },
  { type: 'assistant/message', seq: 10, time: 1006, data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'reasoning', text: '想一想' }, { type: 'text', text: '改好了' }] }, stream: [] } },
  { type: 'turn/end', seq: 11, time: 193000, data: { turn: 1, reason: { kind: 'completed' } } },
];

function fakeHost() {
  const used = { invoke: new Set(), stream: new Set(), rpc: new Set() };
  const until = signal => new Promise(r => signal.aborted ? r() : signal.addEventListener('abort', r, { once: true }));
  const invokeResults = {
    'session/list': { items: [{ sessionId: 's1', updatedAt: 1006, running: false, blank: false }] },
    'session/modelCatalog': { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [], failures: [] },
    'session/projections': { values: {} },
    'session/page': { records: events.slice(0, 2).map(event => ({ type: 'event', event })), hasMore: false },
    'session/create': { sessionId: 's9' },
  };
  async function* stream(endpoint, args, signal) {
    if (endpoint === 'session/follow') {
      const live = args.request.assistantStream === true;
      yield { type: 'snapshot', cursor: 11, records: (live ? events.slice(-1) : events).map(event => ({ type: 'event', event })), hasMore: !live, projections: { asOfSeq: 11, values: { title: '修复登录' } } };
      if (live) {
        yield { type: 'assistant-stream', frame: { type: 'chunk', time: 2000, chunk: { type: 'text-delta', text: '继续' } } };
        yield { type: 'event', event: { type: 'turn/start', seq: 12, time: 2000, data: { turn: 2 } } };
      }
    } else if (endpoint === 'workspace/follow') {
      yield { value: { sessionIds: ['s1'], archivedSessionIds: [] } };
    } else if (endpoint === '$events') {
      yield { type: 'ready', clientId: 'client-1', host: { home: '/home/me' } };
      yield { type: 'waterfall', event: 'approval/request', eventId: 'ap-2', agentId: 's1', request: { toolName: 'bash', callId: 'call-2', reason: 'run command' } };
      yield { type: 'waterfall', event: 'user-questions/request', eventId: 'q-1', agentId: 's1', request: { questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] } };
      yield { type: 'cancel', eventId: 'q-1' };
      yield { type: 'emit', event: 'api-session/status', args: ['s1', true] };
      yield { type: 'emit', event: 'api-session/added', args: [{ sessionId: 's2', updatedAt: 1, running: false, blank: true }] };
      yield { type: 'emit', event: 'api-session/removed', args: ['s3'] };
      yield { type: 'emit', event: 'api-session/error', args: ['s1', { code: 'llm/error', message: '额度不足' }] };
    }
    await until(signal);
  }
  const ctx = {
    webServer: { prefixes: new Map() },
    connection: { createPeer: () => { const c = new AbortController(); return { signal: c.signal, dispose: async () => c.abort() }; } },
    typertGateway: {
      invoke: async ({ namespace, method }) => { const e = namespace + '/' + method; used.invoke.add(e); return invokeResults[e] ?? {}; },
      wireStream: { open: async (endpoint, { args }, _u, _peer, signal) => { used.stream.add(endpoint); return stream(endpoint, args, signal); } },
      dispatchRpc: async endpoint => { used.rpc.add(endpoint); return { ok: true }; },
    },
  };
  return { ctx, used };
}

function request(path, body, method = 'POST') {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return Object.assign((async function* () { yield* chunks; })(), {
    method, url: path, headers: { 'content-type': 'application/json' }, [DEVICE_ID]: 'device-1',
  });
}
function response() {
  const res = { status: 0, body: '', sse: [], destroyed: false, writableLength: 0, listeners: {} };
  res.writeHead = s => { res.status = s; };
  res.write = chunk => { for (const line of String(chunk).split('\n')) if (line.startsWith('data: ')) res.sse.push(JSON.parse(line.slice(6))); return true; };
  res.end = b => { res.body = b ?? ''; };
  res.once = (ev, fn) => { (res.listeners[ev] ||= []).push(fn); };
  res.removeListener = () => {};
  res.close = () => { for (const fn of res.listeners.close || []) fn(); };
  return res;
}
const settle = () => new Promise(r => setTimeout(r, 30));

/** Drop values that differ per run (random rpc ids, wall-clock times of synthetic events). */
function normalize(frames) {
  return JSON.parse(JSON.stringify(frames, (k, v) => {
    if (k === 'questionRpcId') return '<rpc>';
    if (k === 'time' && typeof v === 'number' && v > 1e12) return 0;
    return v;
  }));
}

function checkFixture(name, actual) {
  const file = join(fixtureDir, name);
  const text = JSON.stringify(actual, null, 2) + '\n';
  if (update) { mkdirSync(fixtureDir, { recursive: true }); writeFileSync(file, text); return; }
  assert.ok(existsSync(file), `missing fixture ${name}; run with UPDATE_PROTOCOL_FIXTURES=1`);
  assert.equal(text, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${name} changed; if intended, regenerate and update the app copy`);
}

test('protocol contract: host endpoints, phone RPCs and frames match protocol-contract.json and fixtures', async () => {
  const { ctx, used } = fakeHost();
  const routes = new Map();
  const adapter = createModernAdapter(ctx, route => routes.set(route.kind + ' ' + route.path, route));
  try {
    const rpcs = [...routes.keys()].filter(k => k.startsWith('exact /api/')).map(k => k.slice('exact /api/'.length))
      .filter(p => !['events.mux', 'events.host', 'respond'].includes(p)).sort();
    assert.deepEqual(rpcs, [...contract.phoneRpcs].sort(), 'phone RPCs differ from protocol-contract.json');

    // Every phone RPC once, so each host endpoint behind it is recorded.
    const payloads = {
      'session.history': { sessionId: 's1' }, 'session.models': { sessionId: 's1' },
      'host.listDirectory': { path: '/' }, 'commands/execute': { agentId: 's1', line: '/help' }, 'commands/list': { agentId: 's1' },
    };
    let history;
    for (const rpc of rpcs) {
      const res = response();
      await routes.get('exact /api/' + rpc).handler(request('/api/' + rpc, { type: 'client-request', rpcId: 'r-' + rpc, method: rpc, payload: payloads[rpc] ?? { sessionId: 's1' } }), res);
      const body = JSON.parse(res.body);
      if (rpc !== 'host.describe') assert.equal(body.result?.ok, true, `${rpc}: ${res.body}`);
      if (rpc === 'session.history') history = body.result.value;
    }
    {
      const res = response();
      await routes.get('exact /api/session.history').handler(request('/api/session.history', { type: 'client-request', rpcId: 'r-page', method: 'session.history', payload: { sessionId: 's1', beforeSeq: 3, maxMessages: 2 } }), res);
      assert.equal(JSON.parse(res.body).result.ok, true);
    }
    checkFixture('history-page.json', history);

    // The phone's event stream: interactions, host events and a followed session.
    const stream = response();
    routes.get('exact /api/events.mux').handler(request('/api/events.mux', undefined, 'GET'), stream);
    await settle();
    const question = stream.sse.find(f => f.payload.type === 'question/requested');
    const approval = stream.sse.find(f => f.payload.type === 'approval/requested');
    assert.ok(question && approval, 'interactions were forwarded');
    const answer = response();
    await routes.get('exact /api/respond').handler(request('/api/respond', { type: 'client-response', rpcId: approval.rpcId, result: { ok: true, value: { sessionId: 's1', approvalId: 'ap-2', outcome: 'allowed-once' } } }), answer);
    assert.equal(answer.status, 200, answer.body);
    await settle();
    stream.close();
    await settle();

    for (const [kind, endpoints] of Object.entries(contract.hostEndpoints)) {
      assert.deepEqual([...used[kind]].sort(), [...endpoints].sort(), `host ${kind} endpoints differ from protocol-contract.json`);
    }
    // Frames from different host streams interleave by scheduling; only the order within one stream is part of the contract.
    const source = f => f.type.startsWith('session/') ? 'follow ' + f.sessionId : f.type === 'host/workspace-changed' ? 'workspace' : 'events';
    const frames = normalize(stream.sse.map(f => f.payload))
      .map((f, i) => ({ f, i })).sort((a, b) => source(a.f).localeCompare(source(b.f)) || a.i - b.i).map(x => x.f);
    const types = [...new Set(frames.map(f => f.type))].sort();
    for (const t of types) assert.ok(contract.muxFrames.includes(t), `frame ${t} is not in protocol-contract.json`);
    checkFixture('mux-frames.json', frames);
  } finally {
    await adapter.dispose();
  }
});

test('protocol contract: verified DSH series match protocol-contract.json', () => {
  assert.deepEqual(VERIFIED_HOST_SERIES, contract.verifiedHostSeries);
  for (const v of contract.verifiedHostVersions) assert.equal(hostVerified(v), true, v);
  assert.equal(hostVerified('0.3.0'), false);
  assert.equal(hostVerified('0.20.1'), false);
  assert.equal(hostVerified(undefined), null);
});

test('protocol contract: app copy of the fixtures matches', { skip: !process.env.DSH_APP_REPO && 'Set DSH_APP_REPO to the dsh-remote checkout' }, () => {
  const appDir = join(process.env.DSH_APP_REPO, 'app', 'src', 'test', 'resources', 'protocol');
  for (const name of ['history-page.json', 'mux-frames.json']) {
    const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(read(join(appDir, name)), read(join(fixtureDir, name)), `${name} differs between plugin and app`);
  }
});
