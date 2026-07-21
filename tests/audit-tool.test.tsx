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
import { makeLhr } from './helpers/lhr-fixture.js';
import { AuditCanceledError, type AuditRunRequest } from '../src/audit/runner.js';
import type { AuditRunnerFn } from '../src/tui/hooks/use-audit-tool.js';
import type { Lhr } from '../src/audit/types.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = '';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-audit-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-audit-data-'));
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

interface FakeRun {
  runner: AuditRunnerFn;
  requests: AuditRunRequest[];
  emitStatus: (msg: string) => void;
  resolve: (lhr: Lhr) => void;
  reject: (e: unknown) => void;
  canceled: () => boolean;
}

function fakeRunner(): FakeRun {
  const requests: AuditRunRequest[] = [];
  let onStatus: ((msg: string) => void) | undefined;
  let settle: { resolve: (lhr: Lhr) => void; reject: (e: unknown) => void } | undefined;
  let early: { lhr?: Lhr; error?: unknown } | undefined;
  let wasCanceled = false;
  const runner: AuditRunnerFn = (req, opts) => {
    requests.push(req);
    onStatus = opts.onStatus;
    const done = new Promise<Lhr>((resolve, reject) => {
      settle = { resolve, reject };
      if (early?.lhr) resolve(early.lhr);
      else if (early && 'error' in early) reject(early.error);
    });
    return {
      done,
      cancel: () => {
        wasCanceled = true;
        settle?.reject(new AuditCanceledError());
      },
    };
  };
  return {
    runner,
    requests,
    emitStatus: msg => onStatus?.(msg),
    resolve: lhr => {
      if (settle) settle.resolve(lhr);
      else early = { lhr };
    },
    reject: e => {
      if (settle) settle.reject(e);
      else early = { error: e };
    },
    canceled: () => wasCanceled,
  };
}

function renderApp(runner: AuditRunnerFn) {
  return render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} auditRun={runner} clipboard={async () => {}} />,
  );
}

async function untilRunning(fake: FakeRun) {
  for (let i = 0; i < 200 && fake.requests.length === 0; i++) await sleep(10);
  expect(fake.requests.length).toBeGreaterThan(0);
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

test('the audit tab is reachable via 7 and shows the ready state when attached', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  stdin.write('7');
  await waitForFrame(lastFrame, 'Audit');
  expect(stripAnsi(lastFrame()!)).toContain('연결된 탭 없음');
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  expect(stripAnsi(lastFrame()!)).toContain('preset:mobile');
  expect(stripAnsi(lastFrame()!)).toContain('cats:Perf,A11y,BP,SEO');
});

test('r runs an audit: statuses stream in, then the scoreboard and failing list render', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await waitForFrame(lastFrame, '감사 시작 중');
  fake.emitStatus('Gathering trace');
  await waitForFrame(lastFrame, 'Gathering trace');
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0].preset).toBe('mobile');
  expect(fake.requests[0].categories).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);
  expect(fake.requests[0].port).toBe(mock.port);
  fake.resolve(makeLhr());
  await waitForFrame(lastFrame, '감사 완료 · Perf 92');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('Perf 92');
  expect(frame).toContain('A11y 85');
  expect(frame).toContain('BP 100');
  expect(frame).toContain('SEO 67');
  expect(frame).toContain('LCP 1.8 s');
  expect(frame).toContain('TBT 41 ms');
  expect(frame).toContain('실패 audit 8건');
  expect(frame).toContain('Image elements have');
});

test('m toggles the preset and p removes performance from the categories for the next run', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, 'preset:mobile');
  stdin.write('m');
  await waitForFrame(lastFrame, 'preset:desktop');
  stdin.write('p');
  await waitForFrame(lastFrame, 'cats:A11y,BP,SEO');
  stdin.write('r');
  await sleep(50);
  expect(fake.requests[0].preset).toBe('desktop');
  expect(fake.requests[0].categories).toEqual(['accessibility', 'best-practices', 'seo']);
});

test('Enter opens the failing-audit detail with description; esc returns to the list', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await sleep(30);
  fake.resolve(makeLhr());
  await waitForFrame(lastFrame, '실패 audit 8건');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Informative elements should aim');
  expect(stripAnsi(lastFrame()!)).toContain('image-alt');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '실패 audit 8건');
});

test('j moves the failing selection and Enter opens the second entry', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await sleep(30);
  fake.resolve(makeLhr());
  await waitForFrame(lastFrame, '실패 audit 8건');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'meta-description');
  expect(stripAnsi(lastFrame()!)).toContain('Meta descriptions may be included');
});

test('esc while running cancels the audit', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await waitForFrame(lastFrame, '감사 시작 중');
  await untilRunning(fake);
  stdin.write(ESC);
  await waitForFrame(lastFrame, '감사 취소됨');
  expect(fake.canceled()).toBe(true);
  expect(stripAnsi(lastFrame()!)).toContain('감사 준비됨');
});

test('unmounting the app cancels a running audit child', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin, unmount } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await untilRunning(fake);
  unmount();
  await sleep(50);
  expect(fake.canceled()).toBe(true);
});

test('a failed audit surfaces the error line and toast', async () => {
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await sleep(30);
  fake.reject(new Error('ECONNREFUSED 127.0.0.1:9999'));
  await waitForFrame(lastFrame, '감사 실패');
  expect(stripAnsi(lastFrame()!)).toContain('ECONNREFUSED');
});

test('active throttle is cleared for the audit and restored afterwards', async () => {
  const conditions: Array<{ latency: number; offline: boolean }> = [];
  mock.respond('Network.emulateNetworkConditions', p => {
    conditions.push({ latency: p.latency, offline: p.offline });
    return {};
  });
  const fake = fakeRunner();
  const { lastFrame, stdin } = renderApp(fake.runner);
  await attach(lastFrame, stdin);
  stdin.write('T');
  await waitForFrame(lastFrame, 'fast3g');
  stdin.write('7');
  await waitForFrame(lastFrame, '감사 준비됨');
  stdin.write('r');
  await waitForFrame(lastFrame, '감사 시작 중');
  fake.resolve(makeLhr());
  await waitForFrame(lastFrame, '감사 완료');
  expect(conditions).toEqual([
    { latency: 150, offline: false },
    { latency: 0, offline: false },
    { latency: 150, offline: false },
  ]);
  expect(stripAnsi(lastFrame()!)).toContain('fast3g');
});
