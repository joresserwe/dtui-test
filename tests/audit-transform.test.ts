import { test, expect } from 'vitest';
import { makeLhr } from './helpers/lhr-fixture.js';
import {
  formatMetricMs,
  formatScore,
  lhrFailing,
  lhrScoreboard,
  plainDescription,
  scoreLevel,
  stripScreenshotAudits,
} from '../src/audit/transform.js';

test('lhrScoreboard extracts category scores in canonical order', () => {
  const board = lhrScoreboard(makeLhr());
  expect(board.categories.map(c => c.id)).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);
  expect(board.categories.map(c => c.score)).toEqual([0.92, 0.85, 1, 0.67]);
  expect(board.url).toBe('http://localhost:8901/fixture.html');
  expect(board.preset).toBe('mobile');
  expect(board.lighthouseVersion).toBe('13.4.0');
});

test('lhrScoreboard keeps only categories present in the lhr', () => {
  const lhr = makeLhr();
  delete (lhr.categories as Record<string, unknown>)['seo'];
  delete (lhr.categories as Record<string, unknown>)['best-practices'];
  const board = lhrScoreboard(lhr);
  expect(board.categories.map(c => c.id)).toEqual(['performance', 'accessibility']);
});

test('lhrScoreboard extracts lab metrics from metric audits', () => {
  const { metrics } = lhrScoreboard(makeLhr());
  expect(metrics.lcpMs).toBeCloseTo(1834.5);
  expect(metrics.tbtMs).toBeCloseTo(41.2);
  expect(metrics.cls).toBeCloseTo(0.021);
  expect(metrics.fcpMs).toBeCloseTo(912.3);
  expect(metrics.siMs).toBeCloseTo(1200);
});

test('lhrScoreboard tolerates missing metric audits and warnings', () => {
  const lhr = makeLhr({ runWarnings: undefined });
  delete (lhr.audits as Record<string, unknown>)['largest-contentful-paint'];
  const board = lhrScoreboard(lhr);
  expect(board.metrics.lcpMs).toBeUndefined();
  expect(board.runWarnings).toEqual([]);
});

test('lhrFailing lists only scored audits below 1, sorted worst-first', () => {
  const failing = lhrFailing(makeLhr());
  expect(failing.map(f => f.id)).toEqual([
    'image-alt',
    'meta-description',
    'render-blocking-resources',
    'color-contrast',
    'largest-contentful-paint',
    'speed-index',
    'cumulative-layout-shift',
    'first-contentful-paint',
  ]);
  expect(failing.find(f => f.id === 'label')).toBeUndefined();
  expect(failing.find(f => f.id === 'unused-javascript')).toBeUndefined();
});

test('lhrFailing ties broken by weight, then carries savings and category', () => {
  const failing = lhrFailing(makeLhr());
  const [first, second] = failing;
  expect(first.id).toBe('image-alt');
  expect(second.id).toBe('meta-description');
  const rbr = failing.find(f => f.id === 'render-blocking-resources')!;
  expect(rbr.savingsMs).toBe(310);
  expect(rbr.categories).toEqual(['performance']);
  expect(rbr.displayValue).toBe('Potential savings of 310 ms');
});

test('lhrFailing filters by category and limits', () => {
  const perf = lhrFailing(makeLhr(), { category: 'performance' });
  expect(perf.every(f => f.categories.includes('performance'))).toBe(true);
  expect(perf[0].id).toBe('render-blocking-resources');
  const limited = lhrFailing(makeLhr(), { limit: 2 });
  expect(limited).toHaveLength(2);
});

test('lhrFailing merges categories for audits referenced twice', () => {
  const lhr = makeLhr();
  lhr.categories['seo'].auditRefs.push({ id: 'image-alt', weight: 1 });
  const failing = lhrFailing(lhr);
  const dup = failing.filter(f => f.id === 'image-alt');
  expect(dup).toHaveLength(1);
  expect(dup[0].categories.sort()).toEqual(['accessibility', 'seo']);
});

test('stripScreenshotAudits drops base64-heavy screenshot audits and leaves the rest untouched', () => {
  const lhr = makeLhr();
  const bigData = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  lhr.audits['final-screenshot'] = {
    id: 'final-screenshot', title: 'Final Screenshot', score: null, scoreDisplayMode: 'informative',
    details: { type: 'screenshot', data: bigData } as never,
  };
  lhr.audits['screenshot-thumbnails'] = {
    id: 'screenshot-thumbnails', title: 'Screenshot Thumbnails', score: null, scoreDisplayMode: 'informative',
    details: { type: 'filmstrip', items: [{ data: bigData }] } as never,
  };
  (lhr as Record<string, unknown>).fullPageScreenshot = { screenshot: { data: bigData } };

  const stripped = stripScreenshotAudits(lhr);
  expect(stripped.audits['final-screenshot']).toBeUndefined();
  expect(stripped.audits['screenshot-thumbnails']).toBeUndefined();
  expect((stripped as Record<string, unknown>).fullPageScreenshot).toBeUndefined();
  expect(stripped.audits['largest-contentful-paint']).toEqual(lhr.audits['largest-contentful-paint']);
  expect(stripped.categories).toBe(lhr.categories);

  expect(lhr.audits['final-screenshot']).toBeDefined();
  expect((lhr as Record<string, unknown>).fullPageScreenshot).toBeDefined();
});

test('formatScore renders 0-100 or placeholder', () => {
  expect(formatScore(0.92)).toBe('92');
  expect(formatScore(1)).toBe('100');
  expect(formatScore(0)).toBe('0');
  expect(formatScore(null)).toBe('--');
});

test('scoreLevel buckets follow lighthouse thresholds', () => {
  expect(scoreLevel(0.9)).toBe('good');
  expect(scoreLevel(0.89)).toBe('avg');
  expect(scoreLevel(0.5)).toBe('avg');
  expect(scoreLevel(0.49)).toBe('poor');
  expect(scoreLevel(null)).toBe('poor');
});

test('formatMetricMs renders seconds above one second', () => {
  expect(formatMetricMs(1834.5)).toBe('1.8 s');
  expect(formatMetricMs(41.2)).toBe('41 ms');
  expect(formatMetricMs(undefined)).toBe('--');
});

test('plainDescription strips markdown links but keeps text and url', () => {
  expect(plainDescription('Blocking. [Learn more](https://web.dev/rbr/).')).toBe(
    'Blocking. Learn more (https://web.dev/rbr/).',
  );
  expect(plainDescription('Backtick `code` stays.')).toBe('Backtick code stays.');
  expect(plainDescription(undefined)).toBe('');
});
