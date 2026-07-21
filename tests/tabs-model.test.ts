import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { TabsModel } from '../src/tui/lib/tabs-model.js';

let mock: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(async () => { await mock.close(); });

const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'x' });

test('refresh groups tabs by window id', async () => {
  mock.pages = [
    { id: 'a', title: 'A', url: 'https://a.test/' },
    { id: 'b', title: 'B', url: 'https://b.test/' },
    { id: 'c', title: 'C', url: 'https://c.test/' },
  ];
  const winMap: Record<string, number> = { a: 1, b: 2, c: 1 };
  const model = new TabsModel(ep(), async id => winMap[id] ?? null);
  await model.refresh();
  expect(model.groups.map(g => ({ w: g.windowId, ids: g.tabs.map(t => t.id) })))
    .toEqual([{ w: 1, ids: ['a', 'c'] }, { w: 2, ids: ['b'] }]);
  expect(model.flat().map(t => t.id)).toEqual(['a', 'c', 'b']);
});

test('falls back to a single null group without windowIdFor', async () => {
  const model = new TabsModel(ep());
  await model.refresh();
  expect(model.groups).toHaveLength(1);
  expect(model.groups[0].windowId).toBeNull();
  expect(model.error).toBeUndefined();
});

test('sets error when listing fails', async () => {
  const model = new TabsModel({ host: '127.0.0.1', port: 1, browser: 'x' });
  await model.refresh();
  expect(model.error).toBeTruthy();
});
