import { test, expect } from 'vitest';
import { NetworkStore } from '../src/store/network.js';

function feedBasicRequest(store: NetworkStore, id = 'r1') {
  store.handleEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 100.0, wallTime: 1700000000.0, type: 'XHR',
    request: { url: 'https://api.test/data', method: 'POST', headers: { accept: 'application/json' }, postData: '{"q":1}' },
  });
  store.handleEvent('Network.requestWillBeSentExtraInfo', {
    requestId: id, headers: { cookie: 'sid=abc' },
  });
  store.handleEvent('Network.responseReceived', {
    requestId: id, timestamp: 100.1, type: 'XHR',
    response: {
      status: 200, statusText: 'OK', mimeType: 'application/json',
      headers: { 'content-type': 'application/json' },
      timing: { requestTime: 100.0, dnsStart: 0, dnsEnd: 1, connectStart: 1, connectEnd: 5, sslStart: 2, sslEnd: 4, sendStart: 5, sendEnd: 6, receiveHeadersEnd: 90 },
    },
  });
}

test('builds an entry across the request lifecycle', () => {
  const store = new NetworkStore();
  const finished: string[] = [];
  store.on('finished', e => finished.push(e.id));
  feedBasicRequest(store);
  store.handleEvent('Network.loadingFinished', { requestId: 'r1', timestamp: 100.142, encodedDataLength: 2150 });

  const [e] = store.entries();
  expect(e).toMatchObject({
    id: 'r1', url: 'https://api.test/data', method: 'POST', type: 'XHR',
    status: 200, statusText: 'OK', mimeType: 'application/json',
    postData: '{"q":1}', encodedBytes: 2150,
    startTs: 1700000000000,
  });
  expect(e.requestHeaders).toEqual({ accept: 'application/json', cookie: 'sid=abc' });
  expect(e.durationMs).toBeCloseTo(142, 0);
  expect(e.timing?.receiveHeadersEnd).toBe(90);
  expect(finished).toEqual(['r1']);
});

test('records failures', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'r2');
  store.handleEvent('Network.loadingFailed', { requestId: 'r2', timestamp: 100.05, errorText: 'net::ERR_FAILED', canceled: false });
  const [e] = store.entries();
  expect(e.error).toBe('net::ERR_FAILED');
  expect(e.durationMs).toBeCloseTo(50, 0);
});

test('captures blockedReason and corsErrorStatus on loadingFailed', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'r2');
  store.handleEvent('Network.loadingFailed', {
    requestId: 'r2', timestamp: 100.05, errorText: 'net::ERR_FAILED', canceled: false,
    blockedReason: 'other',
    corsErrorStatus: { corsError: 'MissingAllowOriginHeader', failedParameter: '' },
  });
  const [e] = store.entries();
  expect(e.error).toBe('net::ERR_FAILED');
  expect(e.blockedReason).toBe('other');
  expect(e.corsError).toBe('MissingAllowOriginHeader');
  expect(e.corsFailedParameter).toBeUndefined();

  const store2 = new NetworkStore();
  feedBasicRequest(store2, 'r3');
  store2.handleEvent('Network.loadingFailed', {
    requestId: 'r3', timestamp: 100.05, errorText: 'net::ERR_FAILED', canceled: false,
    corsErrorStatus: { corsError: 'DisallowedByMode', failedParameter: 'https://evil.test' },
  });
  const [e2] = store2.entries();
  expect(e2.corsError).toBe('DisallowedByMode');
  expect(e2.corsFailedParameter).toBe('https://evil.test');
  expect(e2.blockedReason).toBeUndefined();
});

test('plain failures carry no cors or blocked fields', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'r2');
  store.handleEvent('Network.loadingFailed', { requestId: 'r2', timestamp: 100.05, errorText: 'net::ERR_TIMED_OUT', canceled: false });
  const [e] = store.entries();
  expect(e.corsError).toBeUndefined();
  expect(e.blockedReason).toBeUndefined();
});

test('setBody attaches capped body', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'r3');
  store.setBody('r3', '{"ok":true}', false, false);
  expect(store.entries()[0]).toMatchObject({ body: '{"ok":true}', bodyBase64: false, bodyTruncated: false });
});

test('evicts oldest entries beyond cap and ignores their late events', () => {
  const store = new NetworkStore(2);
  ['a', 'b', 'c'].forEach(id => feedBasicRequest(store, id));
  expect(store.entries().map(e => e.id)).toEqual(['b', 'c']);
  expect(store.dropped).toBe(1);
  store.handleEvent('Network.loadingFinished', { requestId: 'a', timestamp: 101, encodedDataLength: 1 });
  expect(store.entries().map(e => e.id)).toEqual(['b', 'c']);
});

test('setCap shrinks the live store, evicting oldest and ignoring their late events', () => {
  const store = new NetworkStore();
  ['a', 'b', 'c'].forEach(id => feedBasicRequest(store, id));
  expect(store.cap).toBe(1000);
  store.setCap(2);
  expect(store.cap).toBe(2);
  expect(store.entries().map(e => e.id)).toEqual(['b', 'c']);
  expect(store.dropped).toBe(1);
  store.handleEvent('Network.loadingFinished', { requestId: 'a', timestamp: 101, encodedDataLength: 1 });
  expect(store.entries().map(e => e.id)).toEqual(['b', 'c']);
  store.setCap(4);
  ['d', 'e'].forEach(id => feedBasicRequest(store, id));
  expect(store.entries().map(e => e.id)).toEqual(['b', 'c', 'd', 'e']);
});

test('evicting a prior redirect hop keeps the live entry that shares its id', () => {
  const store = new NetworkStore(3);
  store.handleEvent('Network.requestWillBeSent', {
    requestId: 'x', timestamp: 100, wallTime: 1700000000, type: 'Document',
    request: { url: 'https://a.test/', method: 'GET', headers: {} },
  });
  store.handleEvent('Network.requestWillBeSent', {
    requestId: 'x', timestamp: 100.1, wallTime: 1700000000.1, type: 'Document',
    redirectResponse: { status: 302, statusText: 'Found', mimeType: '', headers: {} },
    request: { url: 'https://b.test/', method: 'GET', headers: {} },
  });
  feedBasicRequest(store, 'y');
  feedBasicRequest(store, 'z');
  expect(store.dropped).toBe(1);
  store.handleEvent('Network.loadingFinished', { requestId: 'x', timestamp: 101, encodedDataLength: 99 });
  const x = store.entries().find(e => e.id === 'x');
  expect(x?.url).toBe('https://b.test/');
  expect(x?.encodedBytes).toBe(99);
});

test('clear() empties entries, resets dropped, and drops byId so late events are ignored', () => {
  const store = new NetworkStore(2);
  ['a', 'b', 'c'].forEach(id => feedBasicRequest(store, id));
  expect(store.dropped).toBe(1);
  let updated = false;
  store.on('update', () => { updated = true; });
  store.clear();
  expect(store.entries()).toEqual([]);
  expect(store.dropped).toBe(0);
  expect(updated).toBe(true);
  store.handleEvent('Network.loadingFinished', { requestId: 'c', timestamp: 101, encodedDataLength: 1 });
  expect(store.entries()).toEqual([]);
});

test('clear() mid-stream lets fresh events append cleanly without id collisions', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'pre1');
  store.handleEvent('Network.loadingFinished', { requestId: 'pre1', timestamp: 100.2, encodedDataLength: 5 });
  store.clear();

  feedBasicRequest(store, 'post1');
  const stale = store.entries();
  store.handleEvent('Network.loadingFinished', { requestId: 'pre1', timestamp: 100.3, encodedDataLength: 99 });
  feedBasicRequest(store, 'post2');
  store.handleEvent('Network.loadingFinished', { requestId: 'post1', timestamp: 100.4, encodedDataLength: 7 });
  store.handleEvent('Network.loadingFinished', { requestId: 'post2', timestamp: 100.5, encodedDataLength: 8 });

  const ids = store.entries().map(e => e.id);
  expect(ids).toEqual(['post1', 'post2']);
  expect(stale.map(e => e.id)).toEqual(['post1']);
  const post1 = store.entries().find(e => e.id === 'post1');
  expect(post1?.encodedBytes).toBe(7);
});

test('ignores ExtraInfo for unknown requests', () => {
  const store = new NetworkStore();
  store.handleEvent('Network.requestWillBeSentExtraInfo', { requestId: 'ghost', headers: {} });
  expect(store.entries()).toEqual([]);
});

test('finalizes redirect hops when requestId is reused', () => {
  const store = new NetworkStore();
  const finished: number[] = [];
  store.on('finished', e => finished.push(e.status ?? -1));
  store.handleEvent('Network.requestWillBeSent', {
    requestId: 'r', timestamp: 10, wallTime: 1700000000, type: 'Document',
    request: { url: 'https://a.test/old', method: 'GET', headers: {} },
  });
  store.handleEvent('Network.requestWillBeSent', {
    requestId: 'r', timestamp: 10.05, wallTime: 1700000000.05, type: 'Document',
    request: { url: 'https://a.test/new', method: 'GET', headers: {} },
    redirectResponse: { status: 302, statusText: 'Found', mimeType: '', headers: { location: '/new' } },
  });
  const [hop1, hop2] = store.entries();
  expect(hop1).toMatchObject({ url: 'https://a.test/old', status: 302, statusText: 'Found' });
  expect(hop1.durationMs).toBeCloseTo(50, 0);
  expect(hop1.responseHeaders).toMatchObject({ location: '/new' });
  expect(hop2.url).toBe('https://a.test/new');
  expect(finished).toEqual([302]);

  store.handleEvent('Network.responseReceived', {
    requestId: 'r', timestamp: 10.1, type: 'Document',
    response: { status: 200, statusText: 'OK', mimeType: 'text/html', headers: {} },
  });
  expect(store.entries()[1].status).toBe(200);
  expect(store.entries()[0].status).toBe(302);
});

test('captures remote address, protocol, priority, referrer policy, initiator, and queueing', () => {
  const store = new NetworkStore();
  store.handleEvent('Network.requestWillBeSent', {
    requestId: 'x', timestamp: 100, wallTime: 1700000000, type: 'Fetch',
    request: {
      url: 'https://a.test/x', method: 'GET', headers: {},
      initialPriority: 'High', referrerPolicy: 'strict-origin-when-cross-origin',
    },
    initiator: {
      type: 'script',
      stack: { callFrames: [
        { functionName: 'fetchData', url: 'https://a.test/app.js', lineNumber: 41, columnNumber: 2 },
        { functionName: 'main', url: 'https://a.test/app.js', lineNumber: 10, columnNumber: 0 },
        { functionName: 'boot', url: 'https://a.test/app.js', lineNumber: 1, columnNumber: 0 },
      ] },
    },
  });
  store.handleEvent('Network.responseReceived', {
    requestId: 'x', timestamp: 100.1, type: 'Fetch',
    response: {
      status: 200, statusText: 'OK', mimeType: 'text/plain', headers: {},
      remoteIPAddress: '93.184.216.34', remotePort: 443, protocol: 'h2',
      timing: { requestTime: 100.02, dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1, sslStart: -1, sslEnd: -1, sendStart: 0, sendEnd: 1, receiveHeadersEnd: 50 },
    },
  });
  const [e] = store.entries();
  expect(e.remoteAddress).toBe('93.184.216.34:443');
  expect(e.protocol).toBe('h2');
  expect(e.priority).toBe('High');
  expect(e.referrerPolicy).toBe('strict-origin-when-cross-origin');
  expect(e.initiator).toEqual({
    type: 'script', url: undefined, lineNumber: undefined,
    stack: [
      { functionName: 'fetchData', url: 'https://a.test/app.js', lineNumber: 41 },
      { functionName: 'main', url: 'https://a.test/app.js', lineNumber: 10 },
    ],
  });
  expect(e.queueingMs).toBeCloseTo(20, 0);
});

test('resourceChangedPriority updates the stored priority', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'p1');
  store.handleEvent('Network.resourceChangedPriority', { requestId: 'p1', newPriority: 'VeryHigh', timestamp: 100.05 });
  expect(store.entries()[0].priority).toBe('VeryHigh');
});

test('cache origin is derived from response flags and requestServedFromCache', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'd1');
  store.handleEvent('Network.responseReceived', {
    requestId: 'd1', timestamp: 100.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'text/plain', headers: {}, fromDiskCache: true },
  });
  expect(store.entries().find(e => e.id === 'd1')!.fromCache).toBe('disk');

  store.handleEvent('Network.requestWillBeSent', {
    requestId: 'm1', timestamp: 101, wallTime: 1700000001, type: 'XHR',
    request: { url: 'https://a.test/m', method: 'GET', headers: {} },
  });
  store.handleEvent('Network.requestServedFromCache', { requestId: 'm1' });
  store.handleEvent('Network.responseReceived', {
    requestId: 'm1', timestamp: 101.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'text/plain', headers: {} },
  });
  expect(store.entries().find(e => e.id === 'm1')!.fromCache).toBe('memory');

  feedBasicRequest(store, 's1');
  store.handleEvent('Network.responseReceived', {
    requestId: 's1', timestamp: 102, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'text/plain', headers: {}, fromServiceWorker: true, fromDiskCache: true },
  });
  expect(store.entries().find(e => e.id === 's1')!.fromCache).toBe('sw');
});

test('dataReceived accumulates decoded bytes', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'dr');
  store.handleEvent('Network.dataReceived', { requestId: 'dr', timestamp: 100.11, dataLength: 1000, encodedDataLength: 500 });
  store.handleEvent('Network.dataReceived', { requestId: 'dr', timestamp: 100.12, dataLength: 234, encodedDataLength: 100 });
  expect(store.entries()[0].decodedBytes).toBe(1234);
});

test('every set-cookie value survives across responseReceived and extraInfo', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'sc');
  store.handleEvent('Network.responseReceived', {
    requestId: 'sc', timestamp: 100.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'text/plain', headers: { 'set-cookie': 'a=1; Path=/' } },
  });
  store.handleEvent('Network.responseReceivedExtraInfo', {
    requestId: 'sc',
    headers: { 'Set-Cookie': 'a=1; Path=/\nb=2; HttpOnly\nc=3; Secure' },
  });
  const [e] = store.entries();
  expect(e.setCookies).toEqual(['a=1; Path=/', 'b=2; HttpOnly', 'c=3; Secure']);
  expect(e.responseHeaders['Set-Cookie']).toContain('b=2');
});

test('blocked cookies are captured on both request and response sides', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'bc');
  store.handleEvent('Network.requestWillBeSentExtraInfo', {
    requestId: 'bc',
    headers: {},
    associatedCookies: [
      { cookie: { name: 'ok', value: '1' }, blockedReasons: [] },
      { cookie: { name: 'tracker', value: '2' }, blockedReasons: ['SameSiteStrict'] },
    ],
  });
  store.handleEvent('Network.responseReceivedExtraInfo', {
    requestId: 'bc',
    headers: { 'set-cookie': 'evil=1; SameSite=None' },
    blockedCookies: [{ cookieLine: 'evil=1; SameSite=None', blockedReasons: ['SameSiteNoneInsecure'] }],
  });
  const [e] = store.entries();
  expect(e.blockedRequestCookies).toEqual([{ name: 'tracker', reasons: ['SameSiteStrict'] }]);
  expect(e.blockedResponseCookies).toEqual([{ cookieLine: 'evil=1; SameSite=None', reasons: ['SameSiteNoneInsecure'] }]);
});

test('websocket lifecycle creates an entry and caps stored frames', () => {
  const store = new NetworkStore();
  store.handleEvent('Network.webSocketCreated', { requestId: 'ws1', url: 'wss://a.test/sock' });
  const [ws] = store.entries();
  expect(ws).toMatchObject({ id: 'ws1', url: 'wss://a.test/sock', type: 'WebSocket' });
  expect(ws.wsFrames).toEqual([]);
  for (let i = 0; i < 505; i++) {
    store.handleEvent('Network.webSocketFrameReceived', {
      requestId: 'ws1', timestamp: i, response: { opcode: 1, mask: false, payloadData: `m${i}` },
    });
  }
  store.handleEvent('Network.webSocketFrameSent', { requestId: 'ws1', timestamp: 300, response: { opcode: 1, mask: true, payloadData: 'ping' } });
  store.handleEvent('Network.webSocketFrameError', { requestId: 'ws1', timestamp: 301, errorMessage: 'boom' });
  expect(ws.wsFrames!.length).toBe(500);
  expect(ws.wsFrames![0].payload).toBe('m7');
  expect(ws.wsFramesDropped).toBe(7);
  expect(ws.wsFrames!.at(-2)).toMatchObject({ dir: 'sent', payload: 'ping' });
  expect(ws.wsFrames!.at(-1)).toMatchObject({ dir: 'error', payload: 'boom' });
  store.handleEvent('Network.webSocketClosed', { requestId: 'ws1', timestamp: 400 });
  expect(ws.durationMs).toBeGreaterThanOrEqual(0);
});

test('frames under the cap report no drops', () => {
  const store = new NetworkStore();
  store.handleEvent('Network.webSocketCreated', { requestId: 'ws2', url: 'wss://a.test/sock' });
  store.handleEvent('Network.webSocketFrameReceived', { requestId: 'ws2', timestamp: 1, response: { opcode: 1, payloadData: 'hi' } });
  expect(store.entries()[0].wsFramesDropped).toBeUndefined();
});

test('captures securityState and securityDetails from responseReceived', () => {
  const store = new NetworkStore();
  store.handleEvent('Network.requestWillBeSent', {
    requestId: 's1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://api.test/data', method: 'GET', headers: {} },
  });
  store.handleEvent('Network.responseReceived', {
    requestId: 's1', timestamp: 1.1, type: 'XHR',
    response: {
      status: 200, statusText: 'OK', mimeType: 'application/json', headers: {},
      securityState: 'secure',
      securityDetails: {
        protocol: 'TLS 1.3', keyExchange: '', keyExchangeGroup: 'X25519', cipher: 'AES_128_GCM',
        subjectName: 'api.test', issuer: 'R11', validFrom: 1700000000, validTo: 1731536000,
        sanList: ['api.test', '*.test'], certificateId: 7, mac: '',
      },
    },
  });
  const [e] = store.entries();
  expect(e.securityState).toBe('secure');
  expect(e.securityDetails).toEqual({
    protocol: 'TLS 1.3', keyExchangeGroup: 'X25519', cipher: 'AES_128_GCM',
    subjectName: 'api.test', issuer: 'R11', validFrom: 1700000000, validTo: 1731536000,
    sanList: ['api.test', '*.test'],
  });
});

test('plain http responses carry no security fields', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'plain');
  const [e] = store.entries();
  expect(e.securityState).toBeUndefined();
  expect(e.securityDetails).toBeUndefined();
});

test('markRemapped records the rewritten target url', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'mr1');
  store.markRemapped('mr1', 'http://localhost:3000/data');
  expect(store.entries()[0].remappedTo).toBe('http://localhost:3000/data');
  store.markRemapped('ghost', 'http://x/');
});

test('eventSource messages land in the same frame list', () => {
  const store = new NetworkStore();
  feedBasicRequest(store, 'sse');
  store.handleEvent('Network.eventSourceMessageReceived', {
    requestId: 'sse', timestamp: 100.2, eventName: 'message', eventId: '1', data: 'hello',
  });
  const [e] = store.entries();
  expect(e.wsFrames).toEqual([{ dir: 'received', opcode: 1, payload: 'hello', ts: expect.any(Number) }]);
});

function feedPost(store: NetworkStore, id: string, url: string, postData: string | undefined, headers: Record<string, string> = {}) {
  store.handleEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 100, wallTime: 1700000000, type: 'Fetch',
    request: { url, method: 'POST', headers, ...(postData !== undefined ? { postData } : {}) },
  });
  return store.entries().at(-1)!;
}

test('tags graphql requests with the explicit operationName and type', () => {
  const store = new NetworkStore();
  const e = feedPost(store, 'g1', 'https://a.test/graphql',
    JSON.stringify({ operationName: 'FetchViewer', query: 'query FetchViewer { viewer { id } }' }));
  expect(e.gqlOperation).toBe('FetchViewer');
  expect(e.gqlType).toBe('query');
});

test('derives the operation name from the query text when operationName is absent', () => {
  const store = new NetworkStore();
  const e = feedPost(store, 'g2', 'https://a.test/graphql',
    JSON.stringify({ query: 'mutation SaveWidget($in: In!) { saveWidget(in: $in) { id } }' }));
  expect(e.gqlOperation).toBe('SaveWidget');
  expect(e.gqlType).toBe('mutation');
});

test('anonymous operations fall back to the keyword', () => {
  const store = new NetworkStore();
  const q = feedPost(store, 'g3', 'https://a.test/graphql', JSON.stringify({ query: 'query { viewer { id } }' }));
  expect(q.gqlOperation).toBe('query');
  expect(q.gqlType).toBe('query');
  const m = feedPost(store, 'g4', 'https://a.test/graphql', JSON.stringify({ query: 'mutation { bump }' }));
  expect(m.gqlOperation).toBe('mutation');
  expect(m.gqlType).toBe('mutation');
});

test('batched operations use the first name plus a +N suffix', () => {
  const store = new NetworkStore();
  const e = feedPost(store, 'g5', 'https://a.test/graphql', JSON.stringify([
    { operationName: 'FetchViewer', query: 'query FetchViewer { viewer { id } }' },
    { query: 'query { b }' },
    { query: 'query { c }' },
  ]));
  expect(e.gqlOperation).toBe('FetchViewer+2');
});

test('detects graphql via json content-type off the /graphql path', () => {
  const store = new NetworkStore();
  const e = feedPost(store, 'g6', 'https://a.test/api',
    JSON.stringify({ query: 'query FetchViewer { viewer { id } }' }),
    { 'Content-Type': 'application/json' });
  expect(e.gqlOperation).toBe('FetchViewer');
});

test('leaves non-graphql and malformed posts untagged', () => {
  const store = new NetworkStore();
  const plain = feedPost(store, 'g7', 'https://a.test/api',
    JSON.stringify({ query: 'red shoes', page: 1 }), { 'content-type': 'application/json' });
  expect(plain.gqlOperation).toBeUndefined();
  const objectQuery = feedPost(store, 'g8', 'https://a.test/api',
    JSON.stringify({ query: { match: 'red' } }), { 'content-type': 'application/json' });
  expect(objectQuery.gqlOperation).toBeUndefined();
  const noJsonCt = feedPost(store, 'g9', 'https://a.test/api',
    JSON.stringify({ query: 'query FetchViewer { viewer { id } }' }), { 'content-type': 'text/plain' });
  expect(noJsonCt.gqlOperation).toBeUndefined();
  const malformed = feedPost(store, 'g10', 'https://a.test/graphql', '{"query": "query Broken {');
  expect(malformed.gqlOperation).toBeUndefined();
  const noBody = feedPost(store, 'g11', 'https://a.test/graphql', undefined);
  expect(noBody.gqlOperation).toBeUndefined();
});
