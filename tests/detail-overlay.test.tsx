import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { DetailOverlay, DETAIL_TABS, DETAIL_CHROME, detailTabLines, detailTabRich, detailTabsFor, detailChips, stackedCells, statusBadge } from '../src/tui/overlays/DetailOverlay.js';
import { theme } from '../src/tui/lib/theme.js';
import { t } from '../src/tui/lib/i18n.js';
import type { NetworkEntry } from '../src/store/types.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const entry: NetworkEntry = {
  id: 'r1', url: 'https://api.test/data', method: 'POST', type: 'XHR',
  status: 200, statusText: 'OK', mimeType: 'application/json',
  requestHeaders: { 'Content-Type': 'application/json', accept: '*/*' },
  responseHeaders: { 'content-type': 'application/json', 'x-trace': 'abc' },
  postData: '{"q":1}',
  startTs: 0, durationMs: 142, encodedBytes: 2150,
  timing: { requestTime: 1, dnsStart: 0, dnsEnd: 2, connectStart: 2, connectEnd: 10, sslStart: -1, sslEnd: -1, sendStart: 10, sendEnd: 11, receiveHeadersEnd: 120 },
  body: '{"ok":true}', bodyBase64: false, bodyTruncated: true,
};

test('summary overview section is structured, aligned, and carries no url', () => {
  const lines = detailTabLines(entry, 'summary');
  const text = lines.join('\n');
  expect(text).not.toContain('https://api.test/data');
  expect(lines).toContain('  status    200 OK');
  expect(lines).toContain('  type      XHR · application/json');
  expect(lines).toContain('  size      2.1kB');
  expect(lines).toContain('  time      142ms');
  expect(lines).toContain('▍ overview');
  expect(text).not.toContain('accept');
});

test('summary lays the overview out as a two-column grid when wide', () => {
  const lines = detailTabLines(entry, 'summary', 120);
  expect(lines.some(l => /^ {2}status {4}200 OK\s+type {6}XHR · application\/json$/.test(l))).toBe(true);
  expect(lines.some(l => /^ {2}size {6}2\.1kB\s+time {6}142ms$/.test(l))).toBe(true);
  const narrow = detailTabLines(entry, 'summary', 80);
  expect(narrow).toContain('  status    200 OK');
  expect(narrow).toContain('  type      XHR · application/json');
});

test('summary overview shows a single operation row for graphql entries', () => {
  const lines = detailTabLines({ ...entry, gqlOperation: 'SaveWidget', gqlType: 'mutation' }, 'summary');
  expect(lines.filter(l => l.includes('operation')).length).toBe(1);
  expect(lines).toContain('  operation SaveWidget · mutation');
  const untyped = detailTabLines({ ...entry, gqlOperation: 'SaveWidget' }, 'summary');
  expect(untyped).toContain('  operation SaveWidget');
  expect(detailTabLines(entry, 'summary').some(l => l.includes('operation'))).toBe(false);
});

test('summary timing renders one stacked bar with the total and a per-phase legend', () => {
  const lines = detailTabLines(entry, 'summary', 80);
  expect(lines).toContain('▍ timing');
  const bar = lines.find(l => /^ {2}█+ 142ms$/.test(l));
  expect(bar).toBeDefined();
  expect(bar!.length).toBe(80);
  const legend = lines.find(l => l.includes('■ dns'));
  expect(legend).toBe('  ■ dns 2ms  ■ connect 8ms  ■ ttfb 109ms  ■ download 22ms');
  expect(lines.join('\n')).not.toContain('ssl');
});

test('stackedCells fills the width, keeps nonzero phases visible, and clamps', () => {
  expect(stackedCells([2, 8, 109, 22], 72).reduce((a, b) => a + b, 0)).toBe(72);
  const tiny = stackedCells([1, 1, 1000], 20);
  expect(tiny.every(c => c >= 1)).toBe(true);
  expect(tiny.reduce((a, b) => a + b, 0)).toBe(20);
  expect(stackedCells([0, 0], 10)).toEqual([0, 0]);
  expect(stackedCells([5], 0)).toEqual([0]);
});

test('summary body section links to the body tabs', () => {
  const lines = detailTabLines(entry, 'summary');
  expect(lines).toContain('▍ body');
  expect(lines).toContain('  request   7B → tab 2');
  expect(lines).toContain('  response  11B → tab 4');
});

test('summary handles failed and pending entries and omits absent sections', () => {
  const failed = detailTabLines(
    { ...entry, status: undefined, statusText: undefined, error: 'net::ERR_FAILED', timing: undefined, durationMs: undefined, body: undefined, postData: undefined },
    'summary',
  );
  const failedText = failed.join('\n');
  expect(failedText).toContain('  status    FAIL (net::ERR_FAILED)');
  expect(failedText).toContain('  response  없음');
  expect(failedText).not.toContain('  request  ');
  expect(failed.some(l => l.startsWith('▍ timing'))).toBe(false);
  const pending = detailTabLines({ ...entry, status: undefined, statusText: undefined, error: undefined }, 'summary');
  expect(pending.join('\n')).toContain('  status    pending');
});

test('request tab shows the full url wrapped and an aligned header section', () => {
  const lines = detailTabLines(entry, 'request');
  const text = lines.join('\n');
  expect(lines[0]).toBe('POST https://api.test/data');
  expect(lines).toContain('▍ headers · 2');
  expect(text).toContain('  Content-Type application/json');
  expect(text).toContain('  accept       */*');
  expect(lines).toContain('▍ body · application/json');
  expect(text).toContain('"q": 1');
  expect(text).not.toContain('x-trace');
});

test('request tab wraps a long url across lines so the whole url is preserved', () => {
  const longUrl = 'https://example.test/' + 'segment-'.repeat(20) + 'MIDTOKEN/' + 'tail-'.repeat(20);
  const long = { ...entry, url: longUrl };
  const width = 40;
  const wrapped = detailTabLines(long, 'request', width);
  const urlLines = wrapped.slice(0, wrapped.indexOf(''));
  expect(urlLines.length).toBeGreaterThan(1);
  expect(urlLines.every(l => l.length <= width)).toBe(true);
  expect(urlLines.join('')).toBe(`POST ${longUrl}`);
  expect(urlLines.join('')).toContain('MIDTOKEN');
});

test('request body mime lookup is fully case-insensitive', () => {
  const text = detailTabLines({ ...entry, requestHeaders: { 'CONTENT-TYPE': 'application/json' } }, 'request').join('\n');
  expect(text).toContain('"q": 1');
});

test('response tab shows a status section and aligned response headers', () => {
  const lines = detailTabLines(entry, 'response');
  const text = lines.join('\n');
  expect(lines).toContain('▍ status');
  expect(lines).toContain('  status    200 OK');
  expect(lines).toContain('  size      2.1kB');
  expect(lines).toContain('  mime      application/json');
  expect(lines).toContain('▍ headers · 2');
  expect(text).toContain('  content-type application/json');
  expect(text).toContain('  x-trace      abc');
  expect(text).not.toContain('accept');
});

test('a header key longer than the column cap gets its own line instead of an ellipsis', () => {
  const wide = {
    ...entry,
    responseHeaders: { 'x-very-long-header-name-exceeding-cap': '1', '한글헤더': 'v', 'x-trace': 'abc' },
  };
  const lines = detailTabLines(wide, 'response', 80);
  expect(lines).toContain('▍ headers · 3');
  expect(lines).toContain('  x-very-long-header-name-exceeding-cap');
  expect(lines).toContain('    1');
  expect(lines.join('\n')).not.toContain('…');
  expect(lines).toContain('  한글헤더 v');
  expect(lines).toContain('  x-trace  abc');
});

test('a long header value wraps onto indented continuation lines without loss', () => {
  const long = { ...entry, responseHeaders: { auth: 'a'.repeat(60) } };
  const lines = detailTabLines(long, 'response', 40);
  const start = lines.findIndex(l => l.startsWith('  auth '));
  expect(start).toBeGreaterThan(-1);
  expect(lines[start]).toBe(`  auth ${'a'.repeat(33)}`);
  expect(lines[start + 1]).toBe(`${' '.repeat(7)}${'a'.repeat(27)}`);
  expect(lines.slice(start, start + 2).join('').replace(/\s/g, '')).toBe(`auth${'a'.repeat(60)}`);
});

test('body tab heads with a mime/size/truncated section then the pretty body', () => {
  const lines = detailTabLines(entry, 'body');
  expect(lines[0]).toBe('▍ response body · application/json · 11B · truncated');
  expect(lines.join('\n')).toContain('"ok": true');
});

test('highlighting the json body leaves its text intact', () => {
  const frame = render(<DetailOverlay entry={entry} tab="body" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(frame).toContain('"ok": true');
});

test('body tab shows a base64 placeholder without a truncation flag', () => {
  const lines = detailTabLines({ ...entry, body: 'AAAA', bodyBase64: true, bodyTruncated: false }, 'body');
  expect(lines[0]).toBe('▍ response body · application/json · 4B');
  expect(lines).toContain('<base64 body, 4 chars>');
  expect(lines.join('\n')).not.toContain('truncated');
});

test('body tab reports a missing body', () => {
  expect(detailTabLines({ ...entry, body: undefined }, 'body')).toEqual(['응답 본문 없음']);
});

test('body tab wraps long content lines only when wrap is on', () => {
  const long = { ...entry, mimeType: 'text/plain', body: 'x'.repeat(50), bodyTruncated: false };
  const off = detailTabRich(long, 'body', 20).map(l => l.text);
  expect(off).toContain('x'.repeat(50));
  const on = detailTabRich(long, 'body', 20, true).map(l => l.text);
  expect(on).not.toContain('x'.repeat(50));
  expect(on.filter(l => /^x+$/.test(l))).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)]);
});

test('wrapped json body fragments keep their syntax segments and lose nothing', () => {
  const long = { ...entry, body: `{"k":"${'v'.repeat(30)}"}`, bodyTruncated: false };
  const on = detailTabRich(long, 'body', 20, true);
  const frags = on.filter(l => l.pre);
  expect(frags.length).toBeGreaterThan(1);
  const pretty = JSON.stringify(JSON.parse(long.body), null, 2).split('\n').join('');
  expect(frags.map(l => l.text).join('')).toBe(pretty);
  expect(frags.some(l => l.segs!.some(s => s.color !== undefined))).toBe(true);
});

test('the base64 placeholder line never wraps', () => {
  const b64 = { ...entry, body: 'A'.repeat(80), bodyBase64: true, bodyTruncated: false };
  const on = detailTabRich(b64, 'body', 20, true).map(l => l.text);
  expect(on).toEqual(['▍ response body · application/json · 80B', '<base64 body, 80 chars>']);
});

test('request tab raw body region wraps when wrap is on', () => {
  const e2 = { ...entry, requestHeaders: { 'content-type': 'text/plain' }, postData: 'y'.repeat(45) };
  expect(detailTabLines(e2, 'request', 20)).toContain('y'.repeat(45));
  const on = detailTabRich(e2, 'request', 20, true).map(l => l.text);
  expect(on).not.toContain('y'.repeat(45));
  expect(on).toContain('y'.repeat(20));
  expect(on).toContain('y'.repeat(5));
});

test('enabling wrap grows the overlay scroll range', () => {
  const long = { ...entry, mimeType: 'text/plain', body: 'x'.repeat(300), bodyTruncated: false };
  const off = stripAnsi(render(<DetailOverlay entry={long} tab="body" scroll={0} height={8} width={60} />).lastFrame()!);
  expect(off).not.toContain('/6)');
  const on = stripAnsi(render(<DetailOverlay entry={long} tab="body" scroll={0} height={8} width={60} wrap />).lastFrame()!);
  expect(on).toContain('(1-3/6)');
});

test('header badge reflects success, failure, and pending state', () => {
  expect(statusBadge(entry, 100)).toEqual({ text: ' 200 OK ', bg: theme.ok, color: theme.badgeFg });
  expect(statusBadge({ ...entry, status: 503, statusText: undefined }, 100).bg).toBe(theme.err);
  expect(statusBadge({ ...entry, status: 302, statusText: undefined }, 100).bg).toBe(theme.warn);
  const ok = render(<DetailOverlay entry={entry} tab="summary" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(stripAnsi(ok).split('\n')[0].endsWith(' 200 OK')).toBe(true);
  const failed = statusBadge({ ...entry, error: 'net::ERR_FAILED' }, 80);
  expect(failed.text).toBe(' FAIL net::ERR_FAILED ');
  expect(failed.bg).toBe(theme.err);
  expect(statusBadge({ ...entry, error: 'net::ERR_FAILED' }, 12).text).toBe(' FAIL ');
  const pending = statusBadge({ ...entry, status: undefined }, 80);
  expect(pending).toEqual({ text: ' pending ', color: theme.muted });
  const pendingFrame = render(<DetailOverlay entry={{ ...entry, status: undefined }} tab="summary" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(stripAnsi(pendingFrame).split('\n')[0].endsWith(' pending')).toBe(true);
});

test('the chips row surfaces time, size, protocol, remote, and cache at a glance', () => {
  const rich = { ...entry, protocol: 'h2', remoteAddress: '93.184.216.34:443', fromCache: 'disk' as const };
  expect(detailChips(rich).map(s => s.text).join('')).toBe('142ms · 2.1kB · h2 · 93.184.216.34:443 · disk cache');
  expect(detailChips(entry).map(s => s.text).join('')).toBe('142ms · 2.1kB');
  expect(detailChips({ ...entry, durationMs: undefined, encodedBytes: undefined })).toEqual([]);
  const frame = stripAnsi(render(<DetailOverlay entry={rich} tab="body" scroll={0} height={12} width={80} />).lastFrame()!);
  expect(frame).toContain('142ms · 2.1kB · h2 · 93.184.216.34:443 · disk cache');
});

test('overlay puts the method and url in the header once and switches content by tab', () => {
  const { lastFrame } = render(<DetailOverlay entry={entry} tab="summary" scroll={0} height={12} />);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain(' POST  api.test/data');
  expect(frame).not.toContain('https://');
  expect(frame.split('\n').filter(l => l.includes('api.test/data')).length).toBe(1);
  expect(frame).toContain('Summary');
  expect(frame).toContain('Request');
  expect(frame).toContain('Response');
  expect(frame).toContain('Body');
  expect(frame).toContain('2.1kB');
  expect(frame).not.toContain('"ok": true');
  const body = render(<DetailOverlay entry={entry} tab="body" scroll={0} height={12} />).lastFrame()!;
  expect(body).toContain('"ok": true');
  expect(body).not.toContain('  size ');
});

test('tab strip carries numeric hints and the underline sits under the active tab', () => {
  const cases = [['summary', '1 Summary'], ['response', '3 Response']] as const;
  for (const [tab, label] of cases) {
    const frame = stripAnsi(render(<DetailOverlay entry={entry} tab={tab} scroll={0} height={12} width={80} />).lastFrame()!);
    expect(frame).toContain('1 Summary │ 2 Request │ 3 Response │ 4 Body');
    const rows = frame.split('\n');
    const tabRow = rows.find(l => l.includes('1 Summary'))!;
    const underlineRow = rows[rows.indexOf(tabRow) + 1];
    const start = tabRow.indexOf(label);
    expect(underlineRow.trimEnd()).toBe(`${' '.repeat(start)}${'━'.repeat(label.length)}`);
    expect(underlineRow).not.toMatch(/[─╯╰]/);
  }
});

test('chrome stacks request line, stats, tabs, and active-tab underline without an https scheme', () => {
  const rich = { ...entry, protocol: 'h2', remoteAddress: '93.184.216.34:443' };
  const rows = stripAnsi(render(<DetailOverlay entry={rich} tab="summary" scroll={0} height={12} width={80} />).lastFrame()!).split('\n');
  expect(rows[0]).toContain(' POST  api.test/data');
  expect(rows[0].endsWith(' 200 OK')).toBe(true);
  expect(rows[0]).not.toContain('https://');
  expect(rows[1].trimEnd()).toBe(`${' '.repeat(7)}142ms · 2.1kB · h2 · 93.184.216.34:443`);
  expect(rows[2]).toContain('1 Summary │ 2 Request');
  expect(rows[3].trimEnd()).toBe(`  ${'━'.repeat('1 Summary'.length)}`);
  expect(rows[3]).not.toMatch(/[─╯╰]/);
});

test('overlay clamps scroll and shows an overflow indicator', () => {
  const { lastFrame } = render(<DetailOverlay entry={entry} tab="request" scroll={0} height={8} width={100} />);
  expect(lastFrame()).not.toContain('"q": 1');
  const scrolled = render(<DetailOverlay entry={entry} tab="request" scroll={999} height={8} width={100} />).lastFrame()!;
  expect(scrolled).toContain('"q": 1');
  const lines = detailTabLines(entry, 'request', 100);
  expect(scrolled).toContain(`/${lines.length})`);
});

test('overlay is borderless and fills the width exactly', () => {
  const frame = render(<DetailOverlay entry={entry} tab="summary" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(frame).not.toContain('╔');
  expect(frame).not.toContain('╭');
  expect(frame).toContain('─'.repeat(80));
  expect(Math.max(...frame.split('\n').map(l => l.length))).toBe(80);
});

test('frame line-count stays constant across tabs and scroll values', () => {
  const height = 10;
  const count = (tab: (typeof DETAIL_TABS)[number], scroll: number) =>
    render(<DetailOverlay entry={entry} tab={tab} scroll={scroll} height={height} />).lastFrame()!.split('\n').length;
  const baseline = count('summary', 0);
  expect(baseline).toBe(height);
  expect(DETAIL_CHROME).toBe(5);
  for (const tab of DETAIL_TABS) {
    for (const scroll of [0, 3, 999]) {
      expect(count(tab, scroll)).toBe(baseline);
    }
  }
});

test('summary overview gains remote, protocol, priority, referrer, and cache annotation', () => {
  const rich = {
    ...entry,
    remoteAddress: '93.184.216.34:443', protocol: 'h2', priority: 'High',
    referrerPolicy: 'no-referrer', fromCache: 'disk' as const,
  };
  const lines = detailTabLines(rich, 'summary');
  expect(lines).toContain('  size      2.1kB (disk cache)');
  expect(lines).toContain('  remote    93.184.216.34:443');
  expect(lines).toContain('  protocol  h2');
  expect(lines).toContain('  priority  High');
  expect(lines).toContain('  referrer  no-referrer');
});

test('summary omits enrichment rows when the entry lacks them', () => {
  const text = detailTabLines(entry, 'summary').join('\n');
  expect(text).not.toContain('remote');
  expect(text).not.toContain('protocol');
  expect(text).not.toContain('priority');
  expect(text).not.toContain('referrer');
  expect(text).not.toContain('initiator');
  expect(text).not.toContain('server-timing');
});

test('summary shows the initiator with its top stack frames', () => {
  const withInit = {
    ...entry,
    initiator: {
      type: 'script', url: 'https://a.test/js/app.js', lineNumber: 41,
      stack: [{ functionName: 'fetchData', url: 'https://a.test/js/app.js', lineNumber: 41 }],
    },
  };
  const lines = detailTabLines(withInit, 'summary');
  expect(lines).toContain('  initiator script · app.js:42');
  expect(lines).toContain(`  ${' '.repeat(10)}↳ fetchData @ app.js:42`);
});

test('summary timing includes queueing in the legend and drops zero phases', () => {
  const lines = detailTabLines({ ...entry, queueingMs: 12 }, 'summary');
  const legend = lines.find(l => l.includes('■ queueing'));
  expect(legend).toBe('  ■ queueing 12ms  ■ dns 2ms  ■ connect 8ms  ■ ttfb 109ms  ■ download 22ms');
  expect(lines.join('\n')).not.toContain('stalled');
});

test('summary parses a server-timing header into a sub-section', () => {
  const st = {
    ...entry,
    responseHeaders: { ...entry.responseHeaders, 'server-timing': 'db;dur=53;desc="Database", cache;dur=2.2, app;desc="render"' },
  };
  const lines = detailTabLines(st, 'summary');
  expect(lines).toContain('▍ server-timing');
  expect(lines).toContain('  db        53ms Database');
  expect(lines).toContain('  cache     2.2ms');
  expect(lines).toContain('  app       - render');
});

test('request tab decodes query params into their own section', () => {
  const q = { ...entry, url: 'https://api.test/data?q=hello%20world&page=2' };
  const lines = detailTabLines(q, 'request');
  expect(lines).toContain('▍ query params · 2');
  expect(lines).toContain('  q    hello world');
  expect(lines).toContain('  page 2');
  expect(detailTabLines(entry, 'request').join('\n')).not.toContain('query params');
});

test('request tab renders urlencoded bodies as a form data section', () => {
  const form = {
    ...entry,
    requestHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
    postData: 'a=1&b=hello+world',
  };
  const lines = detailTabLines(form, 'request');
  expect(lines).toContain('▍ form data · 2');
  expect(lines).toContain('  a 1');
  expect(lines).toContain('  b hello world');
  expect(lines.some(l => l.startsWith('▍ body'))).toBe(false);
});

test('request tab parses the cookie header and flags blocked request cookies', () => {
  const c = {
    ...entry,
    requestHeaders: { cookie: 'sid=abc; theme=dark' },
    blockedRequestCookies: [{ name: 'tracker', reasons: ['SameSiteStrict'] }],
  };
  const lines = detailTabLines(c, 'request');
  expect(lines).toContain('▍ cookies · 3');
  expect(lines).toContain('  sid   abc');
  expect(lines).toContain('  theme dark');
  expect(lines).toContain('  ⚠ tracker SameSiteStrict');
  expect(detailTabLines(entry, 'request').join('\n')).not.toContain('▍ cookies');
});

test('response tab lists every set-cookie with dim attributes and blocked markers', () => {
  const sc = {
    ...entry,
    setCookies: ['sid=abc; Path=/; HttpOnly', 'evil=1; SameSite=None'],
    blockedResponseCookies: [{ cookieLine: 'evil=1; SameSite=None', reasons: ['SameSiteNoneInsecure'] }],
  };
  const lines = detailTabLines(sc, 'response');
  expect(lines).toContain('▍ set-cookie · 2');
  expect(lines).toContain('  sid=abc  Path=/; HttpOnly');
  expect(lines).toContain('  ⚠ evil=1  SameSite=None  SameSiteNoneInsecure');
  expect(detailTabLines(entry, 'response').join('\n')).not.toContain('set-cookie');
});

test('detailTabsFor exposes a fifth Messages tab only for websocket-style entries', () => {
  expect(detailTabsFor(entry)).toEqual(['summary', 'request', 'response', 'body']);
  const ws = { ...entry, wsFrames: [] };
  expect(detailTabsFor(ws)).toEqual(['summary', 'request', 'response', 'body', 'messages']);
  const plainFrame = render(<DetailOverlay entry={entry} tab="summary" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(plainFrame).not.toContain('Messages');
  const wsFrame = render(<DetailOverlay entry={ws} tab="summary" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(stripAnsi(wsFrame)).toContain('5 Messages');
});

test('summary size row surfaces transferred and resource with a compression ratio', () => {
  const lines = detailTabLines({ ...entry, encodedBytes: 2150, decodedBytes: 8600 }, 'summary');
  expect(lines).toContain('  size      2.1kB transferred · 8.4kB resource (75% 압축)');
});

test('summary size row composes the cache note before the resource breakdown', () => {
  const cached = { ...entry, encodedBytes: 0, decodedBytes: 8600, fromCache: 'disk' as const };
  const lines = detailTabLines(cached, 'summary');
  expect(lines).toContain('  size      0B transferred (disk cache) · 8.4kB resource (100% 압축)');
});

test('summary size row stays a single value when resource is absent or equal-ish', () => {
  expect(detailTabLines(entry, 'summary')).toContain('  size      2.1kB');
  const equal = detailTabLines({ ...entry, encodedBytes: 2150, decodedBytes: 2150 }, 'summary');
  expect(equal).toContain('  size      2.1kB');
  expect(equal.join('\n')).not.toContain('transferred');
  const tinyDiff = detailTabLines({ ...entry, encodedBytes: 2150, decodedBytes: 2160 }, 'summary');
  expect(tinyDiff).toContain('  size      2.1kB');
  expect(tinyDiff.join('\n')).not.toContain('resource');
});

test('response tab adds a resource row under size when the decoded size differs', () => {
  const lines = detailTabLines({ ...entry, encodedBytes: 2150, decodedBytes: 8600 }, 'response');
  expect(lines).toContain('  size      2.1kB');
  expect(lines).toContain('  resource  8.4kB');
  expect(detailTabLines(entry, 'response').join('\n')).not.toContain('resource');
});

test('failed status row appends the CORS error name and failed parameter', () => {
  const cors = {
    ...entry, status: undefined, statusText: undefined,
    error: 'net::ERR_FAILED', corsError: 'MissingAllowOriginHeader',
  };
  expect(detailTabLines(cors, 'summary')).toContain('  status    FAIL (net::ERR_FAILED · CORS: MissingAllowOriginHeader)');
  const withParam = { ...cors, corsError: 'DisallowedByMode', corsFailedParameter: 'https://evil.test' };
  expect(detailTabLines(withParam, 'summary').join('\n'))
    .toContain('FAIL (net::ERR_FAILED · CORS: DisallowedByMode (https://evil.test))');
  const blocked = { ...cors, corsError: undefined, blockedReason: 'mixed-content' };
  expect(detailTabLines(blocked, 'summary').join('\n')).toContain('FAIL (net::ERR_FAILED · blocked: mixed-content)');
  expect(detailTabLines({ ...entry, error: 'net::ERR_FAILED' }, 'summary'))
    .toContain('  status    FAIL (net::ERR_FAILED)');
});

const b64url = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
const makeJwt = (header: unknown, payload: unknown): string => `${b64url(header)}.${b64url(payload)}.fake-sig`;

test('request tab decodes a bearer JWT into a section with alg, claims, and exp countdown', () => {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  const jwt = makeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'user-1', exp, scope: { read: true } });
  const lines = detailTabLines({ ...entry, requestHeaders: { authorization: `Bearer ${jwt}` } }, 'request');
  const text = lines.join('\n');
  expect(text).toContain('▍ JWT · Authorization');
  expect(text).toContain('alg   HS256');
  expect(text).toContain('typ   JWT');
  expect(text).toContain('sub   user-1');
  expect(text).toContain('scope {"read":true}');
  const expLine = lines.find(l => l.trimStart().startsWith('exp'))!;
  expect(expLine).toMatch(/exp {3}\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(2h 후 만료\)/);
});

test('an expired JWT renders the exp row in red', () => {
  const exp = Math.floor(Date.now() / 1000) - 3 * 86400;
  const jwt = makeJwt({ alg: 'HS256' }, { exp });
  const e = { ...entry, requestHeaders: { authorization: `Bearer ${jwt}` } };
  const rich = detailTabRich(e, 'request', 100);
  const expRow = rich.find(l => l.text.includes('만료됨'))!;
  expect(expRow.text).toContain('(3d 전 만료됨)');
  expect(expRow.segs!.some(s => s.color === 'red')).toBe(true);
  const freshExp = Math.floor(Date.now() / 1000) + 7200;
  const fresh = { ...entry, requestHeaders: { authorization: `Bearer ${makeJwt({ alg: 'HS256' }, { exp: freshExp })}` } };
  const freshRow = detailTabRich(fresh, 'request', 100).find(l => l.text.includes('만료'))!;
  expect(freshRow.segs!.some(s => s.color === 'red')).toBe(false);
});

test('request tab surfaces a JWT stored in a cookie under its cookie name', () => {
  const jwt = makeJwt({ alg: 'RS256', typ: 'JWT' }, { sub: 'cookie-user' });
  const lines = detailTabLines({ ...entry, requestHeaders: { cookie: `theme=dark; session=${jwt}` } }, 'request');
  const text = lines.join('\n');
  expect(text).toContain('▍ JWT · session');
  expect(text).toContain('cookie-user');
});

test('malformed bearer tokens produce no JWT section', () => {
  const noJwt = detailTabLines({ ...entry, requestHeaders: { authorization: 'Bearer eyJbroken.token' } }, 'request');
  expect(noJwt.join('\n')).not.toContain('▍ JWT');
  expect(detailTabLines(entry, 'request').join('\n')).not.toContain('▍ JWT');
});

test('response tab lists set-cookie JWTs after the set-cookie section', () => {
  const jwt = makeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'sc-user' });
  const lines = detailTabLines({ ...entry, setCookies: [`auth=${jwt}; Path=/; HttpOnly`] }, 'response');
  const text = lines.join('\n');
  expect(lines.findIndex(l => l.startsWith('▍ JWT · auth'))).toBeGreaterThan(lines.findIndex(l => l.startsWith('▍ set-cookie')));
  expect(text).toContain('sub sc-user');
  expect(detailTabLines(entry, 'response').join('\n')).not.toContain('▍ JWT');
});

test('messages tab renders frames newest-last with direction glyphs and timestamps', () => {
  const ts = new Date(2024, 0, 1, 12, 34, 56, 789).getTime();
  const ws = {
    ...entry,
    wsFrames: [
      { dir: 'sent' as const, opcode: 1, payload: 'ping', ts },
      { dir: 'received' as const, opcode: 1, payload: 'pong\nline2', ts },
      { dir: 'received' as const, opcode: 2, payload: 'AAAA', ts },
      { dir: 'error' as const, opcode: 0, payload: 'boom', ts },
    ],
  };
  const lines = detailTabLines(ws, 'messages');
  expect(lines[0]).toBe('▍ messages · 4');
  expect(lines[1]).toBe('  12:34:56.789 ↑ ping');
  expect(lines[2]).toBe('  12:34:56.789 ↓ pong line2');
  expect(lines[3]).toBe('  12:34:56.789 ↓ [binary] AAAA');
  expect(lines[4]).toBe('  12:34:56.789 ✖ boom');
  expect(detailTabLines({ ...ws, wsFrames: [] }, 'messages')).toEqual(['no messages']);
  const frame = render(<DetailOverlay entry={ws} tab="messages" scroll={0} height={12} width={80} />).lastFrame()!;
  expect(frame).toContain('↑ ping');
  expect(frame).toContain('✖ boom');
});

test('messages tab filters frames by payload text', () => {
  const ts = new Date(2024, 0, 1, 12, 34, 56, 789).getTime();
  const ws = {
    ...entry,
    wsFrames: [
      { dir: 'sent' as const, opcode: 1, payload: 'ping', ts },
      { dir: 'received' as const, opcode: 1, payload: 'PONG', ts },
    ],
  };
  const lines = detailTabLines(ws, 'messages', 80, 'pong');
  expect(lines[0]).toBe('▍ messages · 1/2');
  expect(lines[1]).toBe('  12:34:56.789 ↓ PONG');
  expect(lines.length).toBe(2);
  expect(detailTabLines(ws, 'messages', 80, 'nope')).toEqual(['▍ messages · 0/2', '  no matching frames']);
});

test('messages tab states truncation when older frames were dropped', () => {
  const ws = {
    ...entry,
    wsFrames: [{ dir: 'sent' as const, opcode: 1, payload: 'ping', ts: 0 }],
    wsFramesDropped: 12,
  };
  const lines = detailTabLines(ws, 'messages');
  expect(lines[1]).toBe('  … 12 older frames dropped (cap 500)');
  expect(detailTabLines({ ...ws, wsFramesDropped: undefined }, 'messages').some(l => l.includes('dropped'))).toBe(false);
});

const secEntry: NetworkEntry = {
  ...entry,
  securityState: 'secure',
  securityDetails: {
    protocol: 'TLS 1.3', keyExchangeGroup: 'X25519', cipher: 'AES_128_GCM',
    subjectName: 'api.test', issuer: 'R11',
    validFrom: Math.floor(Date.now() / 1000) - 86_400,
    validTo: Math.floor(Date.now() / 1000) + 30 * 86_400,
    sanList: ['api.test', '*.test'],
  },
};

test('summary shows a security section with tls, cert, validity, and SAN', () => {
  const lines = detailTabLines(secEntry, 'summary');
  expect(lines).toContain('▍ security · secure');
  expect(lines).toContain('  protocol  TLS 1.3 · X25519 · AES_128_GCM');
  expect(lines).toContain('  cert      api.test · issuer R11');
  const valid = lines.find(l => l.startsWith('  valid'));
  expect(valid).toMatch(/→/);
  expect(valid).toContain(t('detail.jwt.expiresIn', { t: '30d' }));
  expect(lines).toContain('  SAN       api.test, *.test');
  expect(detailTabLines(entry, 'summary').some(l => l.includes('▍ security'))).toBe(false);
});

test('security state line shows even when securityDetails is absent', () => {
  const lines = detailTabLines({ ...entry, securityState: 'insecure', securityDetails: undefined }, 'summary');
  expect(lines).toContain('▍ security · insecure');
  expect(lines.some(l => l.startsWith('  protocol'))).toBe(false);
});

test('security validity turns red once the certificate is expired', () => {
  const expired = {
    ...secEntry,
    securityDetails: { ...secEntry.securityDetails!, validTo: Math.floor(Date.now() / 1000) - 3 * 86_400 },
  };
  const rich = detailTabRich(expired, 'summary');
  const valid = rich.find(l => l.text.startsWith('  valid'));
  expect(valid?.text).toContain(t('detail.jwt.expired', { t: '3d' }));
  expect(valid?.segs?.some(s => s.color === 'red')).toBe(true);
});

test('keyExchange is included when present and securityState may be absent', () => {
  const withKx = {
    ...secEntry,
    securityState: undefined,
    securityDetails: { ...secEntry.securityDetails!, keyExchange: 'ECDHE_RSA', keyExchangeGroup: undefined },
  };
  const lines = detailTabLines(withKx, 'summary');
  expect(lines).toContain('▍ security');
  expect(lines).toContain('  protocol  TLS 1.3 · ECDHE_RSA · AES_128_GCM');
});
