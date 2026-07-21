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
import type { HostDelegate } from '../src/mcp/host.js';
import { startLiveHost } from '../src/mcp/host.js';
import { LiveClient, LiveSessionSource } from '../src/mcp/live-source.js';
import { getRequest, networkSearch, sessionSummary } from '../src/mcp/tools.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-lb-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-lb-data-'));
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

const TREE_DOC = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], children: [] },
  ] },
] } };

function respondDetail() {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<div id="app">hi</div>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: 'display', value: 'block' }, { name: 'tab-size', value: '8' }] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: {
    content: [0, 0, 10, 0, 10, 10, 0, 10], padding: [0, 0, 10, 0, 10, 10, 0, 10],
    border: [0, 0, 10, 0, 10, 10, 0, 10], margin: [0, 0, 10, 0, 10, 10, 0, 10],
    width: 10, height: 10,
  } }));
  mock.respond('Page.captureScreenshot', p => ({ data: Buffer.from(p?.clip ? 'element-shot' : 'viewport-shot').toString('base64') }));
}

async function attachApp(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

test('the App liveBridge delegate exposes sessions, tabs, screenshots, and the selected element', async () => {
  respondDetail();
  let delegate: HostDelegate | null = null;
  const { lastFrame, stdin } = render(
    <App
      ep={ep()}
      tabs={tabs}
      attach={t => DebugSession.attach(t, { persist: false })}
      reconnectBaseMs={10}
      liveBridge={{ setDelegate: d => { delegate = d; } }}
    />,
  );
  expect(delegate).not.toBeNull();
  await expect(Promise.resolve().then(() => delegate!.selectedElement())).rejects.toThrow(/no element selected/);
  await expect(Promise.resolve().then(() => delegate!.screenshot('viewport'))).rejects.toThrow(/no attached session/);
  await attachApp(lastFrame, stdin);
  const sessions = await delegate!.listSessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].urlSlug).toBe('');
  expect(sessions[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  const tabsList = await delegate!.listTabs();
  expect(tabsList).toEqual([{ id: sessions[0].id, url: 'https://mock.test/', title: 'Mock Page' }]);
  await expect(Promise.resolve().then(() => delegate!.selectedElement())).rejects.toThrow(/no element selected/);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  const el = await delegate!.selectedElement();
  expect(el.selectorPath).toBe('div#app');
  expect(el.outerHTML).toBe('<div id="app">hi</div>');
  expect(el.computed).toEqual([['display', 'block']]);
  expect(el.box).toMatchObject({ width: 10, height: 10 });
  const viewport = await delegate!.screenshot('viewport');
  expect(Buffer.from(viewport.data, 'base64').toString()).toBe('viewport-shot');
  const element = await delegate!.screenshot('element');
  expect(Buffer.from(element.data, 'base64').toString()).toBe('element-shot');
  stdin.write('q');
  await sleep(80);
});

test('MCP tools ride the socket end to end against the App delegate', async () => {
  respondDetail();
  let delegate: HostDelegate | null = null;
  const sockDir = await mkdtemp(join(tmpdir(), 'dtui-lb-sock-'));
  const host = await startLiveHost(() => delegate, join(sockDir, `${process.pid}.sock`));
  const { lastFrame, stdin } = render(
    <App
      ep={ep()}
      tabs={tabs}
      attach={t => DebugSession.attach(t, { persist: false })}
      reconnectBaseMs={10}
      liveBridge={{ setDelegate: d => { delegate = d; } }}
    />,
  );
  try {
    await attachApp(lastFrame, stdin);
    mock.respond('Network.getResponseBody', () => ({ body: '{"payload":"' + 'x'.repeat(4096) + '"}', base64Encoded: false }));
    mock.emitEvent('Network.requestWillBeSent', {
      requestId: 'n1', timestamp: 10, wallTime: 1700000000, type: 'XHR',
      request: { url: 'https://mock.test/api/users', method: 'POST', headers: {}, postData: '{"cart":[1]}' },
    });
    mock.emitEvent('Network.responseReceived', {
      requestId: 'n1', timestamp: 10.1, type: 'XHR',
      response: { status: 404, statusText: 'Not Found', mimeType: 'application/json', headers: {} },
    });
    mock.emitEvent('Network.loadingFinished', { requestId: 'n1', timestamp: 10.2, encodedDataLength: 11 });
    await sleep(150);
    const client = await LiveClient.connect(host.path);
    const src = new LiveSessionSource(client);
    const summary = await sessionSummary(src, {});
    expect(summary.source).toBe('live');
    expect(summary.requests.total).toBe(1);
    const { rows } = await networkSearch(src, { status_class: '4xx' });
    expect(rows.map(r => r.id)).toEqual(['n1']);
    const listRead = await src.readNetwork(summary.id);
    expect(listRead[0]).not.toHaveProperty('body');
    expect(listRead[0]).not.toHaveProperty('postData');
    const detail = await getRequest(src, { id: 'n1', include: ['request_body', 'response_body'], body_max_bytes: 8192 });
    expect(detail.requestBody?.body).toBe('{"cart":[1]}');
    expect(detail.responseBody?.body).toContain('xxxx');
    mock.emitEvent('Network.requestWillBeSent', {
      requestId: 'n2', timestamp: 20, wallTime: 1700000001, type: 'XHR',
      request: { url: 'https://mock.test/api/slow', method: 'GET', headers: {} },
    });
    await sleep(120);
    const pendingPoll = await networkSearch(src, {});
    expect(pendingPoll.rows.find(r => r.id === 'n2')).toMatchObject({ url: 'https://mock.test/api/slow' });
    expect(pendingPoll.cursor).toBe(1700000001000);
    mock.emitEvent('Network.responseReceived', {
      requestId: 'n2', timestamp: 20.5, type: 'XHR',
      response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
    });
    mock.emitEvent('Network.loadingFinished', { requestId: 'n2', timestamp: 20.5, encodedDataLength: 11 });
    await sleep(150);
    const donePoll = await networkSearch(src, { since: pendingPoll.cursor });
    expect(donePoll.rows.map(r => r.id)).toEqual(['n2']);
    expect(donePoll.rows[0].status).toBe(200);
    client.close();
  } finally {
    await host.close();
    stdin.write('q');
    await sleep(80);
  }
});
