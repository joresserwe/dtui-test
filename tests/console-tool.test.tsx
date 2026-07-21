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

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-con-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-con-data-'));
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

function feedLog(kind: string, text: string, ts = 1, extra: Record<string, unknown> = {}) {
  mock.emitEvent('Runtime.consoleAPICalled', {
    type: kind, timestamp: ts, args: [{ type: 'string', value: text }], ...extra,
  });
}

test('x opens the level picker and a multi-select filters entries by level', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('error', 'boom-err', 1);
  feedLog('warning', 'careful-warn', 2);
  feedLog('log', 'plain-log', 3);
  stdin.write('2');
  await waitForFrame(lastFrame, 'plain-log');
  stdin.write('x');
  await waitForFrame(lastFrame, '레벨 필터');
  expect(stripAnsi(lastFrame()!)).toContain('error/exception');
  stdin.write('j');
  await sleep(30);
  stdin.write(' ');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write(' ');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('레벨 필터');
  expect(frame).toContain('boom-err');
  expect(frame).toContain('careful-warn');
  expect(frame).not.toContain('plain-log');
  expect(frame).toContain('[error,warn]');
  expect(frame).toContain('2/3건');
});

test('/ edits a text filter with AND tokens and -negation, esc clears it', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('log', 'alpha one', 1);
  feedLog('log', 'alpha two', 2);
  feedLog('log', 'beta one', 3);
  stdin.write('2');
  await waitForFrame(lastFrame, 'beta one');
  stdin.write('/');
  await sleep(30);
  stdin.write('alpha -two');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '/alpha -two');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('alpha one');
  expect(frame).not.toContain('alpha two');
  expect(frame).not.toContain('beta one');
  expect(frame).toContain('1/3건');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'beta one');
  expect(stripAnsi(lastFrame()!)).not.toContain('/alpha');
});

test('C clears the console log with a toast and resets the selection', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('error', 'wipe-me-log', 1);
  stdin.write('2');
  await waitForFrame(lastFrame, 'wipe-me-log');
  stdin.write('C');
  await waitForFrame(lastFrame, '로그 지움');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('wipe-me-log');
  expect(frame).toContain('콘솔 출력 없음');
  expect(frame).toContain('0건');
});

test('consecutive duplicates collapse to one ×N row and the count keeps every occurrence out of it', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('log', 'dup-line', 1);
  feedLog('log', 'dup-line', 2);
  feedLog('log', 'dup-line', 3);
  feedLog('log', 'other-line', 4);
  feedLog('log', 'dup-line', 5);
  stdin.write('2');
  await waitForFrame(lastFrame, 'other-line');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('dup-line ×3');
  expect(frame).toContain('3건');
  const dupRows = frame.split('\n').filter(l => l.includes('dup-line'));
  expect(dupRows).toHaveLength(2);
});

test('Enter opens the entry detail with timestamp, full text, source, and stack; y copies; esc restores', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.exceptionThrown', {
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 5, 678),
    exceptionDetails: {
      text: 'Uncaught', lineNumber: 41, url: 'https://a.test/app.js',
      exception: { description: 'TypeError: detail-me\nsecond-detail-line' },
      stackTrace: { callFrames: [{ functionName: 'doDetail', url: 'https://a.test/app.js', lineNumber: 41 }] },
    },
  });
  stdin.write('2');
  await waitForFrame(lastFrame, 'detail-me');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'EXCEPTION');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toMatch(/\d{2}:\d{2}:\d{2}\.678/);
  expect(frame).toContain('second-detail-line');
  expect(frame).toContain('https://a.test/app.js:42');
  expect(frame).toContain('at doDetail');
  stdin.write('y');
  await waitForFrame(lastFrame, '복사됨');
  expect(copied).toContain('TypeError: detail-me');
  expect(copied).toContain('at doDetail');
  stdin.write(ESC);
  await sleep(60);
  const closed = stripAnsi(lastFrame()!);
  expect(closed).not.toContain('EXCEPTION');
  expect(closed.split('\n').find(l => l.includes('detail-me'))!.startsWith('▌')).toBe(true);
});

test('space toggles the inline stack expansion', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('error', 'stacky-log', 1, {
    stackTrace: { callFrames: [{ functionName: 'doStack', url: 'https://a.test/app.js', lineNumber: 9 }] },
  });
  stdin.write('2');
  await waitForFrame(lastFrame, 'stacky-log');
  expect(lastFrame()).not.toContain('at doStack');
  stdin.write(' ');
  await waitForFrame(lastFrame, 'at doStack');
  stdin.write(' ');
  await sleep(60);
  expect(lastFrame()).not.toContain('at doStack');
});

test('the command palette lists console commands only on the console tool', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('log', 'palette-log', 1);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  let frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('콘솔 로그 지우기');
  stdin.write(ESC);
  await sleep(50);
  stdin.write('2');
  await waitForFrame(lastFrame, 'palette-log');
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('콘솔');
  await sleep(50);
  frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('콘솔 필터');
  expect(frame).toContain('콘솔 로그 지우기');
  stdin.write(ESC);
  await sleep(50);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('레벨');
  await sleep(50);
  frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('레벨 필터 픽커');
  stdin.write('\r');
  await waitForFrame(lastFrame, '레벨 필터');
});

test('the level picker command opens the picker and 로그 상세 열기 needs an entry', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('로그 상세 열기');
  stdin.write(ESC);
  await sleep(40);
  feedLog('log', 'now-here', 1);
  await waitForFrame(lastFrame, 'now-here');
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('상세');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).toContain('로그 상세 열기');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'LOG');
  expect(stripAnsi(lastFrame()!)).toContain('now-here');
});

const OBJ_ARG = {
  type: 'object', objectId: 'obj-1', className: 'Object', description: 'Object',
  preview: {
    type: 'object', description: 'Object', overflow: false,
    properties: [{ name: 'a', type: 'number', value: '1' }],
  },
};

test('object logs preview inline and expand lazily in the detail overlay', async () => {
  mock.respond('Runtime.getProperties', params => {
    expect(params).toMatchObject({ objectId: 'obj-1', ownProperties: true, generatePreview: true });
    return {
      result: [
        { name: 'a', configurable: true, value: { type: 'number', value: 1 } },
        { name: 's', configurable: true, value: { type: 'string', value: 'str' } },
      ],
    };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1,
    args: [{ type: 'string', value: 'obj-log' }, OBJ_ARG],
  });
  stdin.write('2');
  await waitForFrame(lastFrame, 'obj-log {a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await waitForFrame(lastFrame, '펼침/접기');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▾ {a: 1}');
  let frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('a: 1');
  expect(frame).toContain('s: "str"');
  stdin.write('h');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('s: "str"');
});

test('an expired objectId degrades to a stale marker instead of an error', async () => {
  mock.respond('Runtime.getProperties', () => {
    throw new Error('Could not find object with given id');
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [OBJ_ARG] });
  stdin.write('2');
  await waitForFrame(lastFrame, '{a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '(만료된 객체)');
});

const UP = '[A';
const DOWN = '[B';

async function openConsoleInput(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('2');
  await sleep(40);
  stdin.write('i');
  await waitForFrame(lastFrame, '❯');
}

test('i opens the REPL prompt and Enter runs the expression with the command-line API', async () => {
  let seen: any;
  mock.respond('Runtime.evaluate', params => {
    seen = params;
    return { result: { type: 'number', value: 3, description: '3' } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('1+2');
  await waitForFrame(lastFrame, '❯ 1+2');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ 3');
  expect(seen).toMatchObject({
    expression: '1+2',
    includeCommandLineAPI: true,
    replMode: true,
    awaitPromise: true,
    generatePreview: true,
    userGesture: true,
    objectGroup: 'console-repl',
  });
  const frame = stripAnsi(lastFrame()!);
  // Echo row plus the still-open prompt with a cleared draft.
  expect(frame.split('\n').filter(l => l.includes('❯')).length).toBeGreaterThanOrEqual(2);
  expect(frame).toContain('❯ 1+2');
});

test('identical consecutive REPL runs stay separate rows instead of collapsing', async () => {
  mock.respond('Runtime.evaluate', () => ({ result: { type: 'number', value: 3, description: '3' } }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('1+2');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ 3');
  stdin.write('1+2');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '4건');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('×2');
  expect(frame.split('\n').filter(l => l.includes('❯ 1+2'))).toHaveLength(2);
});

test('an evaluation exception lands through the exception path with its description', async () => {
  mock.respond('Runtime.evaluate', () => ({
    result: { type: 'object', subtype: 'error', description: 'ReferenceError: nope is not defined' },
    exceptionDetails: {
      text: 'Uncaught', lineNumber: 0,
      exception: { type: 'object', subtype: 'error', objectId: 'err-1', description: 'ReferenceError: nope is not defined' },
    },
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('nope');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'ReferenceError: nope is not defined');
  const row = stripAnsi(lastFrame()!).split('\n').find(l => l.includes('ReferenceError'))!;
  expect(row).toContain('✖');
});

test('an object result is expandable in the detail overlay via its objectId', async () => {
  mock.respond('Runtime.evaluate', () => ({
    result: {
      type: 'object', objectId: 'repl-obj', className: 'Object', description: 'Object',
      preview: { type: 'object', description: 'Object', overflow: false, properties: [{ name: 'a', type: 'number', value: '1' }] },
    },
  }));
  mock.respond('Runtime.getProperties', params => {
    expect(params.objectId).toBe('repl-obj');
    return {
      result: [
        { name: 'a', configurable: true, value: { type: 'number', value: 1 } },
        { name: 's', configurable: true, value: { type: 'string', value: 'str' } },
      ],
    };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('window.obj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ {a: 1}');
  stdin.write(ESC);
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'RESULT');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, 's: "str"');
});

test('esc keeps the input draft for the session', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('half-typed');
  await waitForFrame(lastFrame, '❯ half-typed');
  stdin.write(ESC);
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).not.toContain('❯ half-typed');
  stdin.write('i');
  await waitForFrame(lastFrame, '❯ half-typed');
});

test('↑/↓ cycle the history with the draft at the bottom, deduped and persisted', async () => {
  mock.respond('Runtime.evaluate', () => ({ result: { type: 'undefined' } }));
  const { lastFrame, stdin, unmount } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('first()');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  stdin.write('second()');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  stdin.write('second()');
  await sleep(30);
  stdin.write('\r');
  await sleep(60);
  stdin.write('dra');
  await waitForFrame(lastFrame, '❯ dra');
  stdin.write(UP);
  await waitForFrame(lastFrame, '❯ second()');
  stdin.write(UP);
  await waitForFrame(lastFrame, '❯ first()');
  stdin.write(UP);
  await sleep(40);
  expect(stripAnsi(lastFrame()!)).toContain('❯ first()');
  stdin.write(DOWN);
  await waitForFrame(lastFrame, '❯ second()');
  stdin.write(DOWN);
  await waitForFrame(lastFrame, '❯ dra');

  const { readFile } = await import('node:fs/promises');
  const cfg = JSON.parse(await readFile(join(process.env.XDG_CONFIG_HOME!, 'devtools-tui', 'config.json'), 'utf8'));
  expect(cfg.consoleHistory).toEqual(['second()', 'first()']);
  unmount();

  const second = renderApp();
  await attach(second.lastFrame, second.stdin);
  second.stdin.write('2');
  await sleep(40);
  second.stdin.write('i');
  await waitForFrame(second.lastFrame, '❯');
  second.stdin.write(UP);
  await waitForFrame(second.lastFrame, '❯ second()');
});

test('C clears the log and releases the console-repl object group', async () => {
  let released: any;
  mock.respond('Runtime.releaseObjectGroup', params => { released = params; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('log', 'wipe-target', 1);
  stdin.write('2');
  await waitForFrame(lastFrame, 'wipe-target');
  stdin.write('C');
  await waitForFrame(lastFrame, '로그 지움');
  await sleep(50);
  expect(released).toEqual({ objectGroup: 'console-repl' });
});

test('executionContextsCleared drops cached detail children so expansion refetches', async () => {
  let calls = 0;
  mock.respond('Runtime.getProperties', () => {
    calls++;
    return { result: [{ name: 's', configurable: true, value: { type: 'string', value: 'str' } }] };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [OBJ_ARG] });
  stdin.write('2');
  await waitForFrame(lastFrame, '{a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 's: "str"');
  mock.emitEvent('Runtime.executionContextsCleared', {});
  await sleep(60);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('s: "str"');
  expect(frame).toContain('▸ {a: 1}');
  stdin.write('\r');
  await sleep(80);
  expect(calls).toBe(2);
});

test('the command palette offers 콘솔 입력 on the console tool and opens the prompt', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('콘솔 입력');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).toContain('콘솔 입력 (REPL)');
  stdin.write('\r');
  await waitForFrame(lastFrame, '❯');
});

test('the console help section documents the REPL input and $0', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  stdin.write('?');
  await waitForFrame(lastFrame, 'REPL 입력');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('$0');
  expect(frame).toContain('기록');
});

test('Y copies every filtered console line to the clipboard', async () => {
  let copied = '';
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  feedLog('error', 'boom-one', 1);
  feedLog('log', 'plain-two', 2);
  feedLog('log', 'skip-three', 3);
  stdin.write('2');
  await waitForFrame(lastFrame, 'skip-three');
  stdin.write('/');
  await sleep(30);
  stdin.write('-skip');
  await sleep(30);
  stdin.write('\r');
  await sleep(40);
  stdin.write('Y');
  await waitForFrame(lastFrame, '복사됨');
  expect(copied).toContain('[error] boom-one');
  expect(copied).toContain('plain-two');
  expect(copied).not.toContain('skip-three');
});

test('console.table logs expand to a table in the detail overlay', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', {
    type: 'table', timestamp: 1,
    args: [{
      type: 'object', subtype: 'array', objectId: 'tbl', className: 'Array', description: 'Array(2)',
      preview: {
        type: 'object', subtype: 'array', description: 'Array(2)',
        properties: [
          { name: '0', type: 'object', valuePreview: { type: 'object', properties: [{ name: 'name', type: 'string', value: 'alice' }] } },
          { name: '1', type: 'object', valuePreview: { type: 'object', properties: [{ name: 'name', type: 'string', value: 'bob' }] } },
        ],
      },
    }],
  });
  stdin.write('2');
  await waitForFrame(lastFrame, 'alice');
  stdin.write('\r');
  await waitForFrame(lastFrame, '(index)');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('name');
  expect(frame).toContain('"alice"');
  expect(frame).toContain('"bob"');
});

async function openObjectNode(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('2');
  await waitForFrame(lastFrame, '{a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await waitForFrame(lastFrame, '펼침/접기');
}

test('s stores the selected object as a global tempN probed in-page with a toast', async () => {
  let called: any;
  mock.respond('Runtime.callFunctionOn', p => { called = p; return { result: { type: 'string', value: 'temp3' } }; });
  mock.respond('Runtime.getProperties', () => ({ result: [{ name: 'a', configurable: true, value: { type: 'number', value: 1 } }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [OBJ_ARG] });
  await openObjectNode(lastFrame, stdin);
  stdin.write('s');
  await waitForFrame(lastFrame, 'temp3');
  expect(called).toMatchObject({ objectId: 'obj-1', returnByValue: true, arguments: [{ value: 1 }] });
  expect(called.functionDeclaration).toContain('in globalThis');
});

test('s and I on a non-object detail line report instead of silently doing nothing', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [OBJ_ARG] });
  stdin.write('2');
  await waitForFrame(lastFrame, '{a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▸ {a: 1}');
  stdin.write('s');
  await waitForFrame(lastFrame, '객체만 전역 변수로 저장 가능');
  stdin.write('I');
  await waitForFrame(lastFrame, 'DOM 노드가 아님');
});

test('I on a non-DOM object reports that it is not a DOM node', async () => {
  mock.respond('Runtime.getProperties', () => ({ result: [{ name: 'a', configurable: true, value: { type: 'number', value: 1 } }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [OBJ_ARG] });
  await openObjectNode(lastFrame, stdin);
  stdin.write('I');
  await waitForFrame(lastFrame, 'DOM 노드가 아님');
});

const NODE_ARG = {
  type: 'object', subtype: 'node', objectId: 'node-1', className: 'HTMLDivElement', description: 'div#app',
};
const TREE_DOC = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], children: [] },
  ] },
] } };

test('I on a DOM node arg switches to Elements and resolves the node', async () => {
  let requested: any;
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.requestNode', p => { requested = p; return { nodeId: 3 }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  mock.emitEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1, args: [{ type: 'string', value: 'node:' }, NODE_ARG],
  });
  stdin.write('2');
  await waitForFrame(lastFrame, 'div#app');
  stdin.write('\r');
  await waitForFrame(lastFrame, '▸ div#app');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await waitForFrame(lastFrame, '펼침/접기');
  stdin.write('I');
  for (let i = 0; i < 60 && !requested; i++) await sleep(20);
  expect(requested).toMatchObject({ objectId: 'node-1' });
});

test('T toggles a per-row timestamp in the console list', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedLog('log', 'stamped-line', 1234);
  stdin.write('2');
  await waitForFrame(lastFrame, 'stamped-line');
  stdin.write('T');
  await waitForFrame(lastFrame, '타임스탬프 표시');
  const row = stripAnsi(lastFrame()!).split('\n').find(l => l.includes('stamped-line'))!;
  expect(row).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  stdin.write('T');
  await waitForFrame(lastFrame, '타임스탬프 숨김');
  const row2 = stripAnsi(lastFrame()!).split('\n').find(l => l.includes('stamped-line'))!;
  expect(row2).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
});

function emitContext(id: number, origin: string, isDefault: boolean) {
  mock.emitEvent('Runtime.executionContextCreated', {
    context: { id, origin, name: `frame-${id}`, auxData: { frameId: `F${id}`, isDefault } },
  });
}

test('E opens the execution-context picker and selecting an iframe routes evals to its contextId', async () => {
  let seen: any;
  mock.respond('Runtime.evaluate', p => { seen = p; return { result: { type: 'number', value: 1, description: '1' } }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  emitContext(1, 'https://app.test', true);
  emitContext(2, 'https://ads.test', false);
  await sleep(60);
  stdin.write('E');
  await waitForFrame(lastFrame, '실행 컨텍스트');
  expect(stripAnsi(lastFrame()!)).toContain('ads.test');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '컨텍스트: ads.test');
  stdin.write('i');
  await waitForFrame(lastFrame, '❯');
  stdin.write('1');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ 1');
  expect(seen.contextId).toBe(2);
});

test('a destroyed selected context falls back to the default with a toast', async () => {
  let seen: any;
  mock.respond('Runtime.evaluate', p => { seen = p; return { result: { type: 'number', value: 1, description: '1' } }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  emitContext(1, 'https://app.test', true);
  emitContext(2, 'https://ads.test', false);
  await sleep(60);
  stdin.write('E');
  await waitForFrame(lastFrame, '실행 컨텍스트');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '컨텍스트: ads.test');
  mock.emitEvent('Runtime.executionContextDestroyed', { executionContextId: 2 });
  await waitForFrame(lastFrame, '최상위로 복귀');
  stdin.write('i');
  await waitForFrame(lastFrame, '❯');
  stdin.write('1');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◂ 1');
  expect(seen.contextId).toBeUndefined();
});

test('selection and expansion stay on the same entry across ring eviction', async () => {
  const { lastFrame, stdin } = renderApp({
    attach: async t => {
      const s = await DebugSession.attach(t, { persist: false });
      (s.console as any).ring.setCap(3);
      return s;
    },
  });
  await attach(lastFrame, stdin);
  feedLog('log', 'a-line', 1);
  feedLog('error', 'b-line', 2, {
    stackTrace: { callFrames: [{ functionName: 'bFn', url: 'https://a.test/app.js', lineNumber: 1 }] },
  });
  feedLog('log', 'c-line', 3);
  stdin.write('2');
  await waitForFrame(lastFrame, 'c-line');
  stdin.write('k');
  await sleep(30);
  stdin.write(' ');
  await waitForFrame(lastFrame, 'at bFn');
  expect(stripAnsi(lastFrame()!).split('\n').find(l => l.includes('b-line'))!.startsWith('▌')).toBe(true);

  feedLog('log', 'd-line', 4);
  await waitForFrame(lastFrame, 'd-line');
  let frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('a-line');
  expect(frame).toContain('at bFn');
  expect(frame.split('\n').find(l => l.includes('b-line'))!.startsWith('▌')).toBe(true);
  expect(frame.split('\n').find(l => l.includes('c-line'))!.startsWith('▌')).toBe(false);

  feedLog('log', 'e-line', 5);
  feedLog('log', 'f-line', 6);
  await waitForFrame(lastFrame, 'f-line');
  frame = stripAnsi(lastFrame()!);
  expect(frame).not.toContain('b-line');
  expect(frame.split('\n').find(l => l.includes('d-line'))!.startsWith('▌')).toBe(true);
});

test('a context tag persists on history rows after the context is destroyed', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('2');
  await sleep(40);
  emitContext(1, 'https://app.test', true);
  emitContext(2, 'https://ads.test', false);
  await sleep(60);
  feedLog('log', 'framed-line', 1, { executionContextId: 2 });
  await waitForFrame(lastFrame, '⟨ads.test⟩');
  mock.emitEvent('Runtime.executionContextDestroyed', { executionContextId: 2 });
  await sleep(80);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('framed-line');
  expect(frame).toContain('⟨ads.test⟩');
});

test('the eager preview blanks immediately when the draft changes', async () => {
  mock.respond('Runtime.evaluate', p => {
    if (p.objectGroup !== 'console-eager') return { result: { type: 'undefined' } };
    if (p.expression === 'a') return { result: { type: 'string', value: 'EAGER_FIRST' } };
    return new Promise(() => {});
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('a');
  await waitForFrame(lastFrame, 'EAGER_FIRST');
  stdin.write('b');
  const deadline = Date.now() + 2000;
  let frame = '';
  while (Date.now() < deadline) {
    frame = stripAnsi(lastFrame() ?? '');
    if (frame.includes('❯ ab') && !frame.includes('EAGER_FIRST')) break;
    await sleep(15);
  }
  expect(frame).toContain('❯ ab');
  expect(frame).not.toContain('EAGER_FIRST');
});

test('typing shows a dim eager preview of the side-effect-free result', async () => {
  mock.respond('Runtime.evaluate', p => {
    if (p.objectGroup === 'console-eager') {
      expect(p).toMatchObject({ throwOnSideEffect: true, silent: true, timeout: 500 });
      return { result: { type: 'string', value: 'EAGER_PREVIEW_42' } };
    }
    return { result: { type: 'undefined' } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openConsoleInput(lastFrame, stdin);
  stdin.write('foo');
  await waitForFrame(lastFrame, 'EAGER_PREVIEW_42');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('❯ foo');
  expect(frame).toContain('EAGER_PREVIEW_42');
});
