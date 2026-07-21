import { test, expect } from 'vitest';
import {
  brailleRows, bucketToRange, buildBuckets, dotHeights, entryEnd,
  intersectsRange, rangeToBuckets, timelineSpan,
} from '../src/tui/lib/timeline.js';
import type { NetworkEntry } from '../src/store/types.js';

const req = (id: string, startTs: number, durationMs?: number, error?: string): NetworkEntry => ({
  id, url: `https://a.test/${id}`, method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {},
  startTs, durationMs, error,
});

const NOW = 100_000;

test('timelineSpan covers min start to max end and is null when empty', () => {
  expect(timelineSpan([], NOW)).toBeNull();
  const span = timelineSpan([req('a', 1000, 500), req('b', 2000, 3000)], NOW);
  expect(span).toEqual({ min: 1000, max: 5000 });
});

test('timelineSpan keeps a pending request open until now', () => {
  const span = timelineSpan([req('a', 1000, 500), req('p', 1200)], NOW);
  expect(span).toEqual({ min: 1000, max: NOW });
});

test('timelineSpan of a single instant request still spans at least 1ms', () => {
  const span = timelineSpan([req('a', 1000, 0)], NOW);
  expect(span!.max).toBeGreaterThan(span!.min);
});

test('entryEnd is start+duration when finished and now when pending', () => {
  expect(entryEnd(req('a', 1000, 500), NOW)).toBe(1500);
  expect(entryEnd(req('p', 1000), NOW)).toBe(NOW);
});

test('buildBuckets counts overlapping requests as concurrency', () => {
  const entries = [req('a', 0, 1000), req('b', 0, 1000), req('c', 0, 1000)];
  const buckets = buildBuckets(entries, 10, NOW);
  expect(buckets.every(b => b.concurrency === 3)).toBe(true);
});

test('buildBuckets never exceeds 1 for strictly sequential requests', () => {
  const entries = [req('a', 0, 1000), req('b', 1000, 1000), req('c', 2000, 1000)];
  const buckets = buildBuckets(entries, 6, NOW);
  expect(Math.max(...buckets.map(b => b.concurrency))).toBe(1);
  expect(buckets.every(b => b.concurrency >= 1)).toBe(true);
});

test('buildBuckets sees a parallel burst inside a longer request', () => {
  const entries = [req('bg', 0, 10_000), req('x', 4000, 2000), req('y', 4000, 2000)];
  const buckets = buildBuckets(entries, 10, NOW);
  expect(buckets[0].concurrency).toBe(1);
  expect(buckets[4].concurrency).toBe(3);
  expect(buckets[5].concurrency).toBe(3);
  expect(buckets[9].concurrency).toBe(1);
});

test('buildBuckets counts a pending request as in-flight through the tail', () => {
  const buckets = buildBuckets([req('done', 0, 1000), req('p', 500)], 10, 10_000);
  expect(buckets[9].concurrency).toBe(1);
  expect(buckets[0].concurrency).toBe(2);
});

test('buildBuckets counts zero-duration requests in their start bucket', () => {
  const buckets = buildBuckets([req('a', 0, 0), req('b', 0, 10_000)], 10, NOW);
  expect(buckets[0].concurrency).toBe(2);
});

test('buildBuckets flags buckets crossed by failed requests', () => {
  const entries = [req('ok', 0, 10_000), req('bad', 5000, 2000, 'net::ERR_FAILED')];
  const buckets = buildBuckets(entries, 10, NOW);
  expect(buckets[5].failed).toBe(true);
  expect(buckets[6].failed).toBe(true);
  expect(buckets[0].failed).toBe(false);
  expect(buckets[9].failed).toBe(false);
});

test('buildBuckets returns the requested width even when empty', () => {
  expect(buildBuckets([], 7, NOW)).toHaveLength(7);
  expect(buildBuckets([req('a', 0, 100)], 0, NOW)).toHaveLength(0);
});

test('dotHeights scales the max to 8 and keeps small nonzero values visible', () => {
  expect(dotHeights([0, 4, 8])).toEqual([0, 4, 8]);
  expect(dotHeights([0, 1, 100])).toEqual([0, 1, 8]);
  expect(dotHeights([0, 0])).toEqual([0, 0]);
});

test('brailleRows renders known shapes filled from the bottom', () => {
  const [top, bottom] = brailleRows([0, 1, 4, 5, 8]);
  expect(bottom).toBe('⠀⣀⣿⣿⣿');
  expect(top).toBe('⠀⠀⠀⣀⣿');
});

test('brailleRows partial fills use the row dot patterns', () => {
  const [, bottom] = brailleRows([1, 2, 3, 4]);
  expect(bottom).toBe('⣀⣤⣶⣿');
});

test('bucketToRange maps a brushed column span to times and is order-insensitive', () => {
  const span = { min: 0, max: 10_000 };
  expect(bucketToRange(span, 10, 2, 4)).toEqual({ start: 2000, end: 5000 });
  expect(bucketToRange(span, 10, 4, 2)).toEqual({ start: 2000, end: 5000 });
  expect(bucketToRange(span, 10, 0, 9)).toEqual({ start: 0, end: 10_000 });
});

test('rangeToBuckets round-trips bucketToRange', () => {
  const span = { min: 1000, max: 21_000 };
  const r = bucketToRange(span, 20, 3, 7);
  expect(rangeToBuckets(span, 20, r)).toEqual([3, 7]);
});

test('rangeToBuckets clamps ranges outside the current span', () => {
  const span = { min: 5000, max: 15_000 };
  expect(rangeToBuckets(span, 10, { start: 0, end: 6000 })).toEqual([0, 0]);
  expect(rangeToBuckets(span, 10, { start: 14_000, end: 99_000 })).toEqual([9, 9]);
});

test('intersectsRange keeps requests touching the range edges', () => {
  const range = { start: 1000, end: 2000 };
  expect(intersectsRange(req('in', 1500, 100), range, NOW)).toBe(true);
  expect(intersectsRange(req('ends-at-start', 500, 500), range, NOW)).toBe(true);
  expect(intersectsRange(req('starts-at-end', 2000, 500), range, NOW)).toBe(true);
  expect(intersectsRange(req('before', 0, 500), range, NOW)).toBe(false);
  expect(intersectsRange(req('after', 3000, 500), range, NOW)).toBe(false);
  expect(intersectsRange(req('pending-spans', 0), range, NOW)).toBe(true);
});
