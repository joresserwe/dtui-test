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
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = '\x1b';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-comp-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-comp-data-'));
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

function renderApp() {
  return render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} clipboard={async () => {}} />,
  );
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

const REACT_SCAN = {
  frameworks: [{
    framework: 'react',
    version: '18.3.1',
    nodes: [
      { id: 0, name: 'App', depth: 0, parentId: null, kind: 'fn', hostIdx: 0, instIdx: 0 },
      { id: 1, name: 'Header', depth: 1, parentId: 0, kind: 'fn', hostIdx: 1, instIdx: 1 },
      { id: 2, name: 'Row', depth: 1, parentId: 0, kind: 'memo', hostIdx: 2, instIdx: 2 },
      { id: 3, name: 'Ghost', depth: 2, parentId: 2, kind: 'fn' },
    ],
    truncated: false,
  }],
  errors: [],
};

const TREE_DOC = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], children: [
      { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], children: [] },
    ] },
  ] },
] } };

interface EvalLog { scans: number; hostPicks: string[] }

function respondScan(scan: () => unknown, log?: EvalLog) {
  mock.respond('Runtime.evaluate', p => {
    if (p.objectGroup === 'framework-inspect') {
      log?.hostPicks.push(p.expression);
      return { result: { type: 'object', subtype: 'node', className: 'HTMLDivElement', objectId: 'host-obj-1' } };
    }
    if (p.returnByValue) {
      if (log) log.scans++;
      return { result: { type: 'object', value: scan() } };
    }
    return {};
  });
}

test('the components tab detects on entry and renders the tree with kinds, fold glyphs, and header', async () => {
  respondScan(() => REACT_SCAN);
  const { lastFrame, stdin } = renderApp();
  stdin.write('6');
  await waitForFrame(lastFrame, 'Components');
  expect(strip(lastFrame()!)).toContain('연결된 탭 없음');
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, 'react 18.3.1');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('컴포넌트 4개');
  expect(frame).toContain('▾ App');
  expect(frame).toContain('Header');
  expect(frame).toContain('Row ⟨memo⟩');
  expect(frame).toContain('Ghost (요소 없음)');
  expect(frame).toContain('H 하이라이트');
});

test('h folds the selected subtree and l unfolds it', async () => {
  respondScan(() => REACT_SCAN);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('h');
  await waitForFrame(lastFrame, '▸ App');
  expect(strip(lastFrame()!)).not.toContain('Header');
  stdin.write('l');
  await waitForFrame(lastFrame, '▾ App');
  expect(strip(lastFrame()!)).toContain('Header');
});

test('/ filters components by name and esc clears the filter', async () => {
  respondScan(() => REACT_SCAN);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('/');
  await sleep(30);
  stdin.write('head');
  await waitForFrame(lastFrame, '/head▌');
  stdin.write('\r');
  await sleep(30);
  const frame = strip(lastFrame()!);
  expect(frame).toContain('Header');
  expect(frame).not.toContain('Ghost');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'Ghost');
});

test('H highlights the selected component host element on the page', async () => {
  const log: EvalLog = { scans: 0, hostPicks: [] };
  respondScan(() => REACT_SCAN, log);
  const highlighted: number[] = [];
  mock.respond('DOM.requestNode', () => ({ nodeId: 42 }));
  mock.respond('Overlay.highlightNode', p => {
    highlighted.push(p.nodeId);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('H');
  await waitForFrame(lastFrame, '하이라이트: App');
  expect(highlighted).toEqual([42]);
  expect(log.hostPicks).toHaveLength(1);
  expect(log.hostPicks[0]).toContain('__dtuiFwHosts');
  expect(log.hostPicks[0]).toContain('[0]');
});

test('H on a component without a rendered element toasts instead of highlighting', async () => {
  respondScan(() => REACT_SCAN);
  const highlighted: number[] = [];
  mock.respond('Overlay.highlightNode', p => {
    highlighted.push(p.nodeId);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('G');
  await sleep(30);
  stdin.write('H');
  await waitForFrame(lastFrame, '렌더된 요소가 없음');
  expect(highlighted).toEqual([]);
});

test('Enter jumps to the Elements tab and reveals the component host node', async () => {
  const log: EvalLog = { scans: 0, hostPicks: [] };
  respondScan(() => REACT_SCAN, log);
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.requestNode', () => ({ nodeId: 9 }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'span.x');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('3 Elements');
  const selLine = frame.split('\n').find(l => l.includes('▌'));
  expect(selLine).toContain('span.x');
  expect(log.hostPicks[0]).toContain('[1]');
});

test('leaving the components tool hides the page highlight', async () => {
  respondScan(() => REACT_SCAN);
  mock.respond('DOM.requestNode', () => ({ nodeId: 42 }));
  let hidden = 0;
  mock.respond('Overlay.hideHighlight', () => {
    hidden++;
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('H');
  await waitForFrame(lastFrame, '하이라이트: App');
  expect(hidden).toBe(0);
  stdin.write('1');
  for (let i = 0; i < 100 && hidden === 0; i++) await sleep(10);
  expect(hidden).toBe(1);
});

test('H and Enter are ignored while a rescan is in flight', async () => {
  let release: (() => void) | undefined;
  const log: EvalLog = { scans: 0, hostPicks: [] };
  mock.respond('Runtime.evaluate', async p => {
    if (p.objectGroup === 'framework-inspect') {
      log.hostPicks.push(p.expression);
      return { result: { type: 'object', subtype: 'node', objectId: 'host-obj-1' } };
    }
    if (p.returnByValue) {
      log.scans++;
      if (log.scans > 1) await new Promise<void>(r => { release = r; });
      return { result: { type: 'object', value: REACT_SCAN } };
    }
    return {};
  });
  mock.respond('DOM.requestNode', () => ({ nodeId: 42 }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('r');
  for (let i = 0; i < 100 && !release; i++) await sleep(10);
  expect(release).toBeDefined();
  stdin.write('H');
  stdin.write('\r');
  await sleep(100);
  expect(log.hostPicks).toEqual([]);
  release!();
  await sleep(100);
  stdin.write('H');
  await waitForFrame(lastFrame, '하이라이트: App');
  expect(log.hostPicks).toHaveLength(1);
});

test('a detected framework with an empty tree shows the empty-tree line, not the filter copy', async () => {
  respondScan(() => ({
    frameworks: [{ framework: 'react', version: '18.3.1', nodes: [], truncated: false }],
    errors: [],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, 'react 18.3.1');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('컴포넌트 노드 없음');
  expect(frame).not.toContain('일치하는 컴포넌트 없음');
});

test('a page without a framework shows the guidance screen and r rescans', async () => {
  let scan: unknown = { frameworks: [], errors: [] };
  const log: EvalLog = { scans: 0, hostPicks: [] };
  respondScan(() => scan, log);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, 'React/Vue 감지 안 됨');
  expect(strip(lastFrame()!)).toContain('프로덕션 빌드');
  expect(log.scans).toBe(1);
  scan = REACT_SCAN;
  stdin.write('r');
  await waitForFrame(lastFrame, 'react 18.3.1');
  expect(log.scans).toBe(2);
});

test('a navigation clears the tree and triggers an automatic rescan on the new document', async () => {
  let scan: unknown = REACT_SCAN;
  const log: EvalLog = { scans: 0, hostPicks: [] };
  respondScan(() => scan, log);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, 'react 18.3.1');
  scan = {
    frameworks: [{
      framework: 'vue',
      version: '3.5.40',
      nodes: [{ id: 0, name: 'NewApp', depth: 0, parentId: null, kind: 'component', hostIdx: 0 }],
      truncated: false,
    }],
    errors: [],
  };
  mock.emitEvent('DOM.documentUpdated', {});
  await waitForFrame(lastFrame, 'vue 3.5.40');
  expect(strip(lastFrame()!)).toContain('NewApp');
  expect(strip(lastFrame()!)).not.toContain('Header');
  expect(log.scans).toBe(2);
});

const SECTION_PROPS = {
  name: 'props',
  value: {
    type: 'object', objectId: 'sec-props', className: 'Object',
    preview: { type: 'object', description: 'Object', properties: [{ name: 'title', type: 'string', value: 'hi' }] },
  },
};
const SECTION_HOOKS = {
  name: 'hooks',
  value: { type: 'object', subtype: 'array', objectId: 'sec-hooks', description: 'Array(2)' },
};

function respondInspect(opts: {
  scan?: unknown;
  inspectExprs?: string[];
  inspectResult?: () => unknown;
  sections?: unknown[];
  releases?: string[];
} = {}) {
  mock.respond('Runtime.evaluate', p => {
    if (p.objectGroup === 'framework-inspect') {
      if (p.expression.includes('__dtuiFwInst')) {
        opts.inspectExprs?.push(p.expression);
        return { result: (opts.inspectResult ?? (() => ({ type: 'object', className: 'Object', objectId: 'insp-1' })))() };
      }
      return { result: { type: 'object', subtype: 'node', className: 'HTMLDivElement', objectId: 'host-obj-1' } };
    }
    if (p.returnByValue) return { result: { type: 'object', value: opts.scan ?? REACT_SCAN } };
    return {};
  });
  mock.respond('Runtime.getProperties', p => {
    if (p.objectId === 'insp-1') return { result: opts.sections ?? [SECTION_PROPS, SECTION_HOOKS] };
    if (p.objectId === 'sec-props') return { result: [{ name: 'title', value: { type: 'string', value: 'hi' } }] };
    return { result: [] };
  });
  if (opts.releases) {
    mock.respond('Runtime.releaseObjectGroup', p => {
      opts.releases!.push(p.objectGroup);
      return {};
    });
  }
}

test('i opens the inspect pane with sections and l lazily expands props', async () => {
  const inspectExprs: string[] = [];
  respondInspect({ inspectExprs });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, 'App 검사');
  const frame = strip(lastFrame()!);
  expect(frame).toContain('▸ props:');
  expect(frame).toContain('hooks (raw)');
  expect(inspectExprs).toHaveLength(1);
  expect(inspectExprs[0]).toContain('__dtuiFwInst');
  expect(inspectExprs[0]).toContain('[0]');
  stdin.write('l');
  await waitForFrame(lastFrame, 'title');
  expect(strip(lastFrame()!)).toContain('hi');
});

test('esc closes the inspect pane and releases the framework object group', async () => {
  const releases: string[] = [];
  respondInspect({ releases });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '▸ props:');
  const before = releases.filter(g => g === 'framework-inspect').length;
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'H 하이라이트');
  expect(strip(lastFrame()!)).not.toContain('▸ props:');
  for (let i = 0; i < 100 && releases.filter(g => g === 'framework-inspect').length === before; i++) await sleep(10);
  expect(releases.filter(g => g === 'framework-inspect').length).toBe(before + 1);
});

test('i on a component without an instance handle toasts', async () => {
  const inspectExprs: string[] = [];
  respondInspect({ inspectExprs });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('G');
  await sleep(30);
  stdin.write('i');
  await waitForFrame(lastFrame, '인스턴스 핸들 없음');
  expect(inspectExprs).toEqual([]);
});

test('a stale instance toasts instead of opening the pane', async () => {
  respondInspect({ inspectResult: () => ({ type: 'object', subtype: 'null', value: null }) });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '인스턴스가 만료됨');
  expect(strip(lastFrame()!)).not.toContain('App 검사');
});

test('a component with no data sections shows the empty inspect line', async () => {
  respondInspect({ sections: [] });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '표시할 props/state 없음');
});

test('s stores the focused section as a global temp variable', async () => {
  respondInspect({});
  const stored: string[] = [];
  mock.respond('Runtime.callFunctionOn', p => {
    stored.push(`${p.objectId}:${p.functionDeclaration}`);
    return { result: { type: 'undefined' } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '▸ props:');
  stdin.write('s');
  await waitForFrame(lastFrame, 'temp1 전역 변수로 저장됨');
  expect(stored).toHaveLength(1);
  expect(stored[0]).toContain('sec-props');
  expect(stored[0]).toContain('in globalThis');
});

test('a navigation closes the inspect pane with the tree rescan', async () => {
  respondInspect({});
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '▸ props:');
  mock.emitEvent('DOM.documentUpdated', {});
  await waitForFrame(lastFrame, 'H 하이라이트');
  expect(strip(lastFrame()!)).not.toContain('▸ props:');
});

test('the vue inspect script targets setupState', async () => {
  const inspectExprs: string[] = [];
  respondInspect({
    inspectExprs,
    scan: {
      frameworks: [{
        framework: 'vue',
        version: '3.5.40',
        nodes: [{ id: 0, name: 'App', depth: 0, parentId: null, kind: 'component', hostIdx: 0, instIdx: 0 }],
        truncated: false,
      }],
      errors: [],
    },
    sections: [SECTION_PROPS],
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, 'vue 3.5.40');
  stdin.write('i');
  await waitForFrame(lastFrame, '▸ props:');
  expect(inspectExprs[0]).toContain('setupState');
  expect(inspectExprs[0]).not.toContain('memoizedProps');
});

test('Enter with an unresolvable host node toasts the reveal failure', async () => {
  respondScan(() => REACT_SCAN);
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.requestNode', () => ({ nodeId: 0 }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Elements 이동 실패');
});

test('r rescans while the inspect pane is open, closing it and releasing the framework group', async () => {
  const releases: string[] = [];
  respondInspect({ releases });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '▸ props:');
  const before = releases.filter(g => g === 'framework-inspect').length;
  stdin.write('r');
  await waitForFrame(lastFrame, 'H 하이라이트');
  expect(strip(lastFrame()!)).not.toContain('▸ props:');
  expect(strip(lastFrame()!)).toContain('react 18.3.1');
  for (let i = 0; i < 100 && releases.filter(g => g === 'framework-inspect').length === before; i++) await sleep(10);
  expect(releases.filter(g => g === 'framework-inspect').length).toBeGreaterThan(before);
});

test('reinspecting a component releases the prior framework group before the new inspect eval', async () => {
  const releases: string[] = [];
  const inspectExprs: string[] = [];
  const order: string[] = [];
  respondInspect({ inspectExprs });
  mock.respond('Runtime.releaseObjectGroup', p => {
    releases.push(p.objectGroup);
    if (p.objectGroup === 'framework-inspect') order.push('release');
    return {};
  });
  mock.respond('Runtime.evaluate', p => {
    if (p.objectGroup === 'framework-inspect') {
      if (p.expression.includes('__dtuiFwInst')) {
        inspectExprs.push(p.expression);
        order.push('inspect');
        return { result: { type: 'object', className: 'Object', objectId: 'insp-1' } };
      }
      return { result: { type: 'object', subtype: 'node', className: 'HTMLDivElement', objectId: 'host-obj-1' } };
    }
    if (p.returnByValue) return { result: { type: 'object', value: REACT_SCAN } };
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, '▾ App');
  stdin.write('i');
  await waitForFrame(lastFrame, '▸ props:');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'H 하이라이트');
  order.length = 0;
  stdin.write('j');
  await sleep(30);
  stdin.write('i');
  await waitForFrame(lastFrame, 'Header 검사');
  expect(inspectExprs).toHaveLength(2);
  expect(order[0]).toBe('release');
  expect(order.indexOf('release')).toBeLessThan(order.indexOf('inspect'));
});

test('a scan failure surfaces the error and r retries', async () => {
  let fail = true;
  mock.respond('Runtime.evaluate', p => {
    if (!p.returnByValue) return {};
    if (fail) throw new Error('Execution context was destroyed');
    return { result: { type: 'object', value: REACT_SCAN } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('6');
  await waitForFrame(lastFrame, 'Execution context was destroyed');
  fail = false;
  stdin.write('r');
  await waitForFrame(lastFrame, 'react 18.3.1');
});
