import { test, expect } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotRoot, captureSnapshot } from '../src/persist/snapshot.js';

test('snapshotRoot follows the data-root convention', () => {
  expect(snapshotRoot({ XDG_DATA_HOME: '/data' }, 'linux')).toBe('/data/devtools-tui/snapshots');
});

test('captureSnapshot writes every artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-snap-'));
  const dir = await captureSnapshot(root, {
    url: 'https://a.test/page?x=1', origin: 'https://a.test',
    cookies: async () => [{ name: 'sid', value: 'abc', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: false }],
    local: async () => [['k', 'v']],
    session: async () => [],
    dom: async () => '<html></html>',
    screenshotBase64: async () => Buffer.from('png').toString('base64'),
    networkHar: () => ({ log: { version: '1.2', entries: [] } }),
    networkJsonl: () => '{"id":"r1"}\n',
    consoleJsonl: () => '{"kind":"log"}\n',
  }, new Date('2026-07-16T09:00:00Z'));

  expect(dir).toBe(join(root, '2026-07-16T09-00-00-a-test-page'));
  const files = (await readdir(dir)).sort();
  expect(files).toEqual(['console.jsonl', 'cookies.json', 'dom.html', 'meta.json', 'network.jsonl', 'screenshot.png', 'session.har', 'storage.json']);
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
  expect(meta).toMatchObject({ url: 'https://a.test/page?x=1', origin: 'https://a.test', capturedAt: '2026-07-16T09:00:00.000Z' });
  expect(JSON.parse(await readFile(join(dir, 'storage.json'), 'utf8'))).toEqual({ local: [['k', 'v']], session: [] });
  expect(await readFile(join(dir, 'screenshot.png'))).toEqual(Buffer.from('png'));
});

test('captureSnapshot omits screenshot when unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-snap2-'));
  const dir = await captureSnapshot(root, {
    url: 'https://a.test/', origin: 'https://a.test',
    cookies: async () => [], local: async () => [], session: async () => [],
    dom: async () => '', screenshotBase64: async () => null,
    networkHar: () => ({}), networkJsonl: () => '', consoleJsonl: () => '',
  });
  expect((await readdir(dir)).includes('screenshot.png')).toBe(false);
});
