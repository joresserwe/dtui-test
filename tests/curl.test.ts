import { test, expect } from 'vitest';
import { buildCurl, buildFetch, buildNodeFetch } from '../src/tui/lib/curl.js';
import type { NetworkEntry } from '../src/store/types.js';

function entry(over: Partial<NetworkEntry>): NetworkEntry {
  return {
    id: '1', url: 'https://example.com/api', method: 'GET', type: 'XHR',
    requestHeaders: {}, responseHeaders: {}, startTs: 0,
    ...over,
  };
}

test('buildCurl omits -X and body for a bare GET', () => {
  expect(buildCurl(entry({ method: 'GET' }))).toBe("curl 'https://example.com/api'");
});

test('buildCurl emits method, headers, and body for a POST', () => {
  const out = buildCurl(entry({
    method: 'POST',
    requestHeaders: { 'content-type': 'application/json', accept: '*/*' },
    postData: '{"a":1}',
  }));
  expect(out).toBe(
    "curl 'https://example.com/api' \\\n" +
    "  -X POST \\\n" +
    "  -H 'content-type: application/json' \\\n" +
    "  -H 'accept: */*' \\\n" +
    "  --data-raw '{\"a\":1}'",
  );
});

test('buildCurl escapes single quotes in the body', () => {
  const out = buildCurl(entry({ method: 'POST', postData: "it's a test" }));
  expect(out).toContain("--data-raw 'it'\\''s a test'");
});

test('buildCurl escapes single quotes in a header value', () => {
  const out = buildCurl(entry({ method: 'GET', requestHeaders: { cookie: "a='b'" } }));
  expect(out).toContain("-H 'cookie: a='\\''b'\\'''");
});

test('buildFetch omits method and body for a bare GET', () => {
  expect(buildFetch(entry({ method: 'GET' }))).toBe(
    'fetch("https://example.com/api", {\n  "headers": {}\n})',
  );
});

test('buildFetch includes method, headers, and body for a POST', () => {
  const out = buildFetch(entry({
    method: 'POST',
    requestHeaders: { 'content-type': 'application/json' },
    postData: '{"a":1}',
  }));
  expect(out).toBe(
    'fetch("https://example.com/api", {\n' +
    '  "method": "POST",\n' +
    '  "headers": {\n' +
    '    "content-type": "application/json"\n' +
    '  },\n' +
    '  "body": "{\\"a\\":1}"\n' +
    '})',
  );
});

test('buildFetch JSON-escapes quotes in the body', () => {
  const out = buildFetch(entry({ method: 'POST', postData: 'say "hi"' }));
  expect(out).toContain('"body": "say \\"hi\\""');
});

test('buildNodeFetch wraps the same options in a standalone await script', () => {
  const out = buildNodeFetch(entry({
    method: 'POST',
    requestHeaders: { 'content-type': 'application/json' },
    postData: '{"a":1}',
  }));
  expect(out).toBe(
    'const res = await fetch("https://example.com/api", {\n' +
    '  "method": "POST",\n' +
    '  "headers": {\n' +
    '    "content-type": "application/json"\n' +
    '  },\n' +
    '  "body": "{\\"a\\":1}"\n' +
    '});\n' +
    'const body = await res.text();\n' +
    'console.log(res.status, body);',
  );
});

test('buildNodeFetch masks sensitive headers with redact on', () => {
  const out = buildNodeFetch(entry({ requestHeaders: { Authorization: 'Bearer tok' } }), { redact: true });
  expect(out).toContain('"Authorization": "[redacted]"');
  expect(out).not.toContain('Bearer tok');
});

const SECRET_HEADERS = { Authorization: 'Bearer tok', Cookie: 'sid=1', accept: '*/*' };

test('buildCurl masks sensitive header values with redact on', () => {
  const out = buildCurl(entry({ requestHeaders: SECRET_HEADERS }), { redact: true });
  expect(out).toContain("-H 'Authorization: [redacted]'");
  expect(out).toContain("-H 'Cookie: [redacted]'");
  expect(out).toContain("-H 'accept: */*'");
  expect(out).not.toContain('Bearer tok');
});

test('buildCurl preserves header values by default', () => {
  const out = buildCurl(entry({ requestHeaders: SECRET_HEADERS }));
  expect(out).toContain("-H 'Authorization: Bearer tok'");
  expect(out).toContain("-H 'Cookie: sid=1'");
});

test('buildFetch masks sensitive header values with redact on and preserves them by default', () => {
  const masked = buildFetch(entry({ requestHeaders: SECRET_HEADERS }), { redact: true });
  expect(masked).toContain('"Authorization": "[redacted]"');
  expect(masked).toContain('"Cookie": "[redacted]"');
  expect(masked).toContain('"accept": "*/*"');
  const plain = buildFetch(entry({ requestHeaders: SECRET_HEADERS }));
  expect(plain).toContain('"Authorization": "Bearer tok"');
});
