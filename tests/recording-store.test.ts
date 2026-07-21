import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import { mkdtemp, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseStep,
  parseRecording,
  listRecordings,
  loadRecording,
  saveRecording,
  deleteRecording,
  renameRecording,
  recordingsDir,
  recordingSlug,
  type Recording,
  type Step,
} from '../src/store/recording.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dtui-rec-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const rec = (name: string, steps: Step[], createdAt = '2026-07-20T00:00:00.000Z'): Recording => ({
  name,
  createdAt,
  steps,
  version: 1,
});

describe('parseStep', () => {
  test('accepts each valid kind', () => {
    expect(parseStep({ kind: 'goto', url: 'https://a.test/' })).toEqual({ kind: 'goto', url: 'https://a.test/' });
    expect(parseStep({ kind: 'nav', url: 'https://a.test/x' })).toEqual({ kind: 'nav', url: 'https://a.test/x' });
    expect(parseStep({ kind: 'click', selector: '#go' })).toEqual({ kind: 'click', selector: '#go' });
    expect(parseStep({ kind: 'click', selector: '#go', alt: { x: 5, y: 6 } })).toEqual({ kind: 'click', selector: '#go', alt: { x: 5, y: 6 } });
    expect(parseStep({ kind: 'input', selector: '[name=q]', value: 'hi' })).toEqual({ kind: 'input', selector: '[name=q]', value: 'hi' });
    expect(parseStep({ kind: 'input', selector: '#pw', redacted: true })).toEqual({ kind: 'input', selector: '#pw', redacted: true });
    expect(parseStep({ kind: 'key', selector: null, key: 'Enter' })).toEqual({ kind: 'key', selector: null, key: 'Enter' });
    expect(parseStep({ kind: 'select', selector: '#s', value: 'b' })).toEqual({ kind: 'select', selector: '#s', value: 'b' });
  });

  test('rejects junk', () => {
    expect(parseStep(null)).toBeNull();
    expect(parseStep({ kind: 'wat', selector: 'x' })).toBeNull();
    expect(parseStep({ kind: 'click' })).toBeNull();
    expect(parseStep({ kind: 'goto' })).toBeNull();
    expect(parseStep({ kind: 'key', selector: 5, key: 'Enter' })).toBeNull();
    expect(parseStep({ kind: 'input', selector: '#a' })).toBeNull();
  });

  test('drops password value even if present alongside redacted', () => {
    expect(parseStep({ kind: 'input', selector: '#pw', redacted: true, value: 'secret' })).toEqual({ kind: 'input', selector: '#pw', redacted: true });
  });
});

describe('parseRecording', () => {
  test('parses a whole file and drops bad steps', () => {
    const parsed = parseRecording({
      name: 'login',
      createdAt: '2026-07-20T00:00:00.000Z',
      version: 1,
      steps: [
        { kind: 'goto', url: 'https://a.test/' },
        { kind: 'bogus' },
        { kind: 'click', selector: '#go' },
      ],
    });
    expect(parsed?.name).toBe('login');
    expect(parsed?.steps.map(s => s.kind)).toEqual(['goto', 'click']);
  });

  test('rejects wrong version or shape', () => {
    expect(parseRecording(null)).toBeNull();
    expect(parseRecording({ name: 'x', steps: [], version: 2 })).toBeNull();
    expect(parseRecording({ steps: [], version: 1 })).toBeNull();
  });
});

describe('recordingSlug', () => {
  test('slugs a display name, falling back for empty', () => {
    expect(recordingSlug('Login Flow!')).toBe('login-flow');
    expect(recordingSlug('   ')).toBe('recording');
  });
});

describe('file I/O', () => {
  test('save then list then load round-trips', () => {
    const file = saveRecording(dir, rec('Login', [{ kind: 'goto', url: 'https://a.test/' }, { kind: 'click', selector: '#go' }]));
    expect(file.endsWith('.json')).toBe(true);
    const metas = listRecordings(dir);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ name: 'Login', stepCount: 2 });
    const loaded = loadRecording(dir, metas[0].file);
    expect(loaded?.steps).toHaveLength(2);
  });

  test('save is atomic via a temp file that is renamed', async () => {
    saveRecording(dir, rec('Alpha', [{ kind: 'goto', url: 'https://a.test/' }]));
    const names = await readdir(dir);
    expect(names.some(n => n.endsWith('.tmp'))).toBe(false);
    expect(names.filter(n => n.endsWith('.json'))).toHaveLength(1);
  });

  test('distinct names with a colliding slug get unique files', () => {
    const a = saveRecording(dir, rec('Login', [{ kind: 'goto', url: 'https://a.test/1' }]));
    const b = saveRecording(dir, rec('Login', [{ kind: 'goto', url: 'https://a.test/2' }]));
    expect(a).not.toBe(b);
    expect(listRecordings(dir)).toHaveLength(2);
  });

  test('list is newest-first by createdAt', () => {
    saveRecording(dir, rec('Older', [{ kind: 'goto', url: 'https://a.test/' }], '2026-07-19T00:00:00.000Z'));
    saveRecording(dir, rec('Newer', [{ kind: 'goto', url: 'https://a.test/' }], '2026-07-20T00:00:00.000Z'));
    expect(listRecordings(dir).map(m => m.name)).toEqual(['Newer', 'Older']);
  });

  test('rename keeps the same file but changes the display name', () => {
    const file = saveRecording(dir, rec('Old Name', [{ kind: 'goto', url: 'https://a.test/' }]));
    renameRecording(dir, file, 'New Name');
    const metas = listRecordings(dir);
    expect(metas).toHaveLength(1);
    expect(metas[0].name).toBe('New Name');
    expect(metas[0].file).toBe(file);
  });

  test('delete removes the file', () => {
    const file = saveRecording(dir, rec('Bye', [{ kind: 'goto', url: 'https://a.test/' }]));
    deleteRecording(dir, file);
    expect(listRecordings(dir)).toHaveLength(0);
  });

  test('list tolerates and cleans stale temp files and garbage json', async () => {
    saveRecording(dir, rec('Good', [{ kind: 'goto', url: 'https://a.test/' }]));
    await writeFile(join(dir, 'broken.json'), '{not json');
    const stale = join(dir, 'stale.json.tmp');
    await writeFile(stale, '{}');
    const past = Date.now() - 120_000;
    const fs = await import('node:fs');
    fs.utimesSync(stale, past / 1000, past / 1000);
    const metas = listRecordings(dir);
    expect(metas.map(m => m.name)).toEqual(['Good']);
    expect((await readdir(dir)).some(n => n === 'stale.json.tmp')).toBe(false);
  });

  test('password values never touch disk', async () => {
    const file = saveRecording(dir, rec('Secure', [
      { kind: 'input', selector: '#pw', redacted: true },
      { kind: 'input', selector: '#user', value: 'alice' },
    ]));
    const text = await readFile(join(dir, file), 'utf8');
    expect(text).not.toContain('secret');
    expect(text).toContain('"redacted":true');
  });
});

test('recordingsDir lands under the config dir', () => {
  const p = recordingsDir({ XDG_CONFIG_HOME: '/cfg' } as NodeJS.ProcessEnv, 'linux');
  expect(p).toBe('/cfg/devtools-tui/recordings');
});
