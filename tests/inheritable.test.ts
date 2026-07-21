import { test, expect } from 'vitest';
import { isInheritable } from '../src/cdp/inheritable.js';

test('classic inherited properties are inheritable', () => {
  for (const name of ['color', 'font-size', 'font-family', 'line-height', 'letter-spacing', 'text-align', 'visibility', 'cursor', 'white-space', 'list-style-type', 'word-break', 'text-shadow', 'direction', 'quotes', 'border-collapse', 'caption-side', 'tab-size', 'pointer-events', 'writing-mode', 'caret-color', 'color-scheme']) {
    expect(isInheritable(name), name).toBe(true);
  }
});

test('box and layout properties are not inheritable', () => {
  for (const name of ['width', 'height', 'margin', 'margin-top', 'padding', 'display', 'position', 'top', 'border', 'border-radius', 'background', 'background-color', 'overflow', 'z-index', 'flex', 'grid-template-columns', 'transform', 'opacity', 'box-shadow', 'float']) {
    expect(isInheritable(name), name).toBe(false);
  }
});

test('custom properties always inherit', () => {
  expect(isInheritable('--brand-color')).toBe(true);
  expect(isInheritable('--x')).toBe(true);
});

test('vendor prefixes resolve to the unprefixed property', () => {
  expect(isInheritable('-webkit-text-size-adjust')).toBe(true);
  expect(isInheritable('-moz-tab-size')).toBe(true);
  expect(isInheritable('-webkit-appearance')).toBe(false);
});

test('Blink-inherited -webkit properties without an unprefixed twin inherit', () => {
  expect(isInheritable('-webkit-font-smoothing')).toBe(true);
  expect(isInheritable('-webkit-text-stroke')).toBe(true);
  expect(isInheritable('-webkit-text-stroke-width')).toBe(true);
});

test('shorthand and longhand font/text properties inherit', () => {
  for (const name of ['font', 'font-variant', 'font-variant-ligatures', 'list-style', 'text-emphasis', 'text-indent', 'word-spacing', 'overflow-wrap', 'hyphens', 'text-transform', 'text-wrap']) {
    expect(isInheritable(name), name).toBe(true);
  }
});
