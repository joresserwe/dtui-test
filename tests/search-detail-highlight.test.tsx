import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { DetailOverlay } from '../src/tui/overlays/DetailOverlay.js';
import type { NetworkEntry } from '../src/store/types.js';
import { waitForFrame } from './helpers/wait-for.js';

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3';
});

const INVERSE = '[7m';
const CTRL_F = '';

const entry: NetworkEntry = {
  id: 'r1', url: 'https://api.test/data', method: 'GET', type: 'XHR',
  status: 200, statusText: 'OK', mimeType: 'application/json',
  requestHeaders: {}, responseHeaders: { 'x-trace': 'abc-septoken-xyz' },
  startTs: 0,
};

test('DetailOverlay renders matched header text inverse when a highlight query is set', () => {
  const plain = render(<DetailOverlay entry={entry} tab="response" scroll={0} height={20} width={80} />);
  expect(plain.lastFrame()).not.toContain(INVERSE);
  plain.unmount();
  const marked = render(<DetailOverlay entry={entry} tab="response" scroll={0} height={20} width={80} highlight="septoken" />);
  const frame = marked.lastFrame()!;
  expect(frame).toContain('septoken');
  expect(frame).toContain(INVERSE);
  marked.unmount();
});

let mock: MockCdp;
let tabs: MultiTabs;
let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-hl-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-hl-data-'));
  mock = await MockCdp.start();
  tabs = new MultiTabs([{ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' }]);
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

test('the detail overlay of a search match highlights the query in the body', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: '{"secret":"septoken-value"}', base64Encoded: false }));
  const ep = { host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' };
  const { lastFrame, stdin } = render(
    <App ep={ep} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} />,
  );
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '연결됨: Mock Page');
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'r1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/api/septoken-req', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'r1', timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'r1', timestamp: 1.2, encodedDataLength: 10 });
  await waitForFrame(lastFrame, 'septoken-req');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('septoken');
  await new Promise(r => setTimeout(r, 40));
  stdin.write('\r');
  await waitForFrame(lastFrame, '(1)');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('4');
  await waitForFrame(lastFrame, 'response body');
  expect(lastFrame()).toContain(`${INVERSE}[36mseptoken[27m`);
});
