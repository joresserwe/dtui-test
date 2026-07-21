import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  getAppManifest,
  getInstallabilityErrors,
  getFrameTree,
  getSecurityIsolationStatus,
  getOriginTrials,
} from '../src/cdp/page-app.js';
import { getCookies, setCookie } from '../src/cdp/storage.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => {
  mock = await MockCdp.start();
  conn = await CdpConnection.open(mock.pageWsUrl('page1'));
});
afterAll(async () => { conn.close(); await mock.close(); });

test('getAppManifest returns the raw data and flattened error messages', async () => {
  mock.respond('Page.getAppManifest', () => ({
    url: 'https://a.test/manifest.json',
    data: '{"name":"App"}',
    errors: [{ message: 'icon download failed', critical: 1 }, { message: '' }],
  }));
  expect(await getAppManifest(conn)).toEqual({
    url: 'https://a.test/manifest.json',
    raw: '{"name":"App"}',
    errors: ['icon download failed'],
  });
});

test('getAppManifest maps an absent manifest to a null raw', async () => {
  mock.respond('Page.getAppManifest', () => ({ url: '', data: '', errors: [] }));
  expect(await getAppManifest(conn)).toEqual({ url: '', raw: null, errors: [] });
});

test('getInstallabilityErrors renders the error id with its arguments', async () => {
  mock.respond('Page.getInstallabilityErrors', () => ({
    installabilityErrors: [
      { errorId: 'no-icon-available', errorArguments: [] },
      { errorId: 'manifest-display-override-not-supported', errorArguments: [{ name: 'display-override', value: 'window-controls-overlay' }] },
    ],
  }));
  expect(await getInstallabilityErrors(conn)).toEqual([
    'no-icon-available',
    'manifest-display-override-not-supported (display-override: window-controls-overlay)',
  ]);
});

test('getFrameTree flattens the tree depth-first with origin and isolation fields', async () => {
  mock.respond('Page.getFrameTree', () => ({
    frameTree: {
      frame: { id: 'main', url: 'https://a.test/', securityOrigin: 'https://a.test', secureContextType: 'Secure', crossOriginIsolatedContextType: 'Isolated' },
      childFrames: [
        { frame: { id: 'c1', url: 'https://cdn.test/f', securityOrigin: 'https://cdn.test', secureContextType: 'Secure', crossOriginIsolatedContextType: 'NotIsolated' } },
      ],
    },
  }));
  const frames = await getFrameTree(conn);
  expect(frames).toEqual([
    { id: 'main', url: 'https://a.test/', origin: 'https://a.test', depth: 0, secureContext: 'Secure', crossOriginIsolated: 'Isolated' },
    { id: 'c1', url: 'https://cdn.test/f', origin: 'https://cdn.test', depth: 1, secureContext: 'Secure', crossOriginIsolated: 'NotIsolated' },
  ]);
});

test('getSecurityIsolationStatus extracts COOP/COEP values and forwards the frameId', async () => {
  let seen: any;
  mock.respond('Network.getSecurityIsolationStatus', p => {
    seen = p;
    return { status: { coep: { value: 'RequireCorp', reportOnlyValue: 'None' }, coop: { value: 'SameOrigin', reportOnlyValue: 'UnsafeNone' } } };
  });
  expect(await getSecurityIsolationStatus(conn, 'c1')).toEqual({
    coep: 'RequireCorp', coepReportOnly: 'None', coop: 'SameOrigin', coopReportOnly: 'UnsafeNone',
  });
  expect(seen).toEqual({ frameId: 'c1' });
});

test('getOriginTrials maps trial and per-token status', async () => {
  mock.respond('Page.getOriginTrials', p => {
    expect(p).toEqual({ frameId: 'main' });
    return {
      originTrials: [
        { trialName: 'Foo', status: 'Enabled', tokensWithStatus: [{ status: 'Success', parsedToken: { origin: 'https://a.test', expiryTime: 111 } }] },
        { trialName: 'Bar', status: 'ValidTokenNotProvided', tokensWithStatus: [{ status: 'Expired' }] },
      ],
    };
  });
  expect(await getOriginTrials(conn, 'main')).toEqual([
    { name: 'Foo', status: 'Enabled', tokens: [{ status: 'Success', origin: 'https://a.test', expiry: 111 }] },
    { name: 'Bar', status: 'ValidTokenNotProvided', tokens: [{ status: 'Expired' }] },
  ]);
});

test('getCookies surfaces a CHIPS partitionKey as its top-level site string', async () => {
  mock.respond('Network.getCookies', () => ({
    cookies: [
      { name: 'p', value: '1', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: true, partitionKey: { topLevelSite: 'https://top.test', hasCrossSiteAncestor: false } },
      { name: 'plain', value: '2', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: false },
    ],
  }));
  const cookies = await getCookies(conn);
  expect(cookies[0].partitionKey).toBe('https://top.test');
  expect(cookies[1].partitionKey).toBeUndefined();
});

test('setCookie sends the partitionKey in the CookiePartitionKey object shape', async () => {
  let seen: any;
  mock.respond('Network.setCookie', p => { seen = p; return { success: true }; });
  await setCookie(conn, 'https://a.test/', 'p', '1', { partitionKey: 'https://top.test', secure: true });
  expect(seen).toMatchObject({
    url: 'https://a.test/', name: 'p', value: '1', secure: true,
    partitionKey: { topLevelSite: 'https://top.test', hasCrossSiteAncestor: false },
  });
});
