import { test, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { render as inkRender } from 'ink';
import { MockCdp } from './helpers/mock-cdp.js';
import { Root } from '../src/tui/Root.js';
import { DebugSession } from '../src/engine.js';
import { ProfileRestrictedError, WslLoopbackError, type LaunchOptions } from '../src/browser/launch.js';
import type { BrowserCandidate } from '../src/browser/detect.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const CANDS: BrowserCandidate[] = [
  { kind: 'chrome', name: 'Google Chrome', path: '/usr/bin/google-chrome', viaWsl: false },
  { kind: 'comet', name: 'Comet', path: '/mnt/c/x/comet.exe', viaWsl: true },
];
const appProps = { attach: (t: any) => DebugSession.attach(t, { persist: false }), reconnectBaseMs: 10 };
const noScan = async () => [];

let prevConfigHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-root-cfg-'));
  mock = await MockCdp.start();
});
afterEach(async () => {
  await mock.close();
  if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevConfigHome;
});

class MockStdout extends EventEmitter {
  columns = 100;
  frames: string[] = [];
  lastFrame?: string;
  write = (f: string) => { this.frames.push(f); this.lastFrame = f; };
}
class MockStdin extends EventEmitter {
  isTTY = true;
  data: string | null = null;
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  write = (d: string) => {
    this.data = d;
    this.emit('readable');
    this.emit('data', d);
  };
  read = () => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

test('initialEndpoint goes straight to the app', async () => {
  const { lastFrame } = render(
    <Root initialEndpoint={ep()} port={9222} makeBrowser={async () => null} scan={noScan} appProps={appProps} />,
  );
  await waitForFrame(lastFrame, 'MockChrome/1.0');
  expect(lastFrame()).not.toContain('Pick a browser');
});

test('connecting activates a page once, and a picker switch activates once more', async () => {
  const { lastFrame, stdin } = render(
    <Root initialEndpoint={ep()} port={9222} makeBrowser={async () => null} scan={noScan} appProps={appProps} />,
  );
  await waitForFrame(lastFrame, 'MockChrome/1.0');
  const waitForActivated = async (n: number) => {
    const deadline = Date.now() + 2000;
    while (mock.activated.length < n && Date.now() < deadline) await sleep(15);
  };
  await waitForActivated(1);
  expect(mock.activated).toEqual(['page1']);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
  await waitForActivated(2);
  await sleep(50);
  expect(mock.activated).toEqual(['page1', 'page1']);
});

test('initialUrl opens a new tab and attaches to it', async () => {
  const opened: string[] = [];
  const fakeBrowser = {
    createTab: async (url: string) => {
      opened.push(url);
      mock.pages.push({ id: 'opened-tab', title: 'Opened Tab', url });
      return 'opened-tab';
    },
    windowIdFor: async () => null,
    close: () => {},
  };
  const { lastFrame } = render(
    <Root
      initialEndpoint={ep()}
      port={9222}
      initialUrl="https://opened.test/"
      makeBrowser={async () => fakeBrowser as any}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await waitForFrame(lastFrame, 'Opened Tab');
  expect(opened).toEqual(['https://opened.test/']);
});

test('initialUrl with no browser session toasts instead of silently dropping', async () => {
  const { lastFrame } = render(
    <Root
      initialEndpoint={ep()}
      port={9222}
      initialUrl="https://opened.test/"
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await waitForFrame(lastFrame, '브라우저 세션 없음');
});

test('initialProfile presets the picker profile mode', async () => {
  const { lastFrame } = render(
    <Root
      initialEndpoint={null}
      port={9260}
      initialProfile="tool"
      detect={async () => CANDS}
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await waitForFrame(lastFrame, 'profile:');
  expect(lastFrame()).toContain('Pick a browser');
  expect(lastFrame()).toContain('tool');
});

test('no endpoint shows picker; Enter launches selection with profile', async () => {
  const calls: Array<[string, LaunchOptions]> = [];
  const { lastFrame, stdin, unmount } = render(
    <Root
      initialEndpoint={null}
      port={9250}
      detect={async () => CANDS}
      launch={async (c, o) => { calls.push([c.name, o]); return ep(); }}
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await sleep(50);
  expect(lastFrame()).toContain('Pick a browser');
  stdin.write('j');
  await sleep(30);
  stdin.write('p');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'MockChrome/1.0');
  expect(calls).toEqual([['Comet', { port: 9250, profile: 'tool' }]]);
  unmount();
});

test('ProfileRestrictedError auto-falls back to the tool profile', async () => {
  const calls: string[] = [];
  const { lastFrame, stdin } = render(
    <Root
      initialEndpoint={null}
      port={9251}
      detect={async () => CANDS}
      launch={async (c, o) => {
        calls.push(o.profile);
        if (o.profile === 'existing') throw new ProfileRestrictedError();
        return ep();
      }}
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await sleep(50);
  stdin.write('\r');
  await sleep(300);
  expect(calls).toEqual(['existing', 'tool']);
  await waitForFrame(lastFrame, 'MockChrome/1.0');
});

test('viaWsl candidate also auto-falls back to the tool profile', async () => {
  const calls: string[] = [];
  const { lastFrame, stdin } = render(
    <Root
      initialEndpoint={null}
      port={9256}
      detect={async () => CANDS}
      launch={async (_c, o) => {
        calls.push(o.profile);
        if (o.profile === 'existing') throw new ProfileRestrictedError();
        return ep();
      }}
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await sleep(50);
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await sleep(300);
  expect(calls).toEqual(['existing', 'tool']);
  await waitForFrame(lastFrame, 'MockChrome/1.0');
});

test('WslLoopbackError surfaces its full message in the picker', async () => {
  let launches = 0;
  const { lastFrame, stdin } = render(
    <Root
      initialEndpoint={null}
      port={9257}
      detect={async () => CANDS}
      launch={async () => { launches++; throw new WslLoopbackError(); }}
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await sleep(50);
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await sleep(200);
  expect(launches).toBe(1);
  const flat = lastFrame()!.split('\n').map(l => l.replace(/[\u2502\u256D\u256E\u2570\u256F\u2500]/g, '').trim()).join(' ').replace(/\s+/g, ' ');
  expect(flat).toContain(new WslLoopbackError().message);
  expect(lastFrame()).toContain('Pick a browser');
});

test('burst key chunks move the selection per character', async () => {
  const calls: string[] = [];
  const { stdin } = render(
    <Root initialEndpoint={null} port={9253} detect={async () => CANDS}
      launch={async c => { calls.push(c.name); return ep(); }}
      makeBrowser={async () => null} scan={noScan} appProps={appProps} />,
  );
  await sleep(50);
  stdin.write('jj');
  await sleep(50);
  stdin.write('\r');
  await sleep(200);
  expect(calls).toEqual(['Comet']);
});

test('double Enter launches only once', async () => {
  let launches = 0;
  const { stdin } = render(
    <Root initialEndpoint={null} port={9254} detect={async () => CANDS}
      launch={async () => { launches++; await sleep(50); return ep(); }}
      makeBrowser={async () => null} scan={noScan} appProps={appProps} />,
  );
  await sleep(50);
  stdin.write('\r');
  stdin.write('\r');
  await sleep(400);
  expect(launches).toBe(1);
});

test('q quits from the connecting state before the app mounts', async () => {
  const stdout = new MockStdout();
  const stdin = new MockStdin();
  const instance = inkRender(
    <Root initialEndpoint={null} port={9255} detect={async () => CANDS}
      launch={async () => ep()} makeBrowser={() => new Promise(() => {})} scan={noScan} appProps={appProps} />,
    { stdout: stdout as any, stdin: stdin as any, debug: true, exitOnCtrlC: false, patchConsole: false },
  );
  await sleep(50);
  stdin.write('\r');
  await sleep(100);
  expect(stdout.lastFrame).toContain('연결 중…');
  const exited = instance.waitUntilExit();
  stdin.write('q');
  await expect(exited).resolves.toBeUndefined();
});

test('launch errors keep the picker with a message', async () => {
  const { lastFrame, stdin } = render(
    <Root
      initialEndpoint={null}
      port={9252}
      detect={async () => CANDS}
      launch={async () => { throw new Error('spawn ENOENT'); }}
      makeBrowser={async () => null}
      scan={noScan}
      appProps={appProps}
    />,
  );
  await sleep(50);
  stdin.write('\r');
  await sleep(150);
  expect(lastFrame()).toContain('spawn ENOENT');
  expect(lastFrame()).toContain('Pick a browser');
});
