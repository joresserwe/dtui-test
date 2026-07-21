import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { netDiffLines } from '../src/tui/lib/net-diff.js';
import { DiffOverlay, DIFF_CHROME } from '../src/tui/overlays/DiffOverlay.js';
import type { NetworkEntry } from '../src/store/types.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const base: NetworkEntry = {
  id: 'a', url: 'https://a.test/v1/users', method: 'GET', type: 'XHR',
  status: 200, statusText: 'OK', mimeType: 'application/json',
  requestHeaders: { accept: 'application/json', 'x-only-a': '1' },
  responseHeaders: { 'content-type': 'application/json', 'x-trace': 'aaa' },
  startTs: 0, durationMs: 100, encodedBytes: 1000,
  timing: { requestTime: 1, dnsStart: 0, dnsEnd: 2, connectStart: 2, connectEnd: 10, sslStart: -1, sslEnd: -1, sendStart: 10, sendEnd: 11, receiveHeadersEnd: 80 },
};

const other: NetworkEntry = {
  ...base,
  id: 'b', url: 'https://a.test/v2/users', status: 404, statusText: 'Not Found',
  requestHeaders: { accept: 'application/json', 'x-only-b': '2' },
  responseHeaders: { 'content-type': 'application/json', 'x-trace': 'bbb' },
  durationMs: 250, encodedBytes: 2000,
};

test('equal fields collapse to one row, differing fields become -/+ pairs', () => {
  const lines = netDiffLines(base, other, 100);
  const texts = lines.map(l => l.text);
  expect(texts).toContain('    method   GET');
  expect(texts).toContain('  - url      https://a.test/v1/users');
  expect(texts).toContain('  + url      https://a.test/v2/users');
  expect(texts).toContain('  - status   200 OK');
  expect(texts).toContain('  + status   404 Not Found');
  const minus = lines.find(l => l.text.startsWith('  - url'));
  expect(minus?.segs?.some(s => s.color === 'red')).toBe(true);
  const plus = lines.find(l => l.text.startsWith('  + url'));
  expect(plus?.segs?.some(s => s.color === 'green')).toBe(true);
});

test('header diff walks the key union: same, changed, and one-sided keys', () => {
  const lines = netDiffLines(base, other, 100).map(l => l.text);
  expect(lines).toContain('    accept   application/json');
  expect(lines).toContain('  - x-trace  aaa');
  expect(lines).toContain('  + x-trace  bbb');
  expect(lines).toContain('  - x-only-a 1');
  expect(lines).toContain('  + x-only-b 2');
  expect(lines.some(l => l.startsWith('▍ request headers'))).toBe(true);
  expect(lines.some(l => l.startsWith('▍ response headers'))).toBe(true);
});

test('timing section diffs durations', () => {
  const lines = netDiffLines(base, other, 100).map(l => l.text);
  expect(lines.some(l => l.startsWith('▍ timing'))).toBe(true);
  expect(lines).toContain('  - time     100ms');
  expect(lines).toContain('  + time     250ms');
});

test('identical entries produce no -/+ rows', () => {
  const lines = netDiffLines(base, { ...base }, 100).map(l => l.text);
  expect(lines.some(l => l.startsWith('  -') || l.startsWith('  +'))).toBe(false);
});

test('DiffOverlay renders a constant frame with both request lines', () => {
  const lines = netDiffLines(base, other, 80);
  const { lastFrame } = render(
    React.createElement(DiffOverlay, { a: base, b: other, scroll: 0, height: 14, width: 80, lines }),
  );
  const frame = stripAnsi(lastFrame() ?? '');
  const rows = frame.split('\n');
  expect(rows.length).toBe(14);
  expect(frame).toContain('A');
  expect(frame).toContain('https://a.test/v1/users');
  expect(frame).toContain('https://a.test/v2/users');
  expect(DIFF_CHROME).toBeGreaterThan(0);
});
