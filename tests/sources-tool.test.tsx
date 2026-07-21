import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { createServer } from 'node:http';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { lruSet } from '../src/tui/hooks/use-sources-tool.js';
import { handleSourcesKey } from '../src/tui/keys/sources-keys.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = '\x1b';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-src-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-src-data-'));
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
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} clipboard={async () => {}} {...extra} />,
  );
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

const APP_SOURCE = 'function calc(a, b) {\n  const sum = a + b;\n  console.log(sum);\n  return sum;\n}\ncalc(1, 2);\n';

function feedScripts() {
  mock.emitEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://a.test/app.js', endLine: 6 });
  mock.emitEvent('Debugger.scriptParsed', { scriptId: 'sc-2', url: 'https://a.test/vendor.js', endLine: 100 });
}

const PAUSED_PARAMS = {
  reason: 'other',
  hitBreakpoints: ['bp-1'],
  callFrames: [
    {
      callFrameId: 'cf-0',
      functionName: 'calc',
      url: 'https://a.test/app.js',
      location: { scriptId: 'sc-1', lineNumber: 1, columnNumber: 2 },
      scopeChain: [
        { type: 'local', object: { type: 'object', objectId: 'scope-local' } },
        { type: 'global', object: { type: 'object', objectId: 'scope-global', description: 'Window' } },
      ],
    },
    {
      callFrameId: 'cf-1',
      functionName: '',
      url: 'https://a.test/app.js',
      location: { scriptId: 'sc-1', lineNumber: 5, columnNumber: 0 },
      scopeChain: [{ type: 'global', object: { type: 'object', objectId: 'scope-global' } }],
    },
  ],
};

function respondScopeProps() {
  mock.respond('Runtime.getProperties', p => {
    if (p.objectId === 'scope-local') {
      return {
        result: [
          { name: 'a', value: { type: 'number', value: 2, description: '2' } },
          {
            name: 'obj',
            value: {
              type: 'object', objectId: 'obj-9',
              preview: { type: 'object', description: 'Object', properties: [{ name: 'x', type: 'number', value: '7' }] },
            },
          },
        ],
      };
    }
    if (p.objectId === 'obj-9') {
      return { result: [{ name: 'x', value: { type: 'number', value: 7, description: '7' } }] };
    }
    return { result: [] };
  });
}

test('the sources tab enables the debugger, lists parsed scripts, and filters them', async () => {
  let enables = 0;
  mock.respond('Debugger.enable', () => {
    enables++;
    return { debuggerId: 'd1' };
  });
  const { lastFrame, stdin } = renderApp();
  stdin.write('5');
  await waitForFrame(lastFrame, 'Sources');
  expect(stripAnsi(lastFrame()!)).toContain('연결된 탭 없음');
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트 0개');
  for (let i = 0; i < 100 && enables === 0; i++) await sleep(10);
  expect(enables).toBe(1);
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  expect(stripAnsi(lastFrame()!)).toContain('vendor.js');
  expect(stripAnsi(lastFrame()!)).toContain('스크립트 2개');
  stdin.write('/');
  await sleep(30);
  stdin.write('app');
  await waitForFrame(lastFrame, '/app');
  stdin.write('\r');
  await sleep(30);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('app.js');
  expect(frame).not.toContain('vendor.js');
  expect(frame).toContain('스크립트 1/2개');
});

test('Enter opens the source viewer and b toggles a breakpoint at the resolved line', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  const setCalls: any[] = [];
  const removed: string[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push(p);
    return { breakpointId: 'bp-1', locations: [{ scriptId: 'sc-1', lineNumber: 1, columnNumber: 2 }] };
  });
  mock.respond('Debugger.removeBreakpoint', p => {
    removed.push(p.breakpointId);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const sum = a + b');
  expect(stripAnsi(lastFrame()!)).toContain('1 │ function calc');

  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, 'BP 설정: 2행');
  expect(setCalls[0]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 1 });
  expect(stripAnsi(lastFrame()!)).toMatch(/●.*2 │/);

  stdin.write('b');
  await waitForFrame(lastFrame, 'BP 해제: 2행');
  expect(removed).toEqual(['bp-1']);
  expect(stripAnsi(lastFrame()!)).not.toMatch(/●.*2 │/);
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 2개');
});

test('X cycles pause-on-exceptions through uncaught and all', async () => {
  const states: string[] = [];
  mock.respond('Debugger.setPauseOnExceptions', p => {
    states.push(p.state);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, 'X:none');
  stdin.write('X');
  await waitForFrame(lastFrame, 'X:uncaught');
  stdin.write('X');
  await waitForFrame(lastFrame, 'X:all');
  stdin.write('X');
  await waitForFrame(lastFrame, 'X:none');
  expect(states).toEqual(['uncaught', 'all', 'none']);
});

test('a pause in another tool raises a toast without switching tools', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await waitForFrame(lastFrame, '일시정지: app.js:2 — 5 Sources');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('z 구간');
  expect(frame).not.toContain('⏸ 브레이크포인트');
});

test('the paused view shows the stack and scope variables, and frames jump the excerpt', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await sleep(50);
  stdin.write('5');
  await waitForFrame(lastFrame, '⏸ 브레이크포인트');
  await waitForFrame(lastFrame, 'a: 2');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('calc @ app.js:2');
  expect(frame).toContain('(anonymous)');
  expect(frame).toContain('▾ Local');
  expect(frame).toContain('Global');
  expect(frame).toContain('obj: {x: 7}');
  expect(frame).toMatch(/▶ +2 │ +const sum = a \+ b;/);

  stdin.write('j');
  await waitForFrame(lastFrame, '(anonymous) @ app.js:6');
  expect(stripAnsi(lastFrame()!)).toMatch(/▶ +6 │ calc\(1, 2\);/);
});

test('w focuses the scope tree and Enter lazily expands a nested object', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await waitForFrame(lastFrame, 'a: 2');
  stdin.write('w');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '▾ obj');
  await waitForFrame(lastFrame, '   x: 7');
  expect(stripAnsi(lastFrame()!)).toMatch(/ {3,}x: 7/);
  stdin.write('h');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).not.toMatch(/ {3,}x: 7/);
  expect(stripAnsi(lastFrame()!)).toContain('▸ obj');
});

test('step keys drive the debugger and the marker follows the new pause location', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const stepped: string[] = [];
  mock.respond('Debugger.stepOver', () => {
    stepped.push('stepOver');
    return {};
  });
  mock.respond('Debugger.resume', () => {
    stepped.push('resume');
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await waitForFrame(lastFrame, '⏸ 브레이크포인트');

  stdin.write('n');
  await sleep(50);
  expect(stepped).toEqual(['stepOver']);
  mock.emitEvent('Debugger.resumed', {});
  await sleep(30);
  mock.emitEvent('Debugger.paused', {
    ...PAUSED_PARAMS,
    hitBreakpoints: [],
    callFrames: [{ ...PAUSED_PARAMS.callFrames[0], location: { scriptId: 'sc-1', lineNumber: 2, columnNumber: 2 } }],
  });
  await waitForFrame(lastFrame, 'calc @ app.js:3');

  stdin.write('c');
  await sleep(50);
  expect(stepped).toEqual(['stepOver', 'resume']);
  mock.emitEvent('Debugger.resumed', {});
  await waitForFrame(lastFrame, '스크립트 2개');
  expect(stripAnsi(lastFrame()!)).not.toContain('⏸');
});

test('an exception pause surfaces its message in the paused header', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', {
    ...PAUSED_PARAMS,
    reason: 'exception',
    hitBreakpoints: [],
    data: { type: 'object', subtype: 'error', description: 'Error: boom' },
  });
  await waitForFrame(lastFrame, '⏸ 예외');
  expect(stripAnsi(lastFrame()!)).toContain('Error: boom');
});

test('B sets a conditional breakpoint through the inline editor and marks it with a diamond', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  const setCalls: any[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push(p);
    return { breakpointId: `bp-${setCalls.length}`, locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber, columnNumber: 0 }] };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const sum = a + b');
  stdin.write('j');
  await sleep(30);
  stdin.write('B');
  await waitForFrame(lastFrame, '조건(2행)');
  stdin.write('a === 1');
  await waitForFrame(lastFrame, 'a === 1▌');
  stdin.write('\r');
  await waitForFrame(lastFrame, '조건 BP 설정: 2행');
  expect(setCalls[0]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 1, condition: 'a === 1' });
  expect(stripAnsi(lastFrame()!)).toMatch(/◆.*2 │/);
  stdin.write('j');
  await sleep(30);
  stdin.write('k');
  await waitForFrame(lastFrame, '◆ a === 1');
});

test('L sets a logpoint whose CDP condition wraps console.log and never pauses', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  const setCalls: any[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push(p);
    return { breakpointId: `bp-${setCalls.length}`, locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber, columnNumber: 0 }] };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const sum = a + b');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('L');
  await waitForFrame(lastFrame, '로그(3행)');
  stdin.write('sum {sum}');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '로그포인트 설정: 3행');
  expect(setCalls[0]).toMatchObject({ lineNumber: 2, condition: 'console.log(`sum ${sum}`), false' });
  expect(stripAnsi(lastFrame()!)).toMatch(/◎.*3 │/);
});

test('x blackboxes the selected script, dims it, and toggles back off', async () => {
  const patterns: string[][] = [];
  mock.respond('Debugger.setBlackboxPatterns', p => {
    patterns.push(p.patterns);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('j');
  await sleep(30);
  stdin.write('x');
  await waitForFrame(lastFrame, '블랙박스: vendor.js');
  expect(patterns).toEqual([['^https://a\\.test/vendor\\.js$']]);
  expect(stripAnsi(lastFrame()!)).toMatch(/⊘.*vendor\.js/);
  stdin.write('x');
  await waitForFrame(lastFrame, '블랙박스 해제: vendor.js');
  expect(patterns[1]).toEqual([]);
  expect(stripAnsi(lastFrame()!)).not.toContain('⊘');
});

test('F manages XHR breakpoints: add through the prompt, delete with d', async () => {
  const calls: Array<[string, string]> = [];
  mock.respond('DOMDebugger.setXHRBreakpoint', p => {
    calls.push(['set', p.url]);
    return {};
  });
  mock.respond('DOMDebugger.removeXHRBreakpoint', p => {
    calls.push(['remove', p.url]);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  stdin.write('F');
  await waitForFrame(lastFrame, 'XHR 브레이크포인트 없음');
  stdin.write('a');
  await waitForFrame(lastFrame, 'URL 부분 문자열: ▌');
  stdin.write('api/users');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'XHR BP 추가: api/users');
  expect(stripAnsi(lastFrame()!)).toContain('api/users');
  stdin.write('d');
  await waitForFrame(lastFrame, 'XHR BP 삭제: api/users');
  expect(calls).toEqual([
    ['set', 'api/users'],
    ['remove', 'api/users'],
  ]);
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 0개');
});

test('E toggles event listener breakpoints from the category list', async () => {
  const calls: Array<[string, string]> = [];
  mock.respond('DOMDebugger.setEventListenerBreakpoint', p => {
    calls.push(['set', p.eventName]);
    return {};
  });
  mock.respond('DOMDebugger.removeEventListenerBreakpoint', p => {
    calls.push(['remove', p.eventName]);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  stdin.write('E');
  await waitForFrame(lastFrame, '이벤트 리스너 브레이크포인트');
  stdin.write(' ');
  await waitForFrame(lastFrame, '이벤트 BP 설정: click');
  expect(stripAnsi(lastFrame()!)).toMatch(/●\s*click/);
  stdin.write(' ');
  await waitForFrame(lastFrame, '이벤트 BP 해제: click');
  expect(calls).toEqual([
    ['set', 'click'],
    ['remove', 'click'],
  ]);
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 0개');
});

test('watch expressions evaluate on the selected frame and re-render per pause', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const evals: Array<{ callFrameId: string; expression: string }> = [];
  mock.respond('Debugger.evaluateOnCallFrame', p => {
    evals.push({ callFrameId: p.callFrameId, expression: p.expression });
    if (p.expression === 'a + 1') return { result: { type: 'number', value: 3, description: '3' } };
    return { result: { type: 'undefined' }, exceptionDetails: { text: 'boom' } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await waitForFrame(lastFrame, 'a: 2');
  stdin.write('+');
  await waitForFrame(lastFrame, ' + ▌');
  stdin.write('a + 1');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'a + 1: 3');
  expect(evals).toContainEqual({ callFrameId: 'cf-0', expression: 'a + 1' });

  stdin.write('+');
  await sleep(30);
  stdin.write('nope');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'nope: <error>');

  stdin.write('w');
  await sleep(30);
  stdin.write('j');
  await waitForFrame(lastFrame, '(anonymous) @ app.js:6');
  for (let i = 0; i < 100 && !evals.some(e => e.callFrameId === 'cf-1' && e.expression === 'a + 1'); i++) await sleep(10);
  expect(evals).toContainEqual({ callFrameId: 'cf-1', expression: 'a + 1' });

  stdin.write('w');
  await sleep(30);
  stdin.write('w');
  await sleep(30);
  stdin.write('k');
  await sleep(30);
  stdin.write('d');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).not.toContain('a + 1');
  expect(stripAnsi(lastFrame()!)).toContain('nope');
});

test('an XHR pause names the trigger and matched URL in the paused header', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', {
    ...PAUSED_PARAMS,
    reason: 'XHR',
    hitBreakpoints: [],
    data: { url: 'https://a.test/api/users' },
  });
  await waitForFrame(lastFrame, '⏸ XHR/fetch 브레이크포인트 · https://a.test/api/users');
});

const MINI_SOURCE = 'function calc(a,b){var s=a+b;return s;}\ncalc(1,2);';

const MAP_JSON = JSON.stringify({
  version: 3,
  sources: ['src/app.ts'],
  sourcesContent: ['const x = 1;\nexport default x;'],
  mappings: 'AAAA;AACA',
});
const MAP_URL = `data:application/json;base64,${Buffer.from(MAP_JSON).toString('base64')}`;

function feedMappedScripts() {
  mock.emitEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://a.test/app.js', endLine: 6, sourceMapURL: MAP_URL });
  mock.emitEvent('Debugger.scriptParsed', { scriptId: 'sc-2', url: 'https://a.test/vendor.js', endLine: 100 });
}

test('P pretty-prints the source and breakpoints map back to original lines', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: MINI_SOURCE }));
  const setCalls: any[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push(p);
    return { breakpointId: 'bp-1', locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber, columnNumber: 0 }] };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'function calc');
  expect(stripAnsi(lastFrame()!)).toContain('function calc(a,b){var s=a+b;return s;}');

  stdin.write('P');
  await waitForFrame(lastFrame, 'var s=a+b;');
  const pretty = stripAnsi(lastFrame()!);
  expect(pretty).toContain('pretty');
  expect(pretty).toMatch(/2 │ {3}var s=a\+b;/);
  expect(pretty).not.toContain('function calc(a,b){var s=a+b;');

  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, 'BP 설정: 1행');
  expect(setCalls[0]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 0 });
  expect(stripAnsi(lastFrame()!)).toMatch(/●.*1 │/);

  stdin.write('P');
  await waitForFrame(lastFrame, 'function calc(a,b){var s=a+b;return s;}');
  expect(stripAnsi(lastFrame()!)).not.toContain('pretty');
});

test('m lists the original files of a source-mapped script and opens them read-only', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedMappedScripts();
  await waitForFrame(lastFrame, 'app.js');
  expect(stripAnsi(lastFrame()!)).toMatch(/» https:\/\/a\.test\/app\.js/);
  expect(stripAnsi(lastFrame()!)).not.toMatch(/» https:\/\/a\.test\/vendor\.js/);

  stdin.write('m');
  await waitForFrame(lastFrame, '소스맵 원본 파일');
  expect(stripAnsi(lastFrame()!)).toContain('src/app.ts');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const x = 1;');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('export default x;');
  expect(frame).toContain('읽기 전용');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '소스맵 원본 파일');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 2개');
});

test('m on a script without a source map raises a toast', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedMappedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('j');
  await sleep(30);
  stdin.write('m');
  await waitForFrame(lastFrame, '소스맵 없음');
});

test('a paused frame in a mapped script shows the original file:line in the header', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedMappedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await waitForFrame(lastFrame, '⏸ 브레이크포인트');
  await waitForFrame(lastFrame, 'src/app.ts:2');
  expect(stripAnsi(lastFrame()!)).toContain('calc @ app.js:2');
});

test('e live-edits the script: dry run, apply, refresh, and re-apply breakpoints', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: MINI_SOURCE }));
  const setCalls: any[] = [];
  const removed: string[] = [];
  const srcCalls: any[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push(p);
    return { breakpointId: `bp-${setCalls.length}`, locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber, columnNumber: 0 }] };
  });
  mock.respond('Debugger.removeBreakpoint', p => {
    removed.push(p.breakpointId);
    return {};
  });
  mock.respond('Debugger.setScriptSource', p => {
    srcCalls.push({ scriptId: p.scriptId, dryRun: p.dryRun, scriptSource: p.scriptSource });
    return { status: 'Ok' };
  });
  const EDITED = 'function calc(a,b){\n  return 99;\n}\ncalc(1,2);';
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, EDITED);
    },
  });
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'function calc');
  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, 'BP 설정: 2행');
  expect(setCalls).toHaveLength(1);

  stdin.write('e');
  await waitForFrame(lastFrame, '라이브 에딧 적용됨');
  expect(srcCalls).toEqual([
    { scriptId: 'sc-1', dryRun: true, scriptSource: EDITED },
    { scriptId: 'sc-1', dryRun: false, scriptSource: EDITED },
  ]);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('return 99;');
  expect(frame).toContain('✎');
  expect(removed).toEqual(['bp-1']);
  expect(setCalls).toHaveLength(2);
  expect(setCalls[1]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 1 });
});

test('a failed live-edit dry run surfaces the compile error and never applies', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: MINI_SOURCE }));
  const srcCalls: any[] = [];
  mock.respond('Debugger.setScriptSource', p => {
    srcCalls.push(p.dryRun);
    return { status: 'CompileError', exceptionDetails: { text: 'Unexpected token' } };
  });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, 'bad(');
    },
  });
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'function calc');
  stdin.write('e');
  await waitForFrame(lastFrame, '라이브 에딧 실패');
  expect(stripAnsi(lastFrame()!)).toContain('Unexpected token');
  expect(srcCalls).toEqual([true]);
  expect(stripAnsi(lastFrame()!)).toContain('function calc(a,b){var s=a+b;return s;}');
  expect(stripAnsi(lastFrame()!)).not.toContain('✎');
});

test('an unchanged live-edit round trip applies nothing', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: MINI_SOURCE }));
  const srcCalls: any[] = [];
  mock.respond('Debugger.setScriptSource', () => {
    srcCalls.push(1);
    return { status: 'Ok' };
  });
  const { lastFrame, stdin } = renderApp({ editRunner: async () => {} });
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'function calc');
  stdin.write('e');
  await waitForFrame(lastFrame, '변경 없음');
  expect(srcCalls).toEqual([]);
});

test('a render during the reconnect apply window does not wipe persisted breakpoints', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  let slowThrottle = false;
  mock.respond('Network.emulateNetworkConditions', async () => {
    if (slowThrottle) await sleep(300);
    return {};
  });
  const setCalls: any[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push({ url: p.url, lineNumber: p.lineNumber });
    return { breakpointId: `bp-${setCalls.length}`, locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber }] };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('T');
  await waitForFrame(lastFrame, 'fast3g');
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const sum = a + b');
  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, 'BP 설정');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 2개');
  expect(setCalls).toHaveLength(1);

  slowThrottle = true;
  mock.dropConnections();
  let flip = false;
  const kick = setInterval(() => {
    flip = !flip;
    stdin.write(flip ? 'j' : 'k');
  }, 25);
  await waitForFrame(lastFrame, '재연결됨', 5000);
  clearInterval(kick);
  for (let i = 0; i < 100 && setCalls.length < 2; i++) await sleep(10);
  expect(setCalls[1]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 1 });

  mock.dropConnections();
  for (let i = 0; i < 200 && setCalls.length < 3; i++) await sleep(10);
  expect(setCalls[2]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 1 });
});

test('breakpoints and pause-on-exceptions are re-applied after a reconnect', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  let enables = 0;
  const setCalls: any[] = [];
  const states: string[] = [];
  const patterns: string[][] = [];
  const xhrSets: string[] = [];
  mock.respond('Debugger.enable', () => {
    enables++;
    return { debuggerId: 'd1' };
  });
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push({ url: p.url, lineNumber: p.lineNumber, condition: p.condition });
    return { breakpointId: `bp-${setCalls.length}`, locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber }] };
  });
  mock.respond('Debugger.setPauseOnExceptions', p => {
    states.push(p.state);
    return {};
  });
  mock.respond('Debugger.setBlackboxPatterns', p => {
    patterns.push(p.patterns);
    return {};
  });
  mock.respond('DOMDebugger.setXHRBreakpoint', p => {
    xhrSets.push(p.url);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const sum = a + b');
  stdin.write('j');
  await sleep(30);
  stdin.write('B');
  await waitForFrame(lastFrame, '조건(2행)');
  stdin.write('a === 1');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '조건 BP 설정');
  stdin.write('X');
  await waitForFrame(lastFrame, 'X:uncaught');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 2개');
  stdin.write('j');
  await sleep(30);
  stdin.write('x');
  await waitForFrame(lastFrame, '블랙박스: vendor.js');
  stdin.write('F');
  await sleep(30);
  stdin.write('a');
  await sleep(30);
  stdin.write('api');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'XHR BP 추가: api');
  stdin.write(ESC);
  await waitForFrame(lastFrame, '스크립트 2개');
  expect(enables).toBe(1);
  expect(setCalls).toEqual([{ url: 'https://a.test/app.js', lineNumber: 1, condition: 'a === 1' }]);
  expect(patterns).toEqual([['^https://a\\.test/vendor\\.js$']]);
  expect(xhrSets).toEqual(['api']);

  mock.dropConnections();
  await waitForFrame(lastFrame, '재연결됨', 5000);
  await sleep(100);
  expect(enables).toBe(2);
  expect(setCalls).toEqual([
    { url: 'https://a.test/app.js', lineNumber: 1, condition: 'a === 1' },
    { url: 'https://a.test/app.js', lineNumber: 1, condition: 'a === 1' },
  ]);
  expect(states).toEqual(['uncaught', 'uncaught']);
  expect(patterns).toEqual([['^https://a\\.test/vendor\\.js$'], ['^https://a\\.test/vendor\\.js$']]);
  expect(xhrSets).toEqual(['api', 'api']);
});

test('lruSet caps the map and evicts the least recently touched entry', () => {
  let m = new Map<string, string>();
  for (const k of ['a', 'b', 'c']) m = lruSet(m, k, k.toUpperCase(), 3);
  expect([...m.keys()]).toEqual(['a', 'b', 'c']);
  m = lruSet(m, 'a', 'A2', 3);
  expect([...m.keys()]).toEqual(['b', 'c', 'a']);
  expect(m.get('a')).toBe('A2');
  m = lruSet(m, 'd', 'D', 3);
  expect([...m.keys()]).toEqual(['c', 'a', 'd']);
});

function pausedKeyHarness(bodyH: number, focus: 'stack' | 'scope' | 'watch', watches: string[]) {
  const opened: boolean[] = [];
  let pausedFocus = focus;
  const src: any = {
    viewScript: null,
    origin: null,
    mapScript: null,
    xhrMode: false,
    eventMode: false,
    pausedDismissed: false,
    watches,
    watchInput: null,
    watchSel: 0,
    frameSel: 0,
    scopeCursor: 0,
    scopeExpanded: new Set(),
    scopeChildren: new Map(),
    prettyOn: new Set(),
    prettyMaps: new Map(),
    maps: new Map(),
    sources: new Map(),
    srcFilter: '',
    srcSel: 0,
    srcCursor: 0,
    setPausedFocus: (f: any) => {
      pausedFocus = typeof f === 'function' ? f(pausedFocus) : f;
    },
    openWatchInput: (fit: boolean) => opened.push(fit),
  };
  const frame = { callFrameId: 'cf-0', functionName: '', scriptId: 'sc-1', url: '', line: 0, column: 0, scopes: [] };
  const ctx: any = {
    src,
    attached: { session: {} },
    bodyH,
    listNav: () => false,
    gPending: { current: false },
    scripts: [],
    paused: { reason: 'other', frames: [frame], hitBreakpoints: [] },
    scopeLines: [],
    withEditor: async () => null,
  };
  return { ctx, opened, focus: () => pausedFocus };
}

test('w skips the watch pane while it is collapsed and cycles into it once it fits', () => {
  const collapsed = pausedKeyHarness(8, 'scope', ['a + 1']);
  handleSourcesKey(collapsed.ctx, 'w', {} as any);
  expect(collapsed.focus()).toBe('stack');
  const roomy = pausedKeyHarness(24, 'scope', ['a + 1']);
  handleSourcesKey(roomy.ctx, 'w', {} as any);
  expect(roomy.focus()).toBe('watch');
});

test('+ reports whether the watch pane can fit instead of silently no-opping', () => {
  const collapsed = pausedKeyHarness(8, 'stack', []);
  handleSourcesKey(collapsed.ctx, '+', {} as any);
  expect(collapsed.opened).toEqual([false]);
  const roomy = pausedKeyHarness(24, 'stack', []);
  handleSourcesKey(roomy.ctx, '+', {} as any);
  expect(roomy.opened).toEqual([true]);
});

test('watch evals carry an object group and only the superseded group is released', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  respondScopeProps();
  const evals: Array<{ callFrameId: string; objectGroup?: string }> = [];
  mock.respond('Debugger.evaluateOnCallFrame', p => {
    evals.push({ callFrameId: p.callFrameId, objectGroup: p.objectGroup });
    return { result: { type: 'number', value: 3, description: '3' } };
  });
  const released: string[] = [];
  mock.respond('Runtime.releaseObjectGroup', p => {
    released.push(p.objectGroup);
    return {};
  });
  const watchReleases = () => released.filter(g => g.startsWith('watch-'));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  feedScripts();
  await sleep(50);
  stdin.write('5');
  await sleep(50);
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await waitForFrame(lastFrame, 'a: 2');
  stdin.write('+');
  await waitForFrame(lastFrame, ' + ▌');
  stdin.write('a + 1');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'a + 1: 3');
  const firstGroup = evals[0]?.objectGroup;
  expect(firstGroup).toMatch(/^watch-\d+$/);
  expect(watchReleases()).toEqual([]);

  stdin.write('w');
  await sleep(30);
  stdin.write('j');
  await waitForFrame(lastFrame, '(anonymous) @ app.js:6');
  for (let i = 0; i < 100 && watchReleases().length === 0; i++) await sleep(10);
  expect(watchReleases()).toEqual([firstGroup]);
  const secondGroup = evals[evals.length - 1]!.objectGroup;
  expect(secondGroup).toMatch(/^watch-\d+$/);
  expect(secondGroup).not.toBe(firstGroup);
  expect(stripAnsi(lastFrame()!)).toContain('a + 1: 3');
});

test('a failed conditional edit restores the removed breakpoint', async () => {
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: APP_SOURCE }));
  const setCalls: Array<{ lineNumber: number; condition?: string }> = [];
  const removed: string[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push({ lineNumber: p.lineNumber, condition: p.condition });
    if (p.condition !== undefined) throw new Error('boom');
    return { breakpointId: `bp-${setCalls.length}`, locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber, columnNumber: 0 }] };
  });
  mock.respond('Debugger.removeBreakpoint', p => {
    removed.push(p.breakpointId);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('5');
  await waitForFrame(lastFrame, '스크립트');
  feedScripts();
  await waitForFrame(lastFrame, 'app.js');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'const sum = a + b');
  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, 'BP 설정: 2행');
  stdin.write('B');
  await waitForFrame(lastFrame, '조건(2행)');
  stdin.write('a === 1');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'BP 실패');
  expect(removed).toEqual(['bp-1']);
  expect(setCalls).toEqual([
    { lineNumber: 1, condition: undefined },
    { lineNumber: 1, condition: 'a === 1' },
    { lineNumber: 1, condition: undefined },
  ]);
  expect(stripAnsi(lastFrame()!)).toMatch(/●.*2 │/);
});

test('a live edit invalidates the cached source map so m refetches it', async () => {
  let hits = 0;
  const mapJson = JSON.stringify({ version: 3, sources: ['src/app.ts'], sourcesContent: ['const x = 1;'], mappings: 'AAAA' });
  const srv = createServer((_req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    res.end(mapJson);
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const mapPort = (srv.address() as { port: number }).port;
  try {
    mock.respond('Debugger.getScriptSource', () => ({ scriptSource: MINI_SOURCE }));
    mock.respond('Debugger.setScriptSource', () => ({ status: 'Ok' }));
    const EDITED = 'function calc(a,b){\n  return 99;\n}\ncalc(1,2);';
    const { lastFrame, stdin } = renderApp({
      editRunner: async (file: string) => {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(file, EDITED);
      },
    });
    await attach(lastFrame, stdin);
    stdin.write('5');
    await waitForFrame(lastFrame, '스크립트');
    mock.emitEvent('Debugger.scriptParsed', {
      scriptId: 'sc-1',
      url: 'https://a.test/app.js',
      endLine: 6,
      sourceMapURL: `http://127.0.0.1:${mapPort}/app.js.map`,
    });
    await waitForFrame(lastFrame, 'app.js');
    stdin.write('m');
    await waitForFrame(lastFrame, 'src/app.ts');
    expect(hits).toBe(1);
    stdin.write(ESC);
    await waitForFrame(lastFrame, '스크립트 1개');
    stdin.write('\r');
    await waitForFrame(lastFrame, 'function calc');
    stdin.write('e');
    await waitForFrame(lastFrame, '라이브 에딧 적용됨');
    stdin.write(ESC);
    await waitForFrame(lastFrame, '스크립트 1개');
    stdin.write('m');
    await waitForFrame(lastFrame, 'src/app.ts');
    for (let i = 0; i < 100 && hits < 2; i++) await sleep(10);
    expect(hits).toBe(2);
  } finally {
    srv.close();
  }
});
