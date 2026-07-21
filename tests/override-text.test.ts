import { test, expect } from 'vitest';
import { formatOverrideRuleText, formatOverrideText, parseOverrideText, type OverrideDraft } from '../src/tui/lib/override-text.js';
import { globMatch } from '../src/engine.js';

test('formatOverrideText prefills pattern, status, headers, and body', () => {
  const text = formatOverrideText({
    url: 'https://api.example.com/users',
    status: 404,
    responseHeaders: { 'content-type': 'application/json', 'content-length': '12', 'set-cookie': 'a=1\nb=2' },
    body: '{"x":1}',
  });
  expect(text).toBe([
    '# override',
    'PATTERN https://api.example.com/users',
    'STATUS 404',
    'content-type: application/json',
    'set-cookie: a=1',
    'set-cookie: b=2',
    '',
    '{"x":1}',
    '',
  ].join('\n'));
});

test('formatOverrideText defaults to status 200 and an empty body when unavailable', () => {
  expect(formatOverrideText({ url: 'https://a.test/x' })).toBe('# override\nPATTERN https://a.test/x\nSTATUS 200\n\n\n');
  expect(formatOverrideText({ url: 'https://a.test/x', body: 'AAAA', bodyBase64: true })).toContain('STATUS 200\n\n\n');
});

test('parseOverrideText round-trips formatted text', () => {
  const text = formatOverrideText({
    url: 'https://api.example.com/users',
    status: 201,
    responseHeaders: { 'content-type': 'application/json' },
    body: '{"mocked": true}',
  });
  expect(parseOverrideText(text)).toEqual({
    pattern: 'https://api.example.com/users',
    status: 201,
    headers: [['content-type', 'application/json']],
    body: '{"mocked": true}',
  });
});

test('parseOverrideText accepts comments, leading blanks, wildcards, and multi-line bodies', () => {
  const draft = parseOverrideText([
    '',
    '# my rule',
    'PATTERN https://api.example.com/users*',
    '# status below',
    'STATUS 503',
    'x-mock: on',
    '# skipped header comment',
    'retry-after: 5',
    '',
    'line one',
    'line two',
    '',
  ].join('\n'));
  expect(draft).toEqual({
    pattern: 'https://api.example.com/users*',
    status: 503,
    headers: [['x-mock', 'on'], ['retry-after', '5']],
    body: 'line one\nline two',
  });
});

test('parseOverrideText allows an empty header block and empty body', () => {
  expect(parseOverrideText('PATTERN https://a.test/*\nSTATUS 204\n\n')).toEqual({
    pattern: 'https://a.test/*',
    status: 204,
    headers: [],
    body: '',
  });
});

test('parseOverrideText rejects malformed rules', () => {
  expect(parseOverrideText('')).toBeNull();
  expect(parseOverrideText('STATUS 200\n')).toBeNull();
  expect(parseOverrideText('PATTERN https://a.test with spaces\nSTATUS 200\n')).toBeNull();
  expect(parseOverrideText('PATTERN https://a.test/x\nSTATUS abc\n')).toBeNull();
  expect(parseOverrideText('PATTERN https://a.test/x\nSTATUS 20\n')).toBeNull();
  expect(parseOverrideText('PATTERN https://a.test/x\nSTATUS 200\nnot-a-header\n\nbody')).toBeNull();
});

test('formatOverrideRuleText round-trips a rule through parseOverrideText', () => {
  const rule: OverrideDraft = {
    pattern: 'https://api.example.com/users*',
    status: 503,
    headers: [['content-type', 'application/json'], ['retry-after', '5']],
    body: '{"mocked":true}\n\nsecond block',
  };
  expect(parseOverrideText(formatOverrideRuleText(rule))).toEqual(rule);
});

test('formatOverrideRuleText round-trips empty headers, empty body, and header-like body lines', () => {
  const empty: OverrideDraft = { pattern: 'https://a.test/*', status: 204, headers: [], body: '' };
  expect(parseOverrideText(formatOverrideRuleText(empty))).toEqual(empty);
  const headerish: OverrideDraft = { pattern: 'https://a.test/x?', status: 200, headers: [], body: 'x-fake: not-a-header' };
  expect(parseOverrideText(formatOverrideRuleText(headerish))).toEqual(headerish);
});

test('globMatch supports exact URLs, *, ?, and escapes regex characters', () => {
  expect(globMatch('https://a.test/users', 'https://a.test/users')).toBe(true);
  expect(globMatch('https://a.test/users', 'https://a.test/users/1')).toBe(false);
  expect(globMatch('https://a.test/users*', 'https://a.test/users?id=1')).toBe(true);
  expect(globMatch('https://*.test/*/end', 'https://sub.test/a/b/end')).toBe(true);
  expect(globMatch('https://*.test/*/end', 'https://sub.test/end')).toBe(false);
  expect(globMatch('https://a.test/item?', 'https://a.test/item7')).toBe(true);
  expect(globMatch('https://a.test/item?', 'https://a.test/item77')).toBe(false);
  expect(globMatch('https://a.test/item?', 'https://a.test/item')).toBe(false);
  expect(globMatch('https://a.test/x', 'https://aStest/x')).toBe(false);
  expect(globMatch('https://a.test/a+b', 'https://a.test/a+b')).toBe(true);
});
