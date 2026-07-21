import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { StorageOverlay, storageViewRows } from '../src/tui/panels/StorageOverlay.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(20);
  }
};
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = '\x1b';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-stn-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-stn-data-'));
  mock = await MockCdp.start();
  mock.respond('DOMStorage.enable', () => ({}));
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  tabs = new MultiTabs([ep()]);
  await tabs.refresh();
});
afterEach(async () => {
  tabs.stop();
  await mock.close();
  if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevConfigHome;
  if (prevDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevDataHome;
});

const cookie = (name: string, value: string, extra: Record<string, unknown> = {}) => ({
  name, value, domain: 'mock.test', path: '/', expires: -1, httpOnly: false, secure: false, ...extra,
});

function renderApp(extra: Partial<React.ComponentProps<typeof App>> = {}) {
  return render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} {...extra} />,
  );
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

async function openStorage(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('4');
  await waitForFrame(lastFrame, ' idb ');
}

const strObj = (v: string) => ({ type: 'string', value: v });

test('the storage header shows the origin usage and quota', async () => {
  mock.respond('Storage.getUsageAndQuota', () => ({ usage: 2048, quota: 104857600 }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, '2.0kB / 100.0MB');
});

test('idb view drills DB → store → entries, opens the detail, and h walks back up', async () => {
  mock.respond('IndexedDB.requestDatabaseNames', () => ({ databaseNames: ['appdb'] }));
  mock.respond('IndexedDB.requestDatabase', () => ({
    databaseWithObjectStores: {
      objectStores: [{ name: 'items', keyPath: { type: 'string', string: 'id' }, autoIncrement: false, indexes: [{ name: 'byName' }] }],
    },
  }));
  mock.respond('IndexedDB.requestData', () => ({
    objectStoreDataEntries: [{
      key: strObj('user-1'),
      primaryKey: strObj('user-1'),
      value: strObj('{"plan":"pro"}'),
    }],
    hasMore: false,
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lll');
  await waitForFrame(lastFrame, 'appdb');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'items');
  expect(stripAnsi(lastFrame()!)).toContain('key: id');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'user-1 = ');
  expect(stripAnsi(lastFrame()!)).toContain('appdb › items');
  stdin.write('\r');
  await waitForFrame(lastFrame, '"plan": "pro"');
  stdin.write(ESC);
  await sleep(60);
  stdin.write('h');
  await waitForFrame(lastFrame, 'key: id');
  stdin.write('h');
  await sleep(60);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('appdb');
  expect(frame).not.toContain('key: id');
});

test('d deletes an idb entry with an exact key range and D-D clears the store', async () => {
  let deleted: any;
  let cleared: any;
  let rows = [
    { key: strObj('a'), primaryKey: strObj('a'), value: strObj('1') },
    { key: strObj('b'), primaryKey: strObj('b'), value: strObj('2') },
  ];
  mock.respond('IndexedDB.requestDatabaseNames', () => ({ databaseNames: ['appdb'] }));
  mock.respond('IndexedDB.requestDatabase', () => ({
    databaseWithObjectStores: { objectStores: [{ name: 'items', keyPath: { type: 'null' }, autoIncrement: false, indexes: [] }] },
  }));
  mock.respond('IndexedDB.requestData', () => ({ objectStoreDataEntries: rows, hasMore: false }));
  mock.respond('IndexedDB.deleteObjectStoreEntries', p => {
    deleted = p;
    rows = rows.slice(1);
    return {};
  });
  mock.respond('IndexedDB.clearObjectStore', p => {
    cleared = p;
    rows = [];
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lll');
  await waitForFrame(lastFrame, 'appdb');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'items');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'a = 1');
  stdin.write('d');
  await sleep(120);
  expect(deleted).toMatchObject({
    databaseName: 'appdb',
    objectStoreName: 'items',
    keyRange: { lower: { type: 'string', string: 'a' }, upper: { type: 'string', string: 'a' }, lowerOpen: false, upperOpen: false },
  });
  await waitForFrame(lastFrame, 'b = 2');
  expect(stripAnsi(lastFrame()!)).not.toContain('a = 1');
  stdin.write('D');
  await waitForFrame(lastFrame, 'D를 한 번 더');
  stdin.write('D');
  await sleep(120);
  expect(cleared).toMatchObject({ databaseName: 'appdb', objectStoreName: 'items' });
  await waitForFrame(lastFrame, '비어 있음');
});

test('the idb entry list pages in the next chunk when scrolled to the end', async () => {
  const skips: number[] = [];
  mock.respond('IndexedDB.requestDatabaseNames', () => ({ databaseNames: ['appdb'] }));
  mock.respond('IndexedDB.requestDatabase', () => ({
    databaseWithObjectStores: { objectStores: [{ name: 'items', keyPath: { type: 'null' }, autoIncrement: false, indexes: [] }] },
  }));
  mock.respond('IndexedDB.requestData', p => {
    skips.push(p.skipCount);
    const n = p.skipCount === 0 ? 50 : 5;
    return {
      objectStoreDataEntries: Array.from({ length: n }, (_, i) => {
        const idx = p.skipCount + i;
        return { key: strObj(`k${idx}`), primaryKey: strObj(`k${idx}`), value: strObj(`v${idx}`) };
      }),
      hasMore: p.skipCount === 0,
    };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lll');
  await waitForFrame(lastFrame, 'appdb');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'items');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'k0 = v0');
  expect(stripAnsi(lastFrame()!)).toContain('50+');
  stdin.write('G');
  await waitForFrame(lastFrame, 'k49 = v49');
  await sleep(150);
  expect(skips).toContain(50);
  stdin.write('G');
  await waitForFrame(lastFrame, 'k54 = v54');
});

test('e on an idb entry round-trips the value through the editor into an IDB put', async () => {
  const exprs: string[] = [];
  mock.respond('IndexedDB.requestDatabaseNames', () => ({ databaseNames: ['appdb'] }));
  mock.respond('IndexedDB.requestDatabase', () => ({
    databaseWithObjectStores: { objectStores: [{ name: 'items', keyPath: { type: 'string', string: 'id' }, autoIncrement: false, indexes: [] }] },
  }));
  mock.respond('IndexedDB.requestData', () => ({
    objectStoreDataEntries: [{ key: strObj('u1'), primaryKey: strObj('u1'), value: strObj('{"plan":"free"}') }],
    hasMore: false,
  }));
  mock.respond('Runtime.evaluate', p => { exprs.push(p.expression); return {}; });
  let seen = '';
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { readFile, writeFile } = await import('node:fs/promises');
      seen = await readFile(file, 'utf8');
      await writeFile(file, '{"plan":"pro"}');
    },
  });
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lll');
  await waitForFrame(lastFrame, 'appdb');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'items');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'u1 = ');
  stdin.write('e');
  await sleep(200);
  expect(seen).toBe('{"plan":"free"}');
  expect(exprs.some(x => x.includes('indexedDB.open("appdb")') && x.includes('store.put'))).toBe(true);
});

test('cache view lists caches and entries, decodes the cached body, and deletes entry and cache', async () => {
  let entryDeleted: any;
  let cacheDeleted: any;
  let entries = [
    {
      requestURL: 'https://mock.test/api/data',
      requestMethod: 'GET',
      requestHeaders: [{ name: 'accept', value: '*/*' }],
      responseStatus: 200,
      responseStatusText: 'OK',
      responseType: 'basic',
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    },
  ];
  let caches = [{ cacheId: 'c1', cacheName: 'app-v1' }];
  mock.respond('CacheStorage.requestCacheNames', () => ({ caches }));
  mock.respond('CacheStorage.requestEntries', () => ({ cacheDataEntries: entries, returnCount: entries.length }));
  mock.respond('CacheStorage.requestCachedResponse', p => {
    expect(p.cacheId).toBe('c1');
    return { response: { body: Buffer.from('{"cached":true}').toString('base64') } };
  });
  mock.respond('CacheStorage.deleteEntry', p => { entryDeleted = p; entries = []; return {}; });
  mock.respond('CacheStorage.deleteCache', p => { cacheDeleted = p; caches = []; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('llll');
  await waitForFrame(lastFrame, 'app-v1');
  stdin.write('\r');
  await waitForFrame(lastFrame, '/api/data');
  expect(stripAnsi(lastFrame()!)).toContain('GET · 200');
  stdin.write('\r');
  await waitForFrame(lastFrame, '"cached": true');
  expect(stripAnsi(lastFrame()!)).toContain('200 OK');
  stdin.write(ESC);
  await sleep(60);
  stdin.write('d');
  await sleep(120);
  expect(entryDeleted).toEqual({ cacheId: 'c1', request: 'https://mock.test/api/data' });
  await waitForFrame(lastFrame, '비어 있음');
  stdin.write('h');
  await waitForFrame(lastFrame, 'app-v1');
  stdin.write('D');
  await waitForFrame(lastFrame, 'D를 한 번 더');
  stdin.write('D');
  await sleep(120);
  expect(cacheDeleted).toEqual({ cacheId: 'c1' });
  await waitForFrame(lastFrame, '비어 있음');
});

test('sw view lists registrations and toggles update-on-reload and network bypass', async () => {
  const toggles: Array<[string, any]> = [];
  mock.respond('ServiceWorker.enable', () => ({}));
  mock.respond('ServiceWorker.setForceUpdateOnPageLoad', p => { toggles.push(['force', p]); return {}; });
  mock.respond('Network.setBypassServiceWorker', p => { toggles.push(['bypass', p]); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('ServiceWorker.workerRegistrationUpdated', {
    registrations: [{ registrationId: 'r1', scopeURL: 'https://mock.test/app/', isDeleted: false }],
  });
  mock.emitEvent('ServiceWorker.workerVersionUpdated', {
    versions: [{ versionId: 'v1', registrationId: 'r1', scriptURL: 'https://mock.test/app/sw.js', runningStatus: 'running', status: 'activated' }],
  });
  await sleep(80);
  await openStorage(lastFrame, stdin);
  stdin.write('lllll');
  await waitForFrame(lastFrame, 'https://mock.test/app/');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('activated');
  expect(frame).toContain('update-on-reload:off');
  expect(frame).toContain('bypass:off');
  stdin.write('u');
  await waitForFrame(lastFrame, 'update-on-reload:on');
  stdin.write('B');
  await waitForFrame(lastFrame, 'bypass:on');
  expect(toggles).toEqual([
    ['force', { forceUpdateOnPageLoad: true }],
    ['bypass', { bypass: true }],
  ]);
});

async function attachWithSw(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  await attach(lastFrame, stdin);
  mock.emitEvent('ServiceWorker.workerRegistrationUpdated', {
    registrations: [{ registrationId: 'r1', scopeURL: 'https://mock.test/app/', isDeleted: false }],
  });
  mock.emitEvent('ServiceWorker.workerVersionUpdated', {
    versions: [{ versionId: 'v1', registrationId: 'r1', scriptURL: 'https://mock.test/app/sw.js', runningStatus: 'running', status: 'activated' }],
  });
  await sleep(80);
}

test('sw view p delivers a push message to the selected registration with origin and id', async () => {
  let pushed: any;
  mock.respond('ServiceWorker.enable', () => ({}));
  mock.respond('ServiceWorker.deliverPushMessage', p => { pushed = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attachWithSw(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lllll');
  await waitForFrame(lastFrame, 'https://mock.test/app/');
  stdin.write('p');
  await waitForFrame(lastFrame, '푸시 페이로드');
  stdin.write('\r');
  await sleep(150);
  expect(pushed).toEqual({ origin: 'https://mock.test', registrationId: 'r1', data: '{"title":"Test","body":"Test push"}' });
});

test('sw view s dispatches a sync event with the entered tag', async () => {
  let synced: any;
  mock.respond('ServiceWorker.enable', () => ({}));
  mock.respond('ServiceWorker.dispatchSyncEvent', p => { synced = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attachWithSw(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lllll');
  await waitForFrame(lastFrame, 'https://mock.test/app/');
  stdin.write('s');
  await waitForFrame(lastFrame, '동기화 태그');
  stdin.write('!');
  await sleep(40);
  stdin.write('\r');
  await sleep(150);
  expect(synced).toEqual({ origin: 'https://mock.test', registrationId: 'r1', tag: 'test-tag!', lastChance: false });
});

test('background services records events across the 5 service channels', async () => {
  const observed: string[] = [];
  mock.respond('BackgroundService.startObserving', p => { observed.push(p.service); return {}; });
  mock.respond('BackgroundService.setRecording', () => ({}));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('hhh');
  await waitForFrame(lastFrame, ' background ');
  stdin.write('r');
  await until(() => observed.length === 5);
  expect(observed).toEqual(['backgroundFetch', 'backgroundSync', 'pushMessaging', 'notifications', 'periodicBackgroundSync']);
  mock.emitEvent('BackgroundService.backgroundServiceEventReceived', {
    backgroundServiceEvent: {
      timestamp: 1700000000, service: 'pushMessaging', origin: 'https://mock.test',
      eventName: 'Push message received', instanceId: 'i1', eventMetadata: [{ key: 'payload', value: 'hi' }],
    },
  });
  await waitForFrame(lastFrame, 'Push message received');
});

test('background preload subtab shows rule sets and a failed prerender attempt', async () => {
  mock.respond('Preload.enable', () => ({}));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('hhh');
  await waitForFrame(lastFrame, ' background ');
  stdin.write('T');
  await waitForFrame(lastFrame, '규칙 세트');
  mock.emitEvent('Preload.ruleSetUpdated', { ruleSet: { id: 'rs1', sourceText: '{"prerender":[]}' } });
  mock.emitEvent('Preload.prerenderStatusUpdated', {
    key: { action: 'Prerender', url: 'https://mock.test/next' }, status: 'Failure', prerenderStatus: 'MojoBinderPolicy',
  });
  await waitForFrame(lastFrame, 'MojoBinderPolicy');
  expect(stripAnsi(lastFrame()!)).toContain('/next');
});

test('shared storage view lists entries and metadata', async () => {
  mock.respond('Storage.setSharedStorageTracking', () => ({}));
  mock.respond('Storage.getSharedStorageMetadata', () => ({ metadata: { creationTime: 1700000000, length: 1, remainingBudget: 12, bytesUsed: 8 } }));
  mock.respond('Storage.getSharedStorageEntries', () => ({ entries: [{ key: 'ad-campaign', value: 'summer' }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('hh');
  await waitForFrame(lastFrame, 'ad-campaign = summer');
  expect(stripAnsi(lastFrame()!)).toContain('메타데이터');
});

test('trust tokens view lists issuers and d clears an issuer', async () => {
  let cleared: any;
  let tokens = [{ issuerOrigin: 'https://issuer.test', count: 5 }];
  mock.respond('Storage.getTrustTokens', () => ({ tokens }));
  mock.respond('Storage.clearTrustTokens', p => { cleared = p; tokens = []; return { didDeleteTokens: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('h');
  await waitForFrame(lastFrame, 'https://issuer.test');
  expect(stripAnsi(lastFrame()!)).toContain('토큰 5개');
  stdin.write('d');
  await sleep(120);
  expect(cleared).toEqual({ issuerOrigin: 'https://issuer.test' });
  await waitForFrame(lastFrame, '보유한 토큰 없음');
});

test('Y in the cookies view copies every cookie as JSON, httpOnly included', async () => {
  mock.respond('Network.getCookies', () => ({
    cookies: [cookie('sid', 'secret', { httpOnly: true }), cookie('theme', 'dark')],
  }));
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'sid = secret');
  stdin.write('Y');
  await waitForFrame(lastFrame, '쿠키 2개 JSON 복사됨');
  const parsed = JSON.parse(copied);
  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toMatchObject({ name: 'sid', value: 'secret', httpOnly: true });
});

test('an HttpOnly cookie value edit round-trips through setCookie with httpOnly preserved', async () => {
  let seen: any;
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('sid', 'abc', { httpOnly: true })] }));
  mock.respond('Network.setCookie', p => { seen = p; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'sid = abc');
  expect(stripAnsi(lastFrame()!)).toContain('HttpOnly');
  stdin.write('e');
  await sleep(40);
  stdin.write('2');
  await sleep(40);
  stdin.write('\r');
  await sleep(150);
  expect(seen).toMatchObject({ name: 'sid', value: 'abc2', httpOnly: true });
});

test('an idb load failure surfaces as a graceful error line', async () => {
  mock.respond('IndexedDB.requestDatabaseNames', () => { throw new Error('access denied'); });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lll');
  await waitForFrame(lastFrame, 'access denied');
});

test('storageViewRows maps the niche views into display rows', () => {
  const base = { cookieRows: [], localRows: [], sessionRows: [] };
  const idb = {
    idbDb: 'appdb', idbStore: null, idbDbs: ['appdb'],
    idbStores: [{ name: 'items', keyPath: 'id', autoIncrement: true, indexes: ['byName'] }],
    idbEntries: [],
    cacheOpen: null, caches: [], cacheEntries: [], swRegs: [],
  };
  expect(storageViewRows({ storageView: 'idb', ...base, ...idb })).toEqual([
    { key: 'items', value: '', meta: 'key: id · auto++ · idx: byName' },
  ]);
  const entries = storageViewRows({
    storageView: 'idb', ...base, ...idb,
    idbStore: 'items',
    idbEntries: [
      { key: '1', primaryKey: '1', value: '{"a":1}', shallow: false, rangeKey: { type: 'number', number: 1 } },
      { key: 'x', primaryKey: 'y', value: '{}', shallow: true, rangeKey: null },
    ],
  });
  expect(entries[0]).toEqual({ key: '1', value: '{"a":1}', idbKey: { type: 'number', number: 1 } });
  expect(entries[1].meta).toBe('pk: y');
  expect(entries[1].note).toBeTruthy();
  const sw = storageViewRows({
    storageView: 'sw', ...base,
    idbDb: null, idbStore: null, idbDbs: [], idbStores: [], idbEntries: [],
    cacheOpen: null, caches: [], cacheEntries: [],
    swRegs: [{ scope: 'https://a.test/', script: 'https://a.test/sw.js', status: 'activated', running: 'running' }],
  });
  expect(sw[0].key).toBe('https://a.test/');
  expect(sw[0].meta).toBe('activated · running · sw.js');
});

test('the storage overlay keeps the constant height invariant across the niche views', () => {
  const lineCount = (el: React.ReactElement) => render(el).lastFrame()!.split('\n').length;
  const idb = {
    db: 'appdb', store: 'items', dbs: ['appdb'],
    stores: [{ name: 'items', keyPath: '', autoIncrement: false, indexes: [] }],
    entries: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, primaryKey: `k${i}`, value: `v${i}`, shallow: false, rangeKey: null })),
    hasMore: true,
  };
  const cache = { open: null, caches: [{ id: 'c1', name: 'app-v1' }], entries: [], hasMore: false };
  const sw = { regs: [], forceUpdate: true, bypass: false };
  const background = {
    sub: 'services' as const, recording: true,
    events: Array.from({ length: 20 }, (_, i) => ({ timestamp: 1700000000 + i, service: 'pushMessaging' as const, origin: 'https://a.test', name: `evt${i}`, instanceId: `i${i}`, metadata: [] })),
    ruleSets: [], attempts: [], reports: [], endpoints: [],
  };
  const shared = {
    metadata: { creationTime: 1700000000, length: 2, remainingBudget: 12, bytesUsed: 8 },
    entries: [{ key: 'a', value: 'b' }], events: [{ time: 1700000000, type: 'Worklet', method: 'Get', key: 'a' }],
  };
  const trustTokens = [{ issuerOrigin: 'https://issuer.test', count: 3 }];
  for (const height of [14, 20, 8]) {
    expect(lineCount(
      <StorageOverlay view="idb" cookies={[]} local={[]} session={[]} selected={29} idb={idb} quota={{ usage: 10, quota: 100 }} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="cache" cookies={[]} local={[]} session={[]} selected={0} cache={cache} confirmClear="cache" height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="sw" cookies={[]} local={[]} session={[]} selected={0} sw={sw} error="boom" height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="background" cookies={[]} local={[]} session={[]} selected={19} background={background} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="shared" cookies={[]} local={[]} session={[]} selected={0} shared={shared} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="pst" cookies={[]} local={[]} session={[]} selected={0} trustTokens={trustTokens} height={height} />,
    )).toBe(height);
  }
});
