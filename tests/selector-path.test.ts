import { test, expect } from 'vitest';
import { buildSelectorPath, cssEscapeIdent } from '../src/tui/lib/selector-path.js';
import type { NodeMap, NodeInfo } from '../src/cdp/domtree.js';

function node(nodeId: number, nodeName: string, isElement: boolean, parentId: number | undefined, childIds: number[], attributes: Record<string, string> = {}): NodeInfo {
  return { nodeId, nodeName, attributes, parentId, childIds, label: nodeName, isElement };
}

function build(nodes: NodeInfo[]): NodeMap {
  const map: NodeMap = new Map();
  for (const n of nodes) map.set(n.nodeId, n);
  return map;
}

const sample = build([
  node(1, '#document', false, undefined, [2]),
  node(2, 'html', true, 1, [3]),
  node(3, 'body', true, 2, [4]),
  node(4, 'div', true, 3, [5, 100], { id: 'app' }),
  node(100, '#text', false, 4, []),
  node(5, 'ul', true, 4, [6], { class: 'list wide' }),
  node(6, 'li', true, 5, [], { class: 'item' }),
]);

test('builds a tag.class chain joined with " > "', () => {
  expect(buildSelectorPath(sample, 6)).toBe('div#app > ul.list.wide > li.item');
});

test('the hide marker class never enters the selector path', () => {
  const hidden = build([
    node(1, '#document', false, undefined, [2]),
    node(2, 'html', true, 1, [3]),
    node(3, 'body', true, 2, [4]),
    node(4, 'div', true, 3, [5], { id: 'app', class: '__devtools-tui-hide__' }),
    node(5, 'ul', true, 4, [], { class: 'list __devtools-tui-hide__ wide' }),
  ]);
  expect(buildSelectorPath(hidden, 5)).toBe('div#app > ul.list.wide');
  expect(buildSelectorPath(hidden, 4)).toBe('div#app');
});

test('an id roots the path — ancestors above it are dropped', () => {
  expect(buildSelectorPath(sample, 5)).toBe('div#app > ul.list.wide');
  expect(buildSelectorPath(sample, 4)).toBe('div#app');
});

test('walks to the document root when no ancestor has an id', () => {
  const noId = build([
    node(1, '#document', false, undefined, [2]),
    node(2, 'html', true, 1, [3]),
    node(3, 'body', true, 2, [4]),
    node(4, 'p', true, 3, [], { class: 'lead' }),
  ]);
  expect(buildSelectorPath(noId, 4)).toBe('html > body > p.lead');
});

test('skips non-element ancestors', () => {
  const mixed = build([
    node(1, '#document', false, undefined, [2]),
    node(2, 'html', true, 1, [3]),
    node(3, '#comment', false, 2, [4]),
    node(4, 'span', true, 3, []),
  ]);
  expect(buildSelectorPath(mixed, 4)).toBe('html > span');
});

test('returns an empty string for an unknown node', () => {
  expect(buildSelectorPath(sample, 999)).toBe('');
});

test('escapes Tailwind-style class names into valid selectors', () => {
  const styled = build([
    node(1, '#document', false, undefined, [2]),
    node(2, 'html', true, 1, [3]),
    node(3, 'body', true, 2, [4]),
    node(4, 'p', true, 3, [], { class: 'hover:bg-red-500 md:w-1/2 2xl' }),
  ]);
  expect(buildSelectorPath(styled, 4)).toBe('html > body > p.hover\\:bg-red-500.md\\:w-1\\/2.\\32 xl');
});

test('cssEscapeIdent covers digits, dashes and safe identifiers', () => {
  expect(cssEscapeIdent('2xl')).toBe('\\32 xl');
  expect(cssEscapeIdent('-2x')).toBe('-\\32 x');
  expect(cssEscapeIdent('-')).toBe('\\-');
  expect(cssEscapeIdent('a_b-c1')).toBe('a_b-c1');
  expect(cssEscapeIdent('hover:bg')).toBe('hover\\:bg');
});
