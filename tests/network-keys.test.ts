import { test, expect } from 'vitest';
import { copyEntryBody } from '../src/tui/keys/network-keys.js';
import { t } from '../src/tui/lib/i18n.js';
import type { NetworkEntry } from '../src/store/types.js';

const entry = (over: Partial<NetworkEntry>): NetworkEntry => ({
  id: '1', url: 'https://a.test/x', method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {}, startTs: 0,
  ...over,
});

async function run(e: NetworkEntry) {
  const copied: string[] = [];
  let toast = '';
  copyEntryBody(e, async text => { copied.push(text); }, (msg) => { toast = msg; });
  await new Promise(r => setTimeout(r, 0));
  return { copied, toast };
}

test('copyEntryBody reports no body without calling the clipboard', async () => {
  const { copied, toast } = await run(entry({ body: undefined }));
  expect(copied).toEqual([]);
  expect(toast).toBe(t('toast.noResponseBody'));
});

test('copyEntryBody copies plain text with the default toast', async () => {
  const { copied, toast } = await run(entry({ body: 'hello world' }));
  expect(copied).toEqual(['hello world']);
  expect(toast).toBe(t('toast.bodyCopied'));
});

test('copyEntryBody decodes a cleanly-decodable base64 body to utf8', async () => {
  const b64 = Buffer.from('안녕 world', 'utf8').toString('base64');
  const { copied, toast } = await run(entry({ body: b64, bodyBase64: true }));
  expect(copied).toEqual(['안녕 world']);
  expect(toast).toBe(t('toast.bodyCopied'));
});

test('copyEntryBody keeps a binary base64 body raw and flags it in the toast', async () => {
  const b64 = Buffer.from([0xff, 0xfe, 0xfd]).toString('base64');
  const { copied, toast } = await run(entry({ body: b64, bodyBase64: true }));
  expect(copied).toEqual([b64]);
  expect(toast).toBe(t('toast.bodyCopiedBase64'));
});

test('copyEntryBody notes truncation when the captured body was capped', async () => {
  const { copied, toast } = await run(entry({ body: 'partial', bodyTruncated: true }));
  expect(copied).toEqual(['partial']);
  expect(toast).toBe(t('toast.bodyCopiedTruncated'));
});

import { addMapRemoteForEntry, editNetworkConditions, openDiffForMarked, openMapRemoteManager } from '../src/tui/keys/network-keys.js';
import type { DebugSession, MapRemoteRule } from '../src/engine.js';

const tick = () => new Promise(r => setTimeout(r, 0));

test('openDiffForMarked needs exactly two marked entries', () => {
  let diff: { a: NetworkEntry; b: NetworkEntry } | null = null;
  let scroll = 99;
  let toast = '';
  const a = entry({ id: 'a' });
  const b = entry({ id: 'b' });
  openDiffForMarked([a], v => { diff = v; }, n => { scroll = n; }, m => { toast = m; });
  expect(diff).toBeNull();
  expect(toast).toBe(t('toast.diffNeedTwo'));
  openDiffForMarked([a, b], v => { diff = v; }, n => { scroll = n; }, m => { toast = m; });
  expect(diff).toEqual({ a, b });
  expect(scroll).toBe(0);
});

test('addMapRemoteForEntry appends a parsed rule and applies enabled rules', async () => {
  const applied: MapRemoteRule[][] = [];
  const session = { setMapRemote: async (rules: MapRemoteRule[]) => { applied.push(rules); } } as unknown as DebugSession;
  const mapRemoteRef = { current: [] as MapRemoteRule[] };
  const mapSeq = { current: 0 };
  let stored: MapRemoteRule[] = [];
  let toast = '';
  addMapRemoteForEntry(
    session, entry({ url: 'https://a.test/api/users' }),
    async () => '# map remote\nMATCH https://a.test/api/*\nTO http://localhost:3000/api/*\n',
    mapRemoteRef, mapSeq, rules => { stored = rules; }, m => { toast = m; },
  );
  await tick();
  expect(stored).toEqual([{ id: 'mr-0', pattern: 'https://a.test/api/*', target: 'http://localhost:3000/api/*', enabled: true }]);
  expect(applied).toEqual([stored]);
  expect(toast).toBe(t('toast.mapRemoteActive'));
});

test('addMapRemoteForEntry rejects an unchanged or unparsable edit', async () => {
  const session = { setMapRemote: async () => {} } as unknown as DebugSession;
  const mapSeq = { current: 0 };
  let stored: MapRemoteRule[] | null = null;
  let toast = '';
  const e = entry({ url: 'https://a.test/x' });
  addMapRemoteForEntry(session, e, async initial => initial, { current: [] }, mapSeq, r => { stored = r; }, m => { toast = m; });
  await tick();
  expect(stored).toBeNull();
  expect(toast).toBe(t('toast.mapRemoteCanceled'));
  addMapRemoteForEntry(session, e, async () => 'garbage', { current: [] }, mapSeq, r => { stored = r; }, m => { toast = m; });
  await tick();
  expect(stored).toBeNull();
  expect(toast).toBe(t('toast.ruleParseFailed'));
});

test('openMapRemoteManager refuses to open with no rules', () => {
  let open = false;
  let toast = '';
  openMapRemoteManager({ current: [] }, v => { open = v; }, m => { toast = m; });
  expect(open).toBe(false);
  expect(toast).toBe(t('toast.noMapRemoteRules'));
  openMapRemoteManager({ current: [{ id: 'mr-0', pattern: 'a', target: 'b', enabled: true }] }, v => { open = v; }, () => {});
  expect(open).toBe(true);
});

test('editNetworkConditions applies parsed custom conditions through the session', async () => {
  const calls: unknown[] = [];
  const session = {
    customConditions: null,
    throttle: 'off',
    setCustomConditions: async (c: unknown) => { calls.push(c); (session as { throttle: string }).throttle = c ? 'custom' : 'off'; },
  } as unknown as DebugSession;
  let throttleState = '';
  let toast = '';
  editNetworkConditions(session, async () => 'OFFLINE false\nLATENCY 42\nDOWNLOAD 1000\nUPLOAD 500\n', v => { throttleState = v; }, m => { toast = m; });
  await tick();
  expect(calls).toEqual([{ offline: false, latency: 42, downloadThroughput: 1000, uploadThroughput: 500 }]);
  expect(throttleState).toBe('custom');
  expect(toast).toBe('throttle:custom');
});

test('editNetworkConditions clears throttling when the edit is unthrottled', async () => {
  const calls: unknown[] = [];
  const session = {
    customConditions: { offline: false, latency: 42, downloadThroughput: 1000, uploadThroughput: 500 },
    throttle: 'custom',
    setCustomConditions: async (c: unknown) => { calls.push(c); (session as { throttle: string }).throttle = c ? 'custom' : 'off'; },
  } as unknown as DebugSession;
  let throttleState = '';
  editNetworkConditions(session, async () => 'OFFLINE false\nLATENCY 0\nDOWNLOAD 0\nUPLOAD 0\n', v => { throttleState = v; }, () => {});
  await tick();
  expect(calls).toEqual([null]);
  expect(throttleState).toBe('off');
});

test('editNetworkConditions prefills the active preset when no custom conditions are set', async () => {
  let initial = '';
  const session = { customConditions: null, throttle: 'fast3g', setCustomConditions: async () => {} } as unknown as DebugSession;
  editNetworkConditions(session, async prefill => { initial = prefill; return null; }, () => {}, () => {});
  await tick();
  expect(initial).toContain('LATENCY 150');
  expect(initial).toContain('DOWNLOAD 180000');
  expect(initial).toContain('UPLOAD 84000');
});

test('editNetworkConditions treats an unchanged or emptied edit as cancel', async () => {
  const calls: unknown[] = [];
  const session = {
    customConditions: { offline: false, latency: 42, downloadThroughput: 1000, uploadThroughput: 500 },
    throttle: 'custom',
    setCustomConditions: async (c: unknown) => { calls.push(c); },
  } as unknown as DebugSession;
  let toast = '';
  editNetworkConditions(session, async initial => initial, () => {}, m => { toast = m; });
  await tick();
  expect(calls).toEqual([]);
  expect(toast).toBe(t('toast.conditionsCanceled'));
  toast = '';
  editNetworkConditions(session, async () => '   \n', () => {}, m => { toast = m; });
  await tick();
  expect(calls).toEqual([]);
  expect(toast).toBe(t('toast.conditionsCanceled'));
});

test('editNetworkConditions surfaces parse failures and editor cancel', async () => {
  let toast = '';
  const session = { customConditions: null, throttle: 'off', setCustomConditions: async () => { throw new Error('nope'); } } as unknown as DebugSession;
  editNetworkConditions(session, async () => 'NOT VALID LINE FORMAT !', () => {}, m => { toast = m; });
  await tick();
  expect(toast).toBe(t('toast.conditionsParseFailed'));
  toast = '';
  editNetworkConditions(session, async () => null, () => {}, m => { toast = m; });
  await tick();
  expect(toast).toBe('');
});
