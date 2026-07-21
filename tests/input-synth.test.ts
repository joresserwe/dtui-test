import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { contentCenter, synthClick, synthHover } from '../src/cdp/input.js';
import { listPages } from '../src/cdp/targets.js';
import { DebugSession } from '../src/engine.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

const box = (content: number[]) => ({ content, padding: [], border: [], margin: [], width: 0, height: 0 });

test('contentCenter averages the content quad extremes', () => {
  expect(contentCenter(box([0, 0, 10, 0, 10, 10, 0, 10]))).toEqual({ x: 5, y: 5 });
  expect(contentCenter(box([100, 20, 140, 20, 140, 51, 100, 51]))).toEqual({ x: 120, y: 36 });
});

test('contentCenter rejects missing or degenerate quads', () => {
  expect(contentCenter(null)).toBeNull();
  expect(contentCenter(box([]))).toBeNull();
  expect(contentCenter(box([1, 2, 3]))).toBeNull();
});

test('synthClick dispatches mousePressed then mouseReleased at the point', async () => {
  const events: any[] = [];
  mock.respond('Input.dispatchMouseEvent', p => { events.push(p); return {}; });
  await synthClick(conn, 12, 34);
  expect(events.map(e => e.type)).toEqual(['mousePressed', 'mouseReleased']);
  for (const e of events) {
    expect(e).toMatchObject({ x: 12, y: 34, button: 'left', clickCount: 1 });
  }
  expect(events[0].buttons).toBe(1);
  expect(events[1].buttons).toBe(0);
});

test('synthHover dispatches a single mouseMoved', async () => {
  const events: any[] = [];
  mock.respond('Input.dispatchMouseEvent', p => { events.push(p); return {}; });
  await synthHover(conn, 7, 8);
  expect(events).toEqual([{ type: 'mouseMoved', x: 7, y: 8, button: 'none' }]);
});

async function attachSession() {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  return DebugSession.attach(page, { persist: false });
}

test('clickNode scrolls the node into view then clicks its content center', async () => {
  const calls: string[] = [];
  mock.respond('DOM.scrollIntoViewIfNeeded', p => { calls.push(`scroll:${p.nodeId}`); return {}; });
  mock.respond('DOM.getBoxModel', () => ({ model: box([0, 0, 20, 0, 20, 10, 0, 10]) }));
  mock.respond('Input.dispatchMouseEvent', p => { calls.push(`${p.type}@${p.x},${p.y}`); return {}; });
  const session = await attachSession();
  await session.clickNode(42);
  expect(calls).toEqual(['scroll:42', 'mousePressed@10,5', 'mouseReleased@10,5']);
  await session.close();
});

test('hoverNode moves the mouse and clickNode rejects boxless nodes', async () => {
  const moved: any[] = [];
  mock.respond('DOM.scrollIntoViewIfNeeded', () => ({}));
  mock.respond('DOM.getBoxModel', () => ({ model: box([2, 2, 6, 2, 6, 6, 2, 6]) }));
  mock.respond('Input.dispatchMouseEvent', p => { moved.push(p); return {}; });
  const session = await attachSession();
  await session.hoverNode(42);
  expect(moved).toEqual([{ type: 'mouseMoved', x: 4, y: 4, button: 'none' }]);
  mock.respond('DOM.getBoxModel', () => { throw { code: -32000, message: 'no box' }; });
  await expect(session.clickNode(42)).rejects.toThrow('node has no box model');
  await session.close();
});

test('a failing scrollIntoViewIfNeeded does not abort the click', async () => {
  const events: string[] = [];
  mock.respond('DOM.scrollIntoViewIfNeeded', () => { throw { code: -32000, message: 'not visible' }; });
  mock.respond('DOM.getBoxModel', () => ({ model: box([0, 0, 4, 0, 4, 4, 0, 4]) }));
  mock.respond('Input.dispatchMouseEvent', p => { events.push(p.type); return {}; });
  const session = await attachSession();
  await session.clickNode(9);
  expect(events).toEqual(['mousePressed', 'mouseReleased']);
  await session.close();
});
