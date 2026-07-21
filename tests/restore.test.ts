import { test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { loadSnapshot, restoreSnapshot } from '../src/restore.js';

async function makeSnapshot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-restore-'));
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ url: 'https://a.test/deep?x=1', origin: 'https://a.test', capturedAt: '2026-07-16T00:00:00.000Z' }));
  await writeFile(join(dir, 'cookies.json'), JSON.stringify([{ name: 'sid', value: 'abc', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: false }]));
  await writeFile(join(dir, 'storage.json'), JSON.stringify({ local: [['k', 'v']], session: [['s', '1']] }));
  return dir;
}

test('loadSnapshot parses meta/cookies/storage', async () => {
  const data = loadSnapshot(await makeSnapshot());
  expect(data.meta.url).toBe('https://a.test/deep?x=1');
  expect(data.cookies[0].name).toBe('sid');
  expect(data.local).toEqual([['k', 'v']]);
  expect(data.session).toEqual([['s', '1']]);
});

let mock: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(async () => { await mock.close(); });

test('restoreSnapshot opens a tab, injects identity, and navigates', async () => {
  const dir = await makeSnapshot();
  const calls: Array<[string, any]> = [];
  for (const m of ['Network.enable', 'Page.enable', 'Runtime.enable', 'Log.enable', 'Network.setCookie', 'DOMStorage.enable', 'DOMStorage.setDOMStorageItem', 'Page.navigate']) {
    mock.respond(m, p => { calls.push([m, p]); return m === 'Network.setCookie' ? { success: true } : {}; });
  }
  await restoreSnapshot(dir, {
    createTab: async () => 'page1',
    attach: async () => CdpConnection.open(mock.pageWsUrl('page1')),
  });
  expect(calls.find(([m]) => m === 'Network.setCookie')![1]).toMatchObject({ name: 'sid', value: 'abc', domain: 'a.test', path: '/' });
  const storageSets = calls.filter(([m]) => m === 'DOMStorage.setDOMStorageItem');
  expect(storageSets).toHaveLength(2);
  const nav = calls.find(([m]) => m === 'Page.navigate')!;
  expect(nav[1]).toEqual({ url: 'https://a.test/deep?x=1' });
});
