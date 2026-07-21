import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { applyChildNodes, descendantIds, elementPath, expandTargets, firstChildOf, getDomTree, mapDepth, parentOf, resolveElementPath, siblingOf, type NodeMap } from '../src/cdp/domtree.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

const DOC = {
  root: {
    nodeId: 1, nodeName: '#document', nodeType: 9, attributes: [], children: [
      { nodeId: 2, nodeName: 'HTML', nodeType: 1, attributes: [], children: [
        { nodeId: 3, nodeName: 'BODY', nodeType: 1, attributes: [], children: [
          { nodeId: 4, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app', 'class', 'wrap'], children: [
            { nodeId: 5, nodeName: '#text', nodeType: 3, attributes: [], children: [] },
            { nodeId: 6, nodeName: 'BUTTON', nodeType: 1, attributes: ['class', 'btn'], children: [] },
            { nodeId: 7, nodeName: 'SPAN', nodeType: 1, attributes: [], children: [
              { nodeId: 8, nodeName: '#text', nodeType: 3, attributes: [], children: [] },
              { nodeId: 9, nodeName: '#comment', nodeType: 8, attributes: [], children: [] },
            ] },
          ] },
        ] },
      ] },
    ],
  },
};

test('getDomTree flattens the document with parent/child links and labels', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  expect(map.get(4)).toMatchObject({ nodeName: 'div', parentId: 3, childIds: [5, 6, 7], label: 'div#app.wrap' });
  expect(map.get(6)).toMatchObject({ nodeName: 'button', parentId: 4, label: 'button.btn' });
  expect(map.get(1)?.parentId).toBeUndefined();
});

test('navigation helpers walk element nodes', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  expect(parentOf(map, 6)).toBe(4);
  expect(parentOf(map, 1)).toBeNull();
  expect(firstChildOf(map, 4)).toBe(6);
  expect(siblingOf(map, 6, 'next')).toBe(7);
  expect(siblingOf(map, 7, 'prev')).toBe(6);
  expect(siblingOf(map, 7, 'next')).toBeNull();
});

test('firstChildOf returns null when the only children are non-elements', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  expect(firstChildOf(map, 7)).toBeNull();
});

const pathMap = (offset: number): NodeMap => new Map([
  [offset + 1, { nodeId: offset + 1, nodeName: 'html', attributes: {}, childIds: [offset + 2, offset + 3], label: 'html', isElement: true }],
  [offset + 2, { nodeId: offset + 2, nodeName: 'head', attributes: {}, parentId: offset + 1, childIds: [], label: 'head', isElement: true }],
  [offset + 3, { nodeId: offset + 3, nodeName: 'body', attributes: {}, parentId: offset + 1, childIds: [offset + 4, offset + 5], label: 'body', isElement: true }],
  [offset + 4, { nodeId: offset + 4, nodeName: 'div', attributes: {}, parentId: offset + 3, childIds: [], label: 'div', isElement: true }],
  [offset + 5, { nodeId: offset + 5, nodeName: 'footer', attributes: {}, parentId: offset + 3, childIds: [], label: 'footer', isElement: true }],
]);

test('elementPath and resolveElementPath round-trip within one map', () => {
  const map = pathMap(0);
  for (const id of [1, 2, 3, 4, 5]) {
    const path = elementPath(map, id);
    expect(path).not.toBeNull();
    expect(resolveElementPath(map, path!)).toBe(id);
  }
});

test('paths survive nodeId churn across refetches', () => {
  const before = pathMap(0);
  const after = pathMap(100);
  const path = elementPath(before, 5);
  expect(resolveElementPath(after, path!)).toBe(105);
});

test('resolveElementPath returns null for vanished branches', () => {
  const before = pathMap(0);
  const after = pathMap(100);
  after.get(103)!.childIds = [104];
  after.delete(105);
  const path = elementPath(before, 5);
  expect(resolveElementPath(after, path!)).toBeNull();
});

const LAZY_DOC = {
  root: {
    nodeId: 1, nodeName: '#document', nodeType: 9, attributes: [], childNodeCount: 1, children: [
      { nodeId: 2, nodeName: 'HTML', nodeType: 1, attributes: [], childNodeCount: 1, children: [
        { nodeId: 3, nodeName: 'BODY', nodeType: 1, attributes: [], childNodeCount: 2 },
      ] },
    ],
  },
};

test('getDomTree passes the depth through and flags unloaded children', async () => {
  let depthSeen: number | undefined;
  mock.respond('DOM.getDocument', p => { depthSeen = p.depth; return LAZY_DOC; });
  const map = await getDomTree(conn, 2);
  expect(depthSeen).toBe(2);
  expect(map.get(3)).toMatchObject({ childIds: [], hasUnloadedChildren: true });
  expect(map.get(2)?.hasUnloadedChildren).toBe(false);
  expect(map.get(1)?.hasUnloadedChildren).toBe(false);
});

test('applyChildNodes merges pushed children and marks the parent loaded', async () => {
  mock.respond('DOM.getDocument', () => LAZY_DOC);
  const map = await getDomTree(conn, 2);
  const next = applyChildNodes(map, 3, [
    { nodeId: 4, nodeName: 'DIV', nodeType: 1, attributes: ['id', 'app'], childNodeCount: 1 },
    { nodeId: 5, nodeName: '#text', nodeType: 3, attributes: [], childNodeCount: 0 },
  ]);
  expect(map.get(3)?.hasUnloadedChildren).toBe(true);
  expect(next.get(3)).toMatchObject({ childIds: [4, 5], hasUnloadedChildren: false });
  expect(next.get(4)).toMatchObject({ parentId: 3, label: 'div#app', hasUnloadedChildren: true });
  expect(next.get(5)?.isElement).toBe(false);
});

test('applyChildNodes drops the stale subtree it replaces', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  const next = applyChildNodes(map, 4, [
    { nodeId: 40, nodeName: 'EM', nodeType: 1, attributes: [], childNodeCount: 0 },
  ]);
  expect(next.get(4)?.childIds).toEqual([40]);
  for (const stale of [5, 6, 7, 8, 9]) expect(next.has(stale)).toBe(false);
  expect(map.has(6)).toBe(true);
});

test('applyChildNodes on an unknown parent returns the map unchanged', () => {
  const map = pathMap(0);
  expect(applyChildNodes(map, 999, [])).toBe(map);
});

test('mapDepth measures the deepest parent chain', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  expect(mapDepth(map)).toBe(5);
  expect(mapDepth(new Map())).toBe(0);
});

test('expandTargets expands loaded descendants and lists unloaded ones', async () => {
  mock.respond('DOM.getDocument', () => LAZY_DOC);
  const map = await getDomTree(conn, 2);
  const plan = expandTargets(map, 2, 8, 500);
  expect(plan.expandIds).toEqual([2, 3]);
  expect(plan.loadIds).toEqual([3]);
  expect(plan.truncated).toBe(false);
});

test('expandTargets reports truncation at the depth and node caps', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  const shallow = expandTargets(map, 2, 1, 500);
  expect(shallow.expandIds).toEqual([2]);
  expect(shallow.truncated).toBe(true);
  const narrow = expandTargets(map, 2, 8, 1);
  expect(narrow.truncated).toBe(true);
  const full = expandTargets(map, 2, 8, 500);
  expect(full.expandIds).toEqual([2, 3, 4]);
  expect(full.truncated).toBe(false);
});

test('descendantIds walks every loaded descendant once', async () => {
  mock.respond('DOM.getDocument', () => DOC);
  const map = await getDomTree(conn);
  expect(descendantIds(map, 4).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
  expect(descendantIds(map, 6)).toEqual([]);
});
