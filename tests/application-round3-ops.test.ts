import { test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { DebugSession } from '../src/engine.js';
import { listPages } from '../src/cdp/targets.js';
import {
  BackgroundServiceStore,
  startObserving,
  setRecording,
} from '../src/cdp/background-service.js';
import { PreloadStore, enablePreload } from '../src/cdp/preload.js';
import { ReportingStore, enableReportingApi } from '../src/cdp/reporting.js';
import {
  SharedStorageStore,
  setSharedStorageTracking,
  getSharedStorageMetadata,
  getSharedStorageEntries,
  getTrustTokens,
  clearTrustTokens,
} from '../src/cdp/storage.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => {
  mock = await MockCdp.start();
  conn = await CdpConnection.open(mock.pageWsUrl('page1'));
});
afterAll(async () => { conn.close(); await mock.close(); });

test('BackgroundServiceStore records events and tracks recording state', () => {
  const store = new BackgroundServiceStore();
  expect(store.handleEvent('BackgroundService.recordingStateChanged', { isRecording: true, service: 'pushMessaging' })).toBe(true);
  expect(store.isRecording('pushMessaging')).toBe(true);
  expect(store.anyRecording()).toBe(true);
  expect(store.handleEvent('BackgroundService.backgroundServiceEventReceived', {
    backgroundServiceEvent: {
      timestamp: 123,
      service: 'pushMessaging',
      origin: 'https://a.test',
      eventName: 'Push message received',
      instanceId: 'i1',
      eventMetadata: [{ key: 'payload', value: 'hi' }],
    },
  })).toBe(true);
  expect(store.list()).toEqual([
    { timestamp: 123, service: 'pushMessaging', origin: 'https://a.test', name: 'Push message received', instanceId: 'i1', metadata: [['payload', 'hi']] },
  ]);
  store.handleEvent('BackgroundService.recordingStateChanged', { isRecording: false, service: 'pushMessaging' });
  expect(store.anyRecording()).toBe(false);
  expect(store.handleEvent('Network.requestWillBeSent', {})).toBe(false);
});

test('background-service ops hit the BackgroundService domain', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('BackgroundService.startObserving', p => { calls.push(['observe', p]); return {}; });
  mock.respond('BackgroundService.setRecording', p => { calls.push(['record', p]); return {}; });
  await startObserving(conn, 'notifications');
  await setRecording(conn, true, 'notifications');
  expect(calls).toEqual([
    ['observe', { service: 'notifications' }],
    ['record', { shouldRecord: true, service: 'notifications' }],
  ]);
});

test('PreloadStore tracks rule sets and prerender attempt status with failure reasons', () => {
  const store = new PreloadStore();
  store.handleEvent('Preload.ruleSetUpdated', { ruleSet: { id: 'rs1', sourceText: '{"prerender":[]}' } });
  expect(store.ruleSetList()).toEqual([{ id: 'rs1', url: '(inline)' }]);
  store.handleEvent('Preload.prerenderStatusUpdated', {
    key: { action: 'Prerender', url: 'https://a.test/next' },
    status: 'Failure',
    prerenderStatus: 'MojoBinderPolicy',
  });
  const attempts = store.attemptList();
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ action: 'prerender', url: 'https://a.test/next', status: 'Failure', failureReason: 'MojoBinderPolicy' });
  store.handleEvent('Preload.ruleSetRemoved', { id: 'rs1' });
  expect(store.ruleSetList()).toEqual([]);
  expect(store.handleEvent('Other.event', {})).toBe(false);
});

test('preload enable hits the Preload domain', async () => {
  let hit = false;
  mock.respond('Preload.enable', () => { hit = true; return {}; });
  await enablePreload(conn);
  expect(hit).toBe(true);
});

test('ReportingStore collects reports and endpoints', () => {
  const store = new ReportingStore();
  store.handleEvent('Network.reportingApiReportAdded', {
    report: { id: 'rep1', type: 'deprecation', url: 'https://a.test/', status: 'Queued', timestamp: 5, body: { id: 'x' } },
  });
  store.handleEvent('Network.reportingApiReportUpdated', {
    report: { id: 'rep1', type: 'deprecation', url: 'https://a.test/', status: 'Success', timestamp: 5, body: { id: 'x' } },
  });
  expect(store.reportList()).toEqual([
    { id: 'rep1', type: 'deprecation', url: 'https://a.test/', status: 'Success', timestamp: 5, body: '{\n  "id": "x"\n}' },
  ]);
  store.handleEvent('Network.reportingApiEndpointsChangedForOrigin', {
    endpoints: [{ url: 'https://a.test/reports', groupName: 'default' }],
  });
  expect(store.endpointList()).toEqual([{ url: 'https://a.test/reports', groupName: 'default' }]);
});

test('enableReportingApi forwards the enable flag', async () => {
  let seen: any;
  mock.respond('Network.enableReportingApi', p => { seen = p; return {}; });
  await enableReportingApi(conn, true);
  expect(seen).toEqual({ enable: true });
});

test('SharedStorageStore accumulates access events', () => {
  const store = new SharedStorageStore();
  expect(store.handleEvent('Storage.sharedStorageAccessed', {
    accessTime: 9, scope: 'Worklet', method: 'Get', params: { key: 'ad-id' },
  })).toBe(true);
  expect(store.list()).toEqual([{ time: 9, type: 'Worklet', method: 'Get', key: 'ad-id' }]);
});

test('shared storage metadata and entries map from the CDP shapes', async () => {
  mock.respond('Storage.setSharedStorageTracking', () => ({}));
  mock.respond('Storage.getSharedStorageMetadata', p => {
    expect(p).toEqual({ ownerOrigin: 'https://a.test' });
    return { metadata: { creationTime: 100, length: 2, remainingBudget: 11.5, bytesUsed: 40 } };
  });
  mock.respond('Storage.getSharedStorageEntries', () => ({ entries: [{ key: 'k1', value: 'v1' }, { key: 'k2', value: 'v2' }] }));
  await setSharedStorageTracking(conn, true);
  expect(await getSharedStorageMetadata(conn, 'https://a.test')).toEqual({ creationTime: 100, length: 2, remainingBudget: 11.5, bytesUsed: 40 });
  expect(await getSharedStorageEntries(conn, 'https://a.test')).toEqual([{ key: 'k1', value: 'v1' }, { key: 'k2', value: 'v2' }]);
});

test('top-frame navigation clears the preload and reporting stores', async () => {
  const m = await MockCdp.start();
  const root = await mkdtemp(join(tmpdir(), 'dtui-app3-'));
  const [page] = await listPages({ host: '127.0.0.1', port: m.port, browser: 'MockChrome/1.0' });
  const session = await DebugSession.attach(page, { sessionRoot: root, persist: false, browser: 'MockChrome/1.0' });
  m.emitEvent('Preload.ruleSetUpdated', { ruleSet: { id: 'rs1', sourceText: '{"prerender":[]}' } });
  m.emitEvent('Network.reportingApiReportAdded', {
    report: { id: 'rep1', type: 'deprecation', url: 'https://a.test/', status: 'Queued', timestamp: 5, body: {} },
  });
  await new Promise(r => setTimeout(r, 50));
  expect(session.preload.ruleSetList()).toHaveLength(1);
  expect(session.reporting.reportList()).toHaveLength(1);

  m.emitEvent('Page.frameNavigated', { frame: { url: 'https://other.test/x', id: 'nf1' } });
  await new Promise(r => setTimeout(r, 50));
  expect(session.preload.ruleSetList()).toEqual([]);
  expect(session.reporting.reportList()).toEqual([]);

  m.emitEvent('Preload.ruleSetUpdated', { ruleSet: { id: 'rs2', sourceText: '{"prerender":[]}' } });
  m.emitEvent('Page.frameNavigated', { frame: { url: 'https://sub.test/y', id: 'nf2', parentId: 'nf1' } });
  await new Promise(r => setTimeout(r, 50));
  expect(session.preload.ruleSetList()).toHaveLength(1);

  await session.close();
  await m.close();
});

test('trust tokens list and per-issuer clear', async () => {
  let cleared: any;
  mock.respond('Storage.getTrustTokens', () => ({ tokens: [{ issuerOrigin: 'https://issuer.test', count: 7 }] }));
  mock.respond('Storage.clearTrustTokens', p => { cleared = p; return { didDeleteTokens: true }; });
  expect(await getTrustTokens(conn)).toEqual([{ issuerOrigin: 'https://issuer.test', count: 7 }]);
  await clearTrustTokens(conn, 'https://issuer.test');
  expect(cleared).toEqual({ issuerOrigin: 'https://issuer.test' });
});
