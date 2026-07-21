import { test, expect } from 'vitest';
import { highlightHtml, highlightCss, highlightJs, highlightJson, highlightLabel, segsToNodes } from '../src/tui/lib/highlight.js';
import { theme } from '../src/tui/lib/theme.js';

const highlighters = [highlightHtml, highlightCss, highlightJson, highlightLabel, highlightJs];

const gnarly = [
  '',
  '   ',
  '<button class="btn" disabled type=text>Go</button>',
  '<img src=logo.png />',
  '<div class="a b" data-x=\'y\'>',
  '<span>안녕하세요 🌟</span>',
  '<a href="/x?q=1&z=2">link</a>',
  '<input value="">',
  '<half open tag',
  'plain text with < and > loose',
  '.btn { color: red; background: url(http://x/y); }',
  'a:hover { color: blue }',
  '  color: red;',
  '}',
  '{ "name": "값", "n": -12.5e3, "ok": true, "x": null }',
  '  "key": "he said \\"hi\\"",',
  'div#root.btn.active',
  '#text',
  'html',
  'span.x',
  '🌟#id.클래스',
  'const x = await fetch(`/api/${id}?q=1`)',
  "document.querySelector('.btn').addEventListener",
  '$$("div").map(e => e.textContent) // grab all',
  'let n = 0x1f + 12.5e3 - .5 + 10n',
  '"unterminated str',
];

test('every highlighter round-trips concatenated seg text to the input', () => {
  for (const fn of highlighters) {
    for (const line of gnarly) {
      const segs = fn(line);
      expect(segs.map(s => s.text).join('')).toBe(line);
    }
  }
});

test('html classifies tag, attribute and value', () => {
  const segs = highlightHtml('<button class="btn">');
  expect(segs.find(s => s.text === 'button')?.color).toBe('cyan');
  expect(segs.find(s => s.text === 'class')?.color).toBe('yellow');
  expect(segs.find(s => s.text === 'btn')?.color).toBe('green');
  expect(segs.find(s => s.text === '<')?.dim).toBe(true);
});

test('html treats unquoted attribute values as values', () => {
  const segs = highlightHtml('<input type=text>');
  expect(segs.find(s => s.text === 'type')?.color).toBe('yellow');
  expect(segs.find(s => s.text === 'text')?.color).toBe('green');
});

test('css classifies selector, property and value', () => {
  const segs = highlightCss('.btn { color: red; }');
  expect(segs.find(s => s.text === '.btn')?.color).toBe('cyan');
  expect(segs.find(s => s.text === 'color')?.color).toBe('yellow');
  const red = segs.find(s => s.text === 'red')!;
  expect(red.color).toBeUndefined();
  expect(segs.find(s => s.text === '{')?.dim).toBe(true);
});

test('css treats a brace-less declaration line as property and value', () => {
  const segs = highlightCss('  color: red;');
  expect(segs.find(s => s.text === 'color')?.color).toBe('yellow');
  expect(segs.find(s => s.text === 'red')?.color).toBeUndefined();
});

test('json classifies keys, strings and scalars', () => {
  const segs = highlightJson('{ "name": "값", "n": -12.5, "ok": true }');
  expect(segs.find(s => s.text === '"name"')?.color).toBe('cyan');
  expect(segs.find(s => s.text === '"값"')?.color).toBe('green');
  expect(segs.find(s => s.text === '-12.5')?.color).toBe('yellow');
  expect(segs.find(s => s.text === 'true')?.color).toBe('yellow');
  expect(segs.find(s => s.text === ':')?.dim).toBe(true);
});

test('label colours ids yellow and classes green while the tag stays plain', () => {
  const segs = highlightLabel('div#root.btn.active');
  expect(segs.find(s => s.text === 'div')?.color).toBeUndefined();
  expect(segs.find(s => s.text === '#root')?.color).toBe('yellow');
  expect(segs.find(s => s.text === '.btn')?.color).toBe('green');
  expect(segs.find(s => s.text === '.active')?.color).toBe('green');
});

test('label with no id or class is a single plain segment', () => {
  const segs = highlightLabel('html');
  expect(segs).toHaveLength(1);
  expect(segs[0]).toEqual({ text: 'html' });
});

test('js classifies keywords, strings, numbers and punctuation', () => {
  const segs = highlightJs("const n = obj.count + 12.5; return 'done'");
  expect(segs.find(s => s.text === 'const')?.color).toBe('cyan');
  expect(segs.find(s => s.text === 'return')?.color).toBe('cyan');
  expect(segs.find(s => s.text === '12.5')?.color).toBe('yellow');
  expect(segs.find(s => s.text === "'done'")?.color).toBe('green');
  expect(segs.find(s => s.text === '.')?.dim).toBe(true);
  expect(segs.find(s => s.text === 'obj')?.color).toBeUndefined();
});

test('js colors a template literal green as one segment including ${}', () => {
  const segs = highlightJs('tag + `a ${x} b`');
  expect(segs.find(s => s.text === '`a ${x} b`')?.color).toBe('green');
});

test('js keeps an unterminated string green to the end of the line', () => {
  const segs = highlightJs("copy('half");
  expect(segs.find(s => s.text === "'half")?.color).toBe('green');
});

test('js colors command-line API names with the theme accent', () => {
  for (const name of ['$0', '$_', '$', '$$', 'copy', 'inspect', 'keys', 'monitor']) {
    const segs = highlightJs(`${name}(x)`);
    expect(segs.find(s => s.text === name)?.color).toBe(theme.accent);
  }
});

test('js leaves dotted members plain even when they shadow keywords or the CLI API', () => {
  const segs = highlightJs('obj.keys + map.this');
  expect(segs.find(s => s.text === 'keys')?.color).toBeUndefined();
  expect(segs.find(s => s.text === 'this')?.color).toBeUndefined();
});

test('js literals true/false/null/undefined and hex/bigint numbers are colored', () => {
  const segs = highlightJs('x = true ?? null ?? undefined ?? 0xff ?? 10n');
  expect(segs.find(s => s.text === 'true')?.color).toBe('cyan');
  expect(segs.find(s => s.text === 'null')?.color).toBe('cyan');
  expect(segs.find(s => s.text === 'undefined')?.color).toBe('cyan');
  expect(segs.find(s => s.text === '0xff')?.color).toBe('yellow');
  expect(segs.find(s => s.text === '10n')?.color).toBe('yellow');
});

test('js dims a // comment through the end of the line', () => {
  const segs = highlightJs('run() // note');
  expect(segs.find(s => s.text === '// note')?.dim).toBe(true);
});

test('segsToNodes maps one node per segment', () => {
  const segs = highlightCss('.btn { color: red; }');
  const nodes = segsToNodes(segs, 'k');
  expect(nodes).toHaveLength(segs.length);
  expect(segsToNodes([])).toEqual([]);
});
