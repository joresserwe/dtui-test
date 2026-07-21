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
import { centeredStart } from '../src/tui/panels/ElementsPanel.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

const ESC = '';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-elx-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-elx-data-'));
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

const TREE_DOC = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], children: [
      { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], children: [] },
      { nodeId: 6, nodeName: 'BUTTON', nodeType: 1, attributes: ['class', 'go'], children: [] },
    ] },
  ] },
] } };

const LAZY_DOC = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], childNodeCount: 2 },
  ] },
] } };

function respondDetail(doc: unknown = TREE_DOC) {
  mock.respond('DOM.getDocument', () => doc);
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span class="x">hi</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [0, 0, 10, 0, 10, 10, 0, 10], padding: [], border: [], margin: [], width: 10, height: 10 } }));
}

async function openElements(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
}

test('search shows a match counter and n/N walk the matches', async () => {
  respondDetail();
  const inspected: number[] = [];
  mock.respond('DOM.setInspectedNode', p => { inspected.push(p.nodeId); return {}; });
  mock.respond('DOM.performSearch', p => {
    expect(p.query).toBe('hi');
    return { searchId: 's7', resultCount: 2 };
  });
  mock.respond('DOM.getSearchResults', p => ({ nodeIds: p.fromIndex === 0 ? [9] : [6] }));
  const discarded: string[] = [];
  mock.respond('DOM.discardSearchResults', p => { discarded.push(p.searchId); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('/');
  await sleep(30);
  stdin.write('hi');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[1/2]');
  await waitForFrame(lastFrame, 'span.x');
  const deadline = Date.now() + 1500;
  while (!inspected.includes(9) && Date.now() < deadline) await sleep(15);
  expect(inspected).toContain(9);
  stdin.write('n');
  await waitForFrame(lastFrame, '[2/2]');
  const d2 = Date.now() + 1500;
  while (!inspected.includes(6) && Date.now() < d2) await sleep(15);
  expect(inspected).toContain(6);
  stdin.write('N');
  await waitForFrame(lastFrame, '[1/2]');
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).not.toContain('[1/2]');
  expect(discarded).toContain('s7');
});

test('a search with no matches reports it without a counter', async () => {
  respondDetail();
  mock.respond('DOM.performSearch', () => ({ searchId: 's0', resultCount: 0 }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('/');
  await sleep(30);
  stdin.write('zzz');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'no match: zzz');
  expect(lastFrame()).not.toContain('[1/');
});

test('I toggles inspect mode and a browser pick selects the node', async () => {
  respondDetail();
  const modes: string[] = [];
  mock.respond('Overlay.setInspectMode', p => { modes.push(p.mode); return {}; });
  mock.respond('DOM.pushNodesByBackendIdsToFrontend', p => {
    expect(p.backendNodeIds).toEqual([42]);
    return { nodeIds: [9] };
  });
  const inspected: number[] = [];
  mock.respond('DOM.setInspectedNode', p => { inspected.push(p.nodeId); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('I');
  await waitForFrame(lastFrame, '인스펙트: 브라우저');
  const deadline = Date.now() + 1500;
  while (!modes.includes('searchForNode') && Date.now() < deadline) await sleep(15);
  mock.emitEvent('Overlay.inspectNodeRequested', { backendNodeId: 42 });
  const d2 = Date.now() + 1500;
  while (!inspected.includes(9) && Date.now() < d2) await sleep(15);
  expect(inspected).toContain(9);
  const d3 = Date.now() + 1500;
  while (!modes.includes('none') && Date.now() < d3) await sleep(15);
  expect(modes).toEqual(['searchForNode', 'none']);
  expect(lastFrame()).not.toContain('인스펙트: 브라우저');
});

test('Esc cancels inspect mode without picking', async () => {
  respondDetail();
  const modes: string[] = [];
  mock.respond('Overlay.setInspectMode', p => { modes.push(p.mode); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('I');
  await waitForFrame(lastFrame, '인스펙트: 브라우저');
  stdin.write(ESC);
  const deadline = Date.now() + 1500;
  while (!modes.includes('none') && Date.now() < deadline) await sleep(15);
  expect(modes).toEqual(['searchForNode', 'none']);
});

test('f shows hint labels and typing one selects the element', async () => {
  respondDetail();
  const evals: string[] = [];
  mock.respond('Runtime.evaluate', p => {
    const expr = String(p.expression);
    evals.push(expr);
    if (expr.includes('querySelectorAll')) return { result: { type: 'object', value: ['aa', 'ab'] } };
    if (expr.includes('h.map[')) return { result: { type: 'object', objectId: 'obj-6', className: 'HTMLButtonElement' } };
    return { result: { type: 'number', value: 1 } };
  });
  mock.respond('DOM.requestNode', p => {
    expect(p.objectId).toBe('obj-6');
    return { nodeId: 6 };
  });
  const inspected: number[] = [];
  mock.respond('DOM.setInspectedNode', p => { inspected.push(p.nodeId); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('f');
  await waitForFrame(lastFrame, '힌트: ▌');
  stdin.write('a');
  await waitForFrame(lastFrame, '힌트: a▌');
  expect(evals.some(e => e.includes("indexOf(\"a\")"))).toBe(true);
  stdin.write('b');
  const deadline = Date.now() + 1500;
  while (!inspected.includes(6) && Date.now() < deadline) await sleep(15);
  expect(inspected).toContain(6);
  expect(lastFrame()).not.toContain('힌트:');
  expect(lastFrame()).toContain('button.go');
});

test('Esc cancels hint mode and removes the page overlay', async () => {
  respondDetail();
  const evals: string[] = [];
  mock.respond('Runtime.evaluate', p => {
    const expr = String(p.expression);
    evals.push(expr);
    if (expr.includes('querySelectorAll')) return { result: { type: 'object', value: ['aa', 'ab'] } };
    return { result: { type: 'number', value: 0 } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('f');
  await waitForFrame(lastFrame, '힌트: ▌');
  stdin.write(ESC);
  await sleep(80);
  expect(lastFrame()).not.toContain('힌트:');
  expect(evals.some(e => e.includes('h.cleanup()') && !e.includes('h.map['))).toBe(true);
});

test('an unloaded node shows an ellipsis and l loads its children on demand', async () => {
  respondDetail(LAZY_DOC);
  const requested: any[] = [];
  mock.respond('DOM.requestChildNodes', p => { requested.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  expect(lastFrame()).toContain('div#app …');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('l');
  const deadline = Date.now() + 1500;
  while (!requested.length && Date.now() < deadline) await sleep(15);
  expect(requested).toEqual([{ nodeId: 3, depth: 1 }]);
  mock.emitEvent('DOM.setChildNodes', { parentId: 3, nodes: [
    { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], childNodeCount: 0 },
    { nodeId: 6, nodeName: 'BUTTON', nodeType: 1, attributes: ['class', 'go'], childNodeCount: 0 },
  ] });
  await waitForFrame(lastFrame, 'span.x');
  expect(lastFrame()).toContain('button.go');
  expect(lastFrame()).not.toContain('div#app …');
});

test('zR expands recursively, zM collapses recursively', async () => {
  respondDetail();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  expect(lastFrame()).not.toContain('span.x');
  stdin.write('g');
  await sleep(20);
  stdin.write('g');
  await sleep(30);
  stdin.write('z');
  await sleep(20);
  stdin.write('R');
  await waitForFrame(lastFrame, 'span.x');
  expect(lastFrame()).toContain('button.go');
  stdin.write('z');
  await sleep(20);
  stdin.write('M');
  await sleep(60);
  expect(lastFrame()).not.toContain('div#app');
  expect(lastFrame()).toContain('html');
});

test('zR keeps loading unloaded subtrees until they are expanded', async () => {
  respondDetail(LAZY_DOC);
  const requested: any[] = [];
  mock.respond('DOM.requestChildNodes', p => {
    requested.push(p);
    mock.emitEvent('DOM.setChildNodes', { parentId: p.nodeId, nodes: [
      { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], childNodeCount: 0 },
    ] });
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('g');
  await sleep(20);
  stdin.write('g');
  await sleep(30);
  stdin.write('z');
  await sleep(20);
  stdin.write('R');
  await waitForFrame(lastFrame, 'span.x');
  expect(requested).toEqual([{ nodeId: 3, depth: 1 }]);
});

test('. synthesizes a click on the selected tree node', async () => {
  respondDetail();
  const calls: string[] = [];
  mock.respond('DOM.scrollIntoViewIfNeeded', p => { calls.push(`scroll:${p.nodeId}`); return {}; });
  mock.respond('Input.dispatchMouseEvent', p => { calls.push(`${p.type}@${p.x},${p.y}`); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('.');
  await waitForFrame(lastFrame, '클릭 합성');
  expect(calls).toEqual(['scroll:3', 'mousePressed@5,5', 'mouseReleased@5,5']);
});

test('; synthesizes hover and re-gathers the subview styles', async () => {
  respondDetail();
  let matchedCalls = 0;
  mock.respond('CSS.getMatchedStylesForNode', () => { matchedCalls++; return { matchedCSSRules: [] }; });
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  const moved: any[] = [];
  mock.respond('DOM.scrollIntoViewIfNeeded', () => ({}));
  mock.respond('Input.dispatchMouseEvent', p => { moved.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, '/ 검색');
  stdin.write('/');
  await sleep(30);
  stdin.write('.x');
  await sleep(30);
  stdin.write('\r');
  await sleep(200);
  stdin.write('\r');
  await waitForFrame(lastFrame, '#9');
  const before = matchedCalls;
  stdin.write(';');
  await waitForFrame(lastFrame, '호버 합성');
  expect(moved).toEqual([{ type: 'mouseMoved', x: 5, y: 5, button: 'none' }]);
  const deadline = Date.now() + 1500;
  while (matchedCalls <= before && Date.now() < deadline) await sleep(15);
  expect(matchedCalls).toBeGreaterThan(before);
});

test('L lists event listeners in the subview and Esc returns', async () => {
  respondDetail();
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.resolveNode', () => ({ object: { objectId: 'o9' } }));
  mock.respond('DOMDebugger.getEventListeners', () => ({ listeners: [
    { type: 'click', useCapture: true, once: false, passive: false, scriptId: '5', lineNumber: 12, columnNumber: 0, handler: { description: 'function onClick() { go() }' } },
  ] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, '/ 검색');
  stdin.write('/');
  await sleep(30);
  stdin.write('.x');
  await sleep(30);
  stdin.write('\r');
  await sleep(200);
  stdin.write('\r');
  await waitForFrame(lastFrame, '#9');
  stdin.write('L');
  await waitForFrame(lastFrame, 'event listeners (1)');
  expect(lastFrame()).toContain('click');
  expect(lastFrame()).toContain('capture');
  expect(lastFrame()).toContain('onClick');
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).toContain('matched rules');
  expect(lastFrame()).toContain('#9');
});

test('yb writes a handoff bundle, copies its path, and runs agentCmd', async () => {
  const { mkdir, readFile, readdir, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const cfgDir = join(process.env.XDG_CONFIG_HOME!, 'devtools-tui');
  await mkdir(cfgDir, { recursive: true });
  const markerDir = await mkdtemp(join(tmpdir(), 'dtui-agentcmd-'));
  const script = join(markerDir, 'agent.mjs');
  await writeFile(script, "import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nwriteFileSync(join(process.env.MARKER_DIR, 'marker'), process.argv[2]);\n");
  await writeFile(join(cfgDir, 'config.json'), JSON.stringify({ agentCmd: `MARKER_DIR=${JSON.stringify(markerDir)} node ${JSON.stringify(script)}` }));
  respondDetail();
  mock.respond('DOM.getBoxModel', () => ({ model: {
    content: [12, 22, 108, 22, 108, 58, 12, 58],
    padding: [11, 21, 109, 21, 109, 59, 11, 59],
    border: [10, 20, 110, 20, 110, 60, 10, 60],
    margin: [5, 15, 115, 15, 115, 65, 5, 65],
    width: 100, height: 40,
  } }));
  const shots: any[] = [];
  mock.respond('Page.captureScreenshot', p => {
    shots.push(p?.clip);
    return { data: Buffer.from(p?.clip ? 'element-shot' : 'viewport-shot').toString('base64') };
  });
  const copied: string[] = [];
  const { lastFrame, stdin } = renderApp({ clipboard: async text => { copied.push(text); } });
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('y');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, '핸드오프 번들 저장됨');
  const root = join(process.env.XDG_DATA_HOME!, 'devtools-tui', 'handoff');
  const dirs = await readdir(root);
  expect(dirs).toHaveLength(1);
  expect(dirs[0]).toMatch(/-div-app$/);
  const bundle = join(root, dirs[0]);
  expect((await readdir(bundle)).sort()).toEqual(['context.md', 'element.png', 'viewport.png']);
  const md = await readFile(join(bundle, 'context.md'), 'utf8');
  expect(md).toContain('- selector: `div#app`');
  expect(md).toContain('- url: https://mock.test/');
  expect(md).toContain('- size: 100×40 px');
  expect(copied).toEqual([bundle]);
  expect(shots.some(c => c && c.x === 10 && c.y === 20 && c.width === 100 && c.height === 40)).toBe(true);
  expect(shots).toContain(undefined);
  const deadline = Date.now() + 3000;
  while (!existsSync(join(markerDir, 'marker')) && Date.now() < deadline) await sleep(25);
  expect(await readFile(join(markerDir, 'marker'), 'utf8')).toBe(bundle);
});

test('yb without a box model still writes context.md and reports what is missing', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  respondDetail();
  mock.respond('DOM.getBoxModel', () => { throw new Error('no box'); });
  const { lastFrame, stdin } = renderApp({ clipboard: async () => {} });
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('y');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, '누락');
  const root = join(process.env.XDG_DATA_HOME!, 'devtools-tui', 'handoff');
  const dirs = await readdir(root);
  expect(dirs).toHaveLength(1);
  const files = await readdir(join(root, dirs[0]));
  expect(files).toContain('context.md');
  expect(files).not.toContain('element.png');
  const md = await readFile(join(root, dirs[0], 'context.md'), 'utf8');
  expect(md).toContain('- no box model');
});

test('o toggles a grid overlay for a grid container', async () => {
  respondDetail();
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: 'display', value: 'grid' }] }));
  const gridCalls: any[] = [];
  const flexCalls: any[] = [];
  mock.respond('Overlay.setShowGridOverlays', p => { gridCalls.push(p.gridNodeHighlightConfigs.map((c: any) => c.nodeId)); return {}; });
  mock.respond('Overlay.setShowFlexOverlays', p => { flexCalls.push(p.flexNodeHighlightConfigs.map((c: any) => c.nodeId)); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('o');
  await waitForFrame(lastFrame, 'grid 오버레이 표시');
  expect(gridCalls.at(-1)).toEqual([3]);
  expect(flexCalls.at(-1)).toEqual([]);
  await waitForFrame(lastFrame, 'overlay:1');
  stdin.write('o');
  await waitForFrame(lastFrame, '레이아웃 오버레이 해제');
  expect(gridCalls.at(-1)).toEqual([]);
});

test('o on a non-grid node reports the display value instead', async () => {
  respondDetail();
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: 'display', value: 'block' }] }));
  let overlayCalls = 0;
  mock.respond('Overlay.setShowGridOverlays', () => { overlayCalls++; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('o');
  await waitForFrame(lastFrame, 'not a grid/flex container (display: block)');
  expect(overlayCalls).toBe(0);
});

test('P off resumes cursor tracking after being pinned', async () => {
  respondDetail();
  const highlighted: number[] = [];
  mock.respond('Overlay.highlightNode', p => { highlighted.push(p.nodeId); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  const deadline = Date.now() + 2000;
  while (!highlighted.length && Date.now() < deadline) await sleep(15);
  stdin.write('P');
  await waitForFrame(lastFrame, 'highlight:on');
  stdin.write('P');
  await sleep(60);
  const count = highlighted.length;
  stdin.write('j');
  const d2 = Date.now() + 2000;
  while (highlighted.length <= count && Date.now() < d2) await sleep(15);
  expect(highlighted.length).toBeGreaterThan(count);
  expect(highlighted.at(-1)).toBe(2);
});

test('leaving the Elements tool hides the auto highlight', async () => {
  respondDetail();
  let hidden = 0;
  mock.respond('Overlay.hideHighlight', () => { hidden++; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('1');
  await waitForFrame(lastFrame, '요청 없음');
  const deadline = Date.now() + 1500;
  while (!hidden && Date.now() < deadline) await sleep(15);
  expect(hidden).toBeGreaterThanOrEqual(1);
});

const NEXT_DOC = { root: { nodeId: 11, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 12, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 13, nodeName: 'SECTION', nodeType: 1, attributes: ['id', 'next'], children: [
      { nodeId: 21, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'y'], children: [] },
    ] },
  ] },
] } };

test('DOM.documentUpdated reloads the tree and search reveals in the new binding', async () => {
  respondDetail();
  let doc: unknown = TREE_DOC;
  mock.respond('DOM.getDocument', () => doc);
  const inspected: number[] = [];
  mock.respond('DOM.setInspectedNode', p => { inspected.push(p.nodeId); return {}; });
  mock.respond('DOM.performSearch', () => ({ searchId: 's9', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [21] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.resolveNode', () => ({ object: { objectId: 'o1' } }));
  mock.respond('DOMDebugger.getEventListeners', () => ({ listeners: [
    { type: 'click', useCapture: false, once: false, passive: false },
  ] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'matched rules');
  stdin.write('L');
  await waitForFrame(lastFrame, 'event listeners (1)');
  doc = NEXT_DOC;
  mock.emitEvent('DOM.documentUpdated', {});
  await waitForFrame(lastFrame, 'section#next');
  expect(lastFrame()).not.toContain('div#app');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'matched rules');
  expect(lastFrame()).not.toContain('event listeners');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'section#next');
  stdin.write('/');
  await sleep(30);
  stdin.write('y');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[1/1]');
  await waitForFrame(lastFrame, 'span.y');
  const deadline = Date.now() + 1500;
  while (!inspected.includes(21) && Date.now() < deadline) await sleep(15);
  expect(inspected).toContain(21);
});

const REMAP_DOC = { root: { nodeId: 101, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 102, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 103, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], children: [
      { nodeId: 109, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], children: [] },
      { nodeId: 106, nodeName: 'BUTTON', nodeType: 1, attributes: ['class', 'go'], children: [] },
      { nodeId: 110, nodeName: 'INPUT', nodeType: 1, attributes: ['id', 'added'], children: [] },
    ] },
  ] },
] } };

test('a topology mutation reloads the tree while preserving expansion across renumbered node ids', async () => {
  let doc: unknown = TREE_DOC;
  respondDetail();
  mock.respond('DOM.getDocument', () => doc);
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('l');
  await waitForFrame(lastFrame, 'span.x');
  expect(lastFrame()).toContain('button.go');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  doc = REMAP_DOC;
  mock.emitEvent('DOM.childNodeInserted', { parentNodeId: 103, node: { nodeId: 110 } });
  await waitForFrame(lastFrame, 'input#added', 3000);
  const frame = lastFrame()!;
  expect(frame).toContain('span.x');
  expect(frame).toContain('button.go');
});

test('domHtml announces the rebinding so the elements tree reloads', async () => {
  respondDetail();
  let treeFetches = 0;
  mock.respond('DOM.getDocument', p => {
    if (p?.depth === 3) treeFetches++;
    return TREE_DOC;
  });
  const { listPages } = await import('../src/cdp/targets.js');
  const [page] = await listPages(ep());
  const probe = await DebugSession.attach(page, { persist: false });
  let updates = 0;
  probe.on('document-updated', () => updates++);
  await probe.domHtml();
  expect(updates).toBe(1);
  await probe.close();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  expect(treeFetches).toBe(1);
  mock.emitEvent('DOM.documentUpdated', {});
  const deadline = Date.now() + 1800;
  while (treeFetches < 2 && Date.now() < deadline) await sleep(30);
  expect(treeFetches).toBe(2);
  await waitForFrame(lastFrame, 'div#app');
});

test('switching sessions discards the previous search on the old session', async () => {
  respondDetail();
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  mock.respond('DOM.performSearch', () => ({ searchId: 's7', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  const discarded: Array<[string, string | undefined]> = [];
  mock.respond('DOM.discardSearchResults', (p, pageId) => { discarded.push([p.searchId, pageId]); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('/');
  await sleep(30);
  stdin.write('hi');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '[1/1]');
  stdin.write('1');
  await sleep(30);
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  const deadline = Date.now() + 2000;
  while (!discarded.some(([id, pageId]) => id === 's7' && pageId === 'page1') && Date.now() < deadline) await sleep(20);
  expect(discarded).toContainEqual(['s7', 'page1']);
  mock.pages.pop();
});

test('zR requests each unloaded node once even while merges trickle in', async () => {
  const TWO_LAZY = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
    { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
      { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'one'], childNodeCount: 1 },
      { nodeId: 4, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'two'], childNodeCount: 1 },
    ] },
  ] } };
  respondDetail(TWO_LAZY);
  const counts: Record<number, number> = {};
  mock.respond('DOM.requestChildNodes', p => {
    counts[p.nodeId] = (counts[p.nodeId] ?? 0) + 1;
    const child = p.nodeId === 3
      ? { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], childNodeCount: 0 }
      : { nodeId: 10, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'z'], childNodeCount: 0 };
    setTimeout(() => mock.emitEvent('DOM.setChildNodes', { parentId: p.nodeId, nodes: [child] }), p.nodeId === 3 ? 0 : 150);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#one');
  stdin.write('g');
  await sleep(20);
  stdin.write('g');
  await sleep(30);
  stdin.write('z');
  await sleep(20);
  stdin.write('R');
  await waitForFrame(lastFrame, 'span.x');
  await waitForFrame(lastFrame, 'span.z');
  expect(counts).toEqual({ 3: 1, 4: 1 });
});

test('centeredStart centers the selection within the window', () => {
  expect(centeredStart(10, 100, 11)).toBe(5);
  expect(centeredStart(0, 100, 11)).toBe(0);
  expect(centeredStart(99, 100, 11)).toBe(89);
  expect(centeredStart(5, 8, 11)).toBe(0);
});

test('the b chord toggles DOM breakpoints on the selected node and marks the row', async () => {
  respondDetail();
  let enables = 0;
  const calls: Array<[string, any]> = [];
  mock.respond('Debugger.enable', () => {
    enables++;
    return { debuggerId: 'd1' };
  });
  mock.respond('DOMDebugger.setDOMBreakpoint', p => {
    calls.push(['set', p]);
    return {};
  });
  mock.respond('DOMDebugger.removeDOMBreakpoint', p => {
    calls.push(['remove', p]);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await sleep(30);
  stdin.write('s');
  await waitForFrame(lastFrame, 'DOM BP 설정: subtree-modified');
  expect(enables).toBe(1);
  expect(calls).toEqual([['set', { nodeId: 3, type: 'subtree-modified' }]]);
  expect(lastFrame()!).not.toContain('탭 전환');
  expect(lastFrame()!).toMatch(/◉.*div#app/);

  stdin.write('b');
  await sleep(30);
  stdin.write('a');
  await waitForFrame(lastFrame, 'DOM BP 설정: attribute-modified');
  expect(calls[1]).toEqual(['set', { nodeId: 3, type: 'attribute-modified' }]);

  stdin.write('b');
  await sleep(30);
  stdin.write('s');
  await waitForFrame(lastFrame, 'DOM BP 해제: subtree-modified');
  expect(calls[2]).toEqual(['remove', { nodeId: 3, type: 'subtree-modified' }]);
  expect(lastFrame()!).toMatch(/◉.*div#app/);

  stdin.write('b');
  await sleep(30);
  stdin.write('a');
  await waitForFrame(lastFrame, 'DOM BP 해제: attribute-modified');
  expect(lastFrame()!).not.toMatch(/◉.*div#app/);
});

test('a DOM breakpoint pause names the mutation type in the Sources paused header', async () => {
  respondDetail();
  mock.respond('Debugger.getScriptSource', () => ({ scriptSource: 'mutate();\n' }));
  mock.respond('DOMDebugger.setDOMBreakpoint', () => ({}));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await sleep(30);
  stdin.write('s');
  await waitForFrame(lastFrame, 'DOM BP 설정: subtree-modified');
  mock.emitEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://mock.test/app.js', endLine: 1 });
  mock.emitEvent('Debugger.paused', {
    reason: 'DOM',
    data: { type: 'subtree-modified', nodeId: 3 },
    callFrames: [
      {
        callFrameId: 'cf-0',
        functionName: 'mutate',
        url: 'https://mock.test/app.js',
        location: { scriptId: 'sc-1', lineNumber: 0, columnNumber: 0 },
        scopeChain: [],
      },
    ],
  });
  await waitForFrame(lastFrame, '일시정지: app.js:1');
  stdin.write('5');
  await waitForFrame(lastFrame, '⏸ DOM 변경 · subtree-modified');
});

test('a DOM breakpoint is re-resolved by selector and re-applied after a reconnect', async () => {
  respondDetail();
  const queries: string[] = [];
  const sets: any[] = [];
  mock.respond('DOM.querySelector', p => {
    queries.push(p.selector);
    return { nodeId: 3 };
  });
  mock.respond('DOMDebugger.setDOMBreakpoint', p => {
    sets.push(p);
    return {};
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('b');
  await sleep(30);
  stdin.write('s');
  await waitForFrame(lastFrame, 'DOM BP 설정: subtree-modified');
  expect(sets).toEqual([{ nodeId: 3, type: 'subtree-modified' }]);

  mock.dropConnections();
  await waitForFrame(lastFrame, '재연결됨', 5000);
  for (let i = 0; i < 100 && sets.length < 2; i++) await sleep(10);
  expect(queries.some(q => q.includes('#app'))).toBe(true);
  expect(queries.every(q => !/^\d+$/.test(q))).toBe(true);
  expect(sets[1]).toEqual({ nodeId: 3, type: 'subtree-modified' });
});

test('mutation count buffers events during an external edit and flushes them afterward', async () => {
  respondDetail();
  mock.respond('DOM.setOuterHTML', () => ({}));
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      mock.emitEvent('DOM.childNodeInserted', { parentNodeId: 2, node: { nodeId: 81 } });
      await sleep(40);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '<span class="x">edited</span>');
    },
  });
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('m');
  await waitForFrame(lastFrame, 'watching (0)');
  stdin.write('\r');
  await sleep(180);
  stdin.write('e');
  await waitForFrame(lastFrame, 'edited — 트리 새로고침', 3000);
  mock.emitEvent('DOM.childNodeInserted', { parentNodeId: 2, node: { nodeId: 82 } });
  await waitForFrame(lastFrame, 'watching (2)');
});
