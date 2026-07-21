import { test, expect } from 'vitest';
import { formatArg, formatConsoleArgs, formatPreview, inlineArg, toConsoleArg } from '../src/store/console-format.js';
import type { ConsoleArg, ConsolePreview } from '../src/store/types.js';

const objPreview = (props: Array<[string, string, string]>, overflow = false): ConsolePreview => ({
  type: 'object',
  description: 'Object',
  overflow,
  properties: props.map(([name, type, value]) => ({ name, type, value })),
});

test('object previews render {name: value} pairs with quoted strings', () => {
  const arg: ConsoleArg = { type: 'object', description: 'Object', objectId: 'o1', preview: objPreview([['a', 'number', '1'], ['b', 'string', 'str']]) };
  expect(formatArg(arg)).toBe('{a: 1, b: "str"}');
});

test('overflowed previews end with an ellipsis item', () => {
  const arg: ConsoleArg = { type: 'object', preview: objPreview([['a', 'number', '1']], true) };
  expect(formatArg(arg)).toBe('{a: 1, …}');
});

test('array previews drop index names and keep order', () => {
  const arg: ConsoleArg = {
    type: 'object', subtype: 'array', description: 'Array(3)',
    preview: {
      type: 'object', subtype: 'array', description: 'Array(3)', overflow: true,
      properties: [
        { name: '0', type: 'number', value: '1' },
        { name: '1', type: 'number', value: '2' },
      ],
    },
  };
  expect(formatArg(arg)).toBe('[1, 2, …]');
});

test('nested previews expand one level, then fall back to the CDP value string', () => {
  const pre: ConsolePreview = {
    type: 'object', description: 'Object',
    properties: [{
      name: 'c', type: 'object', value: 'Object',
      valuePreview: {
        type: 'object', description: 'Object',
        properties: [
          { name: 'd', type: 'number', value: '2' },
          { name: 'e', type: 'object', value: 'Object', valuePreview: { type: 'object', properties: [{ name: 'f', type: 'number', value: '3' }] } },
        ],
      },
    }],
  };
  expect(formatPreview(pre)).toBe('{c: {d: 2, e: Object}}');
});

test('Map and Set previews render their entries', () => {
  const map: ConsoleArg = {
    type: 'object', subtype: 'map',
    preview: {
      type: 'object', subtype: 'map', description: 'Map(2)', overflow: true,
      entries: [
        { key: { type: 'string', description: 'a' }, value: { type: 'number', description: '1' } },
      ],
    },
  };
  expect(formatArg(map)).toBe('Map(2) {"a" => 1, …}');
  const set: ConsoleArg = {
    type: 'object', subtype: 'set',
    preview: {
      type: 'object', subtype: 'set', description: 'Set(2)',
      entries: [
        { value: { type: 'number', description: '1' } },
        { value: { type: 'number', description: '2' } },
      ],
    },
  };
  expect(formatArg(set)).toBe('Set(2) {1, 2}');
});

test('class instances keep their constructor name ahead of the braces', () => {
  const arg: ConsoleArg = {
    type: 'object', description: 'Foo',
    preview: { type: 'object', description: 'Foo', properties: [{ name: 'x', type: 'number', value: '9' }] },
  };
  expect(formatArg(arg)).toBe('Foo {x: 9}');
});

test('functions render only the trimmed first line of their description', () => {
  const arg: ConsoleArg = { type: 'function', objectId: 'f1', description: '  function add(a, b) {\n  return a + b;\n}' };
  expect(formatArg(arg)).toBe('function add(a, b) {');
});

test('inline previews cap at roughly 120 chars', () => {
  const arg: ConsoleArg = {
    type: 'object',
    preview: objPreview(Array.from({ length: 40 }, (_, i) => [`key${i}`, 'string', 'x'.repeat(10)] as [string, string, string])),
  };
  const out = formatArg(arg);
  expect(out.length).toBe(120);
  expect(out.endsWith('…')).toBe(true);
});

test('args without a preview keep the value/unserializable/description fallback', () => {
  expect(formatArg({ type: 'string', value: 'plain' })).toBe('plain');
  expect(formatArg({ type: 'number', value: 3 })).toBe('3');
  expect(formatArg({ type: 'number', unserializableValue: 'Infinity' })).toBe('Infinity');
  expect(formatArg({ type: 'object', subtype: 'node', description: 'div#app' })).toBe('div#app');
  expect(formatArg({ type: 'undefined' })).toBe('undefined');
});

test('inlineArg quotes string values in property position', () => {
  expect(inlineArg({ type: 'string', value: 'str' })).toBe('"str"');
  expect(inlineArg({ type: 'number', value: 3 })).toBe('3');
});

test('toConsoleArg keeps only the lean RemoteObject fields', () => {
  const arg = toConsoleArg({
    type: 'object', subtype: 'array', className: 'Array', description: 'Array(1)', objectId: 'o9',
    preview: { type: 'object', subtype: 'array', description: 'Array(1)', overflow: false, properties: [{ name: '0', type: 'number', value: '1', extra: 'x' }] },
    extraField: true,
  });
  expect(arg).toEqual({
    type: 'object', subtype: 'array', description: 'Array(1)', objectId: 'o9',
    preview: { type: 'object', subtype: 'array', description: 'Array(1)', properties: [{ name: '0', type: 'number', value: '1' }] },
  });
});

const s = (value: string): ConsoleArg => ({ type: 'string', value });
const n = (value: number): ConsoleArg => ({ type: 'number', value });

test('%s %d %i %f substitute arguments in order', () => {
  expect(formatConsoleArgs([s('%s is %d years, %f m, id %i'), s('kim'), n(41.9), n(1.75), n(7)]))
    .toBe('kim is 41 years, 1.75 m, id 7');
});

test('%d coerces strings and yields NaN for objects', () => {
  expect(formatConsoleArgs([s('n=%d'), s('5')])).toBe('n=5');
  expect(formatConsoleArgs([s('n=%d'), { type: 'object', description: 'Object' }])).toBe('n=NaN');
});

test('%o and %O render the preview, %j renders JSON', () => {
  const obj: ConsoleArg = { type: 'object', objectId: 'o1', preview: objPreview([['a', 'number', '1']]) };
  expect(formatConsoleArgs([s('obj %o'), obj])).toBe('obj {a: 1}');
  expect(formatConsoleArgs([s('json %j'), { type: 'object', value: { a: 1 } }])).toBe('json {"a":1}');
});

test('%c consumes its style argument and renders nothing', () => {
  expect(formatConsoleArgs([s('%cstyled%c plain'), s('color: red'), s('')])).toBe('styled plain');
});

test('leftover arguments append space-separated and %% stays literal', () => {
  expect(formatConsoleArgs([s('a=%s 100%%'), s('1'), s('extra'), n(2)])).toBe('a=1 100% extra 2');
});

test('specifiers without remaining arguments stay literal', () => {
  expect(formatConsoleArgs([s('%s and %s'), s('one')])).toBe('one and %s');
  expect(formatConsoleArgs([s('bare %d')])).toBe('bare %d');
});

test('a non-string first argument disables substitution', () => {
  expect(formatConsoleArgs([n(1), s('%s')])).toBe('1 %s');
});
