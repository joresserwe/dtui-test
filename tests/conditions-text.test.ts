import { test, expect } from 'vitest';
import { effectiveConditions, formatConditionsText, parseConditionsText, isUnthrottled } from '../src/tui/lib/conditions-text.js';

test('effectiveConditions returns the active preset when no custom conditions are set', () => {
  expect(effectiveConditions('fast3g', null)).toEqual({ offline: false, latency: 150, downloadThroughput: 180_000, uploadThroughput: 84_000 });
  expect(effectiveConditions('off', null)).toBeNull();
});

test('effectiveConditions prefers explicit custom conditions over the throttle name', () => {
  const custom = { offline: false, latency: 5, downloadThroughput: 1, uploadThroughput: 2 };
  expect(effectiveConditions('custom', custom)).toEqual(custom);
});

test('format round-trips through parse', () => {
  const cond = { offline: false, latency: 150, downloadThroughput: 180_000, uploadThroughput: 84_000 };
  expect(parseConditionsText(formatConditionsText(cond))).toEqual(cond);
});

test('format with null prefills an unthrottled template', () => {
  const parsed = parseConditionsText(formatConditionsText(null));
  expect(parsed).toEqual({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  expect(isUnthrottled(parsed!)).toBe(true);
});

test('parse accepts case-insensitive keys and skips comments and blanks', () => {
  const parsed = parseConditionsText('# hi\n\noffline true\nlatency 400\ndownload 50000\nupload 50000\n');
  expect(parsed).toEqual({ offline: true, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });
});

test('parse maps zero or negative throughput to -1 (unlimited)', () => {
  const parsed = parseConditionsText('OFFLINE false\nLATENCY 0\nDOWNLOAD 0\nUPLOAD -5\n');
  expect(parsed).toEqual({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test('parse rejects malformed values', () => {
  expect(parseConditionsText('OFFLINE maybe\nLATENCY 10\nDOWNLOAD 1\nUPLOAD 1\n')).toBeNull();
  expect(parseConditionsText('OFFLINE false\nLATENCY ten\nDOWNLOAD 1\nUPLOAD 1\n')).toBeNull();
  expect(parseConditionsText('WHAT 1\n')).toBeNull();
});

test('missing keys default to unthrottled values', () => {
  expect(parseConditionsText('LATENCY 25\n')).toEqual({ offline: false, latency: 25, downloadThroughput: -1, uploadThroughput: -1 });
});

test('isUnthrottled is false for offline or any throttling value', () => {
  expect(isUnthrottled({ offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })).toBe(false);
  expect(isUnthrottled({ offline: false, latency: 10, downloadThroughput: -1, uploadThroughput: -1 })).toBe(false);
  expect(isUnthrottled({ offline: false, latency: 0, downloadThroughput: 100, uploadThroughput: -1 })).toBe(false);
});
