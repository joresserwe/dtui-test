import { test, expect } from 'vitest';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditFileName, listAudits, loadAudit, loadLatestAudit, loadSessionAudit, saveAudit } from '../src/audit/store.js';
import { makeLhr } from './helpers/lhr-fixture.js';

test('auditFileName uses the session dir stamp convention', () => {
  expect(auditFileName(new Date('2026-07-19T10:12:34.567Z'))).toBe('audit-2026-07-19T10-12-34.json');
});

test('saveAudit writes and loadAudit round-trips the lhr', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-audit-'));
  const lhr = makeLhr();
  const file = saveAudit(dir, lhr, new Date('2026-07-19T10:00:00Z'));
  expect(file).toBe(join(dir, 'audit-2026-07-19T10-00-00.json'));
  expect(loadAudit(file)).toEqual(lhr);
});

test('listAudits returns audit files newest first, ignoring other files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-audit-'));
  saveAudit(dir, makeLhr(), new Date('2026-07-19T10:00:00Z'));
  saveAudit(dir, makeLhr(), new Date('2026-07-19T11:30:00Z'));
  await writeFile(join(dir, 'network.jsonl'), '{}\n');
  await writeFile(join(dir, 'audit-notes.json'), '{}');
  expect(listAudits(dir)).toEqual(['audit-2026-07-19T11-30-00.json', 'audit-2026-07-19T10-00-00.json']);
});

test('listAudits on a missing dir is empty', () => {
  expect(listAudits('/nonexistent/dtui-audit-test')).toEqual([]);
});

test('listAudits sweeps a stale orphaned .tmp while sparing a fresh one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-audit-'));
  saveAudit(dir, makeLhr(), new Date('2026-07-19T10:00:00Z'));
  const stale = join(dir, 'audit-2026-07-19T11-00-00.json.tmp');
  const fresh = join(dir, 'audit-2026-07-19T12-00-00.json.tmp');
  await writeFile(stale, '{"partial":');
  await writeFile(fresh, '{"partial":');
  const now = Date.now();
  await utimes(stale, new Date(now - 5 * 60_000), new Date(now - 5 * 60_000));
  await utimes(fresh, new Date(now - 1000), new Date(now - 1000));

  expect(listAudits(dir, now)).toEqual(['audit-2026-07-19T10-00-00.json']);
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
});

test('a torn newest audit is skipped in favor of the next valid one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-audit-'));
  const valid = makeLhr({ fetchTime: '2026-07-19T10:00:00.000Z' });
  saveAudit(dir, valid, new Date('2026-07-19T10:00:00Z'));
  await writeFile(join(dir, 'audit-2026-07-19T11-30-00.json'), '{"fetchTime":"2026-07-19T11:30');
  expect(loadSessionAudit(dir)?.fetchTime).toBe('2026-07-19T10:00:00.000Z');
  expect(loadLatestAudit(dir)).toEqual({ name: 'audit-2026-07-19T10-00-00.json', lhr: valid });
  expect(loadSessionAudit(dir, 'audit-2026-07-19T11-30-00.json')).toBeUndefined();
});

test('loadSessionAudit is undefined when every stored audit is unparsable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-audit-'));
  await writeFile(join(dir, 'audit-2026-07-19T10-00-00.json'), 'not json');
  await writeFile(join(dir, 'audit-2026-07-19T11-00-00.json'), '');
  expect(loadSessionAudit(dir)).toBeUndefined();
  expect(loadLatestAudit(dir)).toBeUndefined();
});

test('loadSessionAudit resolves latest by default and by name, rejecting bad names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-audit-'));
  const older = makeLhr({ fetchTime: '2026-07-19T10:00:00.000Z' });
  const newer = makeLhr({ fetchTime: '2026-07-19T11:30:00.000Z' });
  saveAudit(dir, older, new Date('2026-07-19T10:00:00Z'));
  saveAudit(dir, newer, new Date('2026-07-19T11:30:00Z'));
  expect(loadSessionAudit(dir)?.fetchTime).toBe('2026-07-19T11:30:00.000Z');
  expect(loadSessionAudit(dir, 'audit-2026-07-19T10-00-00.json')?.fetchTime).toBe('2026-07-19T10:00:00.000Z');
  expect(loadSessionAudit(dir, '../escape.json')).toBeUndefined();
  expect(loadSessionAudit(dir, 'audit-2099-01-01T00-00-00.json')).toBeUndefined();
});
