import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs, epKey } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import type { BrowserSession } from '../src/cdp/browser.js';
import { App } from '../src/tui/App.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

const ESC = '\x1b';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-nt-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-nt-data-'));
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

interface CreateCall { url: string; opts?: { incognito?: boolean } }

function fakeBrowser(overrides: Partial<BrowserSession> = {}) {
  const calls: CreateCall[] = [];
  let seq = 0;
  const browser = {
    createTab: async (url = 'about:blank', opts?: { incognito?: boolean }) => {
      calls.push({ url, opts });
      const id = `fresh-${seq++}`;
      mock.pages.push({ id, title: `Fresh ${id}`, url });
      return id;
    },
    windowIdFor: async () => null,
    close: () => {},
    ...overrides,
  } as unknown as BrowserSession;
  return { calls, browser };
}

function renderApp(browser: BrowserSession) {
  return render(
    <App
      ep={ep()}
      tabs={tabs}
      browsers={new Map([[epKey(ep()), browser]])}
      attach={t => DebugSession.attach(t, { persist: false })}
      reconnectBaseMs={10}
    />,
  );
}

test('t opens the URL prompt, normalizes a bare host, and creates + attaches', async () => {
  const { calls, browser } = fakeBrowser();
  const { lastFrame, stdin } = renderApp(browser);
  await sleep(50);
  stdin.write('t');
  await waitForFrame(lastFrame, 'URL ❯');
  expect(lastFrame()).toContain('새 탭');
  expect(lastFrame()).not.toContain('시크릿');
  stdin.write('example.com');
  await waitForFrame(lastFrame, 'example.com▌');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Fresh fresh-0');
  expect(calls).toEqual([{ url: 'https://example.com', opts: undefined }]);
  expect(lastFrame()).not.toContain('URL ❯');
  expect(lastFrame()).toContain('연결됨: Fresh fresh-0');
});

test('an empty prompt opens about:blank', async () => {
  const { calls, browser } = fakeBrowser();
  const { lastFrame, stdin } = renderApp(browser);
  await sleep(50);
  stdin.write('t');
  await waitForFrame(lastFrame, 'URL ❯');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Fresh fresh-0');
  expect(calls).toEqual([{ url: 'about:blank', opts: undefined }]);
});

test('Esc cancels the prompt with zero side effects', async () => {
  const { calls, browser } = fakeBrowser();
  const { lastFrame, stdin } = renderApp(browser);
  await sleep(50);
  stdin.write('t');
  await waitForFrame(lastFrame, 'URL ❯');
  stdin.write('example.com');
  await sleep(30);
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).not.toContain('URL ❯');
  expect(calls).toEqual([]);
  expect(lastFrame()).not.toContain('연결됨');
});

test('I opens the incognito prompt and passes incognito to createTab', async () => {
  const { calls, browser } = fakeBrowser();
  const { lastFrame, stdin } = renderApp(browser);
  await sleep(50);
  stdin.write('I');
  await waitForFrame(lastFrame, '시크릿');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Fresh fresh-0');
  expect(calls).toEqual([{ url: 'about:blank', opts: { incognito: true } }]);
});

test('the picker new-tab row opens the prompt', async () => {
  const { calls, browser } = fakeBrowser();
  const { lastFrame, stdin } = renderApp(browser);
  await sleep(50);
  stdin.write('b');
  await waitForFrame(lastFrame, '새 탭 열기');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'URL ❯');
  expect(calls).toEqual([]);
});

test('a createTab failure closes the prompt with a failure toast', async () => {
  const { browser } = fakeBrowser({
    createTab: (async () => {
      throw new Error('no browser context');
    }) as BrowserSession['createTab'],
  });
  const { lastFrame, stdin } = renderApp(browser);
  await sleep(50);
  stdin.write('t');
  await waitForFrame(lastFrame, 'URL ❯');
  stdin.write('boom.test');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '열기 실패');
  expect(lastFrame()).toContain('no browser context');
  expect(lastFrame()).not.toContain('URL ❯');
});

test('t without a browser session toasts instead of creating a tab', async () => {
  const { lastFrame, stdin } = render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} />,
  );
  await sleep(50);
  stdin.write('t');
  await waitForFrame(lastFrame, 'URL ❯');
  stdin.write('\r');
  await waitForFrame(lastFrame, '브라우저 세션 없음');
});
