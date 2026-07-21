import { test, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harToEntries, loadArchive } from '../src/archive.js';
import { buildHar } from '../src/persist/har.js';
import type { NetworkEntry } from '../src/store/types.js';

test('loadArchive reads jsonl entries and skips malformed lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-arch-'));
  await writeFile(join(dir, 'network.jsonl'), '{"id":"r1","url":"https://a.test/x","method":"GET","type":"XHR","requestHeaders":{},"responseHeaders":{},"startTs":1,"status":200}\nnot json\n');
  await writeFile(join(dir, 'console.jsonl'), '{"kind":"error","text":"boom","ts":2}\n');
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ url: 'https://a.test/x', capturedAt: '2026-07-16T00:00:00Z' }));
  const data = loadArchive(dir);
  expect(data.network.map(e => e.id)).toEqual(['r1']);
  expect(data.console[0].text).toBe('boom');
  expect(data.meta?.url).toBe('https://a.test/x');
});

test('loadArchive tolerates missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-arch2-'));
  const data = loadArchive(dir);
  expect(data).toEqual({ network: [], console: [], meta: undefined });
});

test('loadArchive round-trips a HAR built by buildHar', async () => {
  const src: NetworkEntry = {
    id: 'r1', url: 'https://api.test/data?x=1', method: 'POST', type: 'XHR',
    status: 201, statusText: 'Created', mimeType: 'application/json',
    requestHeaders: { 'content-type': 'application/json', cookie: 'sid=abc' },
    responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'sid=def; Path=/' },
    postData: '{"q":1}',
    startTs: 1700000000000, durationMs: 142, encodedBytes: 2150,
    body: '{"ok":true}',
    protocol: 'h2',
    setCookies: ['sid=def; Path=/'],
  };
  const dir = await mkdtemp(join(tmpdir(), 'dtui-arch-har-'));
  const file = join(dir, 'session.har');
  await writeFile(file, JSON.stringify(buildHar([src], { browser: 'X', sanitize: false })));
  const data = loadArchive(file);
  expect(data.console).toEqual([]);
  expect(data.network).toHaveLength(1);
  const e = data.network[0];
  expect(e).toMatchObject({
    url: 'https://api.test/data?x=1', method: 'POST', type: 'XHR',
    status: 201, statusText: 'Created', mimeType: 'application/json',
    postData: '{"q":1}', startTs: 1700000000000, durationMs: 142,
    encodedBytes: 2150, body: '{"ok":true}', protocol: 'h2',
  });
  expect(e.requestHeaders.cookie).toBe('sid=abc');
  expect(e.setCookies).toEqual(['sid=def; Path=/']);
});

test('loadArchive throws on a malformed .har file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-arch-bad-'));
  const file = join(dir, 'broken.har');
  await writeFile(file, 'not json');
  expect(() => loadArchive(file)).toThrow(/invalid HAR/);
});

test('harToEntries skips url-less or junk entries and drops absent fields', () => {
  const entries = harToEntries({
    log: {
      entries: [
        { request: { method: 'GET' } },
        'junk',
        { request: { url: 'https://a.test/x' } },
        { request: { url: 'https://a.test/y' }, response: { status: 0 }, time: -1 },
      ],
    },
  });
  expect(entries.map(e => e.url)).toEqual(['https://a.test/x', 'https://a.test/y']);
  expect(entries[0].method).toBe('GET');
  expect(entries[0].status).toBeUndefined();
  expect(entries[0].durationMs).toBeUndefined();
  expect(entries[0].timing).toBeUndefined();
  expect(entries[0].body).toBeUndefined();
  expect(entries[1].status).toBeUndefined();
  expect(entries[1].durationMs).toBeUndefined();
});

test('harToEntries returns [] for a HAR without an entries array', () => {
  expect(harToEntries({ log: {} })).toEqual([]);
  expect(harToEntries(null)).toEqual([]);
  expect(harToEntries('x')).toEqual([]);
});

test('harToEntries maps Chrome _resourceType, base64 bodies, and repeated Set-Cookie headers', () => {
  const [e] = harToEntries({
    log: {
      entries: [{
        startedDateTime: '2026-07-17T00:00:00.000Z',
        time: 12.5,
        _resourceType: 'fetch',
        request: { url: 'https://a.test/img', method: 'GET', headers: [] },
        response: {
          status: 200,
          headers: [{ name: 'Set-Cookie', value: 'a=1' }, { name: 'Set-Cookie', value: 'b=2' }],
          content: { text: 'aGk=', encoding: 'base64', mimeType: 'image/png', size: 2 },
        },
      }],
    },
  });
  expect(e.type).toBe('Fetch');
  expect(e.startTs).toBe(Date.parse('2026-07-17T00:00:00.000Z'));
  expect(e.durationMs).toBe(12.5);
  expect(e.body).toBe('aGk=');
  expect(e.bodyBase64).toBe(true);
  expect(e.decodedBytes).toBe(2);
  expect(e.setCookies).toEqual(['a=1', 'b=2']);
});

test('harToEntries infers the type bucket from mimeType when _resourceType is absent', () => {
  const typeOf = (mimeType: string) => harToEntries({
    log: { entries: [{ request: { url: 'https://a.test/' }, response: { content: { mimeType } } }] },
  })[0].type;
  expect(typeOf('text/html')).toBe('Document');
  expect(typeOf('application/javascript')).toBe('Script');
  expect(typeOf('text/css')).toBe('Stylesheet');
  expect(typeOf('image/png')).toBe('Image');
  expect(typeOf('font/woff2')).toBe('Font');
  expect(typeOf('application/json')).toBe('XHR');
  expect(typeOf('application/octet-stream')).toBe('Other');
});

test('harToEntries lays HAR phase durations out as cumulative timing offsets', () => {
  const [e] = harToEntries({
    log: {
      entries: [{
        startedDateTime: '2026-07-17T00:00:00.000Z',
        request: { url: 'https://a.test/' },
        response: {},
        timings: { blocked: 1, dns: 2, connect: 8, ssl: 5, send: 1, wait: 100, receive: 10 },
      }],
    },
  });
  expect(e.timing).toMatchObject({
    dnsStart: 1, dnsEnd: 3,
    connectStart: 3, connectEnd: 11,
    sslStart: 6, sslEnd: 11,
    sendStart: 11, sendEnd: 12,
    receiveHeadersEnd: 112,
  });
});

test('console args round-trip through JSONL with previews and without objectIds', async () => {
  const { ConsoleStore, persistableConsoleEntry } = await import('../src/store/console.js');
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 3,
    args: [{
      type: 'object', objectId: 'obj-1', className: 'Object', description: 'Object',
      preview: { type: 'object', description: 'Object', overflow: false, properties: [{ name: 'a', type: 'number', value: '1' }] },
    }],
  });
  const dir = await mkdtemp(join(tmpdir(), 'dtui-arch-con-'));
  await writeFile(join(dir, 'console.jsonl'), `${JSON.stringify(persistableConsoleEntry(store.entries()[0]))}\n`);
  const data = loadArchive(dir);
  expect(data.console[0].text).toBe('{a: 1}');
  expect(data.console[0].args![0].preview).toMatchObject({ type: 'object' });
  expect(data.console[0].args![0].objectId).toBeUndefined();
});
