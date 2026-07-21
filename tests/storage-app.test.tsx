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
import { waitForFrame, waitUntil } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = '\x1b';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-app-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-app-data-'));
  mock = await MockCdp.start();
  mock.respond('DOMStorage.enable', () => ({}));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
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
  await waitForFrame(lastFrame, ' app ');
}

const frameTree = {
  frameTree: {
    frame: { id: 'main', url: 'https://mock.test/', securityOrigin: 'https://mock.test', secureContextType: 'Secure', crossOriginIsolatedContextType: 'Isolated' },
    childFrames: [
      { frame: { id: 'c1', url: 'https://cdn.test/widget', securityOrigin: 'https://cdn.test', secureContextType: 'Secure', crossOriginIsolatedContextType: 'NotIsolated' } },
    ],
  },
};

test('the app view shows manifest fields, installability, and origin trials; Enter opens the raw JSON', async () => {
  mock.respond('Page.getFrameTree', () => frameTree);
  mock.respond('Page.getAppManifest', () => ({
    url: 'https://mock.test/manifest.json',
    data: JSON.stringify({ name: 'Mock App', short_name: 'Mock', start_url: '/', display: 'standalone', theme_color: '#123456', icons: [{ src: '/i.png', sizes: '192x192' }] }),
    errors: [],
  }));
  mock.respond('Page.getInstallabilityErrors', () => ({ installabilityErrors: [{ errorId: 'no-icon-available', errorArguments: [] }] }));
  mock.respond('Page.getOriginTrials', () => ({ originTrials: [{ trialName: 'PrivacySandbox', status: 'Enabled', tokensWithStatus: [{ status: 'Success' }] }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('llllll');
  await waitForFrame(lastFrame, 'Mock App');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('standalone');
  expect(frame).toContain('설치가능성');
  expect(frame).toContain('no-icon-available');
  stdin.write('\r');
  await waitForFrame(lastFrame, '"name": "Mock App"');
  expect(stripAnsi(lastFrame()!)).toContain('"theme_color"');
  stdin.write(ESC);
  await sleep(60);
  stdin.write('G');
  await waitForFrame(lastFrame, 'PrivacySandbox');
  expect(stripAnsi(lastFrame()!)).toContain('오리진 트라이얼');
});

test('an app view with no manifest degrades gracefully and still shows installability errors', async () => {
  mock.respond('Page.getFrameTree', () => frameTree);
  mock.respond('Page.getAppManifest', () => ({ url: '', data: '', errors: [] }));
  mock.respond('Page.getInstallabilityErrors', () => ({ installabilityErrors: [{ errorId: 'no-manifest', errorArguments: [] }] }));
  mock.respond('Page.getOriginTrials', () => ({ originTrials: [] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('llllll');
  await waitForFrame(lastFrame, '매니페스트 없음');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('no-manifest');
  expect(frame).toContain('등록된 트라이얼 없음');
});

test('the frames view shows the tree with isolation badges and Enter opens COOP/COEP detail', async () => {
  mock.respond('Page.getFrameTree', () => frameTree);
  mock.respond('Network.getSecurityIsolationStatus', p => (
    p.frameId === 'main'
      ? { status: { coep: { value: 'RequireCorp', reportOnlyValue: 'None' }, coop: { value: 'SameOrigin', reportOnlyValue: 'UnsafeNone' } } }
      : { status: { coep: { value: 'None' }, coop: { value: 'UnsafeNone' } } }
  ));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  stdin.write('lllllll');
  await waitForFrame(lastFrame, 'cdn.test/widget');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('mock.test/');
  expect(frame).toContain('교차출처 격리');
  expect(frame).toContain('비격리');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'COEP: RequireCorp');
  const detail = stripAnsi(lastFrame()!);
  expect(detail).toContain('COOP: SameOrigin');
  expect(detail).toContain('crossOriginIsolated: Isolated');
});

test('a partitioned (CHIPS) cookie shows the partition in its detail and Y export', async () => {
  mock.respond('Page.getFrameTree', () => frameTree);
  mock.respond('Network.getCookies', () => ({
    cookies: [{ name: 'ad', value: 'x', domain: 'cdn.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None', partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: false } }],
  }));
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'ad = x');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'partition');
  expect(stripAnsi(lastFrame()!)).toContain('https://mock.test');
  stdin.write(ESC);
  await sleep(60);
  stdin.write('Y');
  await waitForFrame(lastFrame, '쿠키 1개 JSON 복사됨');
  const parsed = JSON.parse(copied);
  expect(parsed[0].partitionKey).toBe('https://mock.test');
});

test('editing cookie attributes round-trips the partitionKey through setCookie', async () => {
  let seen: any;
  mock.respond('Page.getFrameTree', () => frameTree);
  mock.respond('Network.getCookies', () => ({
    cookies: [{ name: 'ad', value: 'x', domain: 'cdn.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None', partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: false } }],
  }));
  mock.respond('Network.setCookie', p => { seen = p; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'ad = x');
  stdin.write('a');
  await waitForFrame(lastFrame, 'partitionKey=https://mock.test');
  stdin.write('\r');
  await waitUntil(() => seen !== undefined);
  expect(seen).toMatchObject({
    name: 'ad', value: 'x',
    partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: false },
  });
});

const partCookie = (extra: Record<string, unknown> = {}) => ({
  name: 'ad', value: 'x', domain: 'cdn.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None',
  partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: false }, ...extra,
});

test('deleting a partitioned cookie forwards its partition key, and an unpartitioned one omits it', async () => {
  const deleted: any[] = [];
  mock.respond('Network.getCookies', () => ({
    cookies: [partCookie(), { name: 'plain', value: 'y', domain: 'mock.test', path: '/', expires: -1, httpOnly: false, secure: false }],
  }));
  mock.respond('Network.deleteCookies', p => { deleted.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'ad = x');
  stdin.write('d');
  await waitUntil(() => deleted.length >= 1);
  expect(deleted[0]).toMatchObject({ name: 'ad', partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: false } });
  stdin.write('j');
  await sleep(40);
  stdin.write('d');
  await waitUntil(() => deleted.length >= 2);
  expect(deleted[1]).toMatchObject({ name: 'plain' });
  expect('partitionKey' in deleted[1]).toBe(false);
});

test('editing preserves the original hasCrossSiteAncestor flag on an unchanged save', async () => {
  let seen: any;
  mock.respond('Network.getCookies', () => ({ cookies: [partCookie({ partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: true } })] }));
  mock.respond('Network.setCookie', p => { seen = p; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'ad = x');
  stdin.write('a');
  await waitForFrame(lastFrame, 'partitionKey=https://mock.test');
  stdin.write('\r');
  await sleep(150);
  expect(seen.partitionKey).toEqual({ topLevelSite: 'https://mock.test', hasCrossSiteAncestor: true });
});

test('clearing the partition deletes the partitioned cookie then re-sets it unpartitioned', async () => {
  const deleted: any[] = [];
  let set: any;
  mock.respond('Network.getCookies', () => ({ cookies: [partCookie({ partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: true } })] }));
  mock.respond('Network.deleteCookies', p => { deleted.push(p); return {}; });
  mock.respond('Network.setCookie', p => { set = p; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openStorage(lastFrame, stdin);
  await waitForFrame(lastFrame, 'ad = x');
  stdin.write('a');
  await waitForFrame(lastFrame, 'partitionKey=https://mock.test');
  stdin.write('; partitioned=false');
  await sleep(40);
  stdin.write('\r');
  await sleep(150);
  expect(deleted[0]).toMatchObject({ name: 'ad', partitionKey: { topLevelSite: 'https://mock.test', hasCrossSiteAncestor: true } });
  expect(set).toMatchObject({ name: 'ad', value: 'x' });
  expect('partitionKey' in set).toBe(false);
});
