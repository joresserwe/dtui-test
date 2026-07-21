import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { helpRows } from '../src/tui/overlays/HelpOverlay.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

const ESC = '';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-sc-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-sc-data-'));
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

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

test('. without an attached session toasts instead of opening', async () => {
  const { lastFrame, stdin } = renderApp();
  await sleep(50);
  stdin.write('.');
  await waitForFrame(lastFrame, '연결된 탭 없음');
  expect(lastFrame()).not.toContain('세션 컨트롤');
});

test('. opens the overlay with the session title, current values, and key labels', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  const frame = lastFrame()!;
  expect(frame).toContain('세션 컨트롤 · Mock Page');
  expect(frame).toContain('스로틀');
  expect(frame).toContain('◂ off ▸');
  expect(frame).toContain('캐시 비활성화');
  expect(frame).toContain('오버라이드 규칙');
  expect(frame).toContain('0개 →');
  expect(frame).toContain('HAR 내보내기');
  expect(frame).toContain('데이터 폴더 열기');
  expect(frame).toContain('(T)');
  expect(frame).toContain('(u)');
  expect(frame).toContain('(^O)');
  expect(frame).toContain('(^B)');
  expect(frame).toContain('(H)');
});

test('esc closes the overlay', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).not.toContain('세션 컨트롤');
});

test('h/l cycles the throttle on the active session only', async () => {
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const seen: Array<{ pageId?: string; latency: number }> = [];
  mock.respond('Network.emulateNetworkConditions', (p, pageId) => {
    seen.push({ pageId, latency: p.latency });
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤 · Second Page');
  stdin.write('l');
  await waitForFrame(lastFrame, 'throttle:fast3g');
  expect(lastFrame()).toContain('◂ fast3g ▸');
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ pageId: 'page2', latency: 150 });
  stdin.write('h');
  await waitForFrame(lastFrame, 'throttle:off');
  expect(seen).toHaveLength(2);
  expect(seen[1].pageId).toBe('page2');
  mock.pages.pop();
});

test('space toggles disable cache from the cache row', async () => {
  const seen: any[] = [];
  mock.respond('Network.setCacheDisabled', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  stdin.write('j');
  await sleep(40);
  stdin.write(' ');
  await waitForFrame(lastFrame, 'nocache:on');
  expect(seen[0]).toMatchObject({ cacheDisabled: true });
  expect(lastFrame()).toContain('세션 컨트롤');
  stdin.write(' ');
  await waitForFrame(lastFrame, 'nocache:off');
  expect(seen[1]).toMatchObject({ cacheDisabled: false });
});

test('enter on the override row with no rules toasts and stays open', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  stdin.write('jj');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '오버라이드 규칙 없음');
  expect(lastFrame()).toContain('세션 컨트롤');
});

test('enter on the override row opens the override manager when rules exist', async () => {
  mock.respond('Fetch.enable', () => ({}));
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'PATTERN https://a.test/api/ov-x*\nSTATUS 200\n\n{"m":1}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/ov-x');
  await waitForFrame(lastFrame, 'ov-x');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  expect(lastFrame()).toContain('1개 →');
  stdin.write('jj');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '오버라이드 규칙');
  expect(lastFrame()).toContain('200 · on');
  expect(lastFrame()).not.toContain('세션 컨트롤');
});

test('enter on the block row opens the block manager when patterns exist', async () => {
  mock.respond('Fetch.enable', () => ({}));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedNet('r1', 'https://a.test/api/blocked-me');
  await waitForFrame(lastFrame, 'blocked-me');
  stdin.write('B');
  await waitForFrame(lastFrame, '요청 차단');
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 패턴 추가됨');
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  expect(lastFrame()).toContain('1개 →');
  stdin.write('jjj');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '차단 목록');
  expect(lastFrame()).not.toContain('세션 컨트롤');
});

test('enter on the HAR row exports, copies the path, toasts, and closes the overlay', async () => {
  const copied: string[] = [];
  const { lastFrame, stdin } = renderApp({
    exportHar: async () => '/tmp/session-xyz.har',
    clipboard: async text => { copied.push(text); },
  });
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  stdin.write('jjjj');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'HAR 저장됨 · 경로 복사됨');
  expect(copied).toEqual(['/tmp/session-xyz.har']);
  expect(lastFrame()).not.toContain('세션 컨트롤');
});

test('enter on the folder row opens the app data root and closes the overlay', async () => {
  const opened: string[] = [];
  const { lastFrame, stdin } = renderApp({
    openFolder: async dir => { opened.push(dir); },
  });
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  stdin.write('jjjjj');
  await sleep(40);
  stdin.write('\r');
  await vi.waitFor(() => expect(opened).toEqual([join(process.env.XDG_DATA_HOME!, 'devtools-tui')]));
  expect(lastFrame()).not.toContain('세션 컨트롤');
});

test('a failing folder open reports via toast', async () => {
  const { lastFrame, stdin } = renderApp({
    openFolder: async () => { throw new Error('no opener'); },
  });
  await attach(lastFrame, stdin);
  stdin.write('.');
  await waitForFrame(lastFrame, '세션 컨트롤');
  stdin.write('jjjjj');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '폴더 열기 실패');
});

test('the idle footer advertises the overlay and help lists it in Global', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  expect(lastFrame()).toContain('. 컨트롤');
  const global = helpRows('network').filter(r => r.kind === 'key');
  expect(global.some(r => r.kind === 'key' && r.keys === '.' && r.desc.includes('세션 컨트롤'))).toBe(true);
});
