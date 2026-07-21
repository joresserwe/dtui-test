import { AUDIT_CATEGORIES, type FailingAudit, type LabMetrics, type Lhr, type Scoreboard } from './types.js';

const METRIC_AUDITS: Array<{ key: keyof LabMetrics; id: string }> = [
  { key: 'lcpMs', id: 'largest-contentful-paint' },
  { key: 'cls', id: 'cumulative-layout-shift' },
  { key: 'tbtMs', id: 'total-blocking-time' },
  { key: 'fcpMs', id: 'first-contentful-paint' },
  { key: 'siMs', id: 'speed-index' },
];

const SCORED_MODES = new Set(['numeric', 'binary', 'metricSavings']);

export function lhrScoreboard(lhr: Lhr): Scoreboard {
  const ordered = [
    ...AUDIT_CATEGORIES.filter(id => lhr.categories[id]),
    ...Object.keys(lhr.categories).filter(id => !(AUDIT_CATEGORIES as readonly string[]).includes(id)),
  ];
  const metrics: LabMetrics = {};
  for (const { key, id } of METRIC_AUDITS) {
    const v = lhr.audits[id]?.numericValue;
    if (typeof v === 'number') metrics[key] = v;
  }
  return {
    url: lhr.finalDisplayedUrl || lhr.requestedUrl || lhr.mainDocumentUrl || '',
    fetchTime: lhr.fetchTime,
    preset: lhr.configSettings?.formFactor ?? 'mobile',
    lighthouseVersion: lhr.lighthouseVersion,
    categories: ordered.map(id => {
      const c = lhr.categories[id];
      return { id: c.id, title: c.title, score: c.score };
    }),
    metrics,
    runWarnings: lhr.runWarnings ?? [],
  };
}

export interface FailingOpts {
  category?: string;
  limit?: number;
}

export function lhrFailing(lhr: Lhr, opts: FailingOpts = {}): FailingAudit[] {
  const byId = new Map<string, FailingAudit>();
  for (const cat of Object.values(lhr.categories)) {
    for (const ref of cat.auditRefs) {
      const audit = lhr.audits[ref.id];
      if (!audit) continue;
      if (audit.score === null || audit.score >= 1) continue;
      if (!SCORED_MODES.has(audit.scoreDisplayMode)) continue;
      const prev = byId.get(audit.id);
      if (prev) {
        if (!prev.categories.includes(cat.id)) prev.categories.push(cat.id);
        prev.weight = Math.max(prev.weight, ref.weight);
        continue;
      }
      const entry: FailingAudit = {
        id: audit.id,
        title: audit.title,
        score: audit.score,
        scoreDisplayMode: audit.scoreDisplayMode,
        categories: [cat.id],
        weight: ref.weight,
      };
      if (audit.displayValue !== undefined) entry.displayValue = audit.displayValue;
      if (audit.description !== undefined) entry.description = audit.description;
      const savingsMs = audit.details?.overallSavingsMs;
      if (typeof savingsMs === 'number' && savingsMs > 0) entry.savingsMs = savingsMs;
      const savingsBytes = audit.details?.overallSavingsBytes;
      if (typeof savingsBytes === 'number' && savingsBytes > 0) entry.savingsBytes = savingsBytes;
      byId.set(audit.id, entry);
    }
  }
  let rows = [...byId.values()].sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || b.weight - a.weight || a.id.localeCompare(b.id));
  if (opts.category !== undefined) rows = rows.filter(r => r.categories.includes(opts.category!));
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
  return rows;
}

const SCREENSHOT_AUDIT_IDS = new Set(['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot']);

export function stripScreenshotAudits(lhr: Lhr): Lhr {
  const audits: Record<string, Lhr['audits'][string]> = {};
  for (const [id, audit] of Object.entries(lhr.audits)) {
    if (SCREENSHOT_AUDIT_IDS.has(id)) continue;
    audits[id] = audit;
  }
  const stripped: Lhr = { ...lhr, audits };
  delete (stripped as unknown as Record<string, unknown>).fullPageScreenshot;
  return stripped;
}

export function formatScore(score: number | null): string {
  return score === null ? '--' : String(Math.round(score * 100));
}

export type ScoreLevel = 'good' | 'avg' | 'poor';

export function scoreLevel(score: number | null): ScoreLevel {
  if (score === null) return 'poor';
  if (score >= 0.9) return 'good';
  if (score >= 0.5) return 'avg';
  return 'poor';
}

export function formatMetricMs(ms: number | undefined): string {
  if (ms === undefined) return '--';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

export function plainDescription(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/`([^`]*)`/g, '$1');
}
