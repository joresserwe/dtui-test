import { test, expect } from 'vitest';
import { resolveVars, varRefs } from '../src/tui/lib/css-vars.js';

test('varRefs extracts custom property names in order without duplicates', () => {
  expect(varRefs('var(--accent)')).toEqual(['--accent']);
  expect(varRefs('1px solid var( --line ) var(--accent) var(--line)')).toEqual(['--line', '--accent']);
  expect(varRefs('red')).toEqual([]);
});

test('varRefs reaches names nested inside fallbacks', () => {
  expect(varRefs('var(--a, var(--b, 10px))')).toEqual(['--a', '--b']);
});

test('resolveVars pairs each name with its computed value', () => {
  const computed: Array<[string, string]> = [['--accent', 'teal'], ['color', 'rgb(0, 0, 0)']];
  expect(resolveVars('var(--accent)', computed)).toEqual([{ name: '--accent', value: 'teal' }]);
});

test('resolveVars leaves unknown or empty custom properties unresolved', () => {
  const computed: Array<[string, string]> = [['--empty', '  ']];
  expect(resolveVars('var(--missing) var(--empty)', computed)).toEqual([
    { name: '--missing' },
    { name: '--empty' },
  ]);
});

test('resolveVars uses the literal fallback when the property is missing', () => {
  expect(resolveVars('var(--missing, 10px)', [])).toEqual([{ name: '--missing', value: '10px' }]);
});

test('resolveVars prefers the computed value over the fallback', () => {
  const computed: Array<[string, string]> = [['--gap', '4px']];
  expect(resolveVars('var(--gap, 10px)', computed)).toEqual([{ name: '--gap', value: '4px' }]);
});

test('resolveVars walks a nested fallback chain', () => {
  expect(resolveVars('var(--a, var(--b, 10px))', [])).toEqual([{ name: '--a', value: '10px' }]);
  const computed: Array<[string, string]> = [['--b', 'teal']];
  expect(resolveVars('var(--a, var(--b, 10px))', computed)).toEqual([{ name: '--a', value: 'teal' }]);
});

test('resolveVars leaves an empty fallback unresolved', () => {
  expect(resolveVars('var(--missing, )', [])).toEqual([{ name: '--missing' }]);
});
