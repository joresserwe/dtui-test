import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import type { Endpoint } from '../src/cdp/discovery.js';

let a: MockCdp;
let b: MockCdp;
beforeAll(async () => { a = await MockCdp.start(); b = await MockCdp.start(); });
afterAll(async () => { await a.close(); await b.close(); });

const epFor = (m: MockCdp): Endpoint => ({ host: '127.0.0.1', port: m.port, browser: 'x' });
const dead: Endpoint = { host: '127.0.0.1', port: 1, browser: 'x' };

test('sections expose one entry per endpoint with its groups', async () => {
  a.pages = [{ id: 'a1', title: 'A1', url: 'https://a1.test/' }];
  b.pages = [{ id: 'b1', title: 'B1', url: 'https://b1.test/' }];
  const mt = new MultiTabs([epFor(a), epFor(b)]);
  await mt.refresh();
  const sections = mt.sections();
  expect(sections.map(s => s.endpoint.port)).toEqual([a.port, b.port]);
  expect(sections[0].groups.flatMap(g => g.tabs.map(t => t.id))).toEqual(['a1']);
  expect(sections[1].groups.flatMap(g => g.tabs.map(t => t.id))).toEqual(['b1']);
  expect(mt.flat().map(t => t.id)).toEqual(['a1', 'b1']);
  expect(mt.error).toBeUndefined();
});

test('refresh emits update', async () => {
  a.pages = [{ id: 'a1', title: 'A1', url: 'https://a1.test/' }];
  b.pages = [];
  const mt = new MultiTabs([epFor(a), epFor(b)]);
  const updated = new Promise(r => mt.once('update', r));
  await mt.refresh();
  await updated;
});

test('added fires on second refresh for a gained tab, not on the first', async () => {
  a.pages = [{ id: 'a1', title: 'A1', url: 'https://a1.test/' }];
  b.pages = [];
  const mt = new MultiTabs([epFor(a), epFor(b)]);
  const added: Array<{ port: number; ids: string[] }> = [];
  mt.on('added', e => added.push({ port: e.endpoint.port, ids: e.tabs.map(t => t.id) }));

  await mt.refresh();
  expect(added).toEqual([]);

  a.pages = [
    { id: 'a1', title: 'A1', url: 'https://a1.test/' },
    { id: 'a2', title: 'A2', url: 'https://a2.test/' },
  ];
  await mt.refresh();
  expect(added).toEqual([{ port: a.port, ids: ['a2'] }]);

  await mt.refresh();
  expect(added).toEqual([{ port: a.port, ids: ['a2'] }]);
});

test('a single failing endpoint is tolerated and does not set error', async () => {
  a.pages = [{ id: 'a1', title: 'A1', url: 'https://a1.test/' }];
  const mt = new MultiTabs([epFor(a), dead]);
  await mt.refresh();
  expect(mt.error).toBeUndefined();
  expect(mt.flat().map(t => t.id)).toEqual(['a1']);
  const sections = mt.sections();
  expect(sections[1].groups).toEqual([]);
});

test('error is set only when every endpoint fails', async () => {
  const mt = new MultiTabs([dead, { host: '127.0.0.1', port: 2, browser: 'x' }]);
  await mt.refresh();
  expect(mt.error).toBeTruthy();
});
