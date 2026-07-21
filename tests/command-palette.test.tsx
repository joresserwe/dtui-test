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

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-cp-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-cp-data-'));
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

test(': opens the palette when attached and shows key labels next to actions', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('탭 픽커 열기');
  expect(frame).toMatch(/\d+\/\d+/);
  expect(frame).toContain('^W');
  expect(frame).toContain('^X');
});

test(': opens the palette while unattached with only the actions valid there', async () => {
  const { lastFrame, stdin } = renderApp();
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('탭 픽커 열기');
  expect(frame).toContain('새 시크릿 탭');
  expect(frame).not.toContain('HAR 내보내기');
  expect(frame).not.toContain('세션 종료');
  expect(frame).not.toContain('새로고침');
});

test('fuzzy filter matches the Korean label', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('스로틀');
  await waitForFrame(lastFrame, '1/');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('스로틀 순환');
  expect(frame).not.toContain('캐시 비활성화 토글');
});

test('fuzzy filter matches the English label from the Korean UI', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('throttle');
  await waitForFrame(lastFrame, '1/');
  expect(stripAnsi(lastFrame()!)).toContain('스로틀 순환');
});

test('esc closes the palette without running anything', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).not.toContain('명령 팔레트');
});

test('enter on 스로틀 순환 sends the same CDP command as the T key', async () => {
  const seen: any[] = [];
  mock.respond('Network.emulateNetworkConditions', p => { seen.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('스로틀');
  await waitForFrame(lastFrame, '1/');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'throttle:fast3g');
  expect(seen[0]).toMatchObject({ latency: 150 });
  expect(stripAnsi(lastFrame()!)).not.toContain('명령 팔레트');
});

test('enter on HAR 내보내기 calls the injected exporter', async () => {
  let exported = false;
  const { lastFrame, stdin } = renderApp({
    exportHar: async () => { exported = true; return '/tmp/session-cp.har'; },
    clipboard: async () => { throw new Error('no clipboard'); },
  });
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('har');
  await sleep(50);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'HAR 저장됨: /tmp/session-cp.har');
  expect(exported).toBe(true);
});

test('enter on 오버라이드 관리자 opens the manager over existing rules', async () => {
  mock.respond('Fetch.enable', () => ({}));
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'PATTERN https://a.test/api/cp*\nSTATUS 200\n\n{"m":1}\n');
    },
  });
  await attach(lastFrame, stdin);
  feedNet('cp1', 'https://a.test/api/cp');
  await waitForFrame(lastFrame, 'a.test/api');
  stdin.write('O');
  await waitForFrame(lastFrame, '오버라이드 활성');
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('관리자');
  await waitForFrame(lastFrame, '오버라이드 관리자');
  const filtered = stripAnsi(lastFrame()!);
  expect(filtered).toContain('오버라이드 관리자');
  expect(filtered).toContain('^O');
  expect(filtered).toContain('차단 관리자');
  expect(filtered).toContain('^B');
  stdin.write('\r');
  await waitForFrame(lastFrame, '오버라이드 규칙');
  expect(stripAnsi(lastFrame()!)).toContain('200 · on');
});

test('enter on 탭 닫기 arms the ^W confirm instead of closing immediately', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('탭 닫기');
  await sleep(50);
  stdin.write('\r');
  await waitForFrame(lastFrame, '다시 ^W = 탭 닫기');
  expect(stripAnsi(lastFrame()!)).toContain('◉ Mock Page');
  expect(mock.closed).toEqual([]);
  stdin.write('\x17');
  await waitForFrame(lastFrame, '탭 닫힘');
  expect(mock.closed).toEqual(['page1']);
});

test('selected-entry actions are hidden without a selection and appear with one', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('curl');
  await waitForFrame(lastFrame, '일치하는 명령 없음');
  stdin.write('');
  await sleep(50);
  feedNet('sel1', 'https://a.test/api/selected');
  await waitForFrame(lastFrame, 'selected');
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('curl');
  await waitForFrame(lastFrame, 'cURL 복사');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'cURL 복사됨');
  expect(copied).toContain('curl ');
  expect(copied).toContain('https://a.test/api/selected');
});
