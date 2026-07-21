import { test, expect } from 'vitest';
import {
  HINT_ALPHABET,
  HINT_CONTAINER_ID,
  buildClearHintsScript,
  buildFilterHintsScript,
  buildPickHintScript,
  buildShowHintsScript,
  hintLabels,
} from '../src/tui/lib/hint-script.js';

test('hintLabels returns empty for non-positive counts', () => {
  expect(hintLabels(0, 'ab')).toEqual([]);
  expect(hintLabels(-3, 'ab')).toEqual([]);
});

test('hintLabels uses single chars while the alphabet suffices', () => {
  expect(hintLabels(3, 'asdf')).toEqual(['a', 's', 'd']);
  expect(hintLabels(4, 'asdf')).toEqual(['a', 's', 'd', 'f']);
});

test('hintLabels grows to a uniform length beyond the alphabet', () => {
  const labels = hintLabels(5, 'ab');
  expect(labels).toEqual(['aaa', 'aab', 'aba', 'abb', 'baa']);
  expect(new Set(labels).size).toBe(5);
  expect(labels.every(l => l.length === 3)).toBe(true);
});

test('uniform-length labels are prefix-free', () => {
  const labels = hintLabels(30, HINT_ALPHABET);
  for (const a of labels) {
    for (const b of labels) {
      if (a !== b) expect(b.startsWith(a)).toBe(false);
    }
  }
});

test('hintLabels survives toString round-trip injection', () => {
  const injected = eval(`(${hintLabels.toString()})`) as typeof hintLabels;
  expect(injected(7, 'ab')).toEqual(hintLabels(7, 'ab'));
  expect(injected(100, HINT_ALPHABET)).toEqual(hintLabels(100, HINT_ALPHABET));
});

test('the show script embeds the generator, selector list, and container id', () => {
  const script = buildShowHintsScript();
  expect(script).toContain(HINT_CONTAINER_ID);
  expect(script).toContain(JSON.stringify(HINT_ALPHABET));
  expect(script).toContain('a[href]');
  expect(script).toContain('pagehide');
});

test('filter and pick scripts JSON-escape the interpolated label', () => {
  expect(buildFilterHintsScript('a"b')).toContain('"a\\"b"');
  expect(buildPickHintScript("a'b")).toContain(JSON.stringify("a'b"));
  expect(buildClearHintsScript()).toContain('__dtuiHints');
});
