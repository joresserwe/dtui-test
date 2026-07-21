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
import { t } from '../src/tui/lib/i18n.js';

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
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-n3-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-n3-data-'));
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

function feedReq(id: string, url: string, status = 200) {
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url, method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: id, timestamp: 1.1, type: 'XHR',
    response: { status, statusText: status === 200 ? 'OK' : 'Not Found', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: id, timestamp: 1.2, encodedDataLength: 100 });
}

test('marking two requests and pressing d opens the diff overlay; esc closes it', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('d1', 'https://a.test/v1/users');
  feedReq('d2', 'https://a.test/v2/users', 404);
  await waitForFrame(lastFrame, 'v2');
  stdin.write('gg');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆1');
  stdin.write('j');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆2');
  stdin.write('d');
  await waitForFrame(lastFrame, '-/+');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('- url      https://a.test/v1/users');
  expect(frame).toContain('+ url      https://a.test/v2/users');
  stdin.write(ESC);
  await waitUntil(() => !strip(lastFrame()!).includes('-/+'));
  expect(strip(lastFrame()!)).not.toContain('-/+');
});

test('diff A/B follow mark insertion order, not capture arrival order', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('d1', 'https://a.test/v1/users');
  feedReq('d2', 'https://a.test/v2/users', 404);
  await waitForFrame(lastFrame, 'v2');
  stdin.write('gg');
  await sleep(60);
  stdin.write('j');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆1');
  stdin.write('k');
  await sleep(60);
  stdin.write('v');
  await waitForFrame(lastFrame, '◆2');
  stdin.write('d');
  await waitForFrame(lastFrame, '-/+');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('- url      https://a.test/v2/users');
  expect(frame).toContain('+ url      https://a.test/v1/users');
});

test('d without a marked pair only shows a toast', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('d1', 'https://a.test/only');
  await waitForFrame(lastFrame, 'only');
  stdin.write('d');
  await waitForFrame(lastFrame, t('toast.diffNeedTwo'));
});

test('the messages tab filters websocket frames with /', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.webSocketCreated', { requestId: 'ws1', url: 'wss://a.test/sock' });
  mock.emitEvent('Network.webSocketFrameSent', { requestId: 'ws1', timestamp: 2, response: { opcode: 1, payloadData: 'ping-alpha' } });
  mock.emitEvent('Network.webSocketFrameReceived', { requestId: 'ws1', timestamp: 3, response: { opcode: 1, payloadData: 'pong-beta' } });
  await waitForFrame(lastFrame, 'sock');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Messages');
  stdin.write('5');
  await waitForFrame(lastFrame, 'ping-alpha');
  stdin.write('/');
  await sleep(60);
  stdin.write('beta');
  await sleep(60);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'messages · 1/2');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('messages · 1/2');
  expect(frame).toContain('pong-beta');
  expect(frame).not.toContain('ping-alpha');
});

test('the summary tab surfaces TLS security details', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'sec1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://secure.test/api', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'sec1', timestamp: 1.1, type: 'XHR',
    response: {
      status: 200, statusText: 'OK', mimeType: 'application/json', headers: {},
      securityState: 'secure',
      securityDetails: {
        protocol: 'TLS 1.3', keyExchange: '', keyExchangeGroup: 'X25519', cipher: 'AES_128_GCM',
        subjectName: 'secure.test', issuer: 'R11',
        validFrom: Math.floor(Date.now() / 1000) - 1000,
        validTo: Math.floor(Date.now() / 1000) + 30 * 86_400,
        sanList: ['secure.test'],
      },
    },
  });
  await waitForFrame(lastFrame, 'secure.test');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'security · secure');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('TLS 1.3 · X25519 · AES_128_GCM');
  expect(frame).toContain('secure.test · issuer R11');
});

test('M adds a map remote rule through the editor and the status bar counts it', async () => {
  mock.respond('Fetch.enable', () => ({}));
  mock.respond('Fetch.disable', () => ({}));
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'MATCH https://a.test/api/*\nTO http://localhost:3000/api/*\n');
    },
  });
  await attach(lastFrame, stdin);
  feedReq('m1', 'https://a.test/api/users');
  await waitForFrame(lastFrame, 'users');
  stdin.write('M');
  await waitForFrame(lastFrame, t('toast.mapRemoteActive'));
  await waitForFrame(lastFrame, 'map:1');
  stdin.write('\x05');
  await waitForFrame(lastFrame, t('picker.title.mapRemote'));
  const frame = strip(lastFrame()!);
  expect(frame).toContain('https://a.test/api/* → http://localhost:3000/api/*');
  expect(frame).toContain('on');
});

test('Ctrl-E without rules reports there is nothing to manage', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('\x05');
  await waitForFrame(lastFrame, t('toast.noMapRemoteRules'));
});
