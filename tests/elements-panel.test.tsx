import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ElementsPanel, visibleNodes } from '../src/tui/panels/ElementsPanel.js';
import type { NodeMap, NodeInfo } from '../src/cdp/domtree.js';
import type { DomNodeView } from '../src/tui/overlays/DomOverlay.js';

function node(nodeId: number, nodeName: string, isElement: boolean, parentId: number | undefined, childIds: number[], label = nodeName): NodeInfo {
  return { nodeId, nodeName, attributes: {}, parentId, childIds, label, isElement };
}

function build(nodes: NodeInfo[]): NodeMap {
  const map: NodeMap = new Map();
  for (const n of nodes) map.set(n.nodeId, n);
  return map;
}

const sample = build([
  node(1, '#document', false, undefined, [2]),
  node(2, 'html', true, 1, [3, 4], 'html'),
  node(3, 'head', true, 2, [], 'head'),
  node(4, 'body', true, 2, [5, 100], 'body'),
  node(5, 'div', true, 4, [6], 'div#app'),
  node(6, 'span', true, 5, [], 'span.x'),
  node(100, '#text', false, 4, []),
]);

const detail: DomNodeView = {
  selector: '#app .btn',
  nodeId: 6,
  outerHTML: '<span class="x">hi</span>',
  computed: [['display', 'block'], ['position', 'static'], ['color', 'red'], ['margin', '0'], ['z', 'auto']],
  matched: [
    { selector: '.btn', origin: 'regular', properties: [['color', 'red']] as Array<[string, string]> },
    { selector: 'span', origin: 'regular', properties: [['display', 'block']] as Array<[string, string]> },
  ],
  box: { content: [], padding: [], border: [], margin: [], width: 80, height: 32 },
};

const lineCount = (el: React.ReactElement) => render(el).lastFrame()!.split('\n').length;

test('roots are the element nodes whose ancestor chain has no element', () => {
  expect(visibleNodes(sample, new Set())).toEqual([2]);
});

test('expansion gates children and DFS follows childIds order', () => {
  expect(visibleNodes(sample, new Set([2]))).toEqual([2, 3, 4]);
  expect(visibleNodes(sample, new Set([2, 4]))).toEqual([2, 3, 4, 5]);
  expect(visibleNodes(sample, new Set([2, 4, 5]))).toEqual([2, 3, 4, 5, 6]);
});

test('non-element nodes never appear in the visible list', () => {
  expect(visibleNodes(sample, new Set([2, 4, 5]))).not.toContain(100);
});

test('renders the header, loading state and exact height', () => {
  const { lastFrame } = render(
    <ElementsPanel map={null} expanded={new Set()} selectedId={null} detail={null} height={24} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('Elements');
  expect(frame).toContain('DOM 불러오는 중');
  expect(frame.split('\n').length).toBe(24);
});

test('shows the empty-document notice', () => {
  const empty = build([node(1, '#document', false, undefined, [])]);
  const frame = render(
    <ElementsPanel map={empty} expanded={new Set()} selectedId={null} detail={null} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('빈 문서');
});

test('renders the tree with expander glyphs for expanded, collapsed and leaf nodes', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set([2])} selectedId={4} detail={null} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('▾ html');
  expect(frame).toContain('· head');
  expect(frame).toContain('▸ body');
});

test('highlighting node labels keeps the tag/id/class text intact', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set([2, 4])} selectedId={5} detail={null} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('div#app');
});

test('search row shows a cyan cursor while searching', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set()} selectedId={2} detail={null} searching query="di" height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('/di');
  expect(frame).toContain('▌');
});

test('search row shows a set query without a cursor prompt', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set()} selectedId={2} detail={null} query="span" height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('/span');
  expect(frame).not.toContain('/ 검색');
});

test('renders the default search prompt when idle', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set()} selectedId={2} detail={null} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('/ 검색: 텍스트·셀렉터·XPath');
});

test('status shows highlighting and watching segments', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set()} selectedId={2} detail={null} highlighting watching mutationCount={5} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('highlight:on');
  expect(frame).toContain('watching (5)');
});

test('renders the detail strip for the selected node', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set([2, 4, 5])} selectedId={6} detail={detail} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('#app .btn');
  expect(frame).toContain('box:');
  expect(frame).toContain('80');
  expect(frame).toContain('display');
  expect(frame).toContain('block');
  expect(frame).toContain('position');
  expect(frame).toContain('static');
  expect(frame).toContain('rules: 2 matched');
});

test('an error wins the rules row', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set()} selectedId={2} detail={detail} error="boom" height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('boom');
  expect(frame).not.toContain('rules:');
});

const deep = build([
  node(1, '#document', false, undefined, [2]),
  node(2, 'html', true, 1, [3], 'html'),
  node(3, 'body', true, 2, Array.from({ length: 30 }, (_, i) => 10 + i), 'body'),
  ...Array.from({ length: 30 }, (_, i) => node(10 + i, 'div', true, 3, [], `div.n${i}`)),
]);
const deepExpanded = new Set([2, 3]);

test('windows the tree so a selection at the end stays visible', () => {
  const frame = render(
    <ElementsPanel map={deep} expanded={deepExpanded} selectedId={39} detail={null} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('div.n29');
  expect(frame).not.toContain('div.n0 ');
});

test('keeps a selection at the top anchored', () => {
  const frame = render(
    <ElementsPanel map={deep} expanded={deepExpanded} selectedId={2} detail={null} height={20} />,
  ).lastFrame()!;
  expect(frame).toContain('html');
  expect(frame).not.toContain('div.n29');
});

test('renders exactly height rows across every state', () => {
  for (const height of [24, 30, 16, 12]) {
    expect(lineCount(<ElementsPanel map={null} expanded={new Set()} selectedId={null} detail={null} height={height} />)).toBe(height);
    expect(lineCount(<ElementsPanel map={sample} expanded={new Set([2, 4, 5])} selectedId={6} detail={detail} highlighting watching mutationCount={3} error="x" height={height} />)).toBe(height);
    expect(lineCount(<ElementsPanel map={deep} expanded={deepExpanded} selectedId={39} detail={detail} height={height} />)).toBe(height);
    expect(lineCount(<ElementsPanel map={deep} expanded={deepExpanded} selectedId={10} detail={null} height={height} />)).toBe(height);
    expect(lineCount(<ElementsPanel map={build([node(1, '#document', false, undefined, [])])} expanded={new Set()} selectedId={null} detail={null} height={height} />)).toBe(height);
  }
});

test('honours an explicit width', () => {
  const frame = render(
    <ElementsPanel map={sample} expanded={new Set([2])} selectedId={2} detail={null} height={20} width={60} />,
  ).lastFrame()!;
  expect(Math.max(...frame.split('\n').map(l => l.length))).toBe(60);
});
