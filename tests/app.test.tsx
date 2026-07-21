import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import React from 'react';
import { render as inkRender } from 'ink';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession, THROTTLE_PROFILES } from '../src/engine.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { App } from '../src/tui/App.js';
import { ToolTabs } from '../src/tui/panels/ToolTabs.js';
import { buildContext } from '../src/tui/lib/session-context.js';
import { listPages, type PageTarget } from '../src/cdp/targets.js';
import type { Endpoint } from '../src/cdp/discovery.js';
import { waitForFrame, waitUntil } from './helpers/wait-for.js';
import { displayWidth } from '../src/tui/lib/format.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

const ESC = '';
const CTRL_D = '';
const CTRL_U = '';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-app-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-app-data-'));
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

function renderAppTall(rows: number) {
  return renderAppSized(100, rows);
}

function renderAppSized(columns: number, rows: number, extra: Partial<React.ComponentProps<typeof App>> = {}) {
  let frame: string | undefined;
  const stdout = Object.assign(new EventEmitter(), {
    columns,
    rows,
    write: (f: string) => { frame = f; },
  });
  let pending: string | null = null;
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setEncoding: () => {},
    setRawMode: () => {},
    resume: () => {},
    pause: () => {},
    ref: () => {},
    unref: () => {},
    read: () => { const d = pending; pending = null; return d; },
    write: (data: string) => { pending = data; stdin.emit('readable'); stdin.emit('data', data); },
  });
  inkRender(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} {...extra} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return { lastFrame: () => frame, stdin };
}

function feedNet(id: string, url: string) {
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url, method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: id, timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: id, timestamp: 1.2, encodedDataLength: 10 });
}

function feedReq(id: string, url: string, { type = 'XHR', bytes = 10 }: { type?: string; bytes?: number } = {}) {
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 1, wallTime: 1700000000, type,
    request: { url, method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: id, timestamp: 1.1, type,
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: id, timestamp: 1.2, encodedDataLength: bytes });
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

const TREE_DOC = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], children: [
      { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], children: [] },
    ] },
  ] },
] } };

function respondDomNode(doc: () => unknown = () => TREE_DOC) {
  mock.respond('DOM.getDocument', doc);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span class="x">hi</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
}

// Tree-first Elements flow: enter the tool, open selector search, resolve the node,
// then Enter into the DomOverlay subview (which renders `#<nodeId>`).
async function query(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }, sel: string) {
  stdin.write('3');
  await waitForFrame(lastFrame, '/ 검색');
  stdin.write('/');
  await sleep(30);
  stdin.write(sel);
  await sleep(30);
  stdin.write('\r');
  await sleep(200);
  stdin.write('\r');
  await waitForFrame(lastFrame, '#9');
}

test('renders the header, tool bar, and status bar as a full-height frame', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  const frame = lastFrame()!;
  expect(frame).toContain('◉ Mock Page');
  expect(frame).toContain('Network');
  expect(frame).toContain('Console');
  expect(frame).toContain('Elements');
  expect(frame).toContain('Storage');
  expect(frame).toContain('Settings');
  expect(frame).toContain('MockChrome/1.0');
  expect(frame).not.toContain('1 탭');
  expect(frame).toContain('b 전환');
  expect(frame).not.toContain('f 현재 탭');
  expect(frame).toContain('? 도움말');
  expect(frame.split('\n').length).toBe(23);
});

test('the tab bar renders a plain rule and keeps stable columns across actives', () => {
  const rows = (active: 'network' | 'storage') => {
    const { lastFrame } = render(<ToolTabs active={active} width={100} />);
    return lastFrame()!
      .split('\n')
      .map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
  };
  const [tabRowA, ruleRowA] = rows('network');
  const [tabRowB, ruleRowB] = rows('storage');
  expect(ruleRowA).toBe('─'.repeat(100));
  expect(ruleRowB).toBe('─'.repeat(100));
  for (const label of ['1 Network', '2 Console', '3 Elements', '4 Storage', '5 Sources', '6 Components', '7 Audit', '8 Settings']) {
    const col = tabRowA.indexOf(label);
    expect(col).toBeGreaterThan(0);
    expect(tabRowB.indexOf(label)).toBe(col);
  }
  expect(tabRowA).not.toContain('│');
});

test('the b picker attaches to the selected browser tab', async () => {
  const { lastFrame, stdin } = renderApp();
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '연결됨: Mock Page');
  expect(lastFrame()).toContain('◉ Mock Page');
});

test('f activates the currently attached tab in the browser', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('f');
  await waitForFrame(lastFrame, '연결된 탭 없음');
  await attach(lastFrame, stdin);
  mock.activated.length = 0;
  stdin.write('f');
  await waitForFrame(lastFrame, '브라우저 탭 활성화');
  expect(mock.activated).toContain('page1');
});

test('attach streams network into the Network tool and console into the Console tool', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/one');
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'boom-console' }] });
  await waitForFrame(lastFrame, 'one');
  expect(lastFrame()).toContain('◉ Mock Page');
  stdin.write('2');
  await waitForFrame(lastFrame, 'boom-console');
});

test('graphql posts surface their operation name in the request list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'gq1', timestamp: 1, wallTime: 1700000000, type: 'Fetch',
    request: {
      url: 'https://a.test/graphql', method: 'POST', headers: { 'Content-Type': 'application/json' },
      postData: JSON.stringify({ operationName: 'BumpQuxCounter', query: 'mutation BumpQuxCounter { bump }' }),
    },
  });
  await waitForFrame(lastFrame, 'gql·BumpQuxCounter');
});

test('digit keys switch tools', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await waitForFrame(lastFrame, '콘솔 출력 없음');
  stdin.write('1');
  await waitForFrame(lastFrame, '요청 없음');
});

test('an unrecognized function-key sequence (F13) does not switch tools', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await waitForFrame(lastFrame, '요청 없음');
  stdin.write('\x1b[25~');
  await sleep(60);
  expect(lastFrame()).toContain('요청 없음');
  stdin.write('\x1b[1;2P');
  await sleep(60);
  expect(lastFrame()).toContain('요청 없음');
});

test('Tab and Shift-Tab cycle through the tools', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  expect(lastFrame()).toContain('z 구간');
  stdin.write('\t');
  await waitForFrame(lastFrame, '␣ 스택');
  stdin.write('\x1b[Z');
  await waitForFrame(lastFrame, 'z 구간');
});

test('a narrow terminal keeps high-priority hints on row 1 and overflows the rest to row 2', async () => {
  const { lastFrame, stdin } = renderAppSized(40, 20);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '⏎ 상세');
  const lines = lastFrame()!.split('\n');
  const row1 = lines[lines.length - 3].replace(/\x1b\[[0-9;]*m/g, '');
  const row2 = lines[lines.length - 2].replace(/\x1b\[[0-9;]*m/g, '');
  expect(row1).toContain('/ 필터');
  expect(row1).toContain('? 도움말');
  expect(row1).not.toContain('s 정렬');
  expect(row2).toContain('s 정렬');
  expect(row2).toContain('z 구간');
  for (const row of [row1, row2]) {
    expect(row).not.toContain('…');
    expect(displayWidth(row)).toBeLessThanOrEqual(40);
  }
});

test('the detail w hint follows the active tab and request body presence', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'r1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/api/wrap-me', method: 'POST', headers: {}, postData: 'q=1' },
  });
  await waitForFrame(lastFrame, 'wrap-me');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(stripAnsi(lastFrame()!)).not.toContain('w 줄바꿈');
  stdin.write('2');
  await waitForFrame(lastFrame, 'w 줄바꿈');
  expect(stripAnsi(lastFrame()!)).toContain('w 줄바꿈');
  stdin.write('3');
  await sleep(40);
  expect(stripAnsi(lastFrame()!)).not.toContain('w 줄바꿈');
  stdin.write('4');
  await waitForFrame(lastFrame, 'w 줄바꿈');
  expect(stripAnsi(lastFrame()!)).toContain('w 줄바꿈');
});

test('the detail w hint stays hidden on Request when the entry has no body', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/nobody');
  await waitForFrame(lastFrame, 'nobody');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('2');
  await sleep(40);
  expect(stripAnsi(lastFrame()!)).not.toContain('w 줄바꿈');
});

test('detail overlay opens on Enter in the Network tool and closes on Esc', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/detail-me');
  await waitForFrame(lastFrame, 'detail-me');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/api/detail-me');
  stdin.write(ESC);
  await sleep(40);
  expect(lastFrame()).not.toContain('Summary');
});

test('detail overlay tabs switch with digits and h/l', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/detail-me');
  await waitForFrame(lastFrame, 'detail-me');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toMatch(/type\s+XHR/);
  stdin.write('3');
  await sleep(40);
  expect(lastFrame()).not.toContain('XHR');
  expect(lastFrame()).toMatch(/status\s+200/);
  stdin.write('l');
  await waitForFrame(lastFrame, '응답 본문 없음');
  expect(lastFrame()).toContain('응답 본문 없음');
  stdin.write('1');
  await sleep(40);
  expect(lastFrame()).toMatch(/type\s+XHR/);
});

test('w wraps the detail body and the preference survives closing the overlay', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: 'A'.repeat(150), base64Encoded: false }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('w1', 'https://a.test/api/wrap-me');
  await waitForFrame(lastFrame, 'wrap-me');
  await sleep(120);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('4');
  await waitForFrame(lastFrame, 'response body');
  const aRows = () => lastFrame()!.split('\n').filter(l => /^A+…?$/.test(l.trim())).length;
  expect(aRows()).toBe(1);
  stdin.write('w');
  await waitUntil(() => aRows() === 2);
  expect(aRows()).toBe(2);
  stdin.write('q');
  await sleep(40);
  expect(lastFrame()).not.toContain('Summary');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('4');
  await waitForFrame(lastFrame, 'response body');
  expect(aRows()).toBe(2);
  stdin.write('w');
  await waitUntil(() => aRows() === 1);
  expect(aRows()).toBe(1);
});

test('websocket entries expose a fifth Messages tab reachable by 5 and h/l', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.webSocketCreated', { requestId: 'ws1', url: 'wss://a.test/live-socket' });
  mock.emitEvent('Network.webSocketFrameReceived', {
    requestId: 'ws1', timestamp: 1, response: { opcode: 1, mask: false, payloadData: 'hello-frame' },
  });
  await waitForFrame(lastFrame, 'live-socket');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('5 Messages');
  stdin.write('5');
  await waitForFrame(lastFrame, 'hello-frame');
  stdin.write('h');
  await sleep(40);
  expect(lastFrame()).not.toContain('hello-frame');
  stdin.write('l');
  await waitForFrame(lastFrame, 'hello-frame');
  expect(lastFrame()).toContain('hello-frame');
  stdin.write('1');
  await sleep(40);
  expect(lastFrame()).toMatch(/type\s+WebSocket/);
});

test('attach applies the configured throttle and reflects it in the status bar', async () => {
  saveConfig({ throttle: 'slow3g' });
  const seen: any[] = [];
  mock.respond('Network.emulateNetworkConditions', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await waitUntil(() => seen.length > 0);
  expect(seen[0]).toMatchObject({ latency: THROTTLE_PROFILES.slow3g!.latency });
  expect(lastFrame()).toContain('throttle slow3g');
});

test('attach keeps throttle off when applying the configured throttle fails', async () => {
  saveConfig({ throttle: 'slow3g' });
  mock.respond('Network.emulateNetworkConditions', () => { throw new Error('nope'); });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await waitForFrame(lastFrame, '연결됨:');
  expect(lastFrame()).toContain('연결됨:');
  expect(lastFrame()).not.toContain('slow3g');
});

test('config bodyCapBytes reaches the default attach path and skips oversized bodies', async () => {
  saveConfig({ bodyCapBytes: 10 });
  let bodyCalls = 0;
  mock.respond('Network.getResponseBody', () => { bodyCalls++; return { body: 'x', base64Encoded: false }; });
  const { lastFrame, stdin } = render(<App ep={ep()} tabs={tabs} reconnectBaseMs={10} />);
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'cap1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/cap', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'cap1', timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'cap1', timestamp: 1.2, encodedDataLength: 1000 });
  await sleep(200);
  expect(bodyCalls).toBe(0);
  stdin.write('q');
  await sleep(100);
});

test('T cycles the throttle and reports via toast', async () => {
  const seen: any[] = [];
  mock.respond('Network.emulateNetworkConditions', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('T');
  await waitForFrame(lastFrame, 'throttle:fast3g');
  expect(seen[0]).toMatchObject({ latency: 150 });
});

test('T reaches offline after slow3g and cycles back to off', async () => {
  const seen: any[] = [];
  mock.respond('Network.emulateNetworkConditions', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('T');
  await waitForFrame(lastFrame, 'throttle:fast3g');
  stdin.write('T');
  await waitForFrame(lastFrame, 'throttle:slow3g');
  stdin.write('T');
  await waitForFrame(lastFrame, 'throttle:offline');
  expect(seen[2]).toMatchObject({ offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  expect(lastFrame()).toContain('throttle offline');
  stdin.write('T');
  await waitUntil(() => seen.length > 3);
  expect(seen[3]).toMatchObject({ offline: false, downloadThroughput: -1 });
  expect(lastFrame()).not.toContain('throttle offline');
});

test('u toggles disable cache, sends the CDP call, and shows the nocache badge', async () => {
  const seen: any[] = [];
  mock.respond('Network.setCacheDisabled', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('u');
  await waitForFrame(lastFrame, 'nocache:on');
  expect(seen[0]).toMatchObject({ cacheDisabled: true });
  expect(lastFrame()).toContain('nocache');
  stdin.write('u');
  await waitForFrame(lastFrame, 'nocache:off');
  expect(seen[1]).toMatchObject({ cacheDisabled: false });
});

test('attach applies the configured cacheDisabled and shows the nocache badge', async () => {
  saveConfig({ cacheDisabled: true });
  const seen: any[] = [];
  mock.respond('Network.setCacheDisabled', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await waitUntil(() => seen.length > 0);
  expect(seen[0]).toMatchObject({ cacheDisabled: true });
  expect(lastFrame()).toContain('nocache');
});

test('switching tabs re-applies the configured cacheDisabled', async () => {
  saveConfig({ cacheDisabled: true });
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const seen: any[] = [];
  mock.respond('Network.setCacheDisabled', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await sleep(120);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  await waitUntil(() => seen.filter(p => p.cacheDisabled === true).length >= 2);
  expect(seen.filter(p => p.cacheDisabled === true).length).toBeGreaterThanOrEqual(2);
  mock.pages.pop();
});

test('editing networkCap in settings applies the cap to the live store', async () => {
  let captured: DebugSession | undefined;
  const { lastFrame, stdin } = render(
    <App ep={ep()} tabs={tabs} reconnectBaseMs={10}
      attach={async t => { captured = await DebugSession.attach(t, { persist: false }); return captured; }} />,
  );
  await attach(lastFrame, stdin);
  expect(captured!.network.cap).toBe(1000);
  stdin.write(',');
  await waitForFrame(lastFrame, 'port');
  for (let i = 0; i < 10; i++) { stdin.write('j'); await sleep(15); }
  stdin.write('\r');
  await waitForFrame(lastFrame, 'edit networkCap');
  for (let i = 0; i < 6; i++) { stdin.write('\x7f'); await sleep(10); }
  stdin.write('250');
  await sleep(20);
  stdin.write('\r');
  await waitUntil(() => loadConfig().networkCap === 250);
  expect(loadConfig().networkCap).toBe(250);
  expect(captured!.network.cap).toBe(250);
});

test('flipping persistSanitize in settings redacts subsequent JSONL writes on the open session', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: '{"ok":true}', base64Encoded: false }));
  let captured: DebugSession | undefined;
  const { lastFrame, stdin } = render(
    <App ep={ep()} tabs={tabs} reconnectBaseMs={10}
      attach={async t => { captured = await DebugSession.attach(t, {}); return captured; }} />,
  );
  await attach(lastFrame, stdin);
  expect(captured!.persistSanitize).toBe(false);
  expect(captured!.sessionDir).toBeDefined();
  stdin.write(',');
  await waitForFrame(lastFrame, 'port');
  stdin.write('/');
  await sleep(20);
  stdin.write('persist');
  await sleep(20);
  stdin.write('\r');
  await sleep(20);
  stdin.write('l');
  await waitForFrame(lastFrame, 'persistSanitize:on');
  expect(captured!.persistSanitize).toBe(true);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'ps1', timestamp: 10, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/ps1', method: 'GET', headers: { Authorization: 'Bearer secret' } },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'ps1', timestamp: 10.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: { 'Set-Cookie': 'sid=raw-secret; HttpOnly' } },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'ps1', timestamp: 10.2, encodedDataLength: 11 });
  const file = join(captured!.sessionDir!, 'network.jsonl');
  const deadline = Date.now() + 2000;
  let text = '';
  while (Date.now() < deadline) {
    try { text = readFileSync(file, 'utf8'); } catch {}
    if (text.includes('ps1')) break;
    await sleep(25);
  }
  const line = JSON.parse(text.trim().split('\n').find(l => l.includes('ps1'))!);
  expect(line.requestHeaders.Authorization).toBe('[redacted]');
  expect(line.responseHeaders['Set-Cookie']).toBe('[redacted]');
  expect(line.setCookies).toEqual(['sid=[redacted]']);
  expect(captured!.network.entries().find(e => e.id === 'ps1')!.requestHeaders.Authorization).toBe('Bearer secret');
});

test('y copies context via injected clipboard', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'ctx-err' }] });
  await sleep(150);
  stdin.write('y');
  await waitUntil(() => copied.includes('# devtools-tui context'));
  expect(copied).toContain('# devtools-tui context');
  expect(copied).toContain('Mock Page');
  expect(copied).toContain('ctx-err');
});

test('Y copies the selected request as a curl command', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/curl-me');
  await waitForFrame(lastFrame, 'curl-me');
  stdin.write('Y');
  await waitUntil(() => copied.includes("curl 'https://a.test/api/curl-me'"));
  expect(copied).toContain("curl 'https://a.test/api/curl-me'");
});

test('R replays the selected request through page fetch', async () => {
  const exprs: string[] = [];
  mock.respond('Runtime.evaluate', p => { exprs.push(p.expression); return { result: { type: 'undefined' } }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'r1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: {
      url: 'https://a.test/api/replay-me', method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: 'sid=1', Host: 'a.test', 'Content-Length': '7' },
      postData: '{"a":1}',
    },
  });
  await waitForFrame(lastFrame, 'replay-me');
  stdin.write('R');
  await waitForFrame(lastFrame, '재전송됨');
  expect(exprs).toHaveLength(1);
  expect(exprs[0]).toContain('fetch("https://a.test/api/replay-me"');
  expect(exprs[0]).toContain('"method":"POST"');
  expect(exprs[0]).toContain('"content-type":"application/json"');
  expect(exprs[0]).toContain('"credentials":"include"');
  expect(exprs[0]).toContain('"body":"{\\"a\\":1}"');
  expect(exprs[0]).not.toMatch(/Cookie|Host|Content-Length/);
});

test('R shows a failure toast when the evaluate call errors', async () => {
  mock.respond('Runtime.evaluate', () => { throw new Error('nope'); });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/replay-fail');
  await waitForFrame(lastFrame, 'replay-fail');
  stdin.write('R');
  await waitForFrame(lastFrame, '재전송 실패');
});

test('R without a selected entry is a silent no-op', async () => {
  const exprs: string[] = [];
  mock.respond('Runtime.evaluate', p => { exprs.push(p.expression); return { result: {} }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('R');
  await sleep(100);
  expect(exprs).toHaveLength(0);
  expect(lastFrame()).not.toContain('재전송');
});

test('E opens the request in the editor and sends the edited version', async () => {
  const exprs: string[] = [];
  mock.respond('Runtime.evaluate', p => { exprs.push(p.expression); return { result: {} }; });
  let seen = '';
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { readFile, writeFile } = await import('node:fs/promises');
      seen = await readFile(file, 'utf8');
      await writeFile(file, 'PUT https://a.test/api/edited\nx-flag: on\n\n{"b":2}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/orig');
  await waitForFrame(lastFrame, 'orig');
  stdin.write('E');
  await waitForFrame(lastFrame, '재전송됨');
  expect(seen).toContain('GET https://a.test/api/orig');
  expect(exprs).toHaveLength(1);
  expect(exprs[0]).toContain('fetch("https://a.test/api/edited"');
  expect(exprs[0]).toContain('"method":"PUT"');
  expect(exprs[0]).toContain('"x-flag":"on"');
  expect(exprs[0]).toContain('"body":"{\\"b\\":2}"');
});

test('E aborts with a toast when the edited text cannot be parsed', async () => {
  const exprs: string[] = [];
  mock.respond('Runtime.evaluate', p => { exprs.push(p.expression); return { result: {} }; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'not a request line\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/orig');
  await waitForFrame(lastFrame, 'orig');
  stdin.write('E');
  await waitForFrame(lastFrame, '요청 파싱 실패');
  expect(exprs).toHaveLength(0);
});

test('E skips the resend with a toast when the editor exits without changes', async () => {
  const exprs: string[] = [];
  mock.respond('Runtime.evaluate', p => { exprs.push(p.expression); return { result: {} }; });
  const { lastFrame, stdin } = renderApp({ editRunner: async () => {} });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/orig');
  await waitForFrame(lastFrame, 'orig');
  stdin.write('E');
  await waitForFrame(lastFrame, '변경 없음 · 전송 안 함');
  expect(exprs).toHaveLength(0);
});

test('O opens the editor prefilled from the entry and activates an override rule', async () => {
  const enables: any[] = [];
  mock.respond('Fetch.enable', p => { enables.push(p); return {}; });
  let seen = '';
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { readFile, writeFile } = await import('node:fs/promises');
      seen = await readFile(file, 'utf8');
      await writeFile(file, 'PATTERN https://a.test/api/ov-target*\nSTATUS 503\ncontent-type: application/json\n\n{"mocked":true}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ovr1', 'https://a.test/api/ov-target');
  await waitForFrame(lastFrame, 'ov-target');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  expect(seen).toContain('PATTERN https://a.test/api/ov-target');
  expect(seen).toContain('STATUS 200');
  expect(enables).toEqual([{ patterns: [{ urlPattern: 'https://a.test/api/ov-target*', requestStage: 'Response' }] }]);
  expect(lastFrame()).toContain('override:1');
});

test('O aborts with a toast when the override rule cannot be parsed', async () => {
  const enables: any[] = [];
  mock.respond('Fetch.enable', p => { enables.push(p); return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'not an override rule\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ovb1', 'https://a.test/api/ov-broken');
  await waitForFrame(lastFrame, 'ov-broken');
  stdin.write('O');
  await waitForFrame(lastFrame, '규칙 파싱 실패');
  expect(enables).toHaveLength(0);
  expect(lastFrame()).not.toContain('override:');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '오버라이드 규칙 없음');
});

test('Ctrl+O manager toggles rules with space and deletes with d', async () => {
  const fetchCalls: string[] = [];
  mock.respond('Fetch.enable', () => { fetchCalls.push('enable'); return {}; });
  mock.respond('Fetch.disable', () => { fetchCalls.push('disable'); return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'PATTERN https://a.test/api/ov-managed*\nSTATUS 200\n\n{"m":1}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ovm1', 'https://a.test/api/ov-managed');
  await waitForFrame(lastFrame, 'ov-managed');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '오버라이드 규칙');
  expect(lastFrame()).toContain('200 · on');
  stdin.write(' ');
  await waitForFrame(lastFrame, '200 · off');
  expect(lastFrame()).not.toContain('override:1');
  await vi.waitFor(() => expect(fetchCalls).toEqual(['enable', 'disable']));
  stdin.write(' ');
  await waitForFrame(lastFrame, '200 · on');
  await vi.waitFor(() => expect(fetchCalls).toEqual(['enable', 'disable', 'enable']));
  stdin.write('d');
  await vi.waitFor(() => {
    expect(lastFrame()).not.toContain('오버라이드 규칙');
    expect(fetchCalls).toEqual(['enable', 'disable', 'enable', 'disable']);
  });
  expect(lastFrame()).not.toContain('override:');
});

test('active override rules are re-applied after a reconnect', async () => {
  let enables = 0;
  mock.respond('Fetch.enable', () => { enables++; return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'PATTERN https://a.test/api/ov-reapply*\nSTATUS 200\n\n{"r":1}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ovc1', 'https://a.test/api/ov-reapply');
  await waitForFrame(lastFrame, 'ov-reapply');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  expect(enables).toBe(1);
  mock.dropConnections();
  await waitForFrame(lastFrame, '재연결됨', 5000);
  await waitUntil(() => enables === 2);
  expect(enables).toBe(2);
  expect(lastFrame()).toContain('override:1');
});

test('O leaves no rule and toasts when the editor exits without changes', async () => {
  const enables: any[] = [];
  mock.respond('Fetch.enable', p => { enables.push(p); return {}; });
  const { lastFrame, stdin } = renderApp({ editRunner: async () => {} });
  await attach(lastFrame, stdin);
  feedNet('ovn1', 'https://a.test/api/ov-nochange');
  await waitForFrame(lastFrame, 'ov-nochange');
  stdin.write('O');
  await waitForFrame(lastFrame, '변경 없음 · 규칙 미생성');
  expect(enables).toHaveLength(0);
  expect(lastFrame()).not.toContain('override:');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '오버라이드 규칙 없음');
});

test('Ctrl+O manager enter re-edits the selected rule in place', async () => {
  const enables: any[] = [];
  mock.respond('Fetch.enable', p => { enables.push(p); return {}; });
  mock.respond('Fetch.disable', () => ({}));
  let calls = 0;
  let reopened = '';
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { readFile, writeFile } = await import('node:fs/promises');
      calls++;
      if (calls === 1) {
        await writeFile(file, 'PATTERN https://a.test/api/ov-edit*\nSTATUS 200\nx-mock: a\n\n{"v":1}\n');
      } else {
        reopened = await readFile(file, 'utf8');
        await writeFile(file, 'PATTERN https://a.test/api/ov-edited*\nSTATUS 503\n\n{"v":2}\n');
      }
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ove1', 'https://a.test/api/ov-edit');
  await waitForFrame(lastFrame, 'ov-edit');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '오버라이드 규칙');
  stdin.write('\r');
  await waitForFrame(lastFrame, '규칙 수정됨');
  await vi.waitFor(() => expect(enables).toHaveLength(2));
  expect(reopened).toContain('PATTERN https://a.test/api/ov-edit*');
  expect(reopened).toContain('STATUS 200');
  expect(reopened).toContain('x-mock: a');
  expect(reopened).toContain('{"v":1}');
  expect(lastFrame()).toContain('ov-edited');
  expect(lastFrame()).toContain('503 · on');
  expect(enables[1]).toEqual({ patterns: [{ urlPattern: 'https://a.test/api/ov-edited*', requestStage: 'Response' }] });
  expect(lastFrame()).toContain('override:1');
});

test('Ctrl+O manager re-edit keeps a disabled rule off', async () => {
  const enables: any[] = [];
  mock.respond('Fetch.enable', p => { enables.push(p); return {}; });
  mock.respond('Fetch.disable', () => ({}));
  let calls = 0;
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      calls++;
      if (calls === 1) await writeFile(file, 'PATTERN https://a.test/api/ov-off*\nSTATUS 200\n\n{"v":1}\n');
      else await writeFile(file, 'PATTERN https://a.test/api/ov-off*\nSTATUS 503\n\n{"v":2}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ovo1', 'https://a.test/api/ov-off');
  await waitForFrame(lastFrame, 'ov-off');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '200 · on');
  stdin.write(' ');
  await waitForFrame(lastFrame, '200 · off');
  stdin.write('\r');
  await waitForFrame(lastFrame, '규칙 수정됨');
  expect(lastFrame()).toContain('503 · off');
  expect(enables).toHaveLength(1);
  expect(lastFrame()).not.toContain('override:1');
});

test('Ctrl+O manager re-edit exiting without changes leaves the rule alone', async () => {
  const enables: any[] = [];
  mock.respond('Fetch.enable', p => { enables.push(p); return {}; });
  let calls = 0;
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      calls++;
      if (calls === 1) await writeFile(file, 'PATTERN https://a.test/api/ov-same*\nSTATUS 200\n\n{"v":1}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('ovs1', 'https://a.test/api/ov-same');
  await waitForFrame(lastFrame, 'ov-same');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '오버라이드 규칙');
  stdin.write('\r');
  await waitUntil(() => calls === 2);
  expect(calls).toBe(2);
  expect(lastFrame()).not.toContain('규칙 수정됨');
  expect(lastFrame()).toContain('200 · on');
  expect(enables).toHaveLength(1);
});

test('override manager shows a long pattern un-truncated at a wide terminal', async () => {
  const longUrl = 'https://api.example.test/very/long/path/that/would/not/fit/in/the/old/narrow/picker/resource';
  mock.respond('Fetch.enable', () => ({}));
  const { lastFrame, stdin } = renderAppSized(150, 30, {
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, `PATTERN ${longUrl}\nSTATUS 200\n\n{"v":1}\n`);
    },
  });
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'z 구간');
  feedNet('ovw1', 'https://a.test/api/ov-wide');
  await waitForFrame(lastFrame, 'ov-wide');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write('\x0f');
  await waitForFrame(lastFrame, '오버라이드 규칙');
  const row = lastFrame()!.split('\n').find(l => l.includes('very/long'))!;
  expect(row).toContain(longUrl);
  expect(row).not.toContain('…');
});

test('B chooser blocks the exact URL via Network.setBlockedURLs', async () => {
  const calls: string[][] = [];
  mock.respond('Network.setBlockedURLs', p => { calls.push(p.urls); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('bl1', 'https://a.test/api/block-me');
  await waitForFrame(lastFrame, 'block-me');
  stdin.write('B');
  await waitForFrame(lastFrame, '요청 차단');
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  expect(calls).toEqual([['https://a.test/api/block-me']]);
  expect(lastFrame()).toContain('block:1');
});

test('B chooser domain option blocks the whole hostname', async () => {
  const calls: string[][] = [];
  mock.respond('Network.setBlockedURLs', p => { calls.push(p.urls); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('bld1', 'https://a.test/api/block-domain');
  await waitForFrame(lastFrame, 'block-domain');
  stdin.write('B');
  await waitForFrame(lastFrame, '도메인 차단');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  expect(calls).toEqual([['*://a.test/*']]);
  expect(lastFrame()).toContain('block:1');
});

test('Ctrl+B manager toggles patterns with space and deletes with d', async () => {
  const calls: string[][] = [];
  mock.respond('Network.setBlockedURLs', p => { calls.push(p.urls); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('blm1', 'https://a.test/api/block-managed');
  await waitForFrame(lastFrame, 'block-managed');
  stdin.write('B');
  await waitForFrame(lastFrame, '요청 차단');
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  stdin.write('\x02');
  await waitForFrame(lastFrame, '차단 목록');
  stdin.write(' ');
  await waitForFrame(lastFrame, 'off');
  expect(calls.at(-1)).toEqual([]);
  expect(lastFrame()).not.toContain('block:1');
  stdin.write(' ');
  await waitUntil(() => !!calls.at(-1)?.includes('https://a.test/api/block-managed'));
  expect(calls.at(-1)).toEqual(['https://a.test/api/block-managed']);
  stdin.write('d');
  await waitUntil(() => calls.at(-1)?.length === 0);
  expect(lastFrame()).not.toContain('차단 목록');
  expect(lastFrame()).not.toContain('block:');
  expect(calls.at(-1)).toEqual([]);
});

test('Ctrl+B manager enter still toggles a pattern', async () => {
  const calls: string[][] = [];
  mock.respond('Network.setBlockedURLs', p => { calls.push(p.urls); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('ble1', 'https://a.test/api/block-enter');
  await waitForFrame(lastFrame, 'block-enter');
  stdin.write('B');
  await waitForFrame(lastFrame, '요청 차단');
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  stdin.write('\x02');
  await waitForFrame(lastFrame, '차단 목록');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'off');
  expect(calls.at(-1)).toEqual([]);
  stdin.write('\r');
  await waitUntil(() => !!calls.at(-1)?.includes('https://a.test/api/block-enter'));
  expect(calls.at(-1)).toEqual(['https://a.test/api/block-enter']);
  expect(lastFrame()).toContain('차단 목록');
});

test('Ctrl+B with no patterns shows a toast instead of the manager', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('\x02');
  await waitForFrame(lastFrame, '차단 패턴 없음');
  expect(lastFrame()).not.toContain('차단 목록');
});

test('block patterns stay per-session and switching sends no CDP traffic', async () => {
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const calls: string[][] = [];
  mock.respond('Network.setBlockedURLs', p => { calls.push(p.urls); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('blr1', 'https://a.test/api/block-reapply');
  await waitForFrame(lastFrame, 'block-reapply');
  stdin.write('B');
  await waitForFrame(lastFrame, '요청 차단');
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  expect(calls).toEqual([['https://a.test/api/block-reapply']]);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  await sleep(120);
  expect(calls).toEqual([['https://a.test/api/block-reapply']]);
  expect(lastFrame()).not.toContain('block:1');
  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  expect(lastFrame()).toContain('block:1');
  expect(calls).toEqual([['https://a.test/api/block-reapply']]);
  mock.pages.pop();
});

test('y inside the detail overlay copies the current tab text', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/copy-tab');
  await waitForFrame(lastFrame, 'copy-tab');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('y');
  await waitForFrame(lastFrame, '복사됨');
  expect(copied).toContain('▍ overview');
  expect(copied).toContain('status');
  stdin.write('3');
  await sleep(40);
  stdin.write('y');
  await waitUntil(() => copied.includes('▍ headers'));
  expect(copied).toContain('▍ headers');
});

test('e inside the detail overlay opens the tab text in the editor for viewing', async () => {
  let seen = '';
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { readFile } = await import('node:fs/promises');
      seen = await readFile(file, 'utf8');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/view-tab');
  await waitForFrame(lastFrame, 'view-tab');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('e');
  await waitUntil(() => seen.includes('▍ overview'));
  expect(seen).toContain('▍ overview');
  expect(seen).toContain('status');
  expect(lastFrame()).toContain('Summary');
});

test('help overlay toggles with ?', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('?');
  await waitForFrame(lastFrame, 'Keys');
  expect(lastFrame()).toContain('── Network');
  stdin.write(ESC);
  await sleep(50);
  expect(lastFrame()).not.toContain('Keys');
});

test('help puts the active tool section first, 전역 second', async () => {
  const { lastFrame, stdin } = renderAppTall(40);
  await sleep(50);
  stdin.write('2');
  await sleep(40);
  stdin.write('?');
  await waitForFrame(lastFrame, 'Keys');
  const frame = lastFrame()!;
  expect(frame).toContain('── Console');
  expect(frame).toContain('── 전역');
  expect(frame.indexOf('── Console')).toBeLessThan(frame.indexOf('── 전역'));
  expect(frame).toContain('스택 트레이스 펼치기 / 접기');
});

test('help overlay lists the network keys with current semantics', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('?');
  await waitForFrame(lastFrame, 'Keys');
  const frame = lastFrame()!;
  expect(frame).toContain('타입 필터 픽커');
  expect(frame).toContain('픽 토글');
  expect(frame).toContain('스로틀 순환');
});

test('help scrolls: G reveals the last binding and gg returns to the top', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('?');
  await waitForFrame(lastFrame, 'Keys');
  const top = lastFrame()!;
  expect(top).toContain('더 있음');
  expect(top).not.toContain('구간 적용');
  stdin.write('G');
  await waitForFrame(lastFrame, '인쇄 미디어 에뮬레이션 토글');
  const bottom = lastFrame()!;
  expect(bottom).toContain('인쇄 미디어 에뮬레이션 토글');
  expect(bottom).not.toContain('더 있음');
  stdin.write('gg');
  await waitForFrame(lastFrame, '요청 상세 열기');
  expect(lastFrame()).toContain('더 있음');
});

test('help scrolls by line with j and stays open', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('?');
  await waitForFrame(lastFrame, 'Keys');
  expect(lastFrame()).toContain('요청 상세 열기');
  stdin.write('j');
  await sleep(40);
  const frame = lastFrame()!;
  expect(frame).toContain('Keys');
  expect(frame).not.toContain('── Network');
});

test('the peek overlay is on by default and K toggles it off then back on', async () => {
  const { lastFrame, stdin } = renderAppTall(30);
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/peek-me');
  await waitForFrame(lastFrame, 'peek-me');
  expect(lastFrame()).toContain('200 OK');
  stdin.write('K');
  await sleep(60);
  expect(lastFrame()).not.toContain('200 OK');
  stdin.write('K');
  await waitForFrame(lastFrame, '200 OK');
});

test('reconnects after the connection drops', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.dropConnections();
  await sleep(400);
  feedNet('r9', 'https://a.test/after-reconnect');
  await waitForFrame(lastFrame, 'after-reconnect');
  expect(lastFrame()).toContain('after-reconnect');
});

test('picker switching tabs attaches without a spurious reconnect', async () => {
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  await sleep(400);
  const frame = lastFrame()!;
  expect(frame).toContain('◉ Second Page');
  expect(frame).not.toContain('재연결 중');
  expect(frame).not.toContain('재연결됨');
  mock.pages.pop();
});

test('a new tab appearing while attached shows a move-to toast', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.pages.push({ id: 'page2', title: 'Fresh Tab', url: 'https://fresh.test/' });
  await tabs.refresh();
  await waitForFrame(lastFrame, '새 탭: Fresh Tab — b로 이동');
  mock.pages.pop();
});

test('killing the current tab finalizes its session and falls back to the previous one', async () => {
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('kb1', 'https://a.test/api/keep-me');
  await waitForFrame(lastFrame, 'keep-me');
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  mock.pages.pop();
  mock.dropConnections('page2');
  await waitForFrame(lastFrame, '"Second Page" 탭 닫힘');
  expect(lastFrame()).toContain('◉ Mock Page');
  expect(lastFrame()).toContain('keep-me');
});

test('the picker shows a section per endpoint and attaches with that endpoint', async () => {
  const mock2 = await MockCdp.start();
  mock2.pages = [{ id: 'c1', title: 'Comet Page', url: 'https://comet.test/' }];
  const ep1: Endpoint = { host: '127.0.0.1', port: mock.port, browser: 'Chrome' };
  const ep2: Endpoint = { host: '127.0.0.1', port: mock2.port, browser: 'Comet' };
  const multi = new MultiTabs([ep1, ep2]);
  await multi.refresh();
  const spy = vi.fn((t: PageTarget, _e: Endpoint) => DebugSession.attach(t, { persist: false }));
  const { lastFrame, stdin } = render(
    <App ep={ep1} tabs={multi} attach={spy} reconnectBaseMs={10} />,
  );
  try {
    await sleep(50);
    stdin.write('b');
    await waitForFrame(lastFrame, 'Comet Page');
    const frame = lastFrame()!;
    expect(frame).toContain('Chrome');
    expect(frame).toContain('Comet');
    stdin.write('j');
    await sleep(40);
    stdin.write('\r');
    await waitForFrame(lastFrame, '◉ Comet Page');
    const call = spy.mock.calls.find(c => c[0].id === 'c1');
    expect(call).toBeTruthy();
    expect(call![1].port).toBe(mock2.port);
  } finally {
    multi.stop();
    await mock2.close();
  }
});

test('reconnect works with the default attach path', async () => {
  const prevXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-xdg-'));
  try {
    const { lastFrame, stdin } = render(<App ep={ep()} tabs={tabs} reconnectBaseMs={10} />);
    await attach(lastFrame, stdin);
    mock.dropConnections();
    await sleep(500);
    feedNet('r9', 'https://a.test/default-reconnect');
    await waitForFrame(lastFrame, 'default-reconnect');
    expect(lastFrame()).not.toContain('reconnecting');
    stdin.write('q');
    await sleep(200);
  } finally {
    process.env.XDG_DATA_HOME = prevXdg;
  }
});

test('burst key chunks are handled per character', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  for (let i = 0; i < 3; i++) feedNet(`b${i}`, `https://a.test/burst${i}`);
  await waitForFrame(lastFrame, 'burst2');
  stdin.write('jj');
  await sleep(50);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/burst2');
});

test('gg jumps to the top and G jumps to the bottom of the network list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  for (let i = 0; i < 4; i++) feedNet(`g${i}`, `https://a.test/row${i}`);
  await waitForFrame(lastFrame, 'row3');
  stdin.write('G');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/row3');
  stdin.write(ESC);
  await sleep(40);
  stdin.write('gg');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/row0');
});

test('Ctrl-d and Ctrl-u page through the network list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  for (let i = 0; i < 20; i++) feedNet(`p${i}`, `https://a.test/page${i}`);
  await waitForFrame(lastFrame, 'page19');
  await sleep(150);
  stdin.write('k');
  await sleep(40);
  stdin.write(CTRL_U);
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  const afterUp = lastFrame()!;
  expect(afterUp).toContain('Summary');
  expect(afterUp).toContain('a.test/page12');
  expect(afterUp).not.toContain('a.test/page19');
  stdin.write(ESC);
  await sleep(40);
  stdin.write(CTRL_D);
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/page18');
});

test('the Storage tool loads cookies on entry', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [{ name: 'sid', value: 'abc', domain: 'mock.test', path: '/', expires: -1, httpOnly: false, secure: false }] }));
  mock.respond('DOMStorage.enable', () => ({}));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [['k', 'v']] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'sid = abc');
  expect(lastFrame()).toContain('Storage');
});

test('the Storage tool cycles views with h/l', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [{ name: 'sid', value: 'abc', domain: 'mock.test', path: '/', expires: -1, httpOnly: false, secure: false }] }));
  mock.respond('DOMStorage.enable', () => ({}));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [['lk', 'lv']] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'sid = abc');
  stdin.write('l');
  await waitForFrame(lastFrame, 'lk = lv');
  expect(lastFrame()).toContain('Storage');
});

test('editing a cookie targets the selected row when names collide', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [
    { name: 'dup', value: 'one', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: false },
    { name: 'dup', value: 'two', domain: 'b.test', path: '/', expires: -1, httpOnly: false, secure: false },
  ] }));
  mock.respond('DOMStorage.enable', () => ({}));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  let seen: any;
  mock.respond('Network.setCookie', p => { seen = p; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'dup = one');
  stdin.write('j');
  await sleep(50);
  stdin.write('e');
  await sleep(50);
  stdin.write('X');
  await sleep(50);
  stdin.write('\r');
  await waitUntil(() => seen !== undefined);
  expect(seen).toBeTruthy();
  expect(seen.name).toBe('dup');
  expect(seen.domain).toBe('b.test');
  expect(seen.value).toBe('twoX');
});

test('the Storage tool creates a new local storage item with n', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
  mock.respond('DOMStorage.enable', () => ({}));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  let setItem: any;
  mock.respond('DOMStorage.setDOMStorageItem', p => { setItem = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'Storage');
  stdin.write('l');
  await sleep(60);
  stdin.write('n');
  await sleep(50);
  stdin.write('greeting=hi');
  await sleep(50);
  stdin.write('\r');
  await waitUntil(() => setItem !== undefined);
  expect(setItem).toBeTruthy();
  expect(setItem.key).toBe('greeting');
  expect(setItem.value).toBe('hi');
});

test('S captures a snapshot, copies the full path, and toasts the abbreviated one', async () => {
  let captured = false;
  let copied = '';
  const { lastFrame, stdin } = renderApp({
    snapshot: async () => { captured = true; return '/tmp/snap-xyz'; },
    clipboard: async t => { copied = t; },
  });
  await attach(lastFrame, stdin);
  stdin.write('S');
  await waitForFrame(lastFrame, '스냅샷 저장됨 · 경로 복사됨 · /tmp/snap-xyz');
  expect(captured).toBe(true);
  expect(copied).toBe('/tmp/snap-xyz');
});

test('S falls back to the plain saved toast when the clipboard fails', async () => {
  const { lastFrame, stdin } = renderApp({
    snapshot: async () => '/tmp/snap-xyz',
    clipboard: async () => { throw new Error('no clipboard'); },
  });
  await attach(lastFrame, stdin);
  stdin.write('S');
  await waitForFrame(lastFrame, '스냅샷 저장됨: /tmp/snap-xyz');
  expect(lastFrame()).not.toContain('경로 복사됨');
});

test('H exports the session HAR, copies the full path, and toasts the abbreviated one', async () => {
  let exported = false;
  let copied = '';
  const file = join(homedir(), '.local/share/devtools-tui/har/session-2026-07-17-093015-abcdef.har');
  const { lastFrame, stdin } = renderApp({
    exportHar: async () => { exported = true; return file; },
    clipboard: async t => { copied = t; },
  });
  await attach(lastFrame, stdin);
  stdin.write('H');
  await waitForFrame(lastFrame, 'HAR 저장됨 · 경로 복사됨');
  expect(exported).toBe(true);
  expect(copied).toBe(file);
  const toast = stripAnsi(lastFrame()!);
  expect(toast).toContain('~/');
  expect(toast).toContain('…');
  expect(toast).toContain('session-2026-07-17-093015-abcdef.har');
});

test('H falls back to the plain saved toast when the clipboard fails', async () => {
  const { lastFrame, stdin } = renderApp({
    exportHar: async () => '/tmp/session-xyz.har',
    clipboard: async () => { throw new Error('no clipboard'); },
  });
  await attach(lastFrame, stdin);
  stdin.write('H');
  await waitForFrame(lastFrame, 'HAR 저장됨: /tmp/session-xyz.har');
  expect(lastFrame()).not.toContain('경로 복사됨');
});

test('H writes a sanitized HAR file under the data dir by default', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'r1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/api/har-me', method: 'GET', headers: { Authorization: 'Bearer tok' } },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'r1', timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'r1', timestamp: 1.2, encodedDataLength: 10 });
  await waitForFrame(lastFrame, 'har-me');
  stdin.write('H');
  await waitForFrame(lastFrame, 'HAR 저장됨');
  const dir = join(process.env.XDG_DATA_HOME!, 'devtools-tui', 'har');
  const files = readdirSync(dir);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.har$/);
  const har = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
  expect(har.log.entries).toHaveLength(1);
  expect(har.log.entries[0].request.url).toBe('https://a.test/api/har-me');
  expect(har.log.entries[0].request.headers).toContainEqual({ name: 'Authorization', value: '[redacted]' });
});

test('Y masks sensitive headers when copyRedact is on', async () => {
  saveConfig({ copyRedact: true });
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'r1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/api/auth-me', method: 'GET', headers: { Authorization: 'Bearer tok' } },
  });
  await waitForFrame(lastFrame, 'auth-me');
  stdin.write('Y');
  await waitUntil(() => copied.includes("-H 'Authorization: [redacted]'"));
  expect(copied).toContain("-H 'Authorization: [redacted]'");
  expect(copied).not.toContain('Bearer tok');
});

test('w cycles the network time window label', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('w');
  await waitForFrame(lastFrame, 'window:30s');
});

test('x opens the type picker and applies a multi-type filter', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('t1', 'https://a.test/api/one', { type: 'XHR' });
  feedReq('t2', 'https://a.test/app.js', { type: 'Script' });
  feedReq('t3', 'https://a.test/pic.png', { type: 'Image' });
  await waitForFrame(lastFrame, 'pic.png');
  stdin.write('x');
  await waitForFrame(lastFrame, '타입 필터');
  expect(lastFrame()).toContain('모두');
  stdin.write('j');
  await sleep(30);
  stdin.write(' ');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write(' ');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[xhr,js]');
  const frame = lastFrame()!;
  expect(frame).toContain('one');
  expect(frame).toContain('app.js');
  expect(frame).not.toContain('pic.png');
});

test('the type picker Esc cancels without changing the filter', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('t1', 'https://a.test/api/one');
  await waitForFrame(lastFrame, 'one');
  stdin.write('x');
  await waitForFrame(lastFrame, '타입 필터');
  stdin.write(ESC);
  await sleep(50);
  const frame = lastFrame()!;
  expect(frame).not.toContain('타입 필터');
  expect(frame).not.toContain('[xhr');
  expect(frame).toContain('one');
});

test('the type picker offers doc, font and other and applies the doc filter', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('t1', 'https://a.test/index.html', { type: 'Document' });
  feedReq('t2', 'https://a.test/face.woff2', { type: 'Font' });
  feedReq('t3', 'https://a.test/api/one', { type: 'XHR' });
  await waitForFrame(lastFrame, 'one');
  stdin.write('x');
  await waitForFrame(lastFrame, '타입 필터');
  const picker = lastFrame()!;
  expect(picker).toContain('doc');
  expect(picker).toContain('font');
  expect(picker).toContain('기타(other)');
  for (let i = 0; i < 6; i++) {
    stdin.write('j');
    await sleep(20);
  }
  stdin.write(' ');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[doc]');
  const frame = lastFrame()!;
  expect(frame).toContain('index.html');
  expect(frame).not.toContain('face.woff2');
  expect(frame).not.toContain('api/one');
});

test('s sorts by size, shows badge and header arrow, and re-picking toggles direction', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('a', 'https://a.test/big', { bytes: 3000 });
  feedReq('b', 'https://a.test/small', { bytes: 100 });
  feedReq('c', 'https://a.test/mid', { bytes: 2000 });
  await waitForFrame(lastFrame, 'mid');
  stdin.write('s');
  await waitForFrame(lastFrame, '정렬');
  expect(lastFrame()).toContain('기본(도착순)');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'sort:size↑');
  let frame = lastFrame()!;
  expect(frame).toContain('Size↑');
  expect(frame.indexOf('small')).toBeLessThan(frame.indexOf('mid'));
  expect(frame.indexOf('mid')).toBeLessThan(frame.indexOf('big'));
  stdin.write('s');
  await waitForFrame(lastFrame, '정렬');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'sort:size↓');
  frame = lastFrame()!;
  expect(frame.indexOf('big')).toBeLessThan(frame.indexOf('mid'));
  expect(frame.indexOf('mid')).toBeLessThan(frame.indexOf('small'));
});

test('a non-default sort pins the selected request while new entries stream in', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('a', 'https://a.test/big', { bytes: 3000 });
  feedReq('b', 'https://a.test/small', { bytes: 100 });
  feedReq('c', 'https://a.test/mid', { bytes: 2000 });
  await waitForFrame(lastFrame, 'mid');
  stdin.write('s');
  await waitForFrame(lastFrame, '정렬');
  stdin.write('jj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'sort:size↑');
  feedReq('d', 'https://a.test/tiny', { bytes: 5 });
  await waitForFrame(lastFrame, 'tiny');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/mid');
});

test('picking 기본 restores arrival order and tail-follow', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('a', 'https://a.test/big', { bytes: 3000 });
  feedReq('b', 'https://a.test/small', { bytes: 100 });
  await waitForFrame(lastFrame, 'small');
  stdin.write('s');
  await waitForFrame(lastFrame, '정렬');
  stdin.write('jj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'sort:size↑');
  stdin.write('s');
  await waitForFrame(lastFrame, '정렬');
  stdin.write('k');
  await sleep(30);
  stdin.write('k');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  expect(lastFrame()).not.toContain('sort:size');
  feedReq('c', 'https://a.test/fresh', { bytes: 1 });
  await waitForFrame(lastFrame, 'fresh');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/fresh');
});

test('moving up off the tail pins the selection and G resumes following', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  for (let i = 0; i < 3; i++) feedNet(`s${i}`, `https://a.test/stream${i}`);
  await waitForFrame(lastFrame, 'stream2');
  stdin.write('k');
  await sleep(50);
  for (let i = 3; i < 16; i++) feedNet(`s${i}`, `https://a.test/stream${i}`);
  await waitForFrame(lastFrame, '16건');
  expect(lastFrame()).not.toContain('stream15');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/stream1');
  stdin.write(ESC);
  await sleep(50);
  stdin.write('G');
  await sleep(50);
  feedNet('s16', 'https://a.test/stream16');
  await waitForFrame(lastFrame, 'stream16');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/stream16');
});

test('a pinned selection stays highlighted and visible while entries stream in', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  for (let i = 0; i < 10; i++) feedNet(`v${i}`, `https://a.test/vis${i}`);
  await waitForFrame(lastFrame, 'vis9');
  stdin.write('k');
  await sleep(40);
  stdin.write('k');
  await sleep(40);
  for (let i = 10; i < 20; i++) feedNet(`v${i}`, `https://a.test/vis${i}`);
  await sleep(200);
  const line = lastFrame()!.split('\n').find(l => l.includes('vis7'));
  expect(line).toBeTruthy();
  expect(line!.startsWith('▌')).toBe(true);
});

test('a pinned selection degrades to a clamped index when its entry leaves the list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('a', 'https://a.test/big');
  feedReq('b', 'https://a.test/small');
  feedReq('c', 'https://a.test/mid');
  await waitForFrame(lastFrame, 'mid');
  stdin.write('k');
  await sleep(50);
  stdin.write('/');
  await sleep(30);
  stdin.write('big');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/big');
});

test('c opens the column picker, toggles the method column, and persists to config', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('m1', 'https://a.test/api/one');
  await waitForFrame(lastFrame, 'one');
  expect(lastFrame()).not.toContain('Meth');
  stdin.write('c');
  await waitForFrame(lastFrame, '컬럼');
  expect(lastFrame()).toContain('set-cookies');
  stdin.write('j');
  await sleep(30);
  stdin.write(' ');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Meth');
  expect(lastFrame()).toContain('GET');
  expect(loadConfig().networkColumns).toEqual(['status', 'method', 'type', 'time', 'size', 'waterfall', 'name']);
});

test('c toggles the optional protocol column on and renders it', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'p1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/api/one', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'p1', timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {}, protocol: 'h2' },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'p1', timestamp: 1.2, encodedDataLength: 10 });
  await waitForFrame(lastFrame, 'one');
  expect(lastFrame()).not.toContain('Proto');
  stdin.write('c');
  await waitForFrame(lastFrame, '컬럼');
  expect(lastFrame()).toContain('protocol');
  for (let i = 0; i < 7; i++) {
    stdin.write('j');
    await sleep(15);
  }
  stdin.write(' ');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Proto');
  expect(lastFrame()).toContain('h2');
  expect(loadConfig().networkColumns).toContain('protocol');
});

test('configured networkColumns apply on startup', async () => {
  saveConfig({ networkColumns: ['status', 'method', 'url'] });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('m1', 'https://a.test/api/one');
  await waitForFrame(lastFrame, 'api/one');
  const frame = lastFrame()!;
  expect(frame).toContain('Meth');
  expect(frame).toContain('URL');
  expect(frame).toContain('https://a.test/api/one');
  expect(frame).not.toContain('Type');
});

test('r reloads without clearing the network or console log', async () => {
  const reloads: number[] = [];
  mock.respond('Page.reload', () => { reloads.push(1); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('rl1', 'https://a.test/api/persisted-req');
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'persisted-log' }] });
  await waitForFrame(lastFrame, 'persisted-req');
  expect(lastFrame()).toContain('1건');
  stdin.write('r');
  await waitForFrame(lastFrame, '새로고침됨');
  const frame = lastFrame()!;
  expect(frame).toContain('persisted-req');
  expect(frame).toContain('1건');
  expect(reloads).toHaveLength(1);
  stdin.write('2');
  await waitForFrame(lastFrame, 'persisted-log');
  expect(lastFrame()).toContain('persisted-log');
});

test('C clears the network log with a toast and leaves the console intact', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('cl1', 'https://a.test/api/wipe-me');
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'kept-log' }] });
  await waitForFrame(lastFrame, 'wipe-me');
  expect(lastFrame()).toContain('1건');
  stdin.write('C');
  await waitForFrame(lastFrame, '로그 지움');
  const frame = lastFrame()!;
  expect(frame).not.toContain('wipe-me');
  expect(frame).toContain('0건');
  stdin.write('2');
  await waitForFrame(lastFrame, 'kept-log');
  expect(lastFrame()).toContain('kept-log');
});

test('buildContext includes request block and session path', async () => {
  const [page] = await listPages(ep());
  const session = await DebugSession.attach(page, { persist: false });
  const ctx = buildContext(page, session, {
    id: 'r', url: 'https://a.test/sel', method: 'POST', type: 'XHR',
    requestHeaders: {}, responseHeaders: {}, startTs: 0, status: 201, durationMs: 88, body: '{"z":1}',
  });
  expect(ctx).toContain('POST https://a.test/sel');
  expect(ctx).toContain('status: 201');
  expect(ctx).toContain('{"z":1}');
  await session.close();
});

test('the Elements tool shows a placeholder until a tab is attached', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('3');
  await waitForFrame(lastFrame, '연결된 탭 없음');
  expect(lastFrame()).toContain('Elements');
});

test('the Elements tool resolves a searched node and shows its detail', async () => {
  respondDomNode(() => TREE_DOC);
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: 'display', value: 'inline' }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  expect(lastFrame()).toContain('#9');
  expect(lastFrame()).toContain('display');
});

test('selecting an element publishes it as $0 via DOM.setInspectedNode', async () => {
  respondDomNode(() => TREE_DOC);
  const inspected: number[] = [];
  mock.respond('DOM.setInspectedNode', p => { inspected.push(p.nodeId); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  await waitUntil(() => inspected.includes(9));
  expect(inspected).toContain(9);
});

test('e edits outerHTML through the injected editor runner', async () => {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span>old</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
  let applied = '';
  mock.respond('DOM.setOuterHTML', p => { applied = p.outerHTML; return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '<span>new</span>');
    },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  stdin.write('e');
  await waitUntil(() => applied === '<span>new</span>');
  expect(applied).toBe('<span>new</span>');
});

test('e is re-entrancy guarded while the editor is in flight', async () => {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span>old</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
  mock.respond('DOM.setOuterHTML', () => ({}));
  let calls = 0;
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      calls++;
      await sleep(30);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '<span>new</span>');
    },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  stdin.write('e');
  stdin.write('e');
  await sleep(120);
  expect(calls).toBe(1);
});

test('reconnect while the Elements subview is open reloads the tree', async () => {
  respondDomNode(() => TREE_DOC);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  expect(lastFrame()).toContain('#9');
  mock.dropConnections();
  await waitForFrame(lastFrame, '/ 검색');
  expect(lastFrame()).not.toContain('#9');
});

test('comma opens the searchable settings panel', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(',');
  await waitForFrame(lastFrame, 'port');
  expect(lastFrame()).toContain('Settings');
});

test('c edits the selected CSS rule through the editor runner', async () => {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span class="x">hi</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 },
      cssProperties: [{ name: 'color', value: 'red' }],
    } } }],
  }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
  let applied = '';
  mock.respond('CSS.setStyleTexts', p => { applied = p.edits[0].text; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, 'color: blue'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('r');
  await sleep(40);
  stdin.write('c');
  await waitUntil(() => applied === 'color: blue');
  expect(applied).toBe('color: blue');
});

test('comma settings panel edits a value and saves it', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-set-'));
  try {
    const { lastFrame, stdin } = renderApp();
    await attach(lastFrame, stdin);
    stdin.write(',');
    await waitForFrame(lastFrame, 'port');
    for (let i = 0; i < 2; i++) { stdin.write('j'); await sleep(20); }
    stdin.write('\r');
    await waitForFrame(lastFrame, 'edit browserPaths');
    stdin.write('/opt/dtui/chrome');
    await sleep(20);
    stdin.write('\r');
    await sleep(80);
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();
    expect(Array.isArray(cfg.browserPaths) && cfg.browserPaths.length > 0).toBe(true);
  } finally {
    process.env.XDG_CONFIG_HOME = prevXdg;
  }
});

test('cycling the layout enum to split renders Network and Console stacked', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(',');
  await waitForFrame(lastFrame, 'port');
  for (let i = 0; i < 3; i++) { stdin.write('j'); await sleep(20); }
  stdin.write('l');
  await sleep(40);
  stdin.write('1');
  await waitForFrame(lastFrame, '콘솔 출력 없음');
  expect(lastFrame()).toContain('요청 없음');
});

test('the Elements tool renders the DOM tree and expands nodes with l', async () => {
  respondDomNode(() => TREE_DOC);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  expect(lastFrame()).toContain('body');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('l');
  await waitForFrame(lastFrame, 'span.x');
});

test('+ adds a CSS rule through the editor runner', async () => {
  respondDomNode(() => TREE_DOC);
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'f1' } } }));
  mock.respond('CSS.createStyleSheet', () => ({ styleSheetId: 's1' }));
  let ruleText = '';
  mock.respond('CSS.addRule', p => { ruleText = p.ruleText; return { rule: {} }; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, '.x { color: teal }'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('+');
  await waitUntil(() => ruleText === '.x { color: teal }');
  expect(ruleText).toBe('.x { color: teal }');
});

test('+ refreshes the subview by nodeId without re-querying', async () => {
  let queries = 0;
  respondDomNode(() => TREE_DOC);
  mock.respond('DOM.performSearch', () => { queries++; return { searchId: 's1', resultCount: 1 }; });
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'f1' } } }));
  mock.respond('CSS.createStyleSheet', () => ({ styleSheetId: 's1' }));
  let ruleText = '';
  mock.respond('CSS.addRule', p => { ruleText = p.ruleText; return { rule: {} }; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, '.x { color: teal }'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('+');
  await waitUntil(() => ruleText === '.x { color: teal }');
  expect(ruleText).toBe('.x { color: teal }');
  expect(queries).toBe(1);
  expect(lastFrame()).toContain('#9');
});

test('c refreshes the subview by nodeId without re-querying', async () => {
  let queries = 0;
  respondDomNode(() => TREE_DOC);
  mock.respond('DOM.performSearch', () => { queries++; return { searchId: 's1', resultCount: 1 }; });
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 },
      cssProperties: [{ name: 'color', value: 'red' }],
    } } }],
  }));
  let applied = '';
  mock.respond('CSS.setStyleTexts', p => { applied = p.edits[0].text; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, 'color: blue'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('r');
  await sleep(40);
  stdin.write('c');
  await waitUntil(() => applied === 'color: blue');
  expect(applied).toBe('color: blue');
  expect(queries).toBe(1);
  expect(lastFrame()).toContain('#9');
});

test('e edits the node then closes back to the refreshed tree', async () => {
  respondDomNode(() => TREE_DOC);
  let applied = '';
  mock.respond('DOM.setOuterHTML', p => { applied = p.outerHTML; return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, '<span class="x">new</span>'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('e');
  await waitForFrame(lastFrame, '트리 새로');
  expect(applied).toBe('<span class="x">new</span>');
  expect(lastFrame()).not.toContain('#9');
});

test('a DOM mutation re-fetches the tree', async () => {
  let treeFetches = 0;
  respondDomNode(() => TREE_DOC);
  mock.respond('DOM.getDocument', p => {
    if (p?.depth === 3) treeFetches++;
    return TREE_DOC;
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  expect(treeFetches).toBe(1);
  mock.emitEvent('DOM.childNodeInserted', { parentNodeId: 2, node: { nodeId: 99 } });
  const deadline = Date.now() + 1800;
  while (treeFetches < 2 && Date.now() < deadline) await sleep(50);
  expect(treeFetches).toBe(2);
});

test('the cursor auto-highlights and P pins the highlight, pausing tracking', async () => {
  respondDomNode(() => TREE_DOC);
  let highlighted = 0;
  mock.respond('Overlay.highlightNode', () => { highlighted++; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  const deadline = Date.now() + 2000;
  while (highlighted === 0 && Date.now() < deadline) await sleep(15);
  expect(highlighted).toBeGreaterThanOrEqual(1);
  stdin.write('P');
  await waitForFrame(lastFrame, 'highlight:on');
  await sleep(150);
  const pinned = highlighted;
  stdin.write('j');
  await sleep(250);
  expect(highlighted).toBe(pinned);
});

test('m watches DOM mutations and counts them', async () => {
  respondDomNode(() => TREE_DOC);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  stdin.write('m');
  await waitForFrame(lastFrame, 'watching (0)');
  mock.emitEvent('DOM.childNodeInserted', { parentNodeId: 2, node: { nodeId: 77 } });
  await waitForFrame(lastFrame, 'watching (1)');
});

test('Esc in Elements closes the subview then the search without leaving the tool', async () => {
  respondDomNode(() => TREE_DOC);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  expect(lastFrame()).toContain('#9');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '접기/펼치기');
  expect(lastFrame()).not.toContain('#9');
  expect(lastFrame()).toContain('접기/펼치기');
  stdin.write('/');
  await waitForFrame(lastFrame, 'esc 취소');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '접기/펼치기');
  expect(lastFrame()).toContain('접기/펼치기');
});

test('r selects a matched rule so a can append to it', async () => {
  respondDomNode(() => TREE_DOC);
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 },
      cssProperties: [{ name: 'color', value: 'red' }],
    } } }],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('r');
  await sleep(40);
  stdin.write('a');
  await waitForFrame(lastFrame, 'append:');
});

test('c surfaces a setStyleTexts failure as a dom error', async () => {
  respondDomNode(() => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 },
      cssProperties: [{ name: 'color', value: 'red' }],
    } } }],
  }));
  mock.respond('CSS.setStyleTexts', () => { throw new Error('stylesheet vanished'); });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, 'color: blue'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('r');
  await sleep(40);
  stdin.write('c');
  await waitForFrame(lastFrame, 'stylesheet vanished');
});

test('+ with unparseable editor text reports a parse error', async () => {
  respondDomNode(() => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'f1' } } }));
  mock.respond('CSS.createStyleSheet', () => ({ styleSheetId: 's1' }));
  let added = false;
  mock.respond('CSS.addRule', () => { added = true; return { rule: {} }; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, 'color: teal'); },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('+');
  await waitForFrame(lastFrame, 'could not parse rule: expected selector { declarations }');
  expect(added).toBe(false);
});

test('quit still runs while a re-attach is mid-close', async () => {
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const stopSpy = vi.spyOn(tabs, 'stop');
  let calls = 0;
  const attachFn = async (t: Parameters<typeof DebugSession.attach>[0]) => {
    calls++;
    if (calls > 1) await sleep(400);
    return DebugSession.attach(t, { persist: false });
  };
  const { lastFrame, stdin } = renderApp({ attach: attachFn });
  await attach(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await sleep(50);
  stdin.write('q');
  await waitUntil(() => stopSpy.mock.calls.length > 0);
  expect(stopSpy).toHaveBeenCalled();
  mock.pages.pop();
});

test('a disconnect while the editor is open does not repaint until it closes', async () => {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span>old</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
  let release: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '.x { }');
      await gate;
    },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  stdin.write('+');
  await sleep(60);
  const before = lastFrame();
  mock.dropConnections();
  await sleep(400);
  expect(lastFrame()).toBe(before);
  expect(lastFrame()).not.toContain('재연결');
  release();
  await waitForFrame(lastFrame, '재연결됨');
});

test('a toast expiring while the editor is open clears only after it closes', async () => {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span>old</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
  let release: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async () => {
      await gate;
    },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, 'span');
  expect(lastFrame()).toContain('연결됨:');
  stdin.write('+');
  await sleep(60);
  const before = lastFrame();
  await sleep(3200);
  expect(lastFrame()).toBe(before);
  expect(lastFrame()).toContain('연결됨:');
  release();
  await sleep(150);
  expect(lastFrame()).not.toContain('연결됨:');
}, 10000);

function respondEditableRule() {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span class="x">hi</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 },
      cssProperties: [{ name: 'color', value: 'red' }],
    } } }],
  }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
}

async function openDeclInput(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('r');
  await sleep(40);
  stdin.write('a');
  await waitForFrame(lastFrame, 'append:');
}

test('a opens the declaration input and Tab completes and cycles property names', async () => {
  respondEditableRule();
  const { lastFrame, stdin } = renderApp();
  await openDeclInput(lastFrame, stdin);
  stdin.write('col');
  await sleep(30);
  stdin.write('\t');
  await waitForFrame(lastFrame, 'append: color▌');
  expect(lastFrame()).toContain('append: color▌');
  stdin.write('\t');
  await waitForFrame(lastFrame, 'append: column-count▌');
  expect(lastFrame()).toContain('append: column-count▌');
  stdin.write('\t');
  await sleep(30);
  stdin.write('\t');
  await sleep(30);
  stdin.write('\t');
  await waitForFrame(lastFrame, 'append: color▌');
  expect(lastFrame()).toContain('append: color▌');
});

test('Tab with no matching property is a no-op', async () => {
  respondEditableRule();
  const { lastFrame, stdin } = renderApp();
  await openDeclInput(lastFrame, stdin);
  stdin.write('zzz');
  await sleep(30);
  stdin.write('\t');
  await waitForFrame(lastFrame, 'append: zzz▌');
  expect(lastFrame()).toContain('append: zzz▌');
});

test('Enter appends the declaration to the authored cssText via setStyleTexts', async () => {
  respondEditableRule();
  let applied = '';
  mock.respond('CSS.setStyleTexts', p => { applied = p.edits[0].text; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await openDeclInput(lastFrame, stdin);
  stdin.write('col');
  await sleep(30);
  stdin.write('\t');
  await sleep(30);
  stdin.write(': blue');
  await sleep(30);
  stdin.write('\r');
  await waitUntil(() => applied === 'color: red; color: blue');
  expect(applied).toBe('color: red; color: blue');
  const frame = lastFrame()!;
  expect(frame).not.toContain('append:');
  expect(frame).toContain('#9');
});

test('Esc cancels the declaration input without touching the rule', async () => {
  respondEditableRule();
  let calls = 0;
  mock.respond('CSS.setStyleTexts', () => { calls++; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await openDeclInput(lastFrame, stdin);
  stdin.write('color: blue');
  await sleep(30);
  stdin.write(ESC);
  await sleep(60);
  const frame = lastFrame()!;
  expect(calls).toBe(0);
  expect(frame).not.toContain('append:');
  expect(frame).toContain('selector:');
  expect(frame).toContain('#9');
});

test('a on a read-only rule shows the read-only message', async () => {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span class="x">hi</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: 'span' }, origin: 'user-agent', style: {
      cssProperties: [{ name: 'display', value: 'inline' }],
    } } }],
  }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('r');
  await sleep(40);
  stdin.write('a');
  await waitForFrame(lastFrame, 'rule is read-only');
  expect(lastFrame()).not.toContain('append:');
});

function feedTimed(id: string, url: string, startSec: number, durSec: number) {
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 1000 + startSec, wallTime: 1700000000 + startSec, type: 'XHR',
    request: { url, method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: id, timestamp: 1000 + startSec + durSec / 2, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: id, timestamp: 1000 + startSec + durSec, encodedDataLength: 10 });
}

test('the timeline strip is always visible and z toggles range-select mode', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedTimed('t1', 'https://a.test/first-req', 0, 1);
  feedTimed('t2', 'https://a.test/second-req', 10, 1);
  await waitForFrame(lastFrame, '2 req');
  expect(lastFrame()).toMatch(/[⣀-⣿]/);
  expect(lastFrame()!.split('\n').length).toBe(23);
  stdin.write('z');
  await waitForFrame(lastFrame, 'v 선택/적용');
  const frame = lastFrame()!;
  expect(frame).toMatch(/[⣀-⣿]/);
  expect(frame).toContain('10.9s');
  expect(frame).not.toContain('2 req');
  expect(frame.split('\n').length).toBe(23);
  stdin.write('H');
  await waitForFrame(lastFrame, '9.8s');
  stdin.write('z');
  await waitForFrame(lastFrame, 'z 구간');
  expect(lastFrame()).not.toContain('v 선택');
  expect(lastFrame()).toMatch(/[⣀-⣿]/);
  expect(lastFrame()).toContain('2 req');
});

test('the timeline strip shows a placeholder for an empty capture', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await waitForFrame(lastFrame, '요청 없음');
  stdin.write('z');
  await waitForFrame(lastFrame, 'v 선택/적용');
  stdin.write('v');
  await sleep(30);
  stdin.write('\r');
  await sleep(30);
  expect(lastFrame()).toContain('요청 없음');
  expect(lastFrame()).toContain('v 선택/적용');
});

test('brushing a time range filters the list to intersecting requests and shows a badge', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedTimed('t1', 'https://a.test/req-one', 0, 1);
  feedTimed('t2', 'https://a.test/req-two', 10, 1);
  feedTimed('t3', 'https://a.test/req-three', 20, 1);
  await waitForFrame(lastFrame, 'req-three');
  stdin.write('z');
  await waitForFrame(lastFrame, 'v 선택/적용');
  stdin.write('0');
  await sleep(30);
  stdin.write('v');
  await sleep(30);
  stdin.write('L');
  await waitForFrame(lastFrame, '· 1건');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'time:0.0s-');
  const frame = lastFrame()!;
  expect(frame).toContain('req-one');
  expect(frame).not.toContain('req-two');
  expect(frame).not.toContain('req-three');
  expect(frame).toContain('1/3건');
  expect(frame).toContain('· 1건');
  expect(frame).not.toContain('v 선택');
});

test('pressing v twice applies the selection like Enter', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedTimed('t1', 'https://a.test/req-one', 0, 1);
  feedTimed('t2', 'https://a.test/req-two', 10, 1);
  feedTimed('t3', 'https://a.test/req-three', 20, 1);
  await waitForFrame(lastFrame, 'req-three');
  stdin.write('z');
  await waitForFrame(lastFrame, 'v 선택/적용');
  stdin.write('0');
  await sleep(30);
  stdin.write('v');
  await sleep(30);
  stdin.write('L');
  await sleep(30);
  stdin.write('v');
  await waitForFrame(lastFrame, 'time:0.0s-');
  const frame = lastFrame()!;
  expect(frame).toContain('req-one');
  expect(frame).not.toContain('req-two');
  expect(frame).not.toContain('req-three');
  expect(frame).toContain('1/3건');
  expect(frame).not.toContain('v 선택');
});

test('a time-range filter suspends tail-follow and Esc semantics clear then close', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedTimed('t1', 'https://a.test/req-one', 0, 1);
  feedTimed('t2', 'https://a.test/req-two', 10, 1);
  await waitForFrame(lastFrame, 'req-two');
  stdin.write('z');
  await waitForFrame(lastFrame, 'v 선택');
  stdin.write('0');
  await sleep(30);
  stdin.write('v');
  await sleep(30);
  stdin.write('L');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'time:0.0s-');
  expect(lastFrame()).toContain('1/2건');
  feedTimed('t3', 'https://a.test/late', 30, 1);
  await waitForFrame(lastFrame, '1/3건');
  expect(lastFrame()).not.toContain('late');
  stdin.write('z');
  await waitForFrame(lastFrame, '┃');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'late');
  expect(lastFrame()).not.toContain('time:0.0s-');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'z 구간');
  feedTimed('t4', 'https://a.test/fresh', 40, 1);
  await waitForFrame(lastFrame, 'fresh');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/fresh');
});

const CTRL_F = '';

test('Ctrl+F applies a full-text search across response bodies and shows a find badge', async () => {
  mock.respond('Network.getResponseBody', (p: { requestId: string }) => ({
    body: p.requestId === 'fb' ? '{"secret":"zzneedle"}' : '{"x":1}',
    base64Encoded: false,
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('fa', 'https://a.test/api/reqalpha');
  feedNet('fb', 'https://a.test/api/reqbravo');
  feedNet('fc', 'https://a.test/api/reqcharlie');
  await waitForFrame(lastFrame, 'reqcharlie');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('zzneedle');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'find:zzneedle (1)');
  const frame = lastFrame()!;
  expect(frame).toContain('reqbravo');
  expect(frame).not.toContain('reqalpha');
  expect(frame).not.toContain('reqcharlie');
  expect(frame).toContain('1/3건');
});

test('n and N cycle the selection through search matches with wraparound', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('n1', 'https://a.test/api/huntone');
  feedNet('n2', 'https://a.test/api/othertwo');
  feedNet('n3', 'https://a.test/api/huntthree');
  await waitForFrame(lastFrame, 'huntthree');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('hunt');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'find:hunt (2)');
  expect(lastFrame()).not.toContain('othertwo');
  let row = lastFrame()!.split('\n').find(l => l.includes('huntthree'));
  expect(row!.startsWith('▌')).toBe(true);
  stdin.write('n');
  await sleep(40);
  row = lastFrame()!.split('\n').find(l => l.includes('huntone'));
  expect(row!.startsWith('▌')).toBe(true);
  stdin.write('N');
  await sleep(40);
  row = lastFrame()!.split('\n').find(l => l.includes('huntthree'));
  expect(row!.startsWith('▌')).toBe(true);
});

test('Esc clears the search first and only then collapses the peek', async () => {
  const { lastFrame, stdin } = renderAppTall(30);
  await attach(lastFrame, stdin);
  feedNet('e1', 'https://a.test/api/escalpha');
  feedNet('e2', 'https://a.test/api/escbravo');
  await waitForFrame(lastFrame, 'escbravo');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('escalpha');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'find:escalpha (1)');
  expect(lastFrame()).not.toContain('escbravo');
  expect(lastFrame()).toContain('╭');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'escbravo');
  expect(lastFrame()).not.toContain('find:');
  expect(lastFrame()).toContain('╭');
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).not.toContain('╭');
});

test('search composes with the type filter as an AND', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedReq('c1', 'https://a.test/api/comboalpha', { type: 'XHR' });
  feedReq('c2', 'https://a.test/img/combobeta.png', { type: 'Image' });
  feedReq('c3', 'https://a.test/api/plainxhr', { type: 'XHR' });
  await waitForFrame(lastFrame, 'plainxhr');
  stdin.write('x');
  await waitForFrame(lastFrame, '타입 필터');
  stdin.write('j');
  await sleep(20);
  stdin.write(' ');
  await sleep(20);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[xhr]');
  expect(lastFrame()).not.toContain('combobeta');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('combo');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'find:combo (1)');
  const frame = lastFrame()!;
  expect(frame).toContain('comboalpha');
  expect(frame).not.toContain('combobeta');
  expect(frame).not.toContain('plainxhr');
  expect(frame).toContain('1/3건');
});

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('the hint guide defaults to two rows above the status bar at a constant frame height', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  const lines = lastFrame()!.split('\n');
  expect(lines.length).toBe(23);
  const row1 = stripAnsi(lines[lines.length - 3]);
  const row2 = stripAnsi(lines[lines.length - 2]);
  expect(row1).toContain('? 도움말');
  expect(row1).toContain('b 전환');
  expect(row1).toContain(': 명령');
  expect(row2).toContain('[/] 세션');
  expect(row2).toContain('^X 세션 종료');
  expect(row2).toContain('^W 탭 닫기');
});

test('hints=1 renders a single hint row directly above the status bar', async () => {
  saveConfig({ hints: '1' });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  const lines = lastFrame()!.split('\n');
  expect(lines.length).toBe(23);
  expect(stripAnsi(lines[lines.length - 2])).toContain('? 도움말');
  expect(stripAnsi(lines[lines.length - 3])).toContain('─');
});

test('hints=off removes the hint rows and gives the height back to the body', async () => {
  saveConfig({ hints: 'off' });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  const lines = lastFrame()!.split('\n');
  expect(lines.length).toBe(23);
  expect(lastFrame()).toContain('요청 없음');
  expect(lastFrame()).not.toContain('z 구간');
  expect(stripAnsi(lines[lines.length - 2])).toContain('─');
});

test('flipping the hints enum in settings applies immediately and persists', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  expect(lastFrame()).toContain('z 구간');
  stdin.write(',');
  await waitForFrame(lastFrame, 'port');
  for (let i = 0; i < 15; i++) { stdin.write('j'); await sleep(15); }
  stdin.write('l');
  await waitUntil(() => loadConfig().hints === '1');
  expect(loadConfig().hints).toBe('1');
  stdin.write('l');
  await waitUntil(() => loadConfig().hints === 'off');
  expect(loadConfig().hints).toBe('off');
  stdin.write('1');
  await waitForFrame(lastFrame, '요청 없음');
  expect(lastFrame()).not.toContain('z 구간');
  expect(lastFrame()!.split('\n').length).toBe(23);
});

test('Esc in the search prompt cancels the draft without touching the applied query', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('p1', 'https://a.test/api/promptalpha');
  feedNet('p2', 'https://a.test/api/promptbeta');
  await waitForFrame(lastFrame, 'promptbeta');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('promptalpha');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'find:promptalpha (1)');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:promptalpha▌');
  stdin.write('zzz');
  await sleep(30);
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'find:promptalpha (1)');
  expect(lastFrame()).not.toContain('zzz');
});

test('the tab picker floats over the network panel: list stays visible beside an intact box', async () => {
  const { lastFrame, stdin } = renderAppSized(140, 30);
  await attach(lastFrame, stdin);
  feedNet('fl1', 'https://a.test/behind-overlay');
  await waitForFrame(lastFrame, 'behind-overlay');
  stdin.write('b');
  await waitForFrame(lastFrame, '탭 전환');
  const lines = lastFrame()!.split('\n').map(stripAnsi);
  expect(lines.some(l => /200\s+XHR.*│/.test(l))).toBe(true);
  expect(lines.some(l => l.includes('╭─') && l.includes('─╮'))).toBe(true);
  expect(lines.some(l => l.includes('╰─') && l.includes('─╯'))).toBe(true);
  expect(lines.some(l => /│ ── 탭 전환 ─+ │/.test(l))).toBe(true);
  expect(lines.some(l => /│ ❯ ▸ Mock Page/.test(l))).toBe(true);
  expect(lines.some(l => /│\s{82}│/.test(l))).toBe(true);
});

test('a centered modal over a CJK-heavy console keeps both box edges column-aligned', async () => {
  const { lastFrame, stdin } = renderAppSized(100, 30);
  await attach(lastFrame, stdin);
  for (let i = 0; i < 18; i++) {
    mock.emitEvent('Runtime.consoleAPICalled', {
      type: 'log', timestamp: i,
      args: [{ type: 'string', value: `한글줄${i} 가나다라마바사아자차카타파하 넓은 문자 배경 가나다라마바사아자차카타파하 배경끝${i}` }],
    });
  }
  stdin.write('2');
  await waitForFrame(lastFrame, '한글줄17');
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  const lines = lastFrame()!.split('\n').map(stripAnsi);
  const boxLines = lines.filter(l => l.indexOf('│') !== l.lastIndexOf('│'));
  expect(boxLines.length).toBeGreaterThan(5);
  const leftCols = boxLines.map(l => displayWidth(l.slice(0, l.indexOf('│'))));
  const rightCols = boxLines.map(l => displayWidth(l.slice(0, l.lastIndexOf('│'))));
  expect(new Set(leftCols).size).toBe(1);
  expect(new Set(rightCols).size).toBe(1);
  expect(lines.some(l => /한글줄\d+.*│/.test(l))).toBe(true);
  expect(lines.some(l => /│.*배경끝\d+/.test(l))).toBe(true);
});

test('the background list keeps receiving entries while the picker is open', async () => {
  const { lastFrame, stdin } = renderAppSized(140, 30);
  await attach(lastFrame, stdin);
  feedNet('lv1', 'https://a.test/live-one');
  await waitForFrame(lastFrame, '1 req');
  stdin.write('b');
  await waitForFrame(lastFrame, '탭 전환');
  feedNet('lv2', 'https://a.test/live-two');
  await waitForFrame(lastFrame, '2 req');
  expect(lastFrame()).toContain('탭 전환');
});

test('background lines are dimmed while a modal is open and restored on close', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('dm1', 'https://a.test/dim-me');
  await waitForFrame(lastFrame, 'dim-me');
  expect(lastFrame()).not.toContain('\x1b[2m');
  stdin.write('b');
  await waitForFrame(lastFrame, '탭 전환');
  expect(lastFrame()).toContain('\x1b[2m');
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).not.toContain('\x1b[2m');
  expect(lastFrame()).toContain('dim-me');
});

test('p opens the copy-format picker and copies the selected request URL', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  feedNet('cp1', 'https://api.test/copy-me');
  await waitForFrame(lastFrame, 'copy-me');
  stdin.write('p');
  await waitForFrame(lastFrame, '복사 형식');
  expect(stripAnsi(lastFrame()!)).toContain('Node fetch');
  stdin.write('j');
  stdin.write('j');
  stdin.write('j');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'URL 복사됨');
  expect(copied).toBe('https://api.test/copy-me');
});

test('D groups the network log by domain and h folds the selected group', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('g1', 'https://api.test/one');
  feedNet('g2', 'https://cdn.test/lib.js');
  await waitForFrame(lastFrame, 'lib.js');
  stdin.write('D');
  await waitForFrame(lastFrame, 'group:domain');
  let frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('api.test (1)');
  expect(frame).toContain('cdn.test (1)');
  stdin.write('h');
  await sleep(40);
  frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('▸');
});
