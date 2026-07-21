import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { saveConfig } from '../src/config.js';
import { App } from '../src/tui/App.js';
import { useSessionManager, type SessionManager } from '../src/tui/hooks/use-session-manager.js';
import type { PageTarget } from '../src/cdp/targets.js';
import { waitForFrame, waitUntil } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

const CTRL_X = '\x18';
const CTRL_W = '\x17';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-sm-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-sm-data-'));
  mock = await MockCdp.start();
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
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

function feedNetTo(pageId: string, id: string, url: string) {
  mock.emitEventTo(pageId, 'Network.requestWillBeSent', {
    requestId: id, timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url, method: 'GET', headers: {} },
  });
  mock.emitEventTo(pageId, 'Network.responseReceived', {
    requestId: id, timestamp: 1.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEventTo(pageId, 'Network.loadingFinished', { requestId: id, timestamp: 1.2, encodedDataLength: 10 });
}

async function attachFirst(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

async function palette(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }, query: string) {
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write(query);
  await sleep(40);
}

async function openSecond(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
}

test('switching sessions is a pure view switch that keeps each log intact', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/alpha-one');
  await waitForFrame(lastFrame, 'alpha-one');

  await openSecond(lastFrame, stdin);
  expect(lastFrame()).not.toContain('alpha-one');
  feedNetTo('page2', 'b1', 'https://b.test/beta-one');
  await waitForFrame(lastFrame, 'beta-one');

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  await waitForFrame(lastFrame, 'alpha-one');
  expect(lastFrame()).not.toContain('beta-one');

  feedNetTo('page2', 'b2', 'https://b.test/beta-two');
  feedNetTo('page1', 'a2', 'https://a.test/alpha-two');
  await waitForFrame(lastFrame, 'alpha-two');
  expect(lastFrame()).not.toContain('beta-two');

  stdin.write(']');
  await waitForFrame(lastFrame, '◉ Second Page');
  await waitForFrame(lastFrame, 'beta-two');
  expect(lastFrame()).toContain('beta-one');
  expect(lastFrame()).not.toContain('alpha-one');
  expect(lastFrame()).toContain('2건');
});

test('console entries also survive a view switch', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  mock.emitEventTo('page1', 'Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'boom-alpha' }] });
  stdin.write('2');
  await waitForFrame(lastFrame, 'boom-alpha');
  await openSecond(lastFrame, stdin);
  stdin.write('2');
  await sleep(60);
  expect(lastFrame()).not.toContain('boom-alpha');
  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  stdin.write('2');
  await waitForFrame(lastFrame, 'boom-alpha');
});

test('Ctrl+X closes the active session, falls back to the remaining one, then to none', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/first-log');
  await waitForFrame(lastFrame, 'first-log');
  await openSecond(lastFrame, stdin);

  stdin.write(CTRL_X);
  // '세션 종료' alone also matches the footer's ^X hint; the │ prefix pins the
  // wait to the status-bar toast that marks close completion.
  await waitForFrame(lastFrame, '│ ✓ 세션 종료');
  expect(lastFrame()).not.toContain('세션 종료 · 저장됨');
  await waitForFrame(lastFrame, '◉ Mock Page');
  expect(lastFrame()).toContain('first-log');

  stdin.write(CTRL_X);
  await waitForFrame(lastFrame, '연결된 탭 없음');
});

test('Ctrl+X writes the session HAR when persistence is on', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-sm-har-'));
  const { lastFrame, stdin } = renderApp({
    attach: t => DebugSession.attach(t, { sessionRoot: root, browser: 'MockChrome' }),
  });
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'h1', 'https://a.test/har-me');
  await waitForFrame(lastFrame, 'har-me');
  stdin.write(CTRL_X);
  await waitForFrame(lastFrame, '세션 종료 · 저장됨');
  const dirs = readdirSync(root);
  expect(dirs).toHaveLength(1);
  const har = JSON.parse(readFileSync(join(root, dirs[0], 'session.har'), 'utf8'));
  expect(har.log.entries.some((e: any) => e.request.url === 'https://a.test/har-me')).toBe(true);
});

test('throttle is per-session and switching sends no CDP traffic', async () => {
  const seen: Array<[string, any]> = [];
  mock.respond('Network.emulateNetworkConditions', (p, pageId) => { seen.push([pageId ?? '?', p]); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  stdin.write('T');
  await waitForFrame(lastFrame, 'throttle:fast3g');
  expect(seen).toHaveLength(1);
  expect(seen[0][0]).toBe('page1');

  await openSecond(lastFrame, stdin);
  expect(lastFrame()).not.toContain('throttle fast3g');
  expect(seen).toHaveLength(1);

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  expect(lastFrame()).toContain('throttle fast3g');
  expect(seen).toHaveLength(1);
});

test('a background tab closing finalizes its session without disturbing the view', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/stay-here');
  await waitForFrame(lastFrame, 'stay-here');
  await openSecond(lastFrame, stdin);
  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');

  mock.pages = mock.pages.filter(p => p.id !== 'page2');
  mock.dropConnections('page2');
  await waitForFrame(lastFrame, '"Second Page" 탭 닫힘');
  expect(lastFrame()).not.toContain('저장됨');
  expect(lastFrame()).toContain('◉ Mock Page');
  expect(lastFrame()).toContain('stay-here');

  await tabs.refresh();
  stdin.write('b');
  await waitForFrame(lastFrame, '탭 전환');
  const pickerRows = lastFrame()!.split('\n').map(l => /│(.*)│/.exec(l)?.[1]).filter(x => x !== undefined).join('\n');
  expect(pickerRows).not.toContain('●');
  expect(pickerRows).not.toContain('Second Page');
});

test('a dropped connection for a still-open tab reconnects and re-applies only that session state', async () => {
  const blockCalls: Array<[string, string[]]> = [];
  mock.respond('Network.setBlockedURLs', (p, pageId) => { blockCalls.push([pageId ?? '?', p.urls]); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await openSecond(lastFrame, stdin);
  feedNetTo('page2', 'b1', 'https://b.test/block-me');
  await waitForFrame(lastFrame, 'block-me');
  stdin.write('B');
  await waitForFrame(lastFrame, '요청 차단');
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  expect(blockCalls).toEqual([['page2', ['https://b.test/block-me']]]);

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  mock.dropConnections('page2');
  const deadline = Date.now() + 2000;
  while (blockCalls.length < 2 && Date.now() < deadline) await sleep(25);
  expect(blockCalls).toEqual([
    ['page2', ['https://b.test/block-me']],
    ['page2', ['https://b.test/block-me']],
  ]);
  await sleep(60);
  expect(lastFrame()).not.toContain('재연결됨');
  expect(lastFrame()).toContain('◉ Mock Page');

  stdin.write(']');
  await waitForFrame(lastFrame, '◉ Second Page');
  expect(lastFrame()).toContain('block:1');
});

test('quit closes every open session and writes each HAR', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-sm-quit-'));
  const { lastFrame, stdin } = renderApp({
    attach: t => DebugSession.attach(t, { sessionRoot: root, browser: 'MockChrome' }),
  });
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/quit-a');
  await waitForFrame(lastFrame, 'quit-a');
  await openSecond(lastFrame, stdin);
  feedNetTo('page2', 'b1', 'https://b.test/quit-b');
  await waitForFrame(lastFrame, 'quit-b');

  stdin.write('q');
  const deadline = Date.now() + 2000;
  let harFiles: string[] = [];
  while (Date.now() < deadline) {
    harFiles = readdirSync(root).filter(d => existsSync(join(root, d, 'session.har')));
    if (harFiles.length === 2) break;
    await sleep(25);
  }
  expect(harFiles).toHaveLength(2);
  const urls = harFiles.flatMap(d => {
    const har = JSON.parse(readFileSync(join(root, d, 'session.har'), 'utf8'));
    return har.log.entries.map((e: any) => e.request.url);
  });
  expect(urls).toContain('https://a.test/quit-a');
  expect(urls).toContain('https://b.test/quit-b');
});

test('the session cap refuses new sessions with a toast', async () => {
  saveConfig({ sessionCap: 1 });
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '세션 한도(1) 도달');
  expect(lastFrame()).toContain('◉ Mock Page');
});

test('the session strip lists every session with its request count and underlines the viewed one', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/one');
  feedNetTo('page1', 'a2', 'https://a.test/two');
  await waitForFrame(lastFrame, '◉ Mock Page 2');
  await openSecond(lastFrame, stdin);
  await waitForFrame(lastFrame, '● Mock Page 2');
  const rows = lastFrame()!.split('\n');
  expect(rows[0]).toContain('◉ Second Page 0');
  expect(rows[1]).toContain('━');
});

test('no strip renders while no session exists', async () => {
  const { lastFrame } = renderApp();
  await waitForFrame(lastFrame, '연결된 탭 없음');
  const frame = lastFrame()!;
  expect(frame).not.toContain('━');
  expect(frame).not.toContain('◉');
});

test('Ctrl+X inside the picker closes the highlighted session, keeps the picker open, and ignores tab rows', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await openSecond(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, '── 세션 ─');
  stdin.write(CTRL_X);
  await waitForFrame(lastFrame, '○ Mock Page');
  const pickerRows = () => lastFrame()!.split('\n').map(l => /│(.*)│/.exec(l)?.[1]).filter(x => x !== undefined).join('\n');
  expect(pickerRows()).toContain('탭 전환');
  expect(pickerRows()).toContain('▸ Second Page');
  expect(pickerRows()).not.toContain('● Mock Page');

  stdin.write('j');
  await sleep(40);
  stdin.write(CTRL_X);
  await sleep(60);
  expect(pickerRows()).toContain('▸ Second Page');
  expect(pickerRows()).toContain('○ Mock Page');
});

test('Enter on a session row switches the view instead of re-attaching', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/switch-back');
  await waitForFrame(lastFrame, 'switch-back');
  await openSecond(lastFrame, stdin);
  expect(lastFrame()).not.toContain('switch-back');
  stdin.write('b');
  await waitForFrame(lastFrame, '── 세션 ─');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'switch-back');
});

test('an active-session reconnect still shows the reconnected toast', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  mock.dropConnections('page1');
  await waitForFrame(lastFrame, '재연결됨');
});

test('a background tab closing with persistence on names the tab and says saved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-sm-bgsave-'));
  const { lastFrame, stdin } = renderApp({
    attach: t => DebugSession.attach(t, { sessionRoot: root, browser: 'MockChrome' }),
  });
  await attachFirst(lastFrame, stdin);
  await openSecond(lastFrame, stdin);
  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  mock.pages = mock.pages.filter(p => p.id !== 'page2');
  mock.dropConnections('page2');
  await waitForFrame(lastFrame, '"Second Page" 탭 닫힘 · 세션 저장됨');
});

test('global Ctrl+W arms first, then closes the session and the browser tab with a single toast', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  expect(mock.closed).toEqual([]);
  expect(lastFrame()).toContain('◉ Mock Page');
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '"Mock Page" 탭 닫힘');
  expect(mock.closed).toEqual(['page1']);
  expect(lastFrame()).not.toContain('◉ Mock Page');
  expect(lastFrame()).toContain('연결된 탭 없음');
  await sleep(300);
  expect(lastFrame()).not.toContain('재연결');
  expect(lastFrame()).toContain('"Mock Page" 탭 닫힘');
  expect(lastFrame()).not.toContain('저장됨');
});

test('the Ctrl+W arm expires after its window and a late press only re-arms', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  await sleep(3200);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  await sleep(60);
  expect(mock.closed).toEqual([]);
  expect(lastFrame()).toContain('◉ Mock Page');
}, 10000);

test('Ctrl+W with persistence says saved and falls back to the MRU session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-sm-cw-'));
  const { lastFrame, stdin } = renderApp({
    attach: t => DebugSession.attach(t, { sessionRoot: root, browser: 'MockChrome' }),
  });
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/keep-log');
  await waitForFrame(lastFrame, 'keep-log');
  await openSecond(lastFrame, stdin);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '"Second Page" 탭 닫힘 · 세션 저장됨');
  expect(mock.closed).toEqual(['page2']);
  expect(lastFrame()).toContain('◉ Mock Page');
  expect(lastFrame()).toContain('keep-log');
  const harDirs = readdirSync(root).filter(d => existsSync(join(root, d, 'session.har')));
  expect(harDirs).toHaveLength(1);
});

test('Ctrl+W inside the picker closes the highlighted session row after a confirm press', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await openSecond(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, '── 세션 ─');
  expect(lastFrame()).toContain('^W 탭 닫기');
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  expect(mock.closed).toEqual([]);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '"Mock Page" 탭 닫힘');
  expect(mock.closed).toEqual(['page1']);
  const pickerRows = () => lastFrame()!.split('\n').map(l => /│(.*)│/.exec(l)?.[1]).filter(x => x !== undefined).join('\n');
  const deadline = Date.now() + 2000;
  while (pickerRows().includes('Mock Page') && Date.now() < deadline) await sleep(25);
  expect(pickerRows()).toContain('탭 전환');
  expect(pickerRows()).not.toContain('Mock Page');
});

test('Ctrl+W inside the picker closes a session-less tab row via /json/close', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '"Second Page" 탭 닫힘');
  expect(mock.closed).toEqual(['page2']);
  expect(lastFrame()).toContain('탭 전환');
});

test('moving the picker selection between Ctrl+W presses re-arms instead of closing', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  stdin.write('j');
  await sleep(40);
  stdin.write(CTRL_W);
  await sleep(60);
  expect(mock.closed).toEqual([]);
  stdin.write(CTRL_W);
  await waitForFrame(lastFrame, '"Second Page" 탭 닫힘');
  expect(mock.closed).toEqual(['page2']);
});

const CTRL_F = '\x06';

test('a→b→a restores the network filter and search while a fresh session gets defaults', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/alpha-one');
  feedNetTo('page1', 'a2', 'https://a.test/alpha-two');
  await waitForFrame(lastFrame, 'alpha-two');
  stdin.write('/');
  await sleep(30);
  stdin.write('alpha');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '· /alpha');
  stdin.write(CTRL_F);
  await waitForFrame(lastFrame, 'find:');
  stdin.write('one');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'find:one (1)');

  await openSecond(lastFrame, stdin);
  expect(lastFrame()).not.toContain('/alpha');
  expect(lastFrame()).not.toContain('find:');

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  await waitForFrame(lastFrame, '· /alpha');
  expect(lastFrame()).toContain('find:one (1)');
  expect(lastFrame()).toContain('alpha-one');
  expect(lastFrame()).not.toContain('alpha-two');
});

test('a→b→a restores the pinned selection and the follow flag', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/alpha-one');
  feedNetTo('page1', 'a2', 'https://a.test/alpha-two');
  await waitForFrame(lastFrame, 'alpha-two');
  stdin.write('k');
  const selRow = () => lastFrame()!.split('\n').find(l => l.startsWith('▌'));
  await waitUntil(() => !!selRow()?.includes('alpha-one'));
  expect(selRow()).toContain('alpha-one');

  await openSecond(lastFrame, stdin);
  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  expect(selRow()).toContain('alpha-one');

  feedNetTo('page1', 'a3', 'https://a.test/alpha-three');
  await waitForFrame(lastFrame, 'alpha-three');
  expect(selRow()).toContain('alpha-one');
});

test('the console expanded state is restored per session together with its tool', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  mock.emitEventTo('page1', 'Runtime.consoleAPICalled', {
    type: 'error', timestamp: 1, args: [{ type: 'string', value: 'boom-alpha' }],
    stackTrace: { callFrames: [{ functionName: 'doBoom', url: 'https://a.test/app.js', lineNumber: 9, columnNumber: 1 }] },
  });
  stdin.write('2');
  await waitForFrame(lastFrame, 'boom-alpha');
  stdin.write(' ');
  await waitForFrame(lastFrame, 'at doBoom');

  await openSecond(lastFrame, stdin);
  feedNetTo('page2', 'b1', 'https://b.test/beta-one');
  stdin.write('1');
  await waitForFrame(lastFrame, 'beta-one');

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  await waitForFrame(lastFrame, 'at doBoom');
  expect(lastFrame()).not.toContain('beta-one');

  stdin.write(']');
  await waitForFrame(lastFrame, '◉ Second Page');
  await waitForFrame(lastFrame, 'beta-one');
  expect(lastFrame()).not.toContain('boom-alpha');
});

test('a→b→a restores the console level and text filters while a fresh session gets defaults', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  mock.emitEventTo('page1', 'Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'alpha-err' }] });
  mock.emitEventTo('page1', 'Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [{ type: 'string', value: 'alpha-log' }] });
  stdin.write('2');
  await waitForFrame(lastFrame, 'alpha-log');
  stdin.write('x');
  await waitForFrame(lastFrame, '레벨 필터');
  stdin.write('j');
  await sleep(30);
  stdin.write(' ');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[error]');
  stdin.write('/');
  await sleep(30);
  stdin.write('alpha');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '· /alpha');
  expect(lastFrame()).not.toContain('alpha-log');

  await openSecond(lastFrame, stdin);
  stdin.write('2');
  await sleep(60);
  expect(lastFrame()).not.toContain('[error]');
  expect(lastFrame()).not.toContain('/alpha');

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  await waitForFrame(lastFrame, '[error]');
  expect(lastFrame()).toContain('· /alpha');
  expect(lastFrame()).toContain('alpha-err');
  expect(lastFrame()).not.toContain('alpha-log');
});

test('closing a session drops its snapshot so reopening the same tab starts fresh', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  stdin.write('/');
  await sleep(30);
  stdin.write('alpha');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '· /alpha');
  stdin.write(CTRL_X);
  await waitForFrame(lastFrame, '연결된 탭 없음');
  await attachFirst(lastFrame, stdin);
  await sleep(60);
  expect(lastFrame()).not.toContain('/alpha');
});

test('the MRU fallback after Ctrl+X restores the surviving session snapshot', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  feedNetTo('page1', 'a1', 'https://a.test/alpha-one');
  await waitForFrame(lastFrame, 'alpha-one');
  stdin.write('/');
  await sleep(30);
  stdin.write('alpha');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '· /alpha');
  await openSecond(lastFrame, stdin);
  expect(lastFrame()).not.toContain('/alpha');
  stdin.write(CTRL_X);
  await waitForFrame(lastFrame, '◉ Mock Page');
  await waitForFrame(lastFrame, '· /alpha');
  expect(lastFrame()).toContain('alpha-one');
});

test('the tab picker marks background sessions with ● and the attached tab with ▸', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await openSecond(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, '탭 전환');
  const frame = lastFrame()!;
  expect(frame).toContain('●');
  expect(frame).toContain('▸');
});

test('emulation state is re-applied after an active-session reconnect', async () => {
  const metrics: Array<[string, any]> = [];
  mock.respond('Emulation.setDeviceMetricsOverride', (p, pageId) => { metrics.push([pageId ?? '?', p]); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 에뮬레이션');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu device:iPhone');
  expect(metrics).toEqual([['page1', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }]]);

  mock.dropConnections('page1');
  const deadline = Date.now() + 2000;
  while (metrics.length < 2 && Date.now() < deadline) await sleep(25);
  expect(metrics).toEqual([
    ['page1', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }],
    ['page1', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }],
  ]);
});

test('quit awaits an attach that is still in flight before exiting', async () => {
  let order = 0;
  let closeAt = -1;
  let exitAt = -1;
  let resolveAttach: ((s: any) => void) | undefined;
  const attachPromise = new Promise<any>(r => { resolveAttach = r; });
  const fakeSession = {
    close: () => { closeAt = order++; return Promise.resolve(); },
    on: () => {},
    sessionDir: '/tmp/x',
    network: { setCap: () => {} },
  };

  const mgrBox: { mgr?: SessionManager } = {};
  function Harness() {
    mgrBox.mgr = useSessionManager({
      ep: ep(),
      tabs: { stop: () => {} } as any,
      attachFn: () => attachPromise,
      browserFor: () => null,
      reconnectBaseMs: 10,
      setToast: () => {},
      whenNotEditing: (fn: () => void) => fn(),
      onViewSwitch: () => {},
      exit: () => { exitAt = order++; },
    });
    return null;
  }
  render(<Harness />);
  await waitUntil(() => mgrBox.mgr !== undefined);

  const target: PageTarget = { id: 'p1', title: 't', url: 'https://x.test/' } as PageTarget;
  void mgrBox.mgr!.openSession(target, ep());
  await sleep(20);
  mgrBox.mgr!.quit();
  await sleep(20);
  expect(exitAt).toBe(-1);

  resolveAttach!(fakeSession);
  const deadline = Date.now() + 1000;
  while (exitAt === -1 && Date.now() < deadline) await sleep(10);
  expect(closeAt).toBeGreaterThanOrEqual(0);
  expect(exitAt).toBeGreaterThan(closeAt);
});
