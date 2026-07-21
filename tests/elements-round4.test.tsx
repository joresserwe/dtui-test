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
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-el4-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-el4-data-'));
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

function respondDetail() {
  mock.respond('DOM.getDocument', () => TREE_DOC);
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

async function runPalette(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }, query: string, item: string) {
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write(query);
  await waitForFrame(lastFrame, item);
  stdin.write('\r');
}

test('D duplicates the selected node as its next sibling and keeps the selection', async () => {
  respondDetail();
  const copies: any[] = [];
  mock.respond('DOM.copyTo', p => { copies.push(p); return { nodeId: 99 }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('l');
  await waitForFrame(lastFrame, 'span.x');
  stdin.write('j');
  await sleep(30);
  stdin.write('D');
  await waitForFrame(lastFrame, '노드 복제됨');
  expect(copies).toEqual([{ nodeId: 9, targetNodeId: 3, insertBeforeNodeId: 6 }]);
  const selLine = stripAnsi(lastFrame()!).split('\n').find(l => l.includes('span.x'));
  expect(selLine).toContain('▌');
});

test('D on the last sibling omits insertBeforeNodeId so the copy lands after it', async () => {
  respondDetail();
  const copies: any[] = [];
  mock.respond('DOM.copyTo', p => { copies.push(p); return { nodeId: 99 }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  stdin.write('j');
  await sleep(30);
  stdin.write('j');
  await sleep(30);
  stdin.write('D');
  await waitForFrame(lastFrame, '노드 복제됨');
  expect(copies).toEqual([{ nodeId: 3, targetNodeId: 2 }]);
});

test('palette CSS overview collects colors, fonts, and media queries on demand', async () => {
  respondDetail();
  let evals = 0;
  mock.respond('Runtime.evaluate', p => {
    if (!String(p.expression).includes('getComputedStyle')) return { result: { type: 'undefined' } };
    evals++;
    return {
      result: {
        type: 'object',
        value: {
          elements: 42,
          truncated: false,
          text: [['rgb(51, 51, 51)', 40]],
          background: [['rgb(255, 255, 255)', 12]],
          border: [['rgb(0, 128, 0)', 3]],
          fonts: [['Arial, sans-serif', 42]],
        },
      },
    };
  });
  mock.respond('CSS.getMediaQueries', () => ({
    medias: [
      { text: '(max-width: 600px)', source: 'mediaRule' },
      { text: '(max-width: 600px)', source: 'mediaRule' },
    ],
  }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  await runPalette(lastFrame, stdin, '오버뷰', 'CSS 오버뷰');
  await waitForFrame(lastFrame, '42개 요소 스캔');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('텍스트 색상 (1)');
  expect(frame).toContain('rgb(51, 51, 51) ×40');
  expect(frame).toContain('rgb(255, 255, 255) ×12');
  expect(frame).toContain('Arial, sans-serif ×42');
  expect(frame).toContain('(max-width: 600px)  (mediaRule) ×2');
  expect(evals).toBe(1);
  stdin.write(',');
  await sleep(60);
  expect(stripAnsi(lastFrame()!)).toContain('42개 요소 스캔');
  stdin.write('r');
  const deadline = Date.now() + 1500;
  while (evals < 2 && Date.now() < deadline) await sleep(15);
  expect(evals).toBe(2);
  stdin.write(ESC);
  await sleep(60);
  expect(stripAnsi(lastFrame()!)).not.toContain('CSS 오버뷰');
});

test('palette animations subview lists events and drives pause, rate, and seek', async () => {
  respondDetail();
  const calls: Array<[string, any]> = [];
  mock.respond('Animation.enable', p => { calls.push(['enable', p]); return {}; });
  mock.respond('Animation.disable', p => { calls.push(['disable', p]); return {}; });
  mock.respond('Animation.setPaused', p => { calls.push(['setPaused', p]); return {}; });
  mock.respond('Animation.setPlaybackRate', p => { calls.push(['setPlaybackRate', p]); return {}; });
  mock.respond('Animation.seekAnimations', p => { calls.push(['seek', p]); return {}; });
  mock.respond('DOM.describeNode', p => {
    expect(p.backendNodeId).toBe(42);
    return { node: { nodeName: 'DIV', attributes: ['id', 'app'] } };
  });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  await runPalette(lastFrame, stdin, '애니메이션', '애니메이션 검사');
  await waitForFrame(lastFrame, '캡처된 애니메이션 없음');
  const d0 = Date.now() + 1500;
  while (!calls.some(c => c[0] === 'enable') && Date.now() < d0) await sleep(15);
  mock.emitEvent('Animation.animationCreated', { id: 'a1' });
  mock.emitEvent('Animation.animationStarted', {
    animation: {
      id: 'a1',
      name: 'pulse',
      type: 'CSSAnimation',
      pausedState: false,
      playbackRate: 1,
      source: { delay: 100, duration: 1200, iterations: 3, backendNodeId: 42 },
    },
  });
  await waitForFrame(lastFrame, 'pulse');
  await waitForFrame(lastFrame, 'div#app');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('CSSAnimation');
  expect(frame).toContain('1200ms');
  expect(frame).toContain('delay 100ms');
  stdin.write(' ');
  const dPause = Date.now() + 1500;
  while (!calls.some(c => c[0] === 'setPaused') && Date.now() < dPause) await sleep(15);
  expect(calls).toContainEqual(['setPaused', { animations: ['a1'], paused: true }]);
  await waitForFrame(lastFrame, '· 일시정지');
  stdin.write('r');
  await waitForFrame(lastFrame, 'rate 25%');
  expect(calls).toContainEqual(['setPlaybackRate', { playbackRate: 0.25 }]);
  stdin.write('5');
  const d1 = Date.now() + 1500;
  while (!calls.some(c => c[0] === 'seek') && Date.now() < d1) await sleep(15);
  expect(calls).toContainEqual(['seek', { animations: ['a1'], currentTime: 700 }]);
  expect(stripAnsi(lastFrame()!)).toContain('애니메이션 (1)');
  stdin.write(ESC);
  const d2 = Date.now() + 1500;
  while (!calls.some(c => c[0] === 'disable') && Date.now() < d2) await sleep(15);
  expect(calls.some(c => c[0] === 'disable')).toBe(true);
  await waitForFrame(lastFrame, 'div#app');
});

test('a canceled animation is marked and excluded from pause-all', async () => {
  respondDetail();
  const paused: any[] = [];
  mock.respond('Animation.setPaused', p => { paused.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await openElements(lastFrame, stdin);
  await runPalette(lastFrame, stdin, '애니메이션', '애니메이션 검사');
  await waitForFrame(lastFrame, '캡처된 애니메이션 없음');
  await sleep(60);
  mock.emitEvent('Animation.animationStarted', { animation: { id: 'a1', name: 'fade', type: 'CSSTransition', source: { duration: 300 } } });
  mock.emitEvent('Animation.animationStarted', { animation: { id: 'a2', name: 'slide', type: 'CSSAnimation', source: { duration: 500 } } });
  await waitForFrame(lastFrame, 'slide');
  mock.emitEvent('Animation.animationCanceled', { id: 'a1' });
  await waitForFrame(lastFrame, '✗');
  stdin.write(' ');
  const deadline = Date.now() + 1500;
  while (!paused.length && Date.now() < deadline) await sleep(15);
  expect(paused).toEqual([{ animations: ['a2'], paused: true }]);
});
