import { test, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { render } from 'ink-testing-library';
import { probe, type Endpoint } from '../src/cdp/discovery.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { waitForFrame } from './helpers/wait-for.js';

const CHROMIUM = process.env.DEVTOOLS_TUI_CHROMIUM;
const FIXTURES = process.env.DTUI_FW_FIXTURES;
const enabled = !!CHROMIUM && !!FIXTURES && existsSync(join(FIXTURES ?? '', 'react-prod.html'));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function launch(fixture: string): Promise<{ child: ChildProcess; ep: Endpoint }> {
  const profile = await mkdtemp(join(tmpdir(), 'dtui-fw-live-'));
  const url = pathToFileURL(join(FIXTURES!, fixture)).href;
  const child = spawn(CHROMIUM!, [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-sandbox',
    '--disable-gpu',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`no DevTools ws url; stderr:\n${buf}`)), 15000);
    child.stderr!.on('data', d => {
      buf += String(d);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`chrome exited early: ${code}\n${buf}`));
    });
  });
  const port = Number(new URL(wsUrl).port);
  const ep = await probe('127.0.0.1', port, fetch);
  if (!ep) throw new Error('probe failed');
  return { child, ep };
}

async function roundTrip(fixture: string, expectHeader: string, expectHost: string, expectName?: string) {
  const { child, ep } = await launch(fixture);
  const prevConfig = process.env.XDG_CONFIG_HOME;
  const prevData = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-fw-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-fw-data-'));
  const tabs = new MultiTabs([ep]);
  try {
    await tabs.refresh();
    const { lastFrame, stdin, unmount } = render(
      <App ep={ep} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} clipboard={async () => {}} />,
    );
    stdin.write('b');
    await waitForFrame(lastFrame, 'file:///', 5000);
    stdin.write('\r');
    await waitForFrame(lastFrame, '◉', 5000);
    await sleep(300);
    stdin.write('6');
    try {
      await waitForFrame(lastFrame, expectHeader, 4000);
    } catch {
      stdin.write('r');
      await waitForFrame(lastFrame, expectHeader, 4000);
    }
    const treeFrame = strip(lastFrame()!);
    if (process.env.DTUI_FW_DEBUG) console.error('TREE-FRAME[' + fixture + ']:\n' + treeFrame);
    expect(treeFrame).toContain('컴포넌트');
    if (expectName) expect(treeFrame).toContain(expectName);

    stdin.write('j');
    await sleep(100);
    stdin.write('H');
    await waitForFrame(lastFrame, '하이라이트:', 5000);
    expect(strip(lastFrame()!)).not.toContain('하이라이트 실패');

    stdin.write('\r');
    await waitForFrame(lastFrame, expectHost, 8000);
    const frame = strip(lastFrame()!);
    if (process.env.DTUI_FW_DEBUG) console.error('ELEMENTS-FRAME[' + fixture + ']:\n' + frame);
    const selLine = frame.split('\n').find(l => l.includes('▌'));
    expect(selLine).toContain(expectHost);
    unmount();
  } finally {
    tabs.stop();
    child.kill('SIGKILL');
    if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevConfig;
    if (prevData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevData;
  }
}

test.skipIf(!enabled)('react prod fixture: tree renders, H highlights, Enter jumps to Elements', async () => {
  await roundTrip('react-prod.html', 'react 18.3.1', 'header#hdr');
}, 60000);

test.skipIf(!enabled)('vue prod fixture: tree renders with full names, H highlights, Enter jumps to Elements', async () => {
  await roundTrip('vue-prod.html', 'vue 3.5', 'nav#nav', 'App');
}, 60000);
