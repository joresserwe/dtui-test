import { test, expect } from 'vitest';
import { buildHostDelegate, type LiveSessionView } from '../src/mcp/delegate.js';
import type { DebugSession } from '../src/engine.js';
import type { NetworkEntry } from '../src/store/types.js';

function net(over: Partial<NetworkEntry> & { id: string }): NetworkEntry {
  return {
    url: 'https://shop.test/api', method: 'GET', type: 'XHR',
    requestHeaders: {}, responseHeaders: {}, startTs: 1_000, status: 200,
    ...over,
  };
}

function view(over: { sessionDir?: string; url?: string; entries?: NetworkEntry[]; fallbackId?: string }): LiveSessionView {
  const entries = over.entries ?? [];
  const session = {
    sessionDir: over.sessionDir,
    url: over.url ?? 'https://shop.test/checkout?x=1',
    network: { entries: () => entries, size: entries.length },
    console: { entries: () => [] },
  } as unknown as DebugSession;
  return { session, title: 'Shop', fallbackId: over.fallbackId ?? 'target-abc123', openedAt: 1_000 };
}

test('readNetwork strips bodies, postData and ws frames from live entries', () => {
  const full = net({ id: 'n1', body: '{"secret":true}', bodyBase64: true, bodyTruncated: true, postData: 'user=alice', wsFrames: [{ dir: 'sent', opcode: 1, payload: 'p', ts: 1 }] });
  const delegate = buildHostDelegate({
    sessions: () => [view({ sessionDir: '/s/2026-07-20T00-00-00-shop-test', entries: [full] })],
    activeSession: () => null,
    selection: () => null,
  });
  const rows = delegate.readNetwork('2026-07-20T00-00-00-shop-test') as NetworkEntry[];
  expect(rows[0]).not.toHaveProperty('body');
  expect(rows[0]).not.toHaveProperty('bodyBase64');
  expect(rows[0]).not.toHaveProperty('bodyTruncated');
  expect(rows[0]).not.toHaveProperty('postData');
  expect(rows[0]).not.toHaveProperty('wsFrames');
  expect(rows[0].id).toBe('n1');
});

test('readRequest keeps the full body for detail reads', () => {
  const full = net({ id: 'n1', body: '{"secret":true}', postData: 'user=alice' });
  const delegate = buildHostDelegate({
    sessions: () => [view({ sessionDir: '/s/2026-07-20T00-00-00-shop-test', entries: [full] })],
    activeSession: () => null,
    selection: () => null,
  });
  expect(delegate.readRequest('2026-07-20T00-00-00-shop-test', 'n1')).toMatchObject({ body: '{"secret":true}', postData: 'user=alice' });
});

test('listSessions derives a urlSlug for persisted sessions', () => {
  const delegate = buildHostDelegate({
    sessions: () => [view({ sessionDir: '/s/2026-07-20T00-00-00-shop-test', url: 'https://shop.test/checkout' })],
    activeSession: () => null,
    selection: () => null,
  });
  const rows = delegate.listSessions() as Array<{ id: string; urlSlug: string }>;
  expect(rows[0].id).toBe('2026-07-20T00-00-00-shop-test');
  expect(rows[0].urlSlug).toBe('shop-test-checkout');
});

test('listSessions omits the urlSlug for non-persisted sessions', () => {
  const delegate = buildHostDelegate({
    sessions: () => [view({ sessionDir: undefined, url: 'https://shop.test/checkout', fallbackId: 'target-abc123' })],
    activeSession: () => null,
    selection: () => null,
  });
  const rows = delegate.listSessions() as Array<{ id: string; urlSlug: string }>;
  expect(rows[0].id).toBe('target-abc123');
  expect(rows[0].urlSlug).toBe('');
});
