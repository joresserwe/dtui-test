import { test, expect } from 'vitest';
import { buildNetGroups, groupKeyOf, groupSelectable } from '../src/tui/lib/net-group.js';
import type { NetworkEntry } from '../src/store/types.js';

const entry = (id: string, url: string): NetworkEntry => ({
  id, url, method: 'GET', type: 'XHR', requestHeaders: {}, responseHeaders: {}, startTs: 0,
});

const sample = (): NetworkEntry[] => [
  entry('1', 'https://a.test/one'),
  entry('2', 'https://cdn.test/lib.js'),
  entry('3', 'https://a.test/two'),
  entry('4', 'https://cdn.test/style.css'),
];

test('groupKeyOf returns the host for domain mode, empty for none, and a fallback for junk', () => {
  expect(groupKeyOf(entry('1', 'https://a.test/x'), 'domain')).toBe('a.test');
  expect(groupKeyOf(entry('1', 'https://a.test/x'), 'none')).toBe('');
  expect(groupKeyOf(entry('1', 'not a url'), 'domain')).toBe('(no host)');
});

test('buildNetGroups in none mode returns entry rows only, no headers', () => {
  const rows = buildNetGroups(sample(), 'none', new Set());
  expect(rows.every(r => r.kind === 'entry')).toBe(true);
  expect(rows).toHaveLength(4);
  expect(groupSelectable(rows).map(e => e.id)).toEqual(['1', '2', '3', '4']);
});

test('buildNetGroups groups by domain in first-appearance order with counts', () => {
  const rows = buildNetGroups(sample(), 'domain', new Set());
  const headers = rows.filter(r => r.kind === 'header');
  expect(headers.map(h => (h.kind === 'header' ? [h.key, h.count] : null))).toEqual([
    ['a.test', 2],
    ['cdn.test', 2],
  ]);
  expect(rows.map(r => (r.kind === 'header' ? `#${r.key}` : r.entry.id))).toEqual([
    '#a.test', '1', '3', '#cdn.test', '2', '4',
  ]);
});

test('a collapsed group keeps its header but omits its entry rows', () => {
  const rows = buildNetGroups(sample(), 'domain', new Set(['cdn.test']));
  const cdn = rows.find(r => r.kind === 'header' && r.key === 'cdn.test');
  expect(cdn && cdn.kind === 'header' && cdn.collapsed).toBe(true);
  expect(cdn && cdn.kind === 'header' && cdn.count).toBe(2);
  expect(rows.map(r => (r.kind === 'header' ? `#${r.key}` : r.entry.id))).toEqual([
    '#a.test', '1', '3', '#cdn.test',
  ]);
  expect(groupSelectable(rows).map(e => e.id)).toEqual(['1', '3']);
});
