import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { buildHar, exportHar, toHarEntry } from '../src/persist/har.js';
import type { NetworkEntry } from '../src/store/types.js';

const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

const entry: NetworkEntry = {
  id: 'r1', url: 'https://api.test/data?x=1', method: 'POST', type: 'XHR',
  status: 200, statusText: 'OK', mimeType: 'application/json',
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  postData: '{"q":1}',
  startTs: 1700000000000, durationMs: 142, encodedBytes: 2150,
  timing: { requestTime: 100, dnsStart: 0, dnsEnd: 2, connectStart: 2, connectEnd: 10, sslStart: 4, sslEnd: 9, sendStart: 10, sendEnd: 11, receiveHeadersEnd: 120 },
  body: '{"ok":true}', bodyBase64: false, bodyTruncated: false,
};

test('toHarEntry maps core fields', () => {
  const h = toHarEntry(entry) as any;
  expect(h.startedDateTime).toBe(new Date(1700000000000).toISOString());
  expect(h.time).toBe(142);
  expect(h.request).toMatchObject({ method: 'POST', url: 'https://api.test/data?x=1' });
  expect(h.request.headers).toEqual([{ name: 'content-type', value: 'application/json' }]);
  expect(h.request.postData).toEqual({ mimeType: 'application/json', text: '{"q":1}' });
  expect(h.response).toMatchObject({ status: 200, statusText: 'OK' });
  expect(h.response.content).toMatchObject({ mimeType: 'application/json', text: '{"ok":true}' });
  expect(h.timings.dns).toBe(2);
  expect(h.timings.connect).toBe(8);
  expect(h.timings.wait).toBeCloseTo(109, 0);
});

test('bodySize and content.size count bytes, not UTF-16 code units', () => {
  const h = toHarEntry({ ...entry, postData: '가나다', body: '한글본문' }) as any;
  expect(h.request.bodySize).toBe(Buffer.byteLength('가나다'));
  expect(h.request.bodySize).toBe(9);
  expect(h.response.content.size).toBe(Buffer.byteLength('한글본문'));
  expect(h.response.content.size).toBe(12);
});

test('content.size decodes base64 bodies to their byte length', () => {
  const raw = Buffer.from([1, 2, 3, 4, 5]);
  const h = toHarEntry({ ...entry, body: raw.toString('base64'), bodyBase64: true }) as any;
  expect(h.response.content.size).toBe(5);
});

test('postData mimeType matches Content-Type case-insensitively', () => {
  const h = toHarEntry({ ...entry, requestHeaders: { 'Content-Type': 'text/plain' } }) as any;
  expect(h.request.postData.mimeType).toBe('text/plain');
});

test('toHarEntry survives an unfinished entry', () => {
  const h = toHarEntry({
    id: 'r2', url: 'https://a.test/', method: 'GET', type: 'Document',
    requestHeaders: {}, responseHeaders: {}, startTs: 1700000000000,
  }) as any;
  expect(h.time).toBe(-1);
  expect(h.response.status).toBe(0);
  expect(h.timings.wait).toBe(-1);
});

test('suppresses the wait segment when receiveHeadersEnd is -1', () => {
  const h = toHarEntry({ ...entry, timing: { ...entry.timing!, receiveHeadersEnd: -1 } }) as any;
  expect(h.timings.wait).toBe(-1);
  expect(h.timings.dns).toBe(2);
});

test('clamps the download segment to 0 when receiveHeadersEnd runs past the finish time', () => {
  const h = toHarEntry({ ...entry, durationMs: 100, timing: { ...entry.timing!, receiveHeadersEnd: 120 } }) as any;
  expect(h.timings.receive).toBe(0);
});

test('annotates a truncated body with a content comment', () => {
  const h = toHarEntry({ ...entry, bodyTruncated: true }, 262_144) as any;
  expect(h.response.content.comment).toBe('body truncated at 262144 bytes');
  const bare = toHarEntry({ ...entry, bodyTruncated: true }) as any;
  expect(bare.response.content.comment).toBe('body truncated');
  expect((toHarEntry(entry) as any).response.content.comment).toBeUndefined();
});

test('fills queryString, cookies, and protocol-derived httpVersion', () => {
  const h = toHarEntry({
    ...entry,
    url: 'https://api.test/data?x=1&y=two',
    requestHeaders: { cookie: 'sid=abc; theme=dark', 'content-type': 'application/json' },
    protocol: 'h2',
    setCookies: ['sid=def; Path=/; Domain=api.test; HttpOnly; Secure'],
  }, undefined, false) as any;
  expect(h.request.httpVersion).toBe('h2');
  expect(h.response.httpVersion).toBe('h2');
  expect(h.request.queryString).toEqual([{ name: 'x', value: '1' }, { name: 'y', value: 'two' }]);
  expect(h.request.cookies).toEqual([{ name: 'sid', value: 'abc' }, { name: 'theme', value: 'dark' }]);
  expect(h.response.cookies).toEqual([
    { name: 'sid', value: 'def', path: '/', domain: 'api.test', httpOnly: true, secure: true },
  ]);
});

test('queryString is empty for an unparseable URL', () => {
  const h = toHarEntry({ ...entry, url: 'not a url' }) as any;
  expect(h.request.queryString).toEqual([]);
  expect(h.request.cookies).toEqual([]);
});

const secretEntry: NetworkEntry = {
  ...entry,
  requestHeaders: { Authorization: 'Bearer tok', Cookie: 'sid=abc', accept: '*/*' },
  responseHeaders: { 'Set-Cookie': 'sid=def; Path=/', 'content-type': 'application/json' },
  setCookies: ['sid=def; Path=/'],
};

test('sanitize masks sensitive header and cookie values by default', () => {
  const h = toHarEntry(secretEntry) as any;
  expect(h.request.headers).toContainEqual({ name: 'Authorization', value: '[redacted]' });
  expect(h.request.headers).toContainEqual({ name: 'Cookie', value: '[redacted]' });
  expect(h.request.headers).toContainEqual({ name: 'accept', value: '*/*' });
  expect(h.response.headers).toContainEqual({ name: 'Set-Cookie', value: '[redacted]' });
  expect(h.request.cookies).toEqual([{ name: 'sid', value: '[redacted]' }]);
  expect(h.response.cookies).toEqual([{ name: 'sid', value: '[redacted]', path: '/' }]);
});

test('buildHar sanitizes by default and exports verbatim with sanitize off', () => {
  const def = (buildHar([secretEntry], {}) as any).log.entries[0];
  expect(def.request.headers).toContainEqual({ name: 'Authorization', value: '[redacted]' });
  const raw = (buildHar([secretEntry], { sanitize: false }) as any).log.entries[0];
  expect(raw.request.headers).toContainEqual({ name: 'Authorization', value: 'Bearer tok' });
  expect(raw.request.cookies).toEqual([{ name: 'sid', value: 'abc' }]);
  expect(raw.response.cookies).toEqual([{ name: 'sid', value: 'def', path: '/' }]);
});

test('exportHar writes a timestamped .har under the root and returns the path', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'dtui-har-')), 'har');
  const file = await exportHar(root, 'https://api.test/data', [entry], { browser: 'X' }, new Date('2026-07-17T01:02:03Z'));
  expect(file).toBe(join(root, '2026-07-17T01-02-03-api-test-data.har'));
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  expect(parsed.log.version).toBe('1.2');
  expect(parsed.log.entries).toHaveLength(1);
});

test('buildHar wraps entries with log metadata', () => {
  const har = buildHar([entry], { browser: 'Chrome/149' }) as any;
  expect(har.log.version).toBe('1.2');
  expect(har.log.creator.name).toBe('devtools-tui');
  expect(har.log.creator.version).toBe(pkgVersion);
  expect(har.log.browser.name).toBe('Chrome/149');
  expect(har.log.entries).toHaveLength(1);
});
