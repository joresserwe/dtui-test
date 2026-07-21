import { test, expect, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionRoot, createSessionDir, JsonlWriter, pruneSessions, urlSlug } from '../src/persist/session.js';

test('sessionRoot honors XDG_DATA_HOME on linux', () => {
  expect(sessionRoot({ XDG_DATA_HOME: '/data' }, 'linux')).toBe('/data/devtools-tui/sessions');
  expect(sessionRoot({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.local/share/devtools-tui/sessions');
  expect(sessionRoot({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32'))
    .toBe(join('C:\\Users\\u\\AppData\\Local', 'devtools-tui', 'sessions'));
});

test('createSessionDir builds slugged timestamped dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-'));
  const paths = createSessionDir(root, 'https://chzzk.naver.com/live/abc?x=1', new Date('2026-07-16T12:30:00Z'));
  expect(paths.dir).toBe(join(root, '2026-07-16T12-30-00-chzzk-naver-com-live-abc'));
  expect(paths.networkFile).toBe(join(paths.dir, 'network.jsonl'));
  expect(paths.consoleFile).toBe(join(paths.dir, 'console.jsonl'));
  expect((await readdir(root))).toHaveLength(1);
});

test('JsonlWriter appends one JSON object per line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-'));
  const file = join(root, 'out.jsonl');
  const w = new JsonlWriter(file);
  w.write({ a: 1 });
  w.write({ b: 'x' });
  await w.close();
  expect((await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l))).toEqual([{ a: 1 }, { b: 'x' }]);
});

test('JsonlWriter surfaces first append failure and warns once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-'));
  const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const w = new JsonlWriter(join(root, 'no-such-dir', 'out.jsonl'));
  w.write({ a: 1 });
  w.write({ b: 2 });
  await w.close();
  expect(w.error).toBeInstanceOf(Error);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('urlSlug strips an uppercase URL scheme', () => {
  expect(urlSlug('HTTPS://Example.COM/Path?x=1')).toBe('example-com-path');
});

test('pruneSessions deletes oldest dirs until under budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-'));
  for (const [name, age] of [['old', 300], ['mid', 200], ['new', 100]] as const) {
    const dir = join(root, name);
    await mkdir(dir);
    await writeFile(join(dir, 'network.jsonl'), 'x'.repeat(1000));
    const t = new Date(Date.now() - age * 1000);
    await utimes(dir, t, t);
  }
  const deleted = await pruneSessions(root, 2500);
  expect(deleted).toEqual(['old']);
  expect((await readdir(root)).sort()).toEqual(['mid', 'new']);
});

test('pruneSessions returns empty for a missing root', async () => {
  expect(await pruneSessions('/nonexistent/dtui-root-xyz', 1000)).toEqual([]);
});

test('pruneSessions refuses a filesystem root', async () => {
  expect(await pruneSessions('/', 1)).toEqual([]);
});

test('pruneSessions refuses a non-directory root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-'));
  const file = join(root, 'not-a-dir');
  await writeFile(file, 'x');
  expect(await pruneSessions(file, 1)).toEqual([]);
});
