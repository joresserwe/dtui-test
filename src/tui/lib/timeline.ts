import type { NetworkEntry } from '../../store/types.js';

export interface TimeRange { start: number; end: number }
export interface TimelineSpan { min: number; max: number }
export interface TimelineBucket { concurrency: number; failed: boolean }

const clampIdx = (i: number, width: number): number => Math.max(0, Math.min(i, width - 1));

export const entryEnd = (e: NetworkEntry, now: number): number =>
  e.durationMs !== undefined ? e.startTs + e.durationMs : Math.max(now, e.startTs);

export function timelineSpan(entries: NetworkEntry[], now: number): TimelineSpan | null {
  if (!entries.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const e of entries) {
    if (e.startTs < min) min = e.startTs;
    const end = entryEnd(e, now);
    if (end > max) max = end;
  }
  return { min, max: max > min ? max : min + 1 };
}

const colOf = (t: number, span: TimelineSpan, width: number): number =>
  clampIdx(Math.floor(((t - span.min) / (span.max - span.min)) * width), width);

const lastColBefore = (t: number, span: TimelineSpan, width: number): number =>
  clampIdx(Math.ceil(((t - span.min) / (span.max - span.min)) * width) - 1, width);

export function buildBuckets(entries: NetworkEntry[], width: number, now: number): TimelineBucket[] {
  const buckets = Array.from({ length: Math.max(0, width) }, (): TimelineBucket => ({ concurrency: 0, failed: false }));
  const span = timelineSpan(entries, now);
  if (!span || width <= 0) return buckets;
  const events: Array<[number, number]> = [];
  for (const e of entries) {
    const end = Math.max(entryEnd(e, now), e.startTs + 1);
    events.push([e.startTs, 1], [end, -1]);
    if (e.error) {
      const c0 = colOf(e.startTs, span, width);
      const c1 = Math.max(c0, lastColBefore(end, span, width));
      for (let c = c0; c <= c1; c++) buckets[c].failed = true;
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let prev = span.min;
  for (const [t, d] of events) {
    if (t > prev && cur > 0) {
      const c0 = colOf(prev, span, width);
      const c1 = Math.max(c0, lastColBefore(t, span, width));
      for (let c = c0; c <= c1; c++) buckets[c].concurrency = Math.max(buckets[c].concurrency, cur);
    }
    cur += d;
    if (t > prev) prev = t;
  }
  return buckets;
}

export function dotHeights(values: number[], maxDots = 8): number[] {
  let maxV = 0;
  for (const v of values) if (v > maxV) maxV = v;
  if (maxV === 0) return values.map(() => 0);
  return values.map(v => (v === 0 ? 0 : Math.max(1, Math.round((v / maxV) * maxDots))));
}

const FILL = [0x00, 0xc0, 0xe4, 0xf6, 0xff];

export function brailleRows(heights: number[]): [string, string] {
  let top = '';
  let bottom = '';
  for (const h of heights) {
    const hh = Math.max(0, Math.min(8, h));
    top += String.fromCharCode(0x2800 + FILL[Math.max(0, hh - 4)]);
    bottom += String.fromCharCode(0x2800 + FILL[Math.min(4, hh)]);
  }
  return [top, bottom];
}

export function bucketToRange(span: TimelineSpan, width: number, a: number, b: number): TimeRange {
  const w = (span.max - span.min) / Math.max(1, width);
  const lo = clampIdx(Math.min(a, b), width);
  const hi = clampIdx(Math.max(a, b), width);
  return { start: span.min + lo * w, end: span.min + (hi + 1) * w };
}

export function rangeToBuckets(span: TimelineSpan, width: number, range: TimeRange): [number, number] {
  const c0 = colOf(Math.max(range.start, span.min), span, width);
  const c1 = Math.max(c0, lastColBefore(Math.min(range.end, span.max), span, width));
  return [c0, c1];
}

export const intersectsRange = (e: NetworkEntry, range: TimeRange, now: number): boolean =>
  e.startTs <= range.end && entryEnd(e, now) >= range.start;
