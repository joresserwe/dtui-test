import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { loadConfig } from '../src/config.js';
import { setLang } from '../src/tui/lib/i18n.js';
import { App } from '../src/tui/App.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-i18n-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-i18n-data-'));
  mock = await MockCdp.start();
  tabs = new MultiTabs([ep()]);
  await tabs.refresh();
});
afterEach(async () => {
  setLang('ko');
  tabs.stop();
  await mock.close();
  if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevConfigHome;
  if (prevDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevDataHome;
});

async function searchLang(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('/');
  await sleep(30);
  stdin.write('lang');
  await sleep(30);
  stdin.write('\r');
  await sleep(30);
}

test('switching lang in settings flips the whole UI live and back', async () => {
  const { lastFrame, stdin } = render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} />,
  );
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');

  stdin.write(',');
  await waitForFrame(lastFrame, 'UI 언어');
  expect(lastFrame()).toContain('? 도움말');
  expect(lastFrame()).toContain('값 전환');

  await searchLang(lastFrame, stdin);
  stdin.write('l');
  await waitForFrame(lastFrame, 'UI language');
  expect(loadConfig().lang).toBe('en');
  expect(lastFrame()).toContain('? help');
  expect(lastFrame()).toContain('flip value');
  expect(lastFrame()).not.toContain('도움말');

  stdin.write('1');
  await waitForFrame(lastFrame, 'no requests');
  stdin.write('C');
  await waitForFrame(lastFrame, 'log cleared');

  stdin.write(',');
  await waitForFrame(lastFrame, 'UI language');
  await searchLang(lastFrame, stdin);
  stdin.write('h');
  await waitForFrame(lastFrame, 'UI 언어');
  expect(loadConfig().lang).toBe('ko');
  expect(lastFrame()).toContain('? 도움말');

  stdin.write('1');
  await waitForFrame(lastFrame, '요청 없음');
  stdin.write('C');
  await waitForFrame(lastFrame, '로그 지움');
});
