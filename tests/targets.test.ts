import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { listPages, attachPage, closePage } from '../src/cdp/targets.js';

let mock: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(async () => { await mock.close(); });

test('listPages returns page targets with rewritten ws host', async () => {
  const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
  expect(pages).toHaveLength(1);
  expect(pages[0]).toMatchObject({ id: 'page1', title: 'Mock Page', url: 'https://mock.test/' });
  expect(pages[0].wsUrl).toBe(`ws://127.0.0.1:${mock.port}/devtools/page/page1`);
});

test('listPages skips pages without webSocketDebuggerUrl', async () => {
  mock.pages.push({ id: 'busy', title: 'Occupied Tab', url: 'https://busy.test/', noWs: true });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1']);
  } finally {
    mock.pages.pop();
  }
});

test('listPages filters out devtools:// targets', async () => {
  mock.pages.push({ id: 'devtools', title: 'DevTools', url: 'devtools://devtools/bundled/inspector.html' });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1']);
  } finally {
    mock.pages.pop();
  }
});

test('listPages filters out browser-internal chrome:// pages', async () => {
  mock.pages.push({ id: 'history', title: '방문기록', url: 'chrome://history' });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1']);
  } finally {
    mock.pages.pop();
  }
});

test('listPages keeps about:blank fresh tabs', async () => {
  mock.pages.push({ id: 'blank', title: 'New Tab', url: 'about:blank' });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1', 'blank']);
  } finally {
    mock.pages.pop();
  }
});

test('listPages keeps http, https, and file pages', async () => {
  mock.pages.push({ id: 'plain', title: 'Plain', url: 'http://plain.test/' });
  mock.pages.push({ id: 'local', title: 'Local', url: 'file:///home/user/index.html' });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1', 'plain', 'local']);
  } finally {
    mock.pages.pop();
    mock.pages.pop();
  }
});

test('listPages filters out extension and other-browser internal pages', async () => {
  mock.pages.push({ id: 'moz', title: 'Ext', url: 'moz-extension://abc/panel.html' });
  mock.pages.push({ id: 'comet', title: 'Comet', url: 'comet://settings' });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1']);
  } finally {
    mock.pages.pop();
    mock.pages.pop();
  }
});

test('listPages filters out targets with empty url', async () => {
  mock.pages.push({ id: 'noUrl', title: 'No URL', url: '' });
  try {
    const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
    expect(pages.map(p => p.id)).toEqual(['page1']);
  } finally {
    mock.pages.pop();
  }
});

test('closePage hits /json/close and removes the target', async () => {
  mock.pages.push({ id: 'doomed', title: 'Doomed', url: 'https://doomed.test/' });
  await closePage({ host: '127.0.0.1', port: mock.port, browser: 'x' }, 'doomed');
  expect(mock.closed).toContain('doomed');
  const pages = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
  expect(pages.map(p => p.id)).toEqual(['page1']);
});

test('closePage rejects on a non-OK response', async () => {
  const notOk = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
  await expect(closePage({ host: '127.0.0.1', port: mock.port, browser: 'x' }, 'page1', notOk)).rejects.toThrow('HTTP 500');
});

test('attachPage enables the four domains', async () => {
  const enabled: string[] = [];
  for (const d of ['Network.enable', 'Page.enable', 'Runtime.enable', 'Log.enable']) {
    mock.respond(d, () => { enabled.push(d); return {}; });
  }
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'x' });
  const conn = await attachPage(page);
  expect(enabled).toEqual(['Network.enable', 'Page.enable', 'Runtime.enable', 'Log.enable']);
  conn.close();
});
