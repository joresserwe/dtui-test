import { test, expect } from 'vitest';
import type { Key } from 'ink';
import { isEscapeRemnant, makeFollowNav } from '../src/tui/lib/keys.js';

test('detects CSI function-key remnants', () => {
  expect(isEscapeRemnant('[25~')).toBe(true);
  expect(isEscapeRemnant('[1;2P')).toBe(true);
  expect(isEscapeRemnant('[15;5~')).toBe(true);
  expect(isEscapeRemnant('[[A')).toBe(true);
});

test('detects SS3 remnants and embedded escapes', () => {
  expect(isEscapeRemnant('Ot')).toBe(true);
  expect(isEscapeRemnant('[25~\u001b[25~')).toBe(true);
});

test('passes plain printable input through', () => {
  expect(isEscapeRemnant('hello')).toBe(false);
  expect(isEscapeRemnant('jjj')).toBe(false);
  expect(isEscapeRemnant('.x')).toBe(false);
  expect(isEscapeRemnant('[data-x]')).toBe(false);
  expect(isEscapeRemnant('25')).toBe(false);
});

const key = (over: Partial<Key> = {}): Key => over as Key;

test('follow nav disengages when moving off the tail and re-engages at the last row', () => {
  const nav = makeFollowNav({ current: false });
  const calls: Array<[number, boolean]> = [];
  const apply = (idx: number, follow: boolean) => calls.push([idx, follow]);

  expect(nav('k', key(), 10, 9, 5, apply)).toBe(true);
  expect(calls.at(-1)).toEqual([8, false]);

  expect(nav('j', key(), 10, 8, 5, apply)).toBe(true);
  expect(calls.at(-1)).toEqual([9, true]);

  expect(nav('d', key({ ctrl: true }), 10, 2, 5, apply)).toBe(true);
  expect(calls.at(-1)).toEqual([7, false]);

  expect(nav('G', key(), 10, 3, 5, apply)).toBe(true);
  expect(calls.at(-1)).toEqual([9, true]);
});

test('follow nav gg goes to the top and disengages follow', () => {
  const gPending = { current: false };
  const nav = makeFollowNav(gPending);
  const calls: Array<[number, boolean]> = [];
  const apply = (idx: number, follow: boolean) => calls.push([idx, follow]);

  expect(nav('g', key(), 10, 9, 5, apply)).toBe(true);
  expect(calls.length).toBe(0);
  expect(nav('g', key(), 10, 9, 5, apply)).toBe(true);
  expect(calls.at(-1)).toEqual([0, false]);
});
