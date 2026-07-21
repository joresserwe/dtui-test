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

const ESC = '';
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-toast-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-toast-data-'));
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

async function attachFirst(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

async function openSecond(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
}

test('a new toast replaces the current one immediately and shows its level icon', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await waitForFrame(lastFrame, '연결됨: Mock Page');
  expect(stripAnsi(lastFrame()!)).toContain('│ ✓ 연결됨: Mock Page');
  stdin.write('C');
  await waitForFrame(lastFrame, '로그 지움');
  const status = stripAnsi(lastFrame()!).split('\n').at(-1)!;
  expect(status).toContain('✓ 로그 지움');
  expect(status).not.toContain('연결됨');
});

test('! opens the history newest-first, enter copies the message, esc closes', async () => {
  const copied: string[] = [];
  const { lastFrame, stdin } = renderApp({
    clipboard: async text => {
      copied.push(text);
    },
  });
  await attachFirst(lastFrame, stdin);
  await waitForFrame(lastFrame, '연결됨: Mock Page');
  stdin.write('C');
  await waitForFrame(lastFrame, '로그 지움');
  stdin.write('!');
  await waitForFrame(lastFrame, '알림 기록');
  const lines = stripAnsi(lastFrame()!).split('\n');
  const cleared = lines.findIndex(l => l.includes('로그 지움'));
  const attached = lines.findIndex(l => l.includes('연결됨: Mock Page'));
  expect(cleared).toBeGreaterThanOrEqual(0);
  expect(attached).toBeGreaterThan(cleared);
  expect(stripAnsi(lastFrame()!)).toMatch(/\d{2}:\d{2}:\d{2}/);
  stdin.write('\r');
  await waitForFrame(lastFrame, '복사됨');
  expect(copied).toEqual(['로그 지움']);
  stdin.write(ESC);
  await sleep(60);
  expect(stripAnsi(lastFrame()!)).not.toContain('알림 기록');
});

test('the history overlay closes on session switch', async () => {
  const { lastFrame, stdin } = renderApp();
  await attachFirst(lastFrame, stdin);
  await openSecond(lastFrame, stdin);
  stdin.write('!');
  await waitForFrame(lastFrame, '알림 기록');
  // The overlay swallows keys, so switch via a background session end: the
  // active tab disappears and the view falls back to the remaining session.
  mock.pages = mock.pages.filter(p => p.id !== 'page2');
  mock.dropConnections();
  await waitForFrame(lastFrame, '◉ Mock Page');
  await sleep(60);
  expect(stripAnsi(lastFrame()!)).not.toContain('알림 기록');
});

test('a failed copy shows an error toast with the ✖ icon', async () => {
  const { lastFrame, stdin } = renderApp({
    clipboard: async () => {
      throw new Error('no clipboard');
    },
  });
  await attachFirst(lastFrame, stdin);
  stdin.write('y');
  await waitForFrame(lastFrame, '복사 실패');
  expect(stripAnsi(lastFrame()!)).toContain('✖ 복사 실패');
});
