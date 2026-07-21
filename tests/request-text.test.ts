import { test, expect } from 'vitest';
import { formatRequestText, parseRequestText } from '../src/tui/lib/request-text.js';

test('formats method, url, headers, and body as editable text', () => {
  const text = formatRequestText({
    method: 'POST',
    url: 'https://api.example.com/users',
    requestHeaders: { 'content-type': 'application/json' },
    postData: '{"name":"kim"}',
  });
  expect(text).toBe('POST https://api.example.com/users\ncontent-type: application/json\n\n{"name":"kim"}\n');
});

test('formats a GET without headers or body as a single line', () => {
  expect(formatRequestText({ method: 'GET', url: 'https://a.test/x' })).toBe('GET https://a.test/x\n');
});

test('format then parse round-trips a POST with body', () => {
  const req = {
    method: 'POST',
    url: 'https://a.test/api',
    requestHeaders: { 'content-type': 'application/json', 'x-token': 'abc' },
    postData: '{"a":1}',
  };
  expect(parseRequestText(formatRequestText(req))).toEqual({
    method: 'POST',
    url: 'https://a.test/api',
    headers: { 'content-type': 'application/json', 'x-token': 'abc' },
    body: '{"a":1}',
  });
});

test('format then parse round-trips a GET without body', () => {
  const req = { method: 'GET', url: 'https://a.test/api', requestHeaders: { accept: '*/*' } };
  expect(parseRequestText(formatRequestText(req))).toEqual({
    method: 'GET',
    url: 'https://a.test/api',
    headers: { accept: '*/*' },
  });
});

test('parse tolerates CRLF, leading blank lines, and uppercases the method', () => {
  const req = parseRequestText('\r\n\r\npost https://a.test/x\r\nx-a:  1 \r\n\r\nbody\r\n');
  expect(req).toEqual({ method: 'POST', url: 'https://a.test/x', headers: { 'x-a': '1' }, body: 'body' });
});

test('parse keeps blank lines inside the body', () => {
  const req = parseRequestText('POST https://a.test/x\n\nline1\n\nline2\n');
  expect(req?.body).toBe('line1\n\nline2');
});

test('parse rejects empty text, a bad request line, and a header without a colon', () => {
  expect(parseRequestText('')).toBeNull();
  expect(parseRequestText('   \n \n')).toBeNull();
  expect(parseRequestText('not a request line\n')).toBeNull();
  expect(parseRequestText('just-a-method\n')).toBeNull();
  expect(parseRequestText('GET https://a.test/x\nbroken header line\n')).toBeNull();
});
