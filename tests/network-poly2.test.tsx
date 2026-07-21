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
import { waitForFrame } from './helpers/wait-for.js';
import type { NetworkEntry } from '../src/store/types.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ESC = '\x1b';
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-n2-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-n2-data-'));
  mock = await MockCdp.start();
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

function feedReq(id: string, url: string, { encoded = 1000, decoded = 3000 }: { encoded?: number; decoded?: number } = {}) {
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url, method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: id, timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.dataReceived', { requestId: id, timestamp: 1.15, dataLength: decoded, encodedDataLength: 0 });
  mock.emitEvent('Network.loadingFinished', { requestId: id, timestamp: 1.2, encodedDataLength: encoded });
}

test('the summary bar totals request count, transferred and resource bytes over the filtered list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('s1', 'https://a.test/one', { encoded: 1000, decoded: 3000 });
  feedReq('s2', 'https://a.test/two', { encoded: 500, decoded: 1000 });
  await waitForFrame(lastFrame, 'two');
  await sleep(60);
  const frame = strip(lastFrame()!);
  expect(frame).toContain('▸');
  expect(frame).toContain('2건');
  expect(frame).toContain('1.5kB 전송');
  expect(frame).toContain('3.9kB 리소스');
});

test('the summary bar shows N/total when a filter narrows the list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('f1', 'https://a.test/keep');
  feedReq('f2', 'https://a.test/drop');
  await waitForFrame(lastFrame, 'drop');
  stdin.write('/');
  await sleep(30);
  stdin.write('keep');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '전송');
  expect(strip(lastFrame()!)).toContain('1/2');
});

test('the summary bar reports DOMContentLoaded and Load once page timing events arrive', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'doc1', loaderId: 'doc1', timestamp: 1, wallTime: 1700000000, type: 'Document',
    request: { url: 'https://mock.test/', method: 'GET', headers: {} },
  });
  mock.emitEvent('Page.domContentEventFired', { timestamp: 1.5 });
  mock.emitEvent('Page.loadEventFired', { timestamp: 2.8 });
  await waitForFrame(lastFrame, 'DCL');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('DCL 500ms');
  expect(frame).toContain('Load 1.8s');
});

test('v marks the selected request and V clears every mark', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('m1', 'https://a.test/one');
  feedReq('m2', 'https://a.test/two');
  await waitForFrame(lastFrame, 'two');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆1');
  await sleep(30);
  stdin.write('V');
  await waitForFrame(lastFrame, '마크 해제됨');
  expect(strip(lastFrame()!)).not.toContain('◆1');
});

test('the copy picker copies every listed URL and reports the count', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  feedReq('u1', 'https://a.test/one');
  feedReq('u2', 'https://a.test/two');
  await waitForFrame(lastFrame, 'two');
  await sleep(60);
  stdin.write('p');
  await waitForFrame(lastFrame, '복사 형식');
  for (let i = 0; i < 5; i++) stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'URL 2개 복사됨');
  expect(copied).toBe('https://a.test/one\nhttps://a.test/two');
});

test('H exports only the marked requests when any are marked', async () => {
  let received: NetworkEntry[] | undefined;
  const { lastFrame, stdin } = renderApp({
    exportHar: async (_session, entries) => { received = entries; return '/tmp/marked.har'; },
    clipboard: async () => {},
  });
  await attach(lastFrame, stdin);
  feedReq('h1', 'https://a.test/one');
  feedReq('h2', 'https://a.test/two');
  await waitForFrame(lastFrame, 'two');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆1');
  stdin.write('H');
  await waitForFrame(lastFrame, 'HAR');
  expect(received).toHaveLength(1);
  expect(received![0].url).toBe('https://a.test/two');
});

test('the copy picker labels the bulk actions as marked when a subset is marked', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('lm1', 'https://a.test/one');
  await waitForFrame(lastFrame, 'one');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆1');
  stdin.write('p');
  await waitForFrame(lastFrame, '복사 형식');
  expect(strip(lastFrame()!)).toContain('마크 · URLs');
});
