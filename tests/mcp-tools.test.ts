import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlSessionSource, type LiveExtras, type SessionSource } from '../src/mcp/source.js';
import { consoleMessages, getRequest, listSessions, listTabs, networkSearch, selectedElement, sessionSummary, takeScreenshot } from '../src/mcp/tools.js';
import type { ConsoleEntry, NetworkEntry } from '../src/store/types.js';

const T0 = Date.UTC(2026, 6, 19, 9, 30, 0);

function net(over: Partial<NetworkEntry> & { id: string }): NetworkEntry {
  return {
    url: 'https://api.example.com/users',
    method: 'GET',
    type: 'XHR',
    requestHeaders: {},
    responseHeaders: {},
    startTs: T0,
    status: 200,
    mimeType: 'application/json',
    ...over,
  };
}

function con(over: Partial<ConsoleEntry>): ConsoleEntry {
  return { kind: 'log', text: 'msg', ts: T0, ...over };
}

async function writeSession(root: string, name: string, netLines: unknown[], conLines: unknown[] = []): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const enc = (rows: unknown[]) => rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
  if (netLines.length) await writeFile(join(dir, 'network.jsonl'), enc(netLines));
  if (conLines.length) await writeFile(join(dir, 'console.jsonl'), enc(conLines));
}

const OLD = '2026-07-18T10-00-00-old-example-com';
const NEW = '2026-07-19T09-30-00-api-example-com';

async function makeFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await writeSession(root, OLD, [net({ id: 'old-1', url: 'https://old.example.com/' })], [con({ text: 'old session line' })]);
  await writeSession(root, NEW, [
    net({ id: 'e1', url: 'https://api.example.com/users', status: 200, encodedBytes: 512, durationMs: 120.4, startTs: T0 + 1000 }),
    net({
      id: 'e2', url: 'https://api.example.com/login', method: 'POST', status: 401, durationMs: 80,
      requestHeaders: { Authorization: 'Bearer secret-token', Accept: 'application/json' },
      responseHeaders: { 'Set-Cookie': 'sid=abc', 'Content-Type': 'application/json' },
      postData: '{"user":"alice","password":"hunter2"}',
      body: '{"error":"unauthorized"}',
      startTs: T0 + 2000,
    }),
    net({ id: 'e3', url: 'https://cdn.example.com/app.js', mimeType: 'application/javascript', decodedBytes: 4000, startTs: T0 + 3000 }),
    net({ id: 'e4', url: 'https://api.example.com/broken', status: undefined, mimeType: undefined, error: 'net::ERR_FAILED', startTs: T0 + 4000 }),
    net({
      id: 'e5', url: 'https://api.example.com/slow', status: 500, durationMs: 900,
      timing: {
        requestTime: 1, dnsStart: 0, dnsEnd: 2, connectStart: 2, connectEnd: 5,
        sslStart: 3, sslEnd: 5, sendStart: 5, sendEnd: 6, receiveHeadersEnd: 890,
      },
      queueingMs: 12, startTs: T0 + 5000,
    }),
  ], [
    con({ kind: 'log', text: 'hello world', ts: T0 + 1000 }),
    con({ kind: 'warn', text: 'deprecated api', ts: T0 + 2000 }),
    con({ kind: 'error', text: 'request failed hard', ts: T0 + 3000, stack: '    at fn (https://x/app.js:1)', url: 'https://x/app.js', line: 1 }),
    con({ kind: 'exception', text: 'ReferenceError: x is not defined', ts: T0 + 4000 }),
    con({ kind: 'info', text: 'started', ts: T0 + 5000 }),
    con({ kind: 'debug', text: 'dbg detail', ts: T0 + 6000, count: 3 }),
  ]);
  return root;
}

test('listSessions returns newest first with metadata and line counts', async () => {
  const root = await makeFixtureRoot();
  const src = new JsonlSessionSource(root);
  const rows = await listSessions(src);
  expect(rows.map(r => r.id)).toEqual([NEW, OLD]);
  expect(rows[0]).toEqual({
    id: NEW,
    startedAt: '2026-07-19T09:30:00.000Z',
    urlSlug: 'api-example-com',
    path: join(root, NEW),
    networkCount: 5,
    consoleCount: 6,
  });
  expect(rows[1].networkCount).toBe(1);
  expect(rows[1].consoleCount).toBe(1);
});

test('listSessions respects limit', async () => {
  const root = await makeFixtureRoot();
  const rows = await listSessions(new JsonlSessionSource(root), { limit: 1 });
  expect(rows.map(r => r.id)).toEqual([NEW]);
});

test('listSessions handles missing and empty roots', async () => {
  expect(await listSessions(new JsonlSessionSource('/nonexistent/dtui-mcp-root'))).toEqual([]);
  const empty = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  expect(await listSessions(new JsonlSessionSource(empty))).toEqual([]);
});

test('listSessions counts a session dir without jsonl files as zero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await mkdir(join(root, '2026-07-19T08-00-00-bare'));
  const rows = await listSessions(new JsonlSessionSource(root));
  expect(rows[0].networkCount).toBe(0);
  expect(rows[0].consoleCount).toBe(0);
});

test('networkSearch defaults to the newest session and orders newest first', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const { rows } = await networkSearch(src, {});
  expect(rows.map(r => r.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
});

test('networkSearch rows are compact: no headers or bodies', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const row = (await networkSearch(src, { url_pattern: 'login' })).rows[0];
  expect(row).toEqual({
    id: 'e2', method: 'POST', status: 401, mimeType: 'application/json',
    url: 'https://api.example.com/login', timeMs: 80, startedAt: '2026-07-19T09:30:02.000Z',
  });
  expect(row).not.toHaveProperty('requestHeaders');
  expect(row).not.toHaveProperty('postData');
  expect(row).not.toHaveProperty('body');
});

test('networkSearch reports size and error on rows', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  expect((await networkSearch(src, { url_pattern: 'users' })).rows[0].size).toBe(512);
  const failed = (await networkSearch(src, { url_pattern: 'broken' })).rows[0];
  expect(failed.error).toBe('net::ERR_FAILED');
  expect(failed.status).toBeUndefined();
});

test('networkSearch filters by substring (case-insensitive) and glob', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  expect((await networkSearch(src, { url_pattern: 'LOGIN' })).rows.map(r => r.id)).toEqual(['e2']);
  expect((await networkSearch(src, { url_pattern: 'https://api.example.com/*' })).rows.map(r => r.id)).toEqual(['e5', 'e4', 'e2', 'e1']);
});

test('networkSearch filters by method, status, status_class, and mime', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  expect((await networkSearch(src, { method: 'post' })).rows.map(r => r.id)).toEqual(['e2']);
  expect((await networkSearch(src, { status: 401 })).rows.map(r => r.id)).toEqual(['e2']);
  expect((await networkSearch(src, { status_class: '5xx' })).rows.map(r => r.id)).toEqual(['e5']);
  expect((await networkSearch(src, { status_class: '2xx' })).rows.map(r => r.id)).toEqual(['e3', 'e1']);
  expect((await networkSearch(src, { mime: 'javascript' })).rows.map(r => r.id)).toEqual(['e3']);
});

test('networkSearch applies limit keeping the newest rows', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  expect((await networkSearch(src, { limit: 2 })).rows.map(r => r.id)).toEqual(['e5', 'e4']);
});

test('networkSearch accepts an explicit session and rejects unknown ones', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  expect((await networkSearch(src, { session: OLD })).rows.map(r => r.id)).toEqual(['old-1']);
  await expect(networkSearch(src, { session: 'nope' })).rejects.toThrow(/unknown session/);
  await expect(networkSearch(src, { session: '../escape' })).rejects.toThrow(/unknown session/);
});

test('networkSearch rejects a bad status_class', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  await expect(networkSearch(src, { status_class: 'abc' })).rejects.toThrow(/status_class/);
});

test('networkSearch since keys on completion time and returns a resumable cursor', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const first = await networkSearch(src, {});
  expect(first.cursor).toBe(T0 + 5900);
  const incr = await networkSearch(src, { since: T0 + 3000 });
  expect(incr.rows.map(r => r.id)).toEqual(['e5', 'e4']);
  expect(incr.cursor).toBe(T0 + 5900);
  const tail = await networkSearch(src, { since: T0 + 5000 });
  expect(tail.rows.map(r => r.id)).toEqual(['e5']);
  const empty = await networkSearch(src, { since: T0 + 5900 });
  expect(empty.rows).toEqual([]);
  expect(empty.cursor).toBe(T0 + 5900);
});

test('networkSearch since combines with other filters and never rewinds the cursor', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const { rows, cursor } = await networkSearch(src, { since: T0 + 1000, status_class: '4xx' });
  expect(rows.map(r => r.id)).toEqual(['e2']);
  expect(cursor).toBe(T0 + 5900);
  const future = await networkSearch(src, { since: T0 + 999_999 });
  expect(future.rows).toEqual([]);
  expect(future.cursor).toBe(T0 + 999_999);
});

test('networkSearch since catches a slow request that started before the cursor but finished after', async () => {
  const { appendFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await writeSession(root, NEW, [net({ id: 'fast', startTs: T0 + 1000, durationMs: 50 })]);
  const src = new JsonlSessionSource(root);
  const first = await networkSearch(src, {});
  expect(first.rows.map(r => r.id)).toEqual(['fast']);
  expect(first.cursor).toBe(T0 + 1050);
  await appendFile(join(root, NEW, 'network.jsonl'), JSON.stringify(net({ id: 'slow', startTs: T0 + 500, durationMs: 5000 })) + '\n');
  const second = await networkSearch(src, { since: first.cursor });
  expect(second.rows.map(r => r.id)).toEqual(['slow']);
  expect(second.cursor).toBe(T0 + 5500);
});

test('getRequest defaults to redacted headers only', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const detail = await getRequest(src, { id: 'e2' });
  expect(detail.requestHeaders).toEqual({ Authorization: '[redacted]', Accept: 'application/json' });
  expect(detail.responseHeaders).toEqual({ 'Set-Cookie': '[redacted]', 'Content-Type': 'application/json' });
  expect(detail.url).toBe('https://api.example.com/login');
  expect(detail.method).toBe('POST');
  expect(detail.status).toBe(401);
  expect(detail).not.toHaveProperty('requestBody');
  expect(detail).not.toHaveProperty('responseBody');
  expect(detail).not.toHaveProperty('timing');
});

test('getRequest returns bodies only when included, truncated to body_max_bytes', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const full = await getRequest(src, { id: 'e2', include: ['request_body', 'response_body'] });
  expect(full.requestBody).toEqual({ body: '{"user":"alice","password":"hunter2"}', bytes: 37, truncated: false });
  expect(full.responseBody).toEqual({ body: '{"error":"unauthorized"}', bytes: 24, truncated: false });
  expect(full).not.toHaveProperty('requestHeaders');
  const cut = await getRequest(src, { id: 'e2', include: ['request_body'], body_max_bytes: 8 });
  expect(cut.requestBody).toEqual({ body: '{"user":', bytes: 37, truncated: true });
});

test('getRequest keeps the writer truncation flag on response bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await writeSession(root, NEW, [net({ id: 'r1', body: 'partial', bodyTruncated: true, bodyBase64: true })]);
  const detail = await getRequest(new JsonlSessionSource(root), { id: 'r1', include: ['response_body'] });
  expect(detail.responseBody).toEqual({ body: 'partial', bytes: 7, truncated: true, base64: true });
});

test('getRequest returns timing when included', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const detail = await getRequest(src, { id: 'e5', include: ['timing'] });
  expect(detail.timing).toMatchObject({ receiveHeadersEnd: 890, queueingMs: 12 });
  expect(detail).not.toHaveProperty('requestHeaders');
});

test('getRequest throws for an unknown request id', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  await expect(getRequest(src, { id: 'missing' })).rejects.toThrow(/request not found/);
});

test('consoleMessages returns newest first with entry fields', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const { rows } = await consoleMessages(src, {});
  expect(rows.map(r => r.text)).toEqual([
    'dbg detail', 'started', 'ReferenceError: x is not defined', 'request failed hard', 'deprecated api', 'hello world',
  ]);
  expect(rows[0]).toEqual({ ts: '2026-07-19T09:30:06.000Z', kind: 'debug', text: 'dbg detail', count: 3 });
  const err = rows.find(r => r.kind === 'error');
  expect(err).toMatchObject({ stack: '    at fn (https://x/app.js:1)', url: 'https://x/app.js', line: 1 });
});

test('consoleMessages level=error includes exceptions', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const { rows } = await consoleMessages(src, { level: 'error' });
  expect(rows.map(r => r.kind)).toEqual(['exception', 'error']);
  expect((await consoleMessages(src, { level: 'warn' })).rows.map(r => r.text)).toEqual(['deprecated api']);
});

test('consoleMessages filters by contains (case-insensitive) and limit', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  expect((await consoleMessages(src, { contains: 'FAILED' })).rows.map(r => r.text)).toEqual(['request failed hard']);
  expect((await consoleMessages(src, { limit: 2 })).rows.map(r => r.text)).toEqual(['dbg detail', 'started']);
});

test('consoleMessages since returns only newer messages and a resumable cursor', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const first = await consoleMessages(src, {});
  expect(first.cursor).toBe(T0 + 6000);
  const incr = await consoleMessages(src, { since: T0 + 4000 });
  expect(incr.rows.map(r => r.text)).toEqual(['dbg detail', 'started']);
  expect(incr.cursor).toBe(T0 + 6000);
  const empty = await consoleMessages(src, { since: T0 + 6000 });
  expect(empty.rows).toEqual([]);
  expect(empty.cursor).toBe(T0 + 6000);
});

test('sessionSummary aggregates the session and reports its source', async () => {
  const src = new JsonlSessionSource(await makeFixtureRoot());
  const summary = await sessionSummary(src, {});
  expect(summary).toEqual({
    id: NEW,
    source: 'files',
    urlSlug: 'api-example-com',
    startedAt: '2026-07-19T09:30:00.000Z',
    requests: { total: 5, byStatusClass: { '2xx': 2, '4xx': 1, '5xx': 1 } },
    failures: 1,
    consoleErrors: 2,
    topSlow: [
      { url: 'https://api.example.com/slow', timeMs: 900, status: 500 },
      { url: 'https://api.example.com/users', timeMs: 120, status: 200 },
      { url: 'https://api.example.com/login', timeMs: 80, status: 401 },
    ],
  });
});

test('sessionSummary of an empty session is all zeroes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await mkdir(join(root, '2026-07-19T08-00-00-bare'));
  const summary = await sessionSummary(new JsonlSessionSource(root), {});
  expect(summary.requests).toEqual({ total: 0, byStatusClass: {} });
  expect(summary.failures).toBe(0);
  expect(summary.consoleErrors).toBe(0);
  expect(summary.topSlow).toEqual([]);
});

test('tools throw when no sessions exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  const src = new JsonlSessionSource(root);
  await expect(networkSearch(src, {})).rejects.toThrow(/no sessions/);
  await expect(sessionSummary(src, {})).rejects.toThrow(/no sessions/);
});

test('corrupt and non-object jsonl lines are skipped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await writeSession(root, NEW, [net({ id: 'g1' }), 'not-json{{{', '42', net({ id: 'g2' })]);
  const { rows } = await networkSearch(new JsonlSessionSource(root), {});
  expect(rows.map(r => r.id)).toEqual(['g2', 'g1']);
});

test('maxLines cap keeps only the newest lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  await writeSession(root, NEW, [net({ id: 'l1' }), net({ id: 'l2' }), net({ id: 'l3' }), net({ id: 'l4' })]);
  const { rows } = await networkSearch(new JsonlSessionSource(root, { maxLines: 2 }), {});
  expect(rows.map(r => r.id)).toEqual(['l4', 'l3']);
});

test('maxBytes cap reads the file tail and drops the partial first line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-'));
  const lines = [net({ id: 'b1' }), net({ id: 'b2' }), net({ id: 'b3' })];
  await writeSession(root, NEW, lines);
  const lastLine = JSON.stringify(lines[2]) + '\n';
  const maxBytes = Buffer.byteLength(lastLine) + 5;
  const { rows } = await networkSearch(new JsonlSessionSource(root, { maxBytes }), {});
  expect(rows.map(r => r.id)).toEqual(['b3']);
});

test('getRequest truncates a multibyte body at a character boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-utf8-'));
  const body = '한'.repeat(10);
  await writeSession(root, NEW, [net({ id: 'u1', body })]);
  const detail = await getRequest(new JsonlSessionSource(root), { id: 'u1', include: ['response_body'], body_max_bytes: 8 });
  expect(detail.responseBody!.body).toBe('한한');
  expect(detail.responseBody!.body).not.toContain('�');
  expect(Buffer.byteLength(detail.responseBody!.body, 'utf8')).toBeLessThanOrEqual(8);
  expect(detail.responseBody!.bytes).toBe(30);
  expect(detail.responseBody!.truncated).toBe(true);
});

test('getRequest caps ws_frame payloads at body_max_bytes with truncation labels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-wscap-'));
  const frames = [
    { dir: 'sent', opcode: 1, payload: 'x'.repeat(100), ts: T0 },
    { dir: 'received', opcode: 1, payload: '한'.repeat(10), ts: T0 + 1 },
    { dir: 'received', opcode: 1, payload: 'short', ts: T0 + 2 },
  ];
  await writeSession(root, NEW, [net({ id: 'w1', wsFrames: frames as NetworkEntry['wsFrames'] })]);
  const detail = await getRequest(new JsonlSessionSource(root), { id: 'w1', include: ['ws_frames'], body_max_bytes: 8 });
  expect(detail.wsFrames![0]).toEqual({ dir: 'sent', opcode: 1, payload: 'x'.repeat(8), ts: T0, payloadBytes: 100, payloadTruncated: true });
  expect(detail.wsFrames![1].payload).toBe('한한');
  expect(detail.wsFrames![1].payload).not.toContain('�');
  expect(detail.wsFrames![1]).toMatchObject({ payloadBytes: 30, payloadTruncated: true });
  expect(detail.wsFrames![2]).toEqual({ dir: 'received', opcode: 1, payload: 'short', ts: T0 + 2 });
});

const ELEMENT_DATA = {
  url: 'https://shop.test/checkout',
  capturedAt: '2026-07-20T00:00:00.000Z',
  selectorPath: 'div#app > button.buy',
  outerHTML: '<button class="buy">buy</button>',
  rules: [
    { selector: '.buy', origin: 'regular', declarations: [{ name: 'color', value: 'red', important: false, disabled: false, overridden: false }] },
    { selector: 'body', origin: 'regular', inheritedFrom: 'body.page', declarations: [{ name: 'color', value: 'green', important: false, disabled: false, overridden: true }] },
  ],
  computed: [['display', 'block']] as Array<[string, string]>,
  box: { width: 10, height: 5, content: [], padding: [], border: [], margin: [] },
  missing: [],
};

function liveSrc(over: Partial<LiveExtras> = {}): SessionSource {
  return {
    kind: 'live',
    listSessions: async () => [{
      id: 'live-1', startedAt: '2026-07-20T00:00:00.000Z', urlSlug: 'shop-test', path: '', networkCount: 1, consoleCount: 0,
    }],
    readNetwork: async () => [net({ id: 'n1', startTs: T0 + 100 })],
    readConsole: async () => [],
    live: {
      listTabs: async () => [{ id: 't1', url: 'https://shop.test/', title: 'Shop' }],
      selectedElement: async () => ELEMENT_DATA,
      screenshot: async (target: string) => ({ data: Buffer.from(`${target}-shot`).toString('base64'), mimeType: 'image/png' }),
      ...over,
    },
  };
}

test('the five base tools work identically against a live source', async () => {
  const src = liveSrc();
  expect((await listSessions(src)).map(s => s.id)).toEqual(['live-1']);
  expect((await networkSearch(src, {})).rows.map(r => r.id)).toEqual(['n1']);
  const summary = await sessionSummary(src, {});
  expect(summary.source).toBe('live');
  expect(summary.requests.total).toBe(1);
  const detail = await getRequest(src, { id: 'n1' });
  expect(detail.url).toBe('https://api.example.com/users');
});

test('listTabs returns live tabs and errors on a files source', async () => {
  expect(await listTabs(liveSrc())).toEqual([{ id: 't1', url: 'https://shop.test/', title: 'Shop' }]);
  const files = new JsonlSessionSource(await mkdtemp(join(tmpdir(), 'dtui-mcp-')));
  await expect(listTabs(files)).rejects.toThrow(/running devtools-tui/);
});

test('selectedElement returns the full structured data by default', async () => {
  const data = await selectedElement(liveSrc(), {});
  expect(data).toEqual(ELEMENT_DATA);
  expect(data.rules![1].inheritedFrom).toBe('body.page');
  expect('inheritedFrom' in data.rules![0]).toBe(false);
});

test('selectedElement include narrows the payload but keeps identity fields', async () => {
  const data = await selectedElement(liveSrc(), { include: ['box'] });
  expect(data).toEqual({
    url: ELEMENT_DATA.url,
    capturedAt: ELEMENT_DATA.capturedAt,
    selectorPath: ELEMENT_DATA.selectorPath,
    box: ELEMENT_DATA.box,
    missing: [],
  });
});

test('selectedElement errors helpfully on a files source', async () => {
  const files = new JsonlSessionSource(await mkdtemp(join(tmpdir(), 'dtui-mcp-')));
  await expect(selectedElement(files, {})).rejects.toThrow(/running devtools-tui/);
});

test('getRequest fetches bodies through readRequest when the source provides it', async () => {
  const src = liveSrc();
  src.readNetwork = async () => [net({ id: 'n1', startTs: T0 + 100 })];
  src.readRequest = async (_session, id) =>
    id === 'n1' ? net({ id: 'n1', startTs: T0 + 100, body: '{"full":true}', postData: 'a=1' }) : undefined;
  const detail = await getRequest(src, { id: 'n1', include: ['request_body', 'response_body'] });
  expect(detail.responseBody?.body).toBe('{"full":true}');
  expect(detail.requestBody?.body).toBe('a=1');
  await expect(getRequest(src, { id: 'nope' })).rejects.toThrow(/request not found/);
});

test('takeScreenshot forwards the target and errors on a files source', async () => {
  const shot = await takeScreenshot(liveSrc(), { target: 'element' });
  expect(Buffer.from(shot.data, 'base64').toString()).toBe('element-shot');
  expect(shot.mimeType).toBe('image/png');
  const files = new JsonlSessionSource(await mkdtemp(join(tmpdir(), 'dtui-mcp-')));
  await expect(takeScreenshot(files, { target: 'viewport' })).rejects.toThrow(/running devtools-tui/);
});

test('getRequest include security and ws_frames returns the captured extras', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-sec-'));
  const sec = {
    protocol: 'TLS 1.3', keyExchangeGroup: 'X25519', cipher: 'AES_128_GCM',
    subjectName: 'api.example.com', issuer: 'R11', validFrom: 1700000000, validTo: 1731536000,
    sanList: ['api.example.com'],
  };
  const frames = [{ dir: 'sent', opcode: 1, payload: 'ping', ts: T0 }];
  await writeSession(root, NEW, [
    net({ id: 'sec1', securityState: 'secure', securityDetails: sec as NetworkEntry['securityDetails'], wsFrames: frames as NetworkEntry['wsFrames'], wsFramesDropped: 3 }),
  ]);
  const src = new JsonlSessionSource(root);
  const detail = await getRequest(src, { id: 'sec1', include: ['security', 'ws_frames'] });
  expect(detail.securityState).toBe('secure');
  expect(detail.securityDetails).toEqual(sec);
  expect(detail.wsFrames).toEqual(frames);
  expect(detail.wsFramesDropped).toBe(3);
  const plain = await getRequest(src, { id: 'sec1' });
  expect(plain.securityDetails).toBeUndefined();
  expect(plain.wsFrames).toBeUndefined();
});
