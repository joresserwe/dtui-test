import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlSessionSource, type AuditRunParams, type SessionSource } from '../src/mcp/source.js';
import { auditFailing, auditRun, auditSummary } from '../src/mcp/tools.js';
import { saveAudit } from '../src/audit/store.js';
import type { Lhr } from '../src/audit/types.js';
import { makeLhr } from './helpers/lhr-fixture.js';

const SESSION = '2026-07-19T09-30-00-localhost-fixture';

async function makeRoot(withAudit = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-audit-'));
  const dir = join(root, SESSION);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'network.jsonl'), JSON.stringify({ id: 'e1', url: 'http://x/', method: 'GET', startTs: 1 }) + '\n');
  if (withAudit) {
    saveAudit(dir, makeLhr({ fetchTime: '2026-07-19T10:00:00.000Z' }), new Date('2026-07-19T10:00:00Z'));
    saveAudit(dir, makeLhr({ fetchTime: '2026-07-19T11:00:00.000Z' }), new Date('2026-07-19T11:00:00Z'));
  }
  return root;
}

test('auditSummary reads the latest stored audit of the resolved session', async () => {
  const src = new JsonlSessionSource(await makeRoot());
  const summary = await auditSummary(src, {});
  expect(summary.session).toBe(SESSION);
  expect(summary.fetchTime).toBe('2026-07-19T11:00:00.000Z');
  expect(summary.categories.map(c => [c.id, c.score])).toEqual([
    ['performance', 0.92],
    ['accessibility', 0.85],
    ['best-practices', 1],
    ['seo', 0.67],
  ]);
  expect(summary.metrics.lcpMs).toBeCloseTo(1834.5);
  expect(summary.preset).toBe('mobile');
});

test('auditSummary skips a torn newest audit file and serves the previous run', async () => {
  const root = await makeRoot();
  await writeFile(join(root, SESSION, 'audit-2026-07-19T12-00-00.json'), '{"fetchTime":"2026-07-19T12');
  const summary = await auditSummary(new JsonlSessionSource(root), {});
  expect(summary.fetchTime).toBe('2026-07-19T11:00:00.000Z');
});

test('auditSummary errors clearly when the session has no audit', async () => {
  const src = new JsonlSessionSource(await makeRoot(false));
  await expect(auditSummary(src, {})).rejects.toThrow(/no audit recorded for session/);
});

test('auditFailing returns worst-first rows with category filter and limit', async () => {
  const src = new JsonlSessionSource(await makeRoot());
  const all = await auditFailing(src, {});
  expect(all.session).toBe(SESSION);
  expect(all.rows[0].id).toBe('image-alt');
  const perf = await auditFailing(src, { category: 'performance', limit: 1 });
  expect(perf.rows).toHaveLength(1);
  expect(perf.rows[0].id).toBe('render-blocking-resources');
  expect(perf.rows[0].savingsMs).toBe(310);
});

test('auditRun requires a live source', async () => {
  const src = new JsonlSessionSource(await makeRoot());
  await expect(auditRun(src, {})).rejects.toThrow(/running devtools-tui TUI/);
});

test('auditRun delegates to the live source and summarizes the returned lhr', async () => {
  let got: AuditRunParams | undefined;
  const src: SessionSource = {
    kind: 'live',
    live: {
      listTabs: () => [],
      selectedElement: () => {
        throw new Error('unused');
      },
      screenshot: () => {
        throw new Error('unused');
      },
      auditRun: (args: AuditRunParams): Lhr => {
        got = args;
        return makeLhr({ configSettings: { formFactor: 'desktop' } });
      },
    },
    listSessions: () => [],
    readNetwork: () => [],
    readConsole: () => [],
  };
  const board = await auditRun(src, { preset: 'desktop', categories: ['performance', 'seo'] });
  expect(got).toEqual({ session: undefined, preset: 'desktop', categories: ['performance', 'seo'] });
  expect(board.preset).toBe('desktop');
  expect(board.categories.find(c => c.id === 'performance')?.score).toBe(0.92);
});
