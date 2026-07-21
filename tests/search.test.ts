import { test, expect } from 'vitest';
import { entryMatches, searchEntries, highlightSegs, parseRegexLiteral } from '../src/tui/lib/search.js';
import type { NetworkEntry } from '../src/store/types.js';
import type { Seg } from '../src/tui/lib/highlight.js';

test('parseRegexLiteral compiles slash-wrapped patterns case-insensitively by default', () => {
  const lit = parseRegexLiteral('/AbC/');
  expect(lit && 're' in lit).toBe(true);
  const re = (lit as { re: RegExp }).re;
  expect(re.test('xxabcxx')).toBe(true);
  expect(re.flags).toContain('i');
});

test('parseRegexLiteral honours explicit flags and keeps them', () => {
  const lit = parseRegexLiteral('/a.b/s') as { re: RegExp };
  expect(lit.re.flags.split('').sort().join('')).toBe('is');
  expect(lit.re.test('a\nb')).toBe(true);
});

test('parseRegexLiteral captures up to the last slash so escaped slashes survive', () => {
  const lit = parseRegexLiteral('/a\\/b/') as { re: RegExp };
  expect(lit.re.test('a/b')).toBe(true);
});

test('parseRegexLiteral returns null for non-literals and invalid for broken patterns', () => {
  expect(parseRegexLiteral('abc')).toBeNull();
  expect(parseRegexLiteral('/')).toBeNull();
  expect(parseRegexLiteral('//')).toBeNull();
  expect(parseRegexLiteral('/ab')).toBeNull();
  expect(parseRegexLiteral('/(/')).toEqual({ invalid: true });
});

const base = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: 'r1', url: 'https://api.test/users', method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {}, startTs: 0,
  ...over,
});

test('matches a substring of the url', () => {
  expect(entryMatches(base(), 'api.test/users')).toBe(true);
  expect(entryMatches(base(), 'nope.example')).toBe(false);
});

test('matches request header keys and values', () => {
  const e = base({ requestHeaders: { 'X-Request-Token': 'abc123' } });
  expect(entryMatches(e, 'request-token')).toBe(true);
  expect(entryMatches(e, 'abc123')).toBe(true);
});

test('matches response header keys and values', () => {
  const e = base({ responseHeaders: { 'x-trace-id': 'trace-777' } });
  expect(entryMatches(e, 'trace-id')).toBe(true);
  expect(entryMatches(e, 'trace-777')).toBe(true);
});

test('matches set-cookie lines', () => {
  const e = base({ setCookies: ['sid=deadbeef; Path=/; HttpOnly'] });
  expect(entryMatches(e, 'deadbeef')).toBe(true);
  expect(entryMatches(e, 'httponly')).toBe(true);
});

test('matches postData and response body', () => {
  const e = base({ postData: '{"query":"mutation Save"}', body: '{"result":"saved-widget"}' });
  expect(entryMatches(e, 'mutation save')).toBe(true);
  expect(entryMatches(e, 'saved-widget')).toBe(true);
});

test('matching is case-insensitive in both directions', () => {
  const e = base({ url: 'https://API.Test/USERS', body: 'HelloWorld' });
  expect(entryMatches(e, 'api.test/users')).toBe(true);
  expect(entryMatches(e, 'HELLOWORLD')).toBe(true);
});

test('matches CJK text in headers and body', () => {
  const e = base({ responseHeaders: { 'x-msg': '안녕하세요' }, body: '{"이름":"위젯"}' });
  expect(entryMatches(e, '안녕')).toBe(true);
  expect(entryMatches(e, '위젯')).toBe(true);
  expect(entryMatches(e, '고양이')).toBe(false);
});

test('skips base64 bodies', () => {
  const e = base({ body: 'ZmluZG1l', bodyBase64: true });
  expect(entryMatches(e, 'zmlu')).toBe(false);
  expect(entryMatches(base({ body: 'ZmluZG1l' }), 'zmlu')).toBe(true);
});

test('searchEntries filters to matching entries only', () => {
  const a = base({ id: 'a', url: 'https://a.test/one' });
  const b = base({ id: 'b', url: 'https://b.test/two', body: 'one hidden here' });
  const c = base({ id: 'c', url: 'https://c.test/three' });
  expect(searchEntries([a, b, c], 'one').map(e => e.id)).toEqual(['a', 'b']);
});

test('an empty or whitespace query applies no filter', () => {
  const list = [base({ id: 'a' }), base({ id: 'b' })];
  expect(searchEntries(list, '')).toBe(list);
  expect(searchEntries(list, '   ')).toBe(list);
});

const join = (segs: Seg[]) => segs.map(s => s.text).join('');

test('highlightSegs splits a seg around the match and marks it inverse cyan', () => {
  const segs: Seg[] = [{ text: '  x-trace abc-token-xyz', color: 'cyan' }];
  const out = highlightSegs(segs, 'token');
  expect(join(out)).toBe('  x-trace abc-token-xyz');
  const hit = out.find(s => s.inverse);
  expect(hit).toEqual({ text: 'token', color: 'cyan', inverse: true });
  expect(out.filter(s => !s.inverse).every(s => s.color === 'cyan')).toBe(true);
});

test('highlightSegs marks a match spanning two segs', () => {
  const segs: Seg[] = [{ text: 'abc-tok', color: 'cyan' }, { text: 'en-xyz', dim: true }];
  const out = highlightSegs(segs, 'token');
  expect(join(out)).toBe('abc-token-xyz');
  const hits = out.filter(s => s.inverse);
  expect(hits.map(s => s.text).join('')).toBe('token');
  expect(hits[0].color).toBe('cyan');
  expect(hits[1].dim).toBe(true);
});

test('highlightSegs marks every occurrence, case-insensitively', () => {
  const out = highlightSegs([{ text: 'Token and TOKEN and token' }], 'token');
  expect(out.filter(s => s.inverse).map(s => s.text)).toEqual(['Token', 'TOKEN', 'token']);
});

test('highlightSegs highlights CJK matches', () => {
  const out = highlightSegs([{ text: '이름: 위젯 목록' }], '위젯');
  expect(join(out)).toBe('이름: 위젯 목록');
  expect(out.find(s => s.inverse)?.text).toBe('위젯');
});

test('highlightSegs returns segs untouched when the query is empty or unmatched', () => {
  const segs: Seg[] = [{ text: 'hello', color: 'green' }];
  expect(highlightSegs(segs, '')).toBe(segs);
  expect(highlightSegs(segs, 'zzz')).toBe(segs);
});
