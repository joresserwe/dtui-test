import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { querySelector, getOuterHTML, setOuterHTML, getBoxModel, highlightNode, hideHighlight, setAttributesAsText, getAttributes, removeNode, copyTo, setAttributeValue, removeAttribute, toggleClassToken, stripHideClass, HIDE_CLASS } from '../src/cdp/dom.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('querySelector resolves the document root then the selector', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('DOM.getDocument', () => ({ root: { nodeId: 1 } }));
  mock.respond('DOM.querySelector', p => { calls.push(['q', p]); return { nodeId: 42 }; });
  expect(await querySelector(conn, '#app .btn')).toBe(42);
  expect(calls[0][1]).toEqual({ nodeId: 1, selector: '#app .btn' });
});

test('querySelector returns null when nodeId is 0', async () => {
  mock.respond('DOM.getDocument', () => ({ root: { nodeId: 1 } }));
  mock.respond('DOM.querySelector', () => ({ nodeId: 0 }));
  expect(await querySelector(conn, '.missing')).toBeNull();
});

test('outerHTML get/set map to DOM domain', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<div>hi</div>' }));
  mock.respond('DOM.setOuterHTML', p => { calls.push(['set', p]); return {}; });
  expect(await getOuterHTML(conn, 42)).toBe('<div>hi</div>');
  await setOuterHTML(conn, 42, '<div>bye</div>');
  expect(calls[0][1]).toEqual({ nodeId: 42, outerHTML: '<div>bye</div>' });
});

test('setAttributesAsText sends the raw attribute text', async () => {
  let seen: any;
  mock.respond('DOM.setAttributesAsText', p => { seen = p; return {}; });
  await setAttributesAsText(conn, 42, 'id="x" class="y z"');
  expect(seen).toEqual({ nodeId: 42, text: 'id="x" class="y z"' });
});

test('getAttributes folds the interleaved attribute list', async () => {
  mock.respond('DOM.getAttributes', () => ({ attributes: ['id', 'x', 'class', 'a b'] }));
  expect(await getAttributes(conn, 42)).toEqual({ id: 'x', class: 'a b' });
  mock.respond('DOM.getAttributes', () => ({}));
  expect(await getAttributes(conn, 42)).toEqual({});
});

test('setAttributeValue and removeAttribute map to the DOM domain', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('DOM.setAttributeValue', p => { calls.push(['set', p]); return {}; });
  mock.respond('DOM.removeAttribute', p => { calls.push(['rm', p]); return {}; });
  await setAttributeValue(conn, 42, 'class', 'a b');
  await removeAttribute(conn, 42, 'class');
  expect(calls).toEqual([
    ['set', { nodeId: 42, name: 'class', value: 'a b' }],
    ['rm', { nodeId: 42, name: 'class' }],
  ]);
});

test('toggleClassToken adds the token when absent and removes it when present', () => {
  expect(toggleClassToken('btn primary', HIDE_CLASS)).toEqual({ value: `btn primary ${HIDE_CLASS}`, on: true });
  expect(toggleClassToken(`btn ${HIDE_CLASS} primary`, HIDE_CLASS)).toEqual({ value: 'btn primary', on: false });
  expect(toggleClassToken(undefined, HIDE_CLASS)).toEqual({ value: HIDE_CLASS, on: true });
  expect(toggleClassToken(`  ${HIDE_CLASS}  `, HIDE_CLASS)).toEqual({ value: '', on: false });
});

test('stripHideClass removes the marker from a tree label', () => {
  expect(stripHideClass(`div#app.card.${HIDE_CLASS}`)).toBe('div#app.card');
  expect(stripHideClass('div#app.card')).toBe('div#app.card');
});

test('removeNode maps to DOM.removeNode', async () => {
  let seen: any;
  mock.respond('DOM.removeNode', p => { seen = p; return {}; });
  await removeNode(conn, 42);
  expect(seen).toEqual({ nodeId: 42 });
});

test('copyTo maps to DOM.copyTo and returns the new nodeId', async () => {
  const calls: any[] = [];
  mock.respond('DOM.copyTo', p => { calls.push(p); return { nodeId: 99 }; });
  expect(await copyTo(conn, 9, 3, 6)).toBe(99);
  expect(await copyTo(conn, 9, 3)).toBe(99);
  expect(calls).toEqual([
    { nodeId: 9, targetNodeId: 3, insertBeforeNodeId: 6 },
    { nodeId: 9, targetNodeId: 3 },
  ]);
});

test('getBoxModel maps model, returns null on error', async () => {
  mock.respond('DOM.getBoxModel', () => ({ model: { content: [0,0,10,0,10,10,0,10], padding: [], border: [], margin: [], width: 10, height: 10 } }));
  const box = await getBoxModel(conn, 42);
  expect(box).toMatchObject({ width: 10, height: 10 });
  mock.respond('DOM.getBoxModel', () => { throw { code: -32000, message: 'no box' }; });
  expect(await getBoxModel(conn, 42)).toBeNull();
});

test('highlight enables overlay then highlights; hide hides', async () => {
  const calls: string[] = [];
  mock.respond('Overlay.enable', () => { calls.push('enable'); return {}; });
  mock.respond('Overlay.highlightNode', p => { calls.push('highlight'); expect(p.nodeId).toBe(42); expect(p.highlightConfig).toBeDefined(); return {}; });
  mock.respond('Overlay.hideHighlight', () => { calls.push('hide'); return {}; });
  await highlightNode(conn, 42);
  await hideHighlight(conn);
  expect(calls).toEqual(['enable', 'highlight', 'hide']);
});
