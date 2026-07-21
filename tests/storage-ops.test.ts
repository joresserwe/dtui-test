import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { getCookies, setCookie, deleteCookie, getStorageItems, setStorageItem, removeStorageItem, clearOrigin, getUsageAndQuota } from '../src/cdp/storage.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => {
  mock = await MockCdp.start();
  conn = await CdpConnection.open(mock.pageWsUrl('page1'));
});
afterAll(async () => { conn.close(); await mock.close(); });

test('cookie ops map to Network domain calls', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('Network.getCookies', () => ({ cookies: [{ name: 'sid', value: 'abc', domain: 'a.test', path: '/', expires: -1, httpOnly: true, secure: false }] }));
  mock.respond('Network.setCookie', p => { calls.push(['set', p]); return { success: true }; });
  mock.respond('Network.deleteCookies', p => { calls.push(['del', p]); return {}; });

  const cookies = await getCookies(conn);
  expect(cookies).toEqual([{ name: 'sid', value: 'abc', domain: 'a.test', path: '/', expires: -1, httpOnly: true, secure: false }]);
  expect(await setCookie(conn, 'https://a.test/', 'theme', 'dark')).toBe(true);
  expect(calls[0][1]).toEqual({ url: 'https://a.test/', name: 'theme', value: 'dark' });
  await setCookie(conn, 'https://a.test/', 'n', 'v', { domain: '.a.test', httpOnly: true });
  expect(calls[1][1]).toMatchObject({ url: 'https://a.test/', name: 'n', value: 'v', domain: '.a.test', httpOnly: true });
  await deleteCookie(conn, { name: 'sid', domain: 'a.test', path: '/' });
  expect(calls.find(([k]) => k === 'del')![1]).toEqual({ name: 'sid', domain: 'a.test', path: '/' });
});

test('storage ops enable DOMStorage and use origin storage ids', async () => {
  const calls: Array<[string, any]> = [];
  for (const m of ['DOMStorage.enable', 'DOMStorage.setDOMStorageItem', 'DOMStorage.removeDOMStorageItem']) {
    mock.respond(m, p => { calls.push([m, p]); return {}; });
  }
  mock.respond('DOMStorage.getDOMStorageItems', p => { calls.push(['get', p]); return { entries: [['k', 'v']] }; });

  expect(await getStorageItems(conn, 'https://a.test', true)).toEqual([['k', 'v']]);
  expect(calls.some(([m]) => m === 'DOMStorage.enable')).toBe(true);
  expect(calls.find(([m]) => m === 'get')![1]).toEqual({ storageId: { securityOrigin: 'https://a.test', isLocalStorage: true } });

  await setStorageItem(conn, 'https://a.test', false, 'a', 'b');
  const set = calls.find(([m]) => m === 'DOMStorage.setDOMStorageItem')!;
  expect(set[1]).toEqual({ storageId: { securityOrigin: 'https://a.test', isLocalStorage: false }, key: 'a', value: 'b' });

  await removeStorageItem(conn, 'https://a.test', true, 'k');
  expect(calls.some(([m]) => m === 'DOMStorage.removeDOMStorageItem')).toBe(true);
});

test('getUsageAndQuota maps the origin usage and quota', async () => {
  mock.respond('Storage.getUsageAndQuota', p => {
    expect(p).toEqual({ origin: 'https://a.test' });
    return { usage: 1234, quota: 5678, overrideActive: false, usageBreakdown: [] };
  });
  expect(await getUsageAndQuota(conn, 'https://a.test')).toEqual({ usage: 1234, quota: 5678 });
});

test('clearOrigin clears all storage types for the origin', async () => {
  let seen: any;
  mock.respond('Storage.clearDataForOrigin', p => { seen = p; return {}; });
  await clearOrigin(conn, 'https://a.test');
  expect(seen).toEqual({ origin: 'https://a.test', storageTypes: 'cookies,local_storage,session_storage,indexeddb,cache_storage' });
});

test('deleteCookie forwards a CHIPS partition key, and omits it for unpartitioned cookies', async () => {
  const calls: any[] = [];
  mock.respond('Network.deleteCookies', p => { calls.push(p); return {}; });
  await deleteCookie(conn, { name: 'ad', domain: 'cdn.test', path: '/', partitionKey: { topLevelSite: 'https://top.test', hasCrossSiteAncestor: false } });
  expect(calls[0]).toEqual({ name: 'ad', domain: 'cdn.test', path: '/', partitionKey: { topLevelSite: 'https://top.test', hasCrossSiteAncestor: false } });
  await deleteCookie(conn, { name: 'plain', domain: 'a.test', path: '/' });
  expect(calls[1]).toEqual({ name: 'plain', domain: 'a.test', path: '/' });
  expect('partitionKey' in calls[1]).toBe(false);
});

test('getCookies preserves hasCrossSiteAncestor and setCookie re-sends the original flag', async () => {
  mock.respond('Network.getCookies', () => ({
    cookies: [{ name: 'p', value: '1', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: true, partitionKey: { topLevelSite: 'https://top.test', hasCrossSiteAncestor: true } }],
  }));
  const [c] = await getCookies(conn);
  expect(c.partitionKey).toBe('https://top.test');
  expect(c.partitionKeyObj).toEqual({ topLevelSite: 'https://top.test', hasCrossSiteAncestor: true });

  const sent: any[] = [];
  mock.respond('Network.setCookie', p => { sent.push(p); return { success: true }; });
  await setCookie(conn, 'https://a.test/', 'p', '1', { partitionKey: c.partitionKey, partitionKeyObj: c.partitionKeyObj });
  expect(sent[0].partitionKey).toEqual({ topLevelSite: 'https://top.test', hasCrossSiteAncestor: true });
  await setCookie(conn, 'https://a.test/', 'p', '1', { partitionKey: 'https://other.test', partitionKeyObj: c.partitionKeyObj });
  expect(sent[1].partitionKey).toEqual({ topLevelSite: 'https://other.test', hasCrossSiteAncestor: false });
});
