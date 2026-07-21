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
const until = async (fn: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(20);
  }
};
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });

const ESC = '';

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-els-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-els-data-'));
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
    ] },
  ] },
] } };

function respondDomNode() {
  mock.respond('DOM.getDocument', () => TREE_DOC);
  mock.respond('DOM.performSearch', () => ({ searchId: 's1', resultCount: 1 }));
  mock.respond('DOM.getSearchResults', () => ({ nodeIds: [9] }));
  mock.respond('DOM.discardSearchResults', () => ({}));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<span class="x">hi</span>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({ matchedCSSRules: [] }));
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [], padding: [], border: [], margin: [], width: 1, height: 1 } }));
}

function respondDeclRule() {
  respondDomNode();
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1',
      range: { startLine: 0, startColumn: 10, endLine: 0, endColumn: 33 },
      cssText: 'color: red; width: 10px',
      cssProperties: [
        { name: 'color', value: 'red', range: { startLine: 0, startColumn: 10, endLine: 0, endColumn: 21 } },
        { name: 'width', value: '10px', range: { startLine: 0, startColumn: 22, endLine: 0, endColumn: 33 } },
      ],
    } } }],
  }));
}

async function query(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }, sel: string) {
  stdin.write('3');
  await waitForFrame(lastFrame, '/ 검색');
  stdin.write('/');
  await sleep(30);
  stdin.write(sel);
  await sleep(30);
  stdin.write('\r');
  await sleep(200);
  stdin.write('\r');
  await waitForFrame(lastFrame, '#9');
}

test('j walks the declaration cursor and expands the containing rule', async () => {
  respondDeclRule();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await waitForFrame(lastFrame, '[x] color: red');
  expect(lastFrame()).toContain('.x {');
  stdin.write('j');
  await sleep(40);
  expect(lastFrame()).toContain('[x] width: 10px');
});

test('space comments the cursor declaration out via setStyleTexts', async () => {
  respondDeclRule();
  let applied = '';
  mock.respond('CSS.setStyleTexts', p => { applied = p.edits[0].text; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await sleep(40);
  stdin.write(' ');
  await sleep(150);
  expect(applied).toBe('/* color: red; */ width: 10px');
});

test('space re-enables a disabled declaration by stripping the comment', async () => {
  respondDomNode();
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1',
      range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 29 },
      cssText: '/* color: red; */ margin: 0;',
      cssProperties: [
        { name: 'color', value: 'red', disabled: true, range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 17 } },
        { name: 'margin', value: '0', range: { startLine: 0, startColumn: 18, endLine: 0, endColumn: 28 } },
      ],
    } } }],
  }));
  let applied = '';
  mock.respond('CSS.setStyleTexts', p => { applied = p.edits[0].text; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await waitForFrame(lastFrame, '[ ] color: red');
  stdin.write(' ');
  await sleep(150);
  expect(applied).toBe('color: red; margin: 0;');
});

test('i replaces the cursor declaration instead of appending', async () => {
  respondDeclRule();
  let applied = '';
  mock.respond('CSS.setStyleTexts', p => { applied = p.edits[0].text; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await sleep(40);
  stdin.write('j');
  await sleep(40);
  stdin.write('i');
  await waitForFrame(lastFrame, 'edit: width: 10px▌');
  stdin.write('\r');
  await sleep(150);
  expect(applied).toBe('color: red; width: 10px');
});

test('] and { adjust the cursor declaration value by 1 and 10', async () => {
  respondDeclRule();
  const applied: string[] = [];
  mock.respond('CSS.setStyleTexts', p => { applied.push(p.edits[0].text); return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await sleep(40);
  stdin.write('j');
  await sleep(40);
  stdin.write(']');
  await sleep(150);
  stdin.write('}');
  await sleep(150);
  expect(applied[0]).toBe('color: red; width: 11px');
  expect(applied[1]).toBe('color: red; width: 20px');
});

test('] on a numberless value is a no-op', async () => {
  respondDeclRule();
  let calls = 0;
  mock.respond('CSS.setStyleTexts', () => { calls++; return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await sleep(40);
  stdin.write(']');
  await sleep(120);
  expect(calls).toBe(0);
});

test('space on a read-only rule shows the read-only message', async () => {
  respondDomNode();
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: 'span' }, origin: 'user-agent', style: {
      cssProperties: [{ name: 'display', value: 'inline' }],
    } } }],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await sleep(40);
  stdin.write(' ');
  await waitForFrame(lastFrame, 'rule is read-only');
});

test('C opens the full computed view with substring filtering', async () => {
  respondDomNode();
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [
    { name: 'display', value: 'block' },
    { name: 'align-items', value: 'center' },
    { name: 'z-index', value: 'auto' },
  ] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('C');
  await waitForFrame(lastFrame, 'computed (3/3)');
  expect(lastFrame()).toContain('align-items');
  stdin.write('/');
  await sleep(30);
  stdin.write('align');
  await waitForFrame(lastFrame, '/align▌');
  expect(lastFrame()).toContain('computed (1/3)');
  expect(lastFrame()).not.toContain('z-index');
  stdin.write('\r');
  await sleep(40);
  stdin.write(ESC);
  await sleep(60);
  expect(lastFrame()).toContain('matched rules');
  expect(lastFrame()).toContain('#9');
});

test('A edits the node attributes through the editor runner', async () => {
  respondDomNode();
  let applied: { nodeId?: number; text?: string } = {};
  let initialText = '';
  mock.respond('DOM.getAttributes', () => ({ attributes: ['class', 'x'] }));
  mock.respond('DOM.setAttributesAsText', p => { applied = p; return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { readFile, writeFile } = await import('node:fs/promises');
      initialText = await readFile(file, 'utf8');
      await writeFile(file, 'class="y"\ndata-k="v"');
    },
  });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('A');
  await waitForFrame(lastFrame, '속성 수정됨');
  expect(initialText.trim()).toBe('class="x"');
  expect(applied).toEqual({ nodeId: 9, text: 'class="y" data-k="v"' });
});

test('x deletes the selected tree node and moves the selection to its parent', async () => {
  respondDomNode();
  let removed = 0;
  mock.respond('DOM.removeNode', p => { removed = p.nodeId; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('x');
  await waitForFrame(lastFrame, '노드 삭제됨');
  expect(removed).toBe(3);
});

test('ys copies the selector path and yy copies the outerHTML', async () => {
  respondDomNode();
  const copied: string[] = [];
  const { lastFrame, stdin } = renderApp({ clipboard: async text => { copied.push(text); } });
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('y');
  await sleep(30);
  stdin.write('s');
  await waitForFrame(lastFrame, '셀렉터 복사됨');
  stdin.write('y');
  await sleep(30);
  stdin.write('y');
  await waitForFrame(lastFrame, 'HTML 복사됨');
  expect(copied[0]).toBe('div#app > span.x');
  expect(copied[1]).toBe('<span class="x">hi</span>');
});

const HIDE = '__devtools-tui-hide__';

const TREE_DOC_HIDDEN = { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
  { nodeId: 2, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
    { nodeId: 3, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app', 'class', HIDE], children: [
      { nodeId: 9, nodeName: 'SPAN', nodeType: 1, attributes: ['class', 'x'], children: [] },
    ] },
  ] },
] } };

test('H hides the node via the inspector stylesheet and H again restores it', async () => {
  respondDomNode();
  let doc: unknown = TREE_DOC;
  mock.respond('DOM.getDocument', () => doc);
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-1' } } }));
  let created = 0;
  const added: string[] = [];
  mock.respond('CSS.createStyleSheet', () => { created++; return { styleSheetId: 'insp-1' }; });
  mock.respond('CSS.addRule', p => { added.push(p.ruleText); return { rule: {} }; });
  let classAttr: string | undefined;
  mock.respond('DOM.getAttributes', () => ({ attributes: classAttr === undefined ? ['id', 'app'] : ['id', 'app', 'class', classAttr] }));
  const sets: any[] = [];
  const removals: any[] = [];
  mock.respond('DOM.setAttributeValue', p => { sets.push(p); classAttr = p.value; doc = TREE_DOC_HIDDEN; return {}; });
  mock.respond('DOM.removeAttribute', p => { removals.push(p); classAttr = undefined; doc = TREE_DOC; return {}; });

  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('H');
  await waitForFrame(lastFrame, '노드 숨김');
  expect(created).toBe(1);
  expect(added).toEqual([`.${HIDE} { visibility: hidden !important }`]);
  expect(sets).toEqual([{ nodeId: 3, name: 'class', value: HIDE }]);
  await waitForFrame(lastFrame, 'hidden');
  expect(lastFrame()).not.toContain(HIDE);

  stdin.write('\r');
  await waitForFrame(lastFrame, 'selector: div#app');
  expect(lastFrame()).not.toContain(HIDE);
  stdin.write(ESC);
  await sleep(60);

  stdin.write('H');
  await waitForFrame(lastFrame, '노드 표시');
  expect(removals).toEqual([{ nodeId: 3, name: 'class' }]);
  expect(created).toBe(1);
});

test('the subview lists inherited rules under ancestor headers with inheritable-only declarations', async () => {
  respondDomNode();
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      cssProperties: [{ name: 'color', value: 'red' }],
    } } }],
    inherited: [
      { matchedCSSRules: [{ rule: { selectorList: { text: '#app' }, origin: 'regular', style: {
        cssProperties: [{ name: 'color', value: 'blue' }, { name: 'width', value: '10px' }],
      } } }] },
      { matchedCSSRules: [{ rule: { selectorList: { text: 'body' }, origin: 'regular', style: {
        cssProperties: [{ name: 'font-size', value: '16px' }],
      } } }] },
    ],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  await waitForFrame(lastFrame, 'div#app에서 상속');
  const frame = lastFrame()!;
  expect(frame).toContain('.x { color: red }');
  expect(frame).toContain('#app { color: blue }');
  expect(frame).not.toContain('width: 10px');
  stdin.write('j');
  await sleep(40);
  stdin.write('j');
  await sleep(40);
  stdin.write('j');
  await waitForFrame(lastFrame, 'body에서 상속');
  expect(lastFrame()).toContain('font-size: 16px');
});

test('space toggles an inherited declaration in the ancestor stylesheet', async () => {
  respondDomNode();
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1',
      range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 },
      cssText: 'color: red',
      cssProperties: [{ name: 'color', value: 'red', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 } }],
    } } }],
    inherited: [
      { matchedCSSRules: [{ rule: { selectorList: { text: '#app' }, origin: 'regular', style: {
        styleSheetId: 's2',
        range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 11 },
        cssText: 'color: blue',
        cssProperties: [{ name: 'color', value: 'blue', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 11 } }],
      } } }] },
    ],
  }));
  const applied: any[] = [];
  mock.respond('CSS.setStyleTexts', p => { applied.push(p.edits[0]); return { styles: [] }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await sleep(40);
  stdin.write('j');
  await waitForFrame(lastFrame, '[x] color: blue');
  stdin.write(' ');
  await sleep(150);
  expect(applied[0]).toMatchObject({ styleSheetId: 's2', text: '/* color: blue; */' });
});

test(', opens the class toggle editor: space toggles, a adds, the hide marker stays out', async () => {
  respondDomNode();
  let classAttr = `btn primary ${HIDE}`;
  mock.respond('DOM.getAttributes', () => ({ attributes: ['class', classAttr] }));
  const sets: any[] = [];
  mock.respond('DOM.setAttributeValue', p => { sets.push(p); classAttr = p.value; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write(',');
  await waitForFrame(lastFrame, 'classes (2)');
  expect(lastFrame()).toContain('[x] .btn');
  expect(lastFrame()).toContain('[x] .primary');
  expect(lastFrame()).not.toContain(HIDE);

  stdin.write(' ');
  await waitForFrame(lastFrame, '[ ] .btn');
  expect(sets[0]).toEqual({ nodeId: 9, name: 'class', value: `primary ${HIDE}` });

  stdin.write('a');
  await waitForFrame(lastFrame, '클래스: ▌');
  stdin.write('fresh');
  await waitForFrame(lastFrame, '클래스: fresh▌');
  stdin.write('\r');
  await waitForFrame(lastFrame, '[x] .fresh');
  expect(sets[1]).toEqual({ nodeId: 9, name: 'class', value: `primary fresh ${HIDE}` });
  expect(lastFrame()).toContain('classes (3)');

  stdin.write(ESC);
  await waitForFrame(lastFrame, 'matched rules');
});

test('a rejected class name surfaces an error and applies nothing', async () => {
  respondDomNode();
  mock.respond('DOM.getAttributes', () => ({ attributes: ['class', 'x'] }));
  let sets = 0;
  mock.respond('DOM.setAttributeValue', () => { sets++; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write(',');
  await waitForFrame(lastFrame, 'classes (1)');
  stdin.write('a');
  await waitForFrame(lastFrame, '클래스: ▌');
  stdin.write('a b');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'invalid class name: a b');
  expect(sets).toBe(0);
});

test(', outside the subview still switches to the settings tool', async () => {
  respondDomNode();
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('3');
  await waitForFrame(lastFrame, 'div#app');
  stdin.write(',');
  await waitForFrame(lastFrame, 'browserPaths');
});

test('the subview shows the rendered fonts line from CSS.getPlatformFontsForNode', async () => {
  respondDomNode();
  mock.respond('CSS.getPlatformFontsForNode', () => ({ fonts: [{ familyName: 'Inter', glyphCount: 7, isCustomFont: true }] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  await waitForFrame(lastFrame, '렌더 폰트: Inter* (glyphs 7)');
});

test('the subview labels rules living in @layer and marks invalid declarations', async () => {
  respondDomNode();
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular',
      layers: [{ text: 'base' }],
      style: {
        cssProperties: [
          { name: 'colr', value: 'red', parsedOk: false },
          { name: 'width', value: '10px' },
        ],
      } } }],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  await waitForFrame(lastFrame, '@layer base .x {');
  expect(lastFrame()).toContain('⚠ colr: red');
});

test('the status line resolves var() uses under the declaration cursor', async () => {
  respondDomNode();
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: '--accent', value: 'teal' }] }));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [{ rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
      styleSheetId: 's1',
      range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 20 },
      cssText: 'color: var(--accent)',
      cssProperties: [
        { name: 'color', value: 'var(--accent)', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 20 } },
      ],
    } } }],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('j');
  await waitForFrame(lastFrame, '--accent = teal');
  expect(lastFrame()).toContain('color: var(--accent) → teal');
});

test('switching sessions releases the forced pseudo state on the old session', async () => {
  respondDomNode();
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  const forced: Array<[string[], string | undefined]> = [];
  mock.respond('CSS.forcePseudoState', (p, pageId) => { forced.push([p.forcedPseudoClasses, pageId]); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('p');
  await waitForFrame(lastFrame, 'forced :hover');
  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  const deadline = Date.now() + 2000;
  while (forced.length < 2 && Date.now() < deadline) await sleep(20);
  expect(forced).toEqual([[['hover'], 'page1'], [[], 'page1']]);
});

test('p cycles the forced pseudo state and Esc clears it', async () => {
  respondDomNode();
  const forced: string[][] = [];
  mock.respond('CSS.forcePseudoState', p => { forced.push(p.forcedPseudoClasses); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await query(lastFrame, stdin, '.x');
  stdin.write('p');
  await waitForFrame(lastFrame, 'forced :hover');
  expect(forced).toEqual([['hover']]);
  stdin.write(ESC);
  await until(() => forced.length === 2 && !(lastFrame() ?? '').includes('forced :hover'));
  expect(lastFrame()).not.toContain('forced :hover');
  expect(forced).toEqual([['hover'], []]);
});
