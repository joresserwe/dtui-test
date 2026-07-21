import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  SwStore,
  enableServiceWorker,
  setBypassServiceWorker,
  setForceUpdateOnPageLoad,
  scopeOrigin,
  deliverPushMessage,
  dispatchSyncEvent,
  dispatchPeriodicSyncEvent,
} from '../src/cdp/service-worker.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => {
  mock = await MockCdp.start();
  conn = await CdpConnection.open(mock.pageWsUrl('page1'));
});
afterAll(async () => { conn.close(); await mock.close(); });

test('SwStore merges registrations with their latest version', () => {
  const store = new SwStore();
  expect(store.handleEvent('ServiceWorker.workerRegistrationUpdated', {
    registrations: [{ registrationId: 'r1', scopeURL: 'https://a.test/', isDeleted: false }],
  })).toBe(true);
  expect(store.handleEvent('ServiceWorker.workerVersionUpdated', {
    versions: [{ versionId: 'v1', registrationId: 'r1', scriptURL: 'https://a.test/sw.js', runningStatus: 'starting', status: 'installing' }],
  })).toBe(true);
  store.handleEvent('ServiceWorker.workerVersionUpdated', {
    versions: [{ versionId: 'v1', registrationId: 'r1', scriptURL: 'https://a.test/sw.js', runningStatus: 'running', status: 'activated' }],
  });
  expect(store.registrations()).toEqual([
    { id: 'r1', scope: 'https://a.test/', script: 'https://a.test/sw.js', status: 'activated', running: 'running' },
  ]);
  expect(store.handleEvent('Network.requestWillBeSent', {})).toBe(false);
});

test('SwStore surfaces the active version, not a newer installing one', () => {
  const store = new SwStore();
  store.handleEvent('ServiceWorker.workerRegistrationUpdated', {
    registrations: [{ registrationId: 'r1', scopeURL: 'https://a.test/', isDeleted: false }],
  });
  store.handleEvent('ServiceWorker.workerVersionUpdated', {
    versions: [{ versionId: 'v1', registrationId: 'r1', scriptURL: 'https://a.test/sw.js', runningStatus: 'running', status: 'activated' }],
  });
  store.handleEvent('ServiceWorker.workerVersionUpdated', {
    versions: [{ versionId: 'v2', registrationId: 'r1', scriptURL: 'https://a.test/sw2.js', runningStatus: 'starting', status: 'installing' }],
  });
  expect(store.registrations()).toEqual([
    { id: 'r1', scope: 'https://a.test/', script: 'https://a.test/sw.js', status: 'activated', running: 'running' },
  ]);
});

test('SwStore hides deleted registrations', () => {
  const store = new SwStore();
  store.handleEvent('ServiceWorker.workerRegistrationUpdated', {
    registrations: [{ registrationId: 'r1', scopeURL: 'https://a.test/', isDeleted: false }],
  });
  expect(store.registrations()).toHaveLength(1);
  store.handleEvent('ServiceWorker.workerRegistrationUpdated', {
    registrations: [{ registrationId: 'r1', scopeURL: 'https://a.test/', isDeleted: true }],
  });
  expect(store.registrations()).toEqual([]);
});

test('enable and toggle helpers hit the ServiceWorker and Network domains', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('ServiceWorker.enable', p => { calls.push(['enable', p]); return {}; });
  mock.respond('ServiceWorker.setForceUpdateOnPageLoad', p => { calls.push(['force', p]); return {}; });
  mock.respond('Network.setBypassServiceWorker', p => { calls.push(['bypass', p]); return {}; });
  await enableServiceWorker(conn);
  await setForceUpdateOnPageLoad(conn, true);
  await setBypassServiceWorker(conn, true);
  expect(calls).toEqual([
    ['enable', {}],
    ['force', { forceUpdateOnPageLoad: true }],
    ['bypass', { bypass: true }],
  ]);
});

test('scopeOrigin extracts the origin from a scope URL', () => {
  expect(scopeOrigin('https://a.test/app/')).toBe('https://a.test');
  expect(scopeOrigin('not a url')).toBe('');
});

test('SW test-event dispatchers forward origin, registrationId and payloads', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('ServiceWorker.deliverPushMessage', p => { calls.push(['push', p]); return {}; });
  mock.respond('ServiceWorker.dispatchSyncEvent', p => { calls.push(['sync', p]); return {}; });
  mock.respond('ServiceWorker.dispatchPeriodicSyncEvent', p => { calls.push(['periodic', p]); return {}; });
  await deliverPushMessage(conn, 'https://a.test', 'r1', '{"msg":"hi"}');
  await dispatchSyncEvent(conn, 'https://a.test', 'r1', 'sync-tag', true);
  await dispatchPeriodicSyncEvent(conn, 'https://a.test', 'r1', 'periodic-tag');
  expect(calls).toEqual([
    ['push', { origin: 'https://a.test', registrationId: 'r1', data: '{"msg":"hi"}' }],
    ['sync', { origin: 'https://a.test', registrationId: 'r1', tag: 'sync-tag', lastChance: true }],
    ['periodic', { origin: 'https://a.test', registrationId: 'r1', tag: 'periodic-tag' }],
  ]);
});
