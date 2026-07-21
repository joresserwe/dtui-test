import { test, expect } from 'vitest';
import {
  computeOverridden,
  flatDecls,
  incrementValue,
  rangeSpan,
  replaceDeclText,
  ruleDecls,
  toggleDeclText,
} from '../src/tui/lib/style-edit.js';
import type { Declaration } from '../src/cdp/css.js';

const decl = (name: string, value: string, over: Partial<Declaration> = {}): Declaration => ({
  name,
  value,
  important: false,
  disabled: false,
  ...over,
});

const rule = (declarations: Declaration[]) => ({
  selector: 'x',
  origin: 'regular',
  properties: declarations.map(d => [d.name, d.value] as [string, string]),
  declarations,
  cssText: '',
});

test('ruleDecls falls back to properties when declarations are absent', () => {
  const r = { selector: 'x', origin: 'regular', properties: [['color', 'red']] as Array<[string, string]>, cssText: '' };
  expect(ruleDecls(r)).toEqual([decl('color', 'red')]);
});

test('flatDecls flattens declarations across rules in order', () => {
  const matched = [rule([decl('a', '1'), decl('b', '2')]), rule([]), rule([decl('c', '3')])];
  expect(flatDecls(matched)).toEqual([
    { rule: 0, decl: 0 },
    { rule: 0, decl: 1 },
    { rule: 2, decl: 0 },
  ]);
});

test('the later declaration of the same property wins the cascade', () => {
  const matched = [rule([decl('color', 'red')]), rule([decl('color', 'blue')])];
  expect(computeOverridden(matched)).toEqual([[true], [false]]);
});

test('the last rule in the list (inline) wins ties', () => {
  const matched = [rule([decl('color', 'red')]), rule([decl('color', 'blue')]), rule([decl('color', 'green')])];
  expect(computeOverridden(matched)).toEqual([[true], [true], [false]]);
});

test('!important beats a later normal declaration', () => {
  const matched = [rule([decl('color', 'red !important', { important: true })]), rule([decl('color', 'blue')])];
  expect(computeOverridden(matched)).toEqual([[false], [true]]);
});

test('a later !important beats an earlier !important', () => {
  const matched = [
    rule([decl('color', 'red !important', { important: true })]),
    rule([decl('color', 'blue !important', { important: true })]),
  ];
  expect(computeOverridden(matched)).toEqual([[true], [false]]);
});

test('disabled declarations neither win nor get marked overridden', () => {
  const matched = [rule([decl('color', 'red')]), rule([decl('color', 'blue', { disabled: true })])];
  expect(computeOverridden(matched)).toEqual([[false], [false]]);
});

test('invalid declarations neither win nor get marked overridden', () => {
  const matched = [rule([decl('color', 'red')]), rule([decl('color', 'banana', { parsedOk: false })])];
  expect(computeOverridden(matched)).toEqual([[false], [false]]);
});

test('different property names never override each other', () => {
  const matched = [rule([decl('margin', '0')]), rule([decl('margin-top', '4px')])];
  expect(computeOverridden(matched)).toEqual([[false], [false]]);
});

const inheritedRule = (declarations: Declaration[], inheritedIndex: number) => ({ ...rule(declarations), inheritedIndex });

test('an own declaration overrides the inherited one for the same property', () => {
  const matched = [rule([decl('color', 'red')]), inheritedRule([decl('color', 'blue')], 0)];
  expect(computeOverridden(matched)).toEqual([[false], [true]]);
});

test('a closer ancestor overrides a farther one', () => {
  const matched = [inheritedRule([decl('color', 'blue')], 0), inheritedRule([decl('color', 'green')], 1)];
  expect(computeOverridden(matched)).toEqual([[false], [true]]);
});

test('inherited !important never beats the element own declaration', () => {
  const matched = [rule([decl('color', 'red')]), inheritedRule([decl('color', 'blue !important', { important: true })], 0)];
  expect(computeOverridden(matched)).toEqual([[false], [true]]);
});

test('an inherited-only property wins its group cascade', () => {
  const matched = [
    rule([decl('color', 'red')]),
    inheritedRule([decl('font-size', '12px')], 0),
    inheritedRule([decl('font-size', '16px')], 0),
  ];
  expect(computeOverridden(matched)).toEqual([[false], [true], [false]]);
});

test('within one ancestor group !important still wins', () => {
  const matched = [
    inheritedRule([decl('color', 'blue !important', { important: true })], 0),
    inheritedRule([decl('color', 'green')], 0),
  ];
  expect(computeOverridden(matched)).toEqual([[false], [true]]);
});

test('rangeSpan maps a same-line property range to cssText offsets', () => {
  const style = { startLine: 3, startColumn: 10, endLine: 3, endColumn: 40 };
  const prop = { startLine: 3, startColumn: 12, endLine: 3, endColumn: 23 };
  expect(rangeSpan('  color: red; margin: 0; ', style, prop)).toEqual({ start: 2, end: 13 });
});

test('rangeSpan maps multi-line ranges via newline offsets', () => {
  const cssText = '\n  color: red;\n  margin: 0;\n';
  const style = { startLine: 0, startColumn: 5, endLine: 3, endColumn: 0 };
  const prop = { startLine: 2, startColumn: 2, endLine: 2, endColumn: 12 };
  const span = rangeSpan(cssText, style, prop)!;
  expect(cssText.slice(span.start, span.end)).toBe('margin: 0;');
});

test('rangeSpan returns null when the range falls outside the text', () => {
  const style = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 5 };
  expect(rangeSpan('abc', style, { startLine: 0, startColumn: 2, endLine: 0, endColumn: 99 })).toBeNull();
  expect(rangeSpan('abc', style, { startLine: 5, startColumn: 0, endLine: 5, endColumn: 1 })).toBeNull();
});

test('toggleDeclText comments an enabled declaration out', () => {
  expect(toggleDeclText('color: red; margin: 0;', { start: 0, end: 11 }, false)).toBe('/* color: red; */ margin: 0;');
});

test('toggleDeclText adds the missing semicolon when commenting out', () => {
  expect(toggleDeclText('color: red', { start: 0, end: 10 }, false)).toBe('/* color: red; */');
});

test('toggleDeclText uncomments a disabled declaration', () => {
  expect(toggleDeclText('/* color: red; */ margin: 0;', { start: 0, end: 17 }, true)).toBe('color: red; margin: 0;');
});

test('replaceDeclText swaps the declaration and keeps the trailing semicolon', () => {
  expect(replaceDeclText('color: red; margin: 0;', { start: 0, end: 11 }, 'color', 'blue')).toBe('color: blue; margin: 0;');
});

test('replaceDeclText keeps a semicolon-less final declaration semicolon-less', () => {
  expect(replaceDeclText('margin: 0; color: red', { start: 11, end: 21 }, 'color', 'blue')).toBe('margin: 0; color: blue');
});

test('incrementValue bumps the first number and keeps the unit', () => {
  expect(incrementValue('10px', 1)).toBe('11px');
  expect(incrementValue('10px', -1)).toBe('9px');
  expect(incrementValue('1.5em', 1)).toBe('2.5em');
  expect(incrementValue('2rem', 10)).toBe('12rem');
  expect(incrementValue('50%', -10)).toBe('40%');
  expect(incrementValue('7', 1)).toBe('8');
});

test('incrementValue handles negatives and later text', () => {
  expect(incrementValue('-4px', 1)).toBe('-3px');
  expect(incrementValue('0', -1)).toBe('-1');
  expect(incrementValue('10px !important', 1)).toBe('11px !important');
  expect(incrementValue('1px solid red', 1)).toBe('2px solid red');
});

test('incrementValue returns null when the value has no number', () => {
  expect(incrementValue('red', 1)).toBeNull();
  expect(incrementValue('auto', -10)).toBeNull();
});

test('incrementValue skips hex colors, url() and calc() values', () => {
  expect(incrementValue('#ff0000', 1)).toBeNull();
  expect(incrementValue('url(img1.png)', 1)).toBeNull();
  expect(incrementValue('calc(100% - 10px)', 1)).toBeNull();
  expect(incrementValue('1px solid #333', 1)).toBe('2px solid #333');
});
