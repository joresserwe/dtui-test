import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { BrowserSession } from '../src/cdp/browser.js';

let mock: MockCdp;
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'x' });
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(async () => { await mock.close(); });

test('createTab sends Target.createTarget with url', async () => {
  const calls: any[] = [];
  mock.respond('Target.createTarget', p => { calls.push(p); return { targetId: 't-1' }; });
  const b = await BrowserSession.connect(ep());
  expect(await b.createTab('https://x.test/')).toBe('t-1');
  expect(calls[0]).toEqual({ url: 'https://x.test/' });
  b.close();
});

test('incognito tab creates a browser context first', async () => {
  const order: string[] = [];
  mock.respond('Target.createBrowserContext', () => { order.push('ctx'); return { browserContextId: 'bc-9' }; });
  mock.respond('Target.createTarget', p => { order.push('target'); return { targetId: p.browserContextId === 'bc-9' ? 't-inc' : 't-wrong' }; });
  const b = await BrowserSession.connect(ep());
  expect(await b.createTab('about:blank', { incognito: true })).toBe('t-inc');
  expect(order).toEqual(['ctx', 'target']);
  b.close();
});

test('windowIdFor returns the window id, or null when unsupported', async () => {
  mock.respond('Browser.getWindowForTarget', () => ({ windowId: 42, bounds: {} }));
  const b = await BrowserSession.connect(ep());
  expect(await b.windowIdFor('t-1')).toBe(42);
  mock.respond('Browser.getWindowForTarget', () => { throw { code: -32601, message: 'not found' }; });
  expect(await b.windowIdFor('t-1')).toBeNull();
  b.close();
});
