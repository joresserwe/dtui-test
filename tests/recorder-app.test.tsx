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
import { REC_BINDING } from '../src/tui/lib/recorder-script.js';
import { listRecordings, recordingsDir, saveRecording } from '../src/store/recording.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
let prevConfigHome: string | undefined;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-rec-app-cfg-'));
  mock = await MockCdp.start();
  mock.respond('Runtime.addBinding', () => ({}));
  mock.respond('Runtime.removeBinding', () => ({}));
  mock.respond('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'scr-1' }));
  mock.respond('Page.removeScriptToEvaluateOnNewDocument', () => ({}));
  mock.respond('Runtime.evaluate', () => ({ result: {} }));
  tabs = new MultiTabs([ep()]);
  await tabs.refresh();
});
afterEach(async () => {
  tabs.stop();
  await mock.close();
  if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevConfigHome;
});

function renderApp() {
  return render(<App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} />);
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (d: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

async function palette(lastFrame: () => string | undefined, stdin: { write: (d: string) => void }, query: string) {
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write(query);
  await sleep(40);
}

test('record via palette shows the badge, prompts a name on stop, and lands in the manager', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);

  await palette(lastFrame, stdin, '레코딩 시작');
  stdin.write('\r');
  await waitForFrame(lastFrame, '● rec 1');

  mock.emitEvent('Runtime.bindingCalled', { name: REC_BINDING, payload: JSON.stringify({ kind: 'click', selector: '#go' }) });
  await waitForFrame(lastFrame, '● rec 2');

  await palette(lastFrame, stdin, '정지');
  stdin.write('\r');
  await waitForFrame(lastFrame, '레코딩 이름');

  stdin.write('login flow');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '레코딩 저장됨');

  const saved = listRecordings(recordingsDir());
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('login flow');
  expect(saved[0].stepCount).toBe(2);

  await palette(lastFrame, stdin, '매니저');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'login flow');
  expect(lastFrame()).toContain('2 스텝');
});

test('manager Enter opens a read-only step detail, Esc returns, r replays', async () => {
  saveRecording(recordingsDir(), {
    name: 'pw flow',
    createdAt: new Date().toISOString(),
    steps: [
      { kind: 'goto', url: 'https://mock.test/' },
      { kind: 'input', selector: '#pw', redacted: true },
    ],
    version: 1,
  });

  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);

  await palette(lastFrame, stdin, '매니저');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'pw flow');

  stdin.write('\r');
  await waitForFrame(lastFrame, '가려진 값');
  expect(lastFrame()).toContain('#pw');

  stdin.write('\x1b');
  await waitForFrame(lastFrame, '이름변경');

  stdin.write('r');
  await waitForFrame(lastFrame, '재생 중');
});
