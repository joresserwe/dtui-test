import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  deleteCache,
  deleteCacheEntry,
  describeCacheBody,
  getCacheEntries,
  getCacheNames,
  getCachedResponseBody,
} from '../src/cdp/cache-storage.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => {
  mock = await MockCdp.start();
  conn = await CdpConnection.open(mock.pageWsUrl('page1'));
});
afterAll(async () => { conn.close(); await mock.close(); });

test('getCacheNames maps cache ids and names for the origin', async () => {
  mock.respond('CacheStorage.requestCacheNames', p => {
    expect(p).toEqual({ securityOrigin: 'https://a.test' });
    return { caches: [{ cacheId: 'c1', securityOrigin: 'https://a.test', cacheName: 'v1' }] };
  });
  expect(await getCacheNames(conn, 'https://a.test')).toEqual([{ id: 'c1', name: 'v1' }]);
});

test('getCacheEntries pages and maps entry fields with the total count', async () => {
  mock.respond('CacheStorage.requestEntries', p => {
    expect(p).toEqual({ cacheId: 'c1', skipCount: 10, pageSize: 50 });
    return {
      cacheDataEntries: [{
        requestURL: 'https://a.test/app.js',
        requestMethod: 'GET',
        requestHeaders: [{ name: 'accept', value: '*/*' }],
        responseStatus: 200,
        responseStatusText: 'OK',
        responseType: 'basic',
        responseTime: 1700000000,
        responseHeaders: [{ name: 'content-type', value: 'text/javascript' }],
      }],
      returnCount: 73,
    };
  });
  const page = await getCacheEntries(conn, 'c1', 10, 50);
  expect(page.total).toBe(73);
  expect(page.entries).toEqual([{
    url: 'https://a.test/app.js',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    responseType: 'basic',
    responseTime: 1700000000,
    headers: [['content-type', 'text/javascript']],
    reqHeaders: [['accept', '*/*']],
  }]);
});

test('getCachedResponseBody decodes the base64 body with the request headers', async () => {
  mock.respond('CacheStorage.requestCachedResponse', p => {
    expect(p).toEqual({
      cacheId: 'c1',
      requestURL: 'https://a.test/app.js',
      requestHeaders: [{ name: 'accept', value: '*/*' }],
    });
    return { response: { body: Buffer.from('hello cache').toString('base64') } };
  });
  const body = await getCachedResponseBody(conn, 'c1', 'https://a.test/app.js', [['accept', '*/*']]);
  expect(body.toString('utf8')).toBe('hello cache');
});

test('deleteCache and deleteCacheEntry send the cache id and request URL', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('CacheStorage.deleteCache', p => { calls.push(['cache', p]); return {}; });
  mock.respond('CacheStorage.deleteEntry', p => { calls.push(['entry', p]); return {}; });
  await deleteCache(conn, 'c1');
  await deleteCacheEntry(conn, 'c1', 'https://a.test/app.js');
  expect(calls).toEqual([
    ['cache', { cacheId: 'c1' }],
    ['entry', { cacheId: 'c1', request: 'https://a.test/app.js' }],
  ]);
});

test('describeCacheBody detects text bodies by mime or content and flags binaries', () => {
  expect(describeCacheBody(Buffer.from('{"a":1}'), 'application/json')).toEqual({ text: '{"a":1}', bytes: 7 });
  expect(describeCacheBody(Buffer.from('plain'), '')).toEqual({ text: 'plain', bytes: 5 });
  expect(describeCacheBody(Buffer.from([0x00, 0x01, 0xff, 0xfe]), 'application/octet-stream').text).toBeNull();
  expect(describeCacheBody(Buffer.from([0x00, 0x01]), '').text).toBeNull();
  expect(describeCacheBody(Buffer.alloc(0), '')).toEqual({ text: '', bytes: 0 });
});
