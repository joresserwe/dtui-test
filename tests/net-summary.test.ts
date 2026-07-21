import { test, expect } from 'vitest';
import { networkSummary } from '../src/tui/lib/net-summary.js';
import { applyNetCopyAll, copyAllHar, toggleMark } from '../src/tui/keys/network-keys.js';
import { exportSessionHar } from '../src/tui/lib/session-actions.js';
import { t } from '../src/tui/lib/i18n.js';
import type { NetworkEntry } from '../src/store/types.js';
import type { NetworkTool } from '../src/tui/hooks/use-network-tool.js';

const entry = (over: Partial<NetworkEntry>): NetworkEntry => ({
  id: '1', url: 'https://a.test/x', method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {}, startTs: 0,
  ...over,
});

test('networkSummary sums encoded/decoded bytes and counts, treating missing sizes as zero', () => {
  const es = [
    entry({ id: '1', encodedBytes: 100, decodedBytes: 300 }),
    entry({ id: '2', encodedBytes: 50, decodedBytes: 120 }),
    entry({ id: '3' }),
  ];
  expect(networkSummary(es)).toEqual({ count: 3, transferred: 150, resources: 420 });
  expect(networkSummary([])).toEqual({ count: 0, transferred: 0, resources: 0 });
});

async function runCopyAll(choice: string, entries: NetworkEntry[]) {
  const copied: string[] = [];
  let toast = '';
  applyNetCopyAll(choice, entries, { browser: 'x', bodyCap: 1000, sanitize: true }, async text => { copied.push(text); }, msg => { toast = msg; });
  await new Promise(r => setTimeout(r, 0));
  return { copied, toast };
}

test('applyNetCopyAll all-urls joins URLs by newline and reports the count', async () => {
  const es = [entry({ id: '1', url: 'https://a.test/one' }), entry({ id: '2', url: 'https://a.test/two' })];
  const { copied, toast } = await runCopyAll('all-urls', es);
  expect(copied).toEqual(['https://a.test/one\nhttps://a.test/two']);
  expect(toast).toBe(t('toast.copiedAllUrls', { n: 2 }));
});

test('applyNetCopyAll all-curl emits a curl command per entry', async () => {
  const es = [entry({ id: '1', url: 'https://a.test/one' }), entry({ id: '2', url: 'https://a.test/two' })];
  const { copied, toast } = await runCopyAll('all-curl', es);
  expect(copied).toHaveLength(1);
  expect(copied[0].match(/curl/g) ?? []).toHaveLength(2);
  expect(copied[0]).toContain('https://a.test/one');
  expect(copied[0]).toContain('https://a.test/two');
  expect(toast).toBe(t('toast.copiedAllCurl', { n: 2 }));
});

test('applyNetCopyAll all-har produces a valid HAR log restricted to the given entries', async () => {
  const es = [entry({ id: '1', url: 'https://a.test/one', status: 200 })];
  const { copied, toast } = await runCopyAll('all-har', es);
  const har = JSON.parse(copied[0]);
  expect(har.log.entries).toHaveLength(1);
  expect(har.log.entries[0].request.url).toBe('https://a.test/one');
  expect(toast).toBe(t('toast.copiedAllHar', { n: 1 }));
});

test('copy-all reports "nothing to copy" and never touches the clipboard when the set is empty', async () => {
  for (const choice of ['all-urls', 'all-curl', 'all-fetch', 'all-har']) {
    const { copied, toast } = await runCopyAll(choice, []);
    expect(copied).toEqual([]);
    expect(toast).toBe(t('toast.copyNothing'));
  }
});

test('copyAllHar redacts sensitive headers when sanitize is on', async () => {
  const es = [entry({ id: '1', requestHeaders: { Authorization: 'Bearer secret' } })];
  const copied: string[] = [];
  copyAllHar(es, { sanitize: true }, async text => { copied.push(text); }, () => {});
  await new Promise(r => setTimeout(r, 0));
  expect(copied[0]).not.toContain('Bearer secret');
});

function fakeNetTool(initial: string[]): { marked: Set<string>; setMarked: NetworkTool['setMarked'] } {
  let marked = new Set(initial);
  return {
    get marked() { return marked; },
    setMarked: (upd => {
      marked = typeof upd === 'function' ? (upd as (p: Set<string>) => Set<string>)(marked) : upd;
    }) as NetworkTool['setMarked'],
  };
}

test('toggleMark adds an unmarked id and removes an already-marked one', () => {
  const net = fakeNetTool([]) as unknown as NetworkTool;
  toggleMark(net, entry({ id: 'a' }));
  expect([...net.marked]).toEqual(['a']);
  toggleMark(net, entry({ id: 'b' }));
  expect(new Set(net.marked)).toEqual(new Set(['a', 'b']));
  toggleMark(net, entry({ id: 'a' }));
  expect([...net.marked]).toEqual(['b']);
});

test('exportSessionHar forwards a marked subset to the export function', async () => {
  const subset = [entry({ id: '2' })];
  let received: NetworkEntry[] | undefined = [entry({ id: 'sentinel' })];
  exportSessionHar(
    {} as never,
    async (_session, entries) => { received = entries; return '/tmp/x.har'; },
    async () => {},
    () => {},
    subset,
  );
  await new Promise(r => setTimeout(r, 0));
  expect(received).toBe(subset);
});

test('exportSessionHar passes undefined entries when no subset is given (whole session)', async () => {
  let received: NetworkEntry[] | undefined = [entry({ id: 'sentinel' })];
  exportSessionHar(
    {} as never,
    async (_session, entries) => { received = entries; return '/tmp/x.har'; },
    async () => {},
    () => {},
  );
  await new Promise(r => setTimeout(r, 0));
  expect(received).toBeUndefined();
});
