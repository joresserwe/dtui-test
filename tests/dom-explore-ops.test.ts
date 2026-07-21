import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  discardSearchResults,
  getEventListeners,
  getSearchResults,
  performSearch,
  pushNodeByBackendId,
  requestChildNodes,
  requestNode,
  scrollIntoViewIfNeeded,
  setInspectMode,
  setShowFlexOverlays,
  setShowGridOverlays,
} from '../src/cdp/dom.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('performSearch does not touch the document on the happy path', async () => {
  const calls: string[] = [];
  mock.respond('DOM.getDocument', () => { calls.push('doc'); return { root: { nodeId: 1 } }; });
  mock.respond('DOM.performSearch', p => {
    calls.push('search');
    expect(p).toEqual({ query: '//div[@id]', includeUserAgentShadowDOM: false });
    return { searchId: 's-1', resultCount: 3 };
  });
  expect(await performSearch(conn, '//div[@id]')).toEqual({ searchId: 's-1', resultCount: 3 });
  expect(calls).toEqual(['search']);
});

test('performSearch fetches the document and retries when the first attempt fails', async () => {
  const calls: string[] = [];
  let attempts = 0;
  mock.respond('DOM.getDocument', () => { calls.push('doc'); return { root: { nodeId: 1 } }; });
  mock.respond('DOM.performSearch', () => {
    calls.push('search');
    if (++attempts === 1) throw { code: -32000, message: 'DOM agent hasn\'t been enabled' };
    return { searchId: 's-2', resultCount: 1 };
  });
  expect(await performSearch(conn, 'query')).toEqual({ searchId: 's-2', resultCount: 1 });
  expect(calls).toEqual(['search', 'doc', 'search']);
});

test('getSearchResults and discardSearchResults pass the searchId through', async () => {
  let seen: any;
  mock.respond('DOM.getSearchResults', p => { seen = p; return { nodeIds: [4, 9] }; });
  expect(await getSearchResults(conn, 's-1', 1, 3)).toEqual([4, 9]);
  expect(seen).toEqual({ searchId: 's-1', fromIndex: 1, toIndex: 3 });
  mock.respond('DOM.getSearchResults', () => ({}));
  expect(await getSearchResults(conn, 's-1', 0, 1)).toEqual([]);
  let discarded: any;
  mock.respond('DOM.discardSearchResults', p => { discarded = p; return {}; });
  await discardSearchResults(conn, 's-1');
  expect(discarded).toEqual({ searchId: 's-1' });
});

test('setInspectMode enables DOM and Overlay before switching modes', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('DOM.enable', () => { calls.push(['dom', null]); return {}; });
  mock.respond('Overlay.enable', () => { calls.push(['overlay', null]); return {}; });
  mock.respond('Overlay.setInspectMode', p => { calls.push(['mode', p.mode]); expect(p.highlightConfig).toBeDefined(); return {}; });
  await setInspectMode(conn, true);
  await setInspectMode(conn, false);
  expect(calls).toEqual([
    ['dom', null], ['overlay', null], ['mode', 'searchForNode'],
    ['dom', null], ['overlay', null], ['mode', 'none'],
  ]);
});

test('requestChildNodes and scrollIntoViewIfNeeded target the node', async () => {
  const seen: any[] = [];
  mock.respond('DOM.requestChildNodes', p => { seen.push(p); return {}; });
  mock.respond('DOM.scrollIntoViewIfNeeded', p => { seen.push(p); return {}; });
  await requestChildNodes(conn, 5);
  await requestChildNodes(conn, 5, 3);
  await scrollIntoViewIfNeeded(conn, 7);
  expect(seen).toEqual([{ nodeId: 5, depth: 1 }, { nodeId: 5, depth: 3 }, { nodeId: 7 }]);
});

test('requestNode and pushNodeByBackendId map zero ids to null', async () => {
  mock.respond('DOM.requestNode', p => { expect(p.objectId).toBe('obj-1'); return { nodeId: 12 }; });
  expect(await requestNode(conn, 'obj-1')).toBe(12);
  mock.respond('DOM.requestNode', () => ({ nodeId: 0 }));
  expect(await requestNode(conn, 'obj-1')).toBeNull();
  mock.respond('DOM.pushNodesByBackendIdsToFrontend', p => { expect(p.backendNodeIds).toEqual([77]); return { nodeIds: [12] }; });
  expect(await pushNodeByBackendId(conn, 77)).toBe(12);
  mock.respond('DOM.pushNodesByBackendIdsToFrontend', () => ({ nodeIds: [0] }));
  expect(await pushNodeByBackendId(conn, 77)).toBeNull();
});

test('grid and flex overlays send one config per node', async () => {
  let grid: any;
  let flex: any;
  mock.respond('Overlay.enable', () => ({}));
  mock.respond('Overlay.setShowGridOverlays', p => { grid = p; return {}; });
  mock.respond('Overlay.setShowFlexOverlays', p => { flex = p; return {}; });
  await setShowGridOverlays(conn, [3, 4]);
  await setShowFlexOverlays(conn, [9]);
  expect(grid.gridNodeHighlightConfigs.map((c: any) => c.nodeId)).toEqual([3, 4]);
  expect(grid.gridNodeHighlightConfigs[0].gridHighlightConfig).toBeDefined();
  expect(flex.flexNodeHighlightConfigs).toHaveLength(1);
  expect(flex.flexNodeHighlightConfigs[0]).toMatchObject({ nodeId: 9 });
  await setShowGridOverlays(conn, []);
  expect(grid.gridNodeHighlightConfigs).toEqual([]);
});

test('getEventListeners resolves the node, maps listeners, and releases the group', async () => {
  const calls: string[] = [];
  mock.respond('DOM.resolveNode', p => {
    calls.push('resolve');
    expect(p.nodeId).toBe(9);
    return { object: { objectId: 'obj-9' } };
  });
  mock.respond('DOMDebugger.getEventListeners', p => {
    calls.push('listeners');
    expect(p.objectId).toBe('obj-9');
    return { listeners: [
      { type: 'click', useCapture: true, passive: false, once: true, scriptId: '22', lineNumber: 4, columnNumber: 2, handler: { description: 'function onClick() {\n stuff \n}' } },
      { type: 'scroll' },
    ] };
  });
  mock.respond('Runtime.releaseObjectGroup', p => { calls.push(`release:${p.objectGroup}`); return {}; });
  const listeners = await getEventListeners(conn, 9);
  expect(listeners).toEqual([
    { type: 'click', useCapture: true, passive: false, once: true, scriptId: '22', lineNumber: 4, columnNumber: 2, handler: 'function onClick() {' },
    { type: 'scroll', useCapture: false, passive: false, once: false, scriptId: undefined, lineNumber: undefined, columnNumber: undefined, handler: undefined },
  ]);
  const deadline = Date.now() + 1000;
  while (!calls.includes('release:dtui-listeners') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  expect(calls.filter(c => c === 'resolve' || c === 'listeners')).toEqual(['resolve', 'listeners']);
  expect(calls).toContain('release:dtui-listeners');
});

test('getEventListeners returns empty when the node does not resolve', async () => {
  mock.respond('DOM.resolveNode', () => ({}));
  expect(await getEventListeners(conn, 9)).toEqual([]);
});
