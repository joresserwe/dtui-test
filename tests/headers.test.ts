import { test, expect } from 'vitest';
import { header } from '../src/util/headers.js';

test('header looks up names case-insensitively', () => {
  expect(header({ 'Content-Type': 'text/plain' }, 'content-type')).toBe('text/plain');
  expect(header({ 'CONTENT-TYPE': 'a/b' }, 'content-type')).toBe('a/b');
  expect(header({ other: 'x' }, 'content-type')).toBe('');
});
