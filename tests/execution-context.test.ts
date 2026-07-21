import { test, expect, beforeEach, afterEach } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { listPages } from '../src/cdp/targets.js';
import { DebugSession } from '../src/engine.js';
import { contextItems, contextTag, nonDefaultContextLabels } from '../src/tui/lib/exec-context.js';

let mock: MockCdp;

beforeEach(async () => {
  mock = await MockCdp.start();
});
afterEach(async () => {
  await mock.close();
});

async function attach() {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  return DebugSession.attach(page, { persist: false });
}

const created = (id: number, extra: Record<string, unknown> = {}) => ({
  context: { id, origin: `https://f${id}.test`, name: `frame-${id}`, auxData: { frameId: `F${id}`, isDefault: id === 1 }, ...extra },
});

test('tracks executionContextCreated and exposes the live context list', async () => {
  const session = await attach();
  let changes = 0;
  session.on('contexts-changed', () => { changes++; });
  mock.emitEvent('Runtime.executionContextCreated', created(1));
  mock.emitEvent('Runtime.executionContextCreated', created(2));
  await new Promise(r => setTimeout(r, 30));
  expect(session.executionContexts()).toEqual([
    { id: 1, origin: 'https://f1.test', name: 'frame-1', frameId: 'F1', isDefault: true },
    { id: 2, origin: 'https://f2.test', name: 'frame-2', frameId: 'F2', isDefault: false },
  ]);
  expect(changes).toBe(2);
  await session.close();
});

test('executionContextDestroyed removes the context and emits context-destroyed', async () => {
  const session = await attach();
  mock.emitEvent('Runtime.executionContextCreated', created(1));
  mock.emitEvent('Runtime.executionContextCreated', created(2));
  await new Promise(r => setTimeout(r, 30));
  let destroyed: number | undefined;
  session.on('context-destroyed', (id: number) => { destroyed = id; });
  mock.emitEvent('Runtime.executionContextDestroyed', { executionContextId: 2 });
  await new Promise(r => setTimeout(r, 30));
  expect(destroyed).toBe(2);
  expect(session.executionContexts().map(c => c.id)).toEqual([1]);
  await session.close();
});

test('executionContextsCleared empties the context list', async () => {
  const session = await attach();
  mock.emitEvent('Runtime.executionContextCreated', created(1));
  mock.emitEvent('Runtime.executionContextCreated', created(2));
  await new Promise(r => setTimeout(r, 30));
  mock.emitEvent('Runtime.executionContextsCleared', {});
  await new Promise(r => setTimeout(r, 30));
  expect(session.executionContexts()).toEqual([]);
  await session.close();
});

test('evaluate forwards contextId only when one is given', async () => {
  let seen: any;
  mock.respond('Runtime.evaluate', p => { seen = p; return { result: { type: 'number', value: 1, description: '1' } }; });
  const session = await attach();
  await session.evaluate('1');
  expect(seen.contextId).toBeUndefined();
  await session.evaluate('1', 7);
  expect(seen.contextId).toBe(7);
  await session.close();
});

test('evaluateEager and evaluateForCompletion forward the contextId', async () => {
  const seen: Record<string, any> = {};
  mock.respond('Runtime.evaluate', p => {
    seen[p.objectGroup] = p;
    return { result: { type: 'string', value: 'x', objectId: p.objectGroup === 'console-completion' ? 'o1' : undefined } };
  });
  mock.respond('Runtime.getProperties', () => ({ result: [] }));
  const session = await attach();
  await session.evaluateEager('x', 3);
  await session.evaluateForCompletion('x', 3);
  expect(seen['console-eager'].contextId).toBe(3);
  expect(seen['console-completion'].contextId).toBe(3);
  await session.close();
});

test('contextTag prefers a compact host and picker items lead with the default', () => {
  const ctxs = [
    { id: 1, origin: 'https://app.test', name: 'top', frameId: 'F1', isDefault: true },
    { id: 2, origin: 'https://ads.example.com', name: 'ad-frame', frameId: 'F2', isDefault: false },
  ];
  expect(contextTag(ctxs[1])).toBe('ads.example.com');
  const items = contextItems(ctxs);
  expect(items[0].value).toBe('1');
  expect(items[1].value).toBe('2');
  expect(items[1].label).toContain('ads.example.com');
  const labels = nonDefaultContextLabels(ctxs);
  expect(labels.get(2)).toBe('ads.example.com');
  expect(labels.has(1)).toBe(false);
});
