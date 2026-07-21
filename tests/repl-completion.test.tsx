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

const ESC = '';
const UP = '[A';
const DOWN = '[B';
const RIGHT = '[C';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-cmp-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-cmp-data-'));
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

async function openConsoleInput(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('2');
  await sleep(40);
  stdin.write('i');
  await waitForFrame(lastFrame, '❯');
}

interface EvalLog {
  completion: any[];
  repl: any[];
}

function respondEvaluate(replResult: unknown = { type: 'undefined' }, completionByExpr: Record<string, unknown> = {}): EvalLog {
  const log: EvalLog = { completion: [], repl: [] };
  mock.respond('Runtime.evaluate', params => {
    if (params.throwOnSideEffect) {
      if (params.objectGroup === 'console-eager') return {};
      log.completion.push(params);
      return completionByExpr[params.expression] ?? {};
    }
    log.repl.push(params);
    return { result: replResult };
  });
  return log;
}

const FOO_OBJ = { 'foo': { result: { type: 'object', objectId: 'foo-obj' } } };

function respondFooProps(): any[] {
  const seen: any[] = [];
  mock.respond('Runtime.getProperties', params => {
    seen.push(params);
    return {
      result: [
        { name: 'bar', value: { type: 'function' } },
        { name: 'baz', value: { type: 'string' } },
      ],
    };
  });
  return seen;
}

test('typing a bare identifier opens the globals popup with tags and the popup hint row, without shifting layout', async () => {
  respondEvaluate({ type: 'undefined' }, { globalThis: { result: { type: 'object', objectId: 'g1' } } });
  mock.respond('Runtime.getProperties', () => ({
    result: [
      { name: 'document', value: { type: 'object' } },
      { name: 'docQuery', value: { type: 'function' } },
    ],
  }));
  mock.respond('Runtime.globalLexicalScopeNames', () => ({ names: ['docStore'] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  const before = stripAnsi(lastFrame()!);
  expect(before).toContain('기록');
  stdin.write('doc');
  await waitForFrame(lastFrame, 'document');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('docQuery');
  expect(frame).toContain('docStore');
  expect(frame).toContain('prop');
  expect(frame).toContain('fn');
  expect(frame).toContain('↑/↓ 후보');
  expect(frame).toContain('Tab 채택');
  expect(frame).not.toContain('기록');
  expect(frame.split('\n').length).toBe(before.split('\n').length);
});

test('a dotted chain fetches inherited properties once and Tab accepts into the segment', async () => {
  const log = respondEvaluate({ type: 'undefined' }, FOO_OBJ);
  const props = respondFooProps();
  let released: any;
  mock.respond('Runtime.releaseObjectGroup', params => { if (params.objectGroup === 'console-completion') released = params; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('foo.');
  await waitForFrame(lastFrame, 'bar');
  expect(log.completion).toHaveLength(1);
  expect(log.completion[0].expression).toBe('foo');
  expect(props[0]).toEqual({ objectId: 'foo-obj', ownProperties: false, generatePreview: false });
  await sleep(100);
  expect(released).toEqual({ objectGroup: 'console-completion' });
  stdin.write('\t');
  await waitForFrame(lastFrame, '❯ foo.bar');
  expect(stripAnsi(lastFrame()!)).not.toContain('Tab 채택');
});

test('→ also accepts the highlighted candidate', async () => {
  respondEvaluate({ type: 'undefined' }, FOO_OBJ);
  respondFooProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('foo.');
  await waitForFrame(lastFrame, 'baz');
  stdin.write(DOWN);
  await sleep(30);
  stdin.write(DOWN);
  await sleep(30);
  stdin.write(RIGHT);
  await waitForFrame(lastFrame, '❯ foo.baz');
});

test('the popup suppresses history cycling and esc closes it before a second esc leaves input mode', async () => {
  respondEvaluate({ type: 'undefined' }, FOO_OBJ);
  respondFooProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('first()');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  stdin.write('foo.');
  await waitForFrame(lastFrame, '후보');
  stdin.write(UP);
  await sleep(60);
  let frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('❯ foo.');
  expect(frame).toContain('후보');
  stdin.write(ESC);
  await sleep(60);
  frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('후보');
  expect(frame).toContain('❯ foo.');
  expect(frame).toContain('실행');
  stdin.write(UP);
  await sleep(60);
  frame = stripAnsi(lastFrame()!);
  expect(frame.split('\n').filter(l => l.includes('❯ first()'))).toHaveLength(2);
  stdin.write(ESC);
  await sleep(60);
  frame = stripAnsi(lastFrame()!);
  expect(frame.split('\n').filter(l => l.includes('❯ first()'))).toHaveLength(1);
  expect(frame).not.toContain('❯ foo.');
});

test('Enter accepts only an arrow-selected candidate; the next Enter submits the line', async () => {
  const log = respondEvaluate({ type: 'number', value: 9, description: '9' }, FOO_OBJ);
  respondFooProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('foo.');
  await waitForFrame(lastFrame, 'baz');
  stdin.write(DOWN);
  await sleep(30);
  stdin.write(DOWN);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '❯ foo.baz');
  expect(log.repl).toHaveLength(0);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ 9');
  expect(log.repl).toHaveLength(1);
  expect(log.repl[0].expression).toBe('foo.baz');
});

test('Enter submits even while the popup is open when nothing is selected', async () => {
  const log = respondEvaluate({ type: 'number', value: 7, description: '7' }, { globalThis: { result: { type: 'object', objectId: 'g1' } } });
  mock.respond('Runtime.getProperties', () => ({ result: [{ name: 'document', value: { type: 'object' } }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('doc');
  await waitForFrame(lastFrame, '후보');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ 7');
  expect(log.repl).toHaveLength(1);
  expect(log.repl[0].expression).toBe('doc');
  expect(stripAnsi(lastFrame()!)).not.toContain('후보');
});

test('rapid keystrokes produce a single debounced completion fetch', async () => {
  const log = respondEvaluate({ type: 'undefined' }, { globalThis: { result: { type: 'object', objectId: 'g1' } } });
  mock.respond('Runtime.getProperties', () => ({ result: [{ name: 'document', value: { type: 'object' } }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('d');
  await sleep(20);
  stdin.write('o');
  await sleep(20);
  stdin.write('c');
  await sleep(500);
  expect(log.completion).toHaveLength(1);
  expect(log.completion[0].expression).toBe('globalThis');
  expect(stripAnsi(lastFrame()!)).toContain('document');
});

test('a throwOnSideEffect failure yields no popup and typing continues', async () => {
  respondEvaluate({ type: 'undefined' }, {
    foo: {
      result: { type: 'object', objectId: 'x' },
      exceptionDetails: { text: 'EvalError: Possible side-effect in debug-evaluate' },
    },
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('foo.');
  await sleep(400);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('후보');
  expect(frame).toContain('❯ foo.');
  stdin.write('x');
  await waitForFrame(lastFrame, '❯ foo.x');
});

test('console history entries complete as candidates', async () => {
  respondEvaluate();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('fetchData()');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  stdin.write('fet');
  await waitForFrame(lastFrame, 'Tab 채택');
  stdin.write('\t');
  await sleep(100);
  const frame = stripAnsi(lastFrame()!);
  expect(frame.split('\n').filter(l => l.includes('❯ fetchData()'))).toHaveLength(2);
});

test('the console help documents Tab completion', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  stdin.write('?');
  await waitForFrame(lastFrame, 'Tab / → (i)');
  expect(stripAnsi(lastFrame()!)).toContain('자동완성 팝업에서 후보 채택');
});
