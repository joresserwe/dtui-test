import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { NetworkPanel, cookieCount, filterEntries, nameOf, parseNetFilter, sortNetEntries, waterfall, waterfallCells } from '../src/tui/panels/NetworkPanel.js';
import { buildNetGroups, groupSelectable } from '../src/tui/lib/net-group.js';
import type { NetworkEntry } from '../src/store/types.js';

const entry = (over: Partial<NetworkEntry>): NetworkEntry => ({
  id: 'x', url: 'https://a.test/api', method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {}, startTs: 0,
  status: 200, statusText: 'OK', durationMs: 142, encodedBytes: 2150,
  ...over,
});

const lineCount = (frame: string): number => frame.split('\n').length;

test('filterEntries filters by type and url substring', () => {
  const es = [
    entry({ id: '1', type: 'XHR' }),
    entry({ id: '2', type: 'Fetch', url: 'https://a.test/data' }),
    entry({ id: '3', type: 'Image', url: 'https://a.test/pic.png' }),
    entry({ id: '4', type: 'Document' }),
  ];
  expect(filterEntries(es, 'xhr', '').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'img', '').map(e => e.id)).toEqual(['3']);
  expect(filterEntries(es, 'all', 'PIC').map(e => e.id)).toEqual(['3']);
});

test('filterEntries maps js, css and ws type filters', () => {
  const es = [
    entry({ id: '1', type: 'Script' }),
    entry({ id: '2', type: 'Stylesheet' }),
    entry({ id: '3', type: 'WebSocket' }),
    entry({ id: '4', type: 'XHR' }),
  ];
  expect(filterEntries(es, 'js', '').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'css', '').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'ws', '').map(e => e.id)).toEqual(['3']);
});

test('filterEntries accepts a multi-type list; empty or 모두 means all', () => {
  const es = [
    entry({ id: '1', type: 'XHR' }),
    entry({ id: '2', type: 'Script' }),
    entry({ id: '3', type: 'Image' }),
    entry({ id: '4', type: 'Stylesheet' }),
  ];
  expect(filterEntries(es, ['xhr', 'js'], '').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, ['css'], '').map(e => e.id)).toEqual(['4']);
  expect(filterEntries(es, [], '').map(e => e.id)).toEqual(['1', '2', '3', '4']);
  expect(filterEntries(es, ['all', 'xhr'], '').map(e => e.id)).toEqual(['1', '2', '3', '4']);
});

test('sortNetEntries sorts by time, size, status and name in both directions', () => {
  const es = [
    entry({ id: '1', durationMs: 300, encodedBytes: 10, status: 500, url: 'https://a.test/bbb' }),
    entry({ id: '2', durationMs: 100, encodedBytes: 30, status: 200, url: 'https://a.test/ccc' }),
    entry({ id: '3', durationMs: 200, encodedBytes: 20, status: 404, url: 'https://a.test/aaa' }),
  ];
  expect(sortNetEntries(es, 'time', 'asc').map(e => e.id)).toEqual(['2', '3', '1']);
  expect(sortNetEntries(es, 'time', 'desc').map(e => e.id)).toEqual(['1', '3', '2']);
  expect(sortNetEntries(es, 'size', 'asc').map(e => e.id)).toEqual(['1', '3', '2']);
  expect(sortNetEntries(es, 'status', 'asc').map(e => e.id)).toEqual(['2', '3', '1']);
  expect(sortNetEntries(es, 'name', 'asc').map(e => e.id)).toEqual(['3', '1', '2']);
  expect(sortNetEntries(es, 'name', 'desc').map(e => e.id)).toEqual(['2', '1', '3']);
});

test('sortNetEntries keeps arrival order untouched, is stable, and puts pending values first ascending', () => {
  const es = [
    entry({ id: '1', durationMs: 100 }),
    entry({ id: '2', durationMs: undefined }),
    entry({ id: '3', durationMs: 100 }),
  ];
  expect(sortNetEntries(es, 'arrival', 'desc')).toBe(es);
  expect(sortNetEntries(es, 'time', 'asc').map(e => e.id)).toEqual(['2', '1', '3']);
  expect(sortNetEntries(es, 'time', 'desc').map(e => e.id)).toEqual(['1', '3', '2']);
});

test('cookieCount counts request cookie header pairs case-insensitively', () => {
  expect(cookieCount(entry({ requestHeaders: { Cookie: 'a=1; b=2; c=3' } }))).toBe(3);
  expect(cookieCount(entry({ requestHeaders: { cookie: 'sid=x' } }))).toBe(1);
  expect(cookieCount(entry({ requestHeaders: {} }))).toBe(0);
  expect(cookieCount(entry({ requestHeaders: { Cookie: '' } }))).toBe(0);
});

test('nameOf derives the last path segment plus query, with host context', () => {
  expect(nameOf('https://a.test/api/users')).toEqual({ name: 'users', context: 'a.test/api' });
  expect(nameOf('https://a.test/live-status')).toEqual({ name: 'live-status', context: 'a.test' });
  expect(nameOf('https://a.test/api/users/')).toEqual({ name: 'users', context: 'a.test/api' });
  expect(nameOf('https://a.test/')).toEqual({ name: 'a.test', context: 'a.test' });
  expect(nameOf('https://a.test')).toEqual({ name: 'a.test', context: 'a.test' });
  expect(nameOf('https://a.test/users?page=1')).toEqual({ name: 'users?page=1', context: 'a.test' });
  expect(nameOf('not a url')).toEqual({ name: 'not a url', context: '' });
});

test('renders a header and rows with status, time, size, name and failure marker', () => {
  const es = [
    entry({ id: '1' }),
    entry({ id: '2', status: undefined, statusText: undefined, durationMs: undefined, error: 'net::ERR_FAILED', url: 'https://a.test/broken' }),
  ];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).toContain('Name');
  expect(frame).not.toContain('╭');
  expect(frame).toContain('200');
  expect(frame).toContain('142ms');
  expect(frame).toContain('2.1kB');
  expect(frame).toContain('api');
  expect(frame).toContain('FAIL');
  expect(frame).toContain('broken');
});

test('status cell shows CORS instead of FAIL when a corsError is present', () => {
  const es = [
    entry({ id: '1', status: undefined, error: 'net::ERR_FAILED', corsError: 'MissingAllowOriginHeader', url: 'https://a.test/cors' }),
    entry({ id: '2', status: undefined, error: 'net::ERR_FAILED', url: 'https://a.test/plain' }),
  ];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} />);
  const frame = lastFrame()!;
  const corsLine = frame.split('\n').find(l => l.includes('cors'))!;
  expect(corsLine).toContain('CORS');
  expect(corsLine).not.toContain('FAIL');
  expect(frame.split('\n').find(l => l.includes('plain'))!).toContain('FAIL');
});

test('renders graphql entries with a gql-prefixed operation name in the Name cell', () => {
  const es = [
    entry({ id: '1', method: 'POST', url: 'https://a.test/graphql', gqlOperation: 'FetchViewer' }),
    entry({ id: '2', method: 'POST', url: 'https://a.test/graphql' }),
  ];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} width={100} />);
  const frame = lastFrame()!;
  expect(frame).toContain('gql·FetchViewer');
  expect(frame.split('\n').filter(l => l.includes('graphql')).length).toBe(1);
});

test('URL column mode keeps the raw URL for graphql entries', () => {
  const es = [entry({ id: '1', method: 'POST', url: 'https://a.test/graphql', gqlOperation: 'FetchViewer' })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={100} columns={['status', 'url']} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('https://a.test/graphql');
  expect(frame).not.toContain('gql·');
});

test('marks the selected row with a cyan bar in the gutter', () => {
  const es = [entry({ id: '1' }), entry({ id: '2', url: 'https://a.test/two' })];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={1} focused height={8} />);
  const frame = lastFrame()!;
  const barLine = frame.split('\n').find(l => l.includes('two'))!;
  expect(barLine.startsWith('▌')).toBe(true);
  expect(frame.split('\n').find(l => l.includes('api'))!.startsWith('▌')).toBe(false);
});

test('omits the selection bar when the panel is unfocused', () => {
  const es = [entry({ id: '1' })];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused={false} height={8} />);
  expect(lastFrame()).not.toContain('▌');
});

test('marks a marked row with a diamond in the gutter; the focused selection bar wins over the mark', () => {
  const es = [entry({ id: '1' }), entry({ id: '2', url: 'https://a.test/two' }), entry({ id: '3', url: 'https://a.test/three' })];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} marked={new Set(['2'])} />);
  const frame = lastFrame()!;
  const line = (needle: string) => frame.split('\n').find(l => l.includes(needle))!;
  expect(line('two').startsWith('◆')).toBe(true);
  expect(line('three').startsWith('◆')).toBe(false);
  expect(line('api').startsWith('▌')).toBe(true);
});

test('scrolls to keep the selected row visible', () => {
  const es = Array.from({ length: 20 }, (_, i) => entry({ id: String(i), url: `https://a.test/row${i}` }));
  const { lastFrame } = render(<NetworkPanel entries={es} selected={19} focused height={8} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).toContain('row19');
  expect(frame).not.toContain('row0');
});

test('keeps the first row visible when selection is at the start', () => {
  const es = Array.from({ length: 20 }, (_, i) => entry({ id: String(i), url: `https://a.test/row${i}` }));
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).toContain('row0');
  expect(frame).not.toContain('row19');
});

test('renders exactly height rows when empty, showing the placeholder', () => {
  const { lastFrame } = render(<NetworkPanel entries={[]} selected={0} focused={false} height={8} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).toContain('요청 없음');
});

test('renders exactly height rows across sizes and selection states', () => {
  const es = Array.from({ length: 30 }, (_, i) => entry({ id: String(i), url: `https://a.test/row${i}` }));
  for (const height of [6, 8, 12, 20]) {
    for (const selected of [0, 5, 15, 29]) {
      const { lastFrame } = render(<NetworkPanel entries={es} selected={selected} focused height={height} />);
      expect(lineCount(lastFrame()!)).toBe(height);
    }
  }
});

test('filterEntries applies a time window', () => {
  const es = [entry({ id: '1', startTs: 1000 }), entry({ id: '2', startTs: 5000 })];
  expect(filterEntries(es, 'all', '', 3000).map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', '').map(e => e.id)).toEqual(['1', '2']);
});

test('filter language: status exact, wildcard and fail', () => {
  const es = [
    entry({ id: '1', status: 200 }),
    entry({ id: '2', status: 404 }),
    entry({ id: '3', status: 500 }),
    entry({ id: '4', status: undefined, error: 'net::ERR_FAILED' }),
  ];
  expect(filterEntries(es, 'all', 'status:404').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'status:4xx').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'status:5xx').map(e => e.id)).toEqual(['3']);
  expect(filterEntries(es, 'all', 'status:fail').map(e => e.id)).toEqual(['2', '3', '4']);
});

test('filter language: method, type, mime', () => {
  const es = [
    entry({ id: '1', method: 'GET', type: 'XHR', mimeType: 'application/json' }),
    entry({ id: '2', method: 'POST', type: 'Fetch', mimeType: 'text/html' }),
    entry({ id: '3', method: 'GET', type: 'Image', mimeType: 'image/png' }),
    entry({ id: '4', method: 'GET', type: 'Script', mimeType: 'application/javascript' }),
  ];
  expect(filterEntries(es, 'all', 'method:post').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'type:xhr').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', 'type:img').map(e => e.id)).toEqual(['3']);
  expect(filterEntries(es, 'all', 'type:js').map(e => e.id)).toEqual(['4']);
  expect(filterEntries(es, 'all', 'mime:json').map(e => e.id)).toEqual(['1']);
});

test('filter language: domain matches the hostname exactly, with wildcards and negation', () => {
  const es = [
    entry({ id: '1', url: 'https://example.com/api' }),
    entry({ id: '2', url: 'https://sub.example.com/api' }),
    entry({ id: '3', url: 'https://deep.sub.example.com/api' }),
    entry({ id: '4', url: 'https://other.test/x' }),
    entry({ id: '5', url: 'not a url' }),
  ];
  expect(filterEntries(es, 'all', 'domain:example.com').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', 'domain:*.example.com').map(e => e.id)).toEqual(['1', '2', '3']);
  expect(filterEntries(es, 'all', 'domain:*.EXAMPLE.com').map(e => e.id)).toEqual(['1', '2', '3']);
  expect(filterEntries(es, 'all', 'domain:sub.*.com').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', '-domain:*.example.com').map(e => e.id)).toEqual(['4', '5']);
  expect(filterEntries(es, 'all', 'domain:*.example.com api').map(e => e.id)).toEqual(['1', '2', '3']);
  expect(filterEntries(es, 'all', 'domain:nope.example.com').map(e => e.id)).toEqual([]);
  expect(parseNetFilter('domain:example.com')[0].kind).toBe('domain');
});

test('filter language: gql matches operation-name substring and bare gql: matches any graphql request', () => {
  const es = [
    entry({ id: '1', method: 'POST', url: 'https://a.test/graphql', gqlOperation: 'FetchViewer' }),
    entry({ id: '2', method: 'POST', url: 'https://a.test/graphql', gqlOperation: 'SaveWidget' }),
    entry({ id: '3', method: 'POST', url: 'https://a.test/api/rest' }),
  ];
  expect(filterEntries(es, 'all', 'gql:fetchviewer').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', 'gql:widget').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'gql:').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', '-gql:').map(e => e.id)).toEqual(['3']);
  expect(parseNetFilter('gql:FetchViewer')[0].kind).toBe('gql');
});

test('filter language: duration and size comparisons', () => {
  const es = [
    entry({ id: '1', durationMs: 100, encodedBytes: 5 * 1024 }),
    entry({ id: '2', durationMs: 800, encodedBytes: 20 * 1024 }),
    entry({ id: '3', durationMs: 2000, encodedBytes: 2 * 1_048_576 }),
    entry({ id: '4', durationMs: undefined, encodedBytes: undefined }),
  ];
  expect(filterEntries(es, 'all', '>500ms').map(e => e.id)).toEqual(['2', '3']);
  expect(filterEntries(es, 'all', '<200ms').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', '>1s').map(e => e.id)).toEqual(['3']);
  expect(filterEntries(es, 'all', '>10kb').map(e => e.id)).toEqual(['2', '3']);
  expect(filterEntries(es, 'all', '<1mb').map(e => e.id)).toEqual(['1', '2']);
});

test('filter language: negation, AND and backward-compat substring', () => {
  const es = [
    entry({ id: '1', url: 'https://a.test/api/users', method: 'GET', status: 200 }),
    entry({ id: '2', url: 'https://a.test/api/posts', method: 'POST', status: 201 }),
    entry({ id: '3', url: 'https://a.test/static/logo.png', type: 'Image', status: 404 }),
  ];
  expect(filterEntries(es, 'all', 'api').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', 'API').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', 'api -users').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'api method:post').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', '-status:200').map(e => e.id)).toEqual(['2', '3']);
});

test('parseNetFilter tokenizes and never throws on junk', () => {
  expect(parseNetFilter('')).toEqual([]);
  expect(parseNetFilter('   ')).toEqual([]);
  const toks = parseNetFilter('api -users status:4xx');
  expect(toks.map(t => t.kind)).toEqual(['text', 'text', 'status']);
  expect(toks[1].negate).toBe(true);
  expect(() => parseNetFilter('status: >>> :::')).not.toThrow();
  expect(parseNetFilter('status:zzz')[0].kind).toBe('text');
});

test('filter language: is:from-cache matches cached entries only', () => {
  const es = [
    entry({ id: '1', fromCache: 'disk' }),
    entry({ id: '2', fromCache: 'memory' }),
    entry({ id: '3' }),
  ];
  expect(filterEntries(es, 'all', 'is:from-cache').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', 'is:cached').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', '-is:from-cache').map(e => e.id)).toEqual(['3']);
  expect(parseNetFilter('is:from-cache')[0].kind).toBe('cache');
});

test('filter language: has-response-header matches header names case-insensitively', () => {
  const es = [
    entry({ id: '1', responseHeaders: { ETag: 'W/"x"' } }),
    entry({ id: '2', responseHeaders: { 'content-type': 'text/html' } }),
  ];
  expect(filterEntries(es, 'all', 'has-response-header:etag').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', 'has-response-header:content-type').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'has-response-header:missing').map(e => e.id)).toEqual([]);
  expect(parseNetFilter('has-response-header:etag')[0].kind).toBe('header');
});

test('filter language: priority matches full name, prefix and abbreviation', () => {
  const es = [
    entry({ id: '1', priority: 'VeryHigh' }),
    entry({ id: '2', priority: 'High' }),
    entry({ id: '3', priority: 'Low' }),
    entry({ id: '4', priority: undefined }),
  ];
  expect(filterEntries(es, 'all', 'priority:high').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'priority:very').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', 'priority:vh').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', 'priority:lo').map(e => e.id)).toEqual(['3']);
  expect(parseNetFilter('priority:high')[0].kind).toBe('priority');
});

test('filter language: scheme matches the URL protocol', () => {
  const es = [
    entry({ id: '1', url: 'https://a.test/x' }),
    entry({ id: '2', url: 'http://a.test/x' }),
    entry({ id: '3', url: 'wss://a.test/ws' }),
  ];
  expect(filterEntries(es, 'all', 'scheme:https').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', 'scheme:http').map(e => e.id)).toEqual(['2']);
  expect(filterEntries(es, 'all', 'scheme:wss').map(e => e.id)).toEqual(['3']);
  expect(parseNetFilter('scheme:https')[0].kind).toBe('scheme');
});

test('filter language: /regex/ matches the URL, negates, and falls back to literal on bad patterns', () => {
  const es = [
    entry({ id: '1', url: 'https://a.test/users/42' }),
    entry({ id: '2', url: 'https://a.test/users/abc' }),
    entry({ id: '3', url: 'https://a.test/posts' }),
  ];
  expect(filterEntries(es, 'all', '/users\\/\\d+/').map(e => e.id)).toEqual(['1']);
  expect(filterEntries(es, 'all', '/USERS/').map(e => e.id)).toEqual(['1', '2']);
  expect(filterEntries(es, 'all', '-/users/').map(e => e.id)).toEqual(['3']);
  expect(parseNetFilter('/users/')[0].kind).toBe('regex');
  const bad = parseNetFilter('/(/');
  expect(bad[0].kind).toBe('text');
  expect(() => filterEntries(es, 'all', '/(/')).not.toThrow();
});

test('waterfall math: position, length, pending and zero span', () => {
  expect(waterfall(entry({ startTs: 0, durationMs: 50 }), 0, 100)).toHaveLength(12);
  expect(waterfall(entry({ startTs: 0, durationMs: 50 }), 0, 100)).toBe('██████      ');
  expect(waterfall(entry({ startTs: 100, durationMs: 100 }), 0, 100)).toBe('           █');
  const pending = waterfall(entry({ startTs: 50, durationMs: undefined }), 0, 100);
  expect(pending).toHaveLength(12);
  expect(pending[6]).toBe('·');
  expect(pending.includes('█')).toBe(false);
  expect(waterfall(entry({ startTs: 0, durationMs: 0 }), 0, 0)).toBe('█           ');
  expect(waterfall(entry({ startTs: 0, durationMs: undefined }), 0, 0)).toBe('·           ');
});

test('waterfallCells fills full-span, sub-cell edges, tiny spans and clamps', () => {
  expect(waterfallCells(0, 1, 12)).toBe('█'.repeat(12));
  expect(waterfallCells(0, 0.5, 4)).toBe('██  ');
  expect(waterfallCells(0, 0.625, 4)).toBe('██▌ ');
  expect(waterfallCells(0.125, 1, 4)).toBe('▌███');
  const tiny = waterfallCells(0.5, 0.5001, 8);
  expect(tiny).toHaveLength(8);
  expect(tiny.replace(/ /g, '')).not.toBe('');
  const zero = waterfallCells(0.5, 0.5, 8);
  expect(zero).toBe('    █   ');
  expect(waterfallCells(-1, 2, 4)).toBe('████');
  expect(waterfallCells(0, 1, 0)).toBe('');
});

const headerLine = (frame: string): string => frame.split('\n').find(l => l.includes('Name')) ?? '';

const blockCount = (frame: string): number => (frame.match(/█/g) ?? []).length;

test('surplus terminal width widens the waterfall column while a narrow terminal collapses it first', () => {
  const es = [entry({ id: '1', startTs: 0, durationMs: 100 })];
  const bars = (width: number): number => {
    const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={4} width={width} />);
    return blockCount(lastFrame()!.split('\n').find(l => l.includes('api'))!);
  };
  expect(bars(100)).toBe(12);
  expect(bars(140)).toBe(40);
  expect(bars(120)).toBeGreaterThan(12);
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={4} width={72} />);
  expect(headerLine(lastFrame()!)).not.toContain('Waterfall');
});

test('responsive columns appear and drop with width', () => {
  const es = [entry({ id: '1' })];
  const at = (width: number): string => {
    const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} width={width} />);
    return headerLine(lastFrame()!);
  };
  const h40 = at(40);
  expect(h40).toContain('Name');
  for (const c of ['Type', 'Time', 'Size', 'Waterfall']) expect(h40).not.toContain(c);
  const h55 = at(55);
  expect(h55).toContain('Time');
  for (const c of ['Type', 'Size', 'Waterfall']) expect(h55).not.toContain(c);
  const h64 = at(64);
  expect(h64).toContain('Type');
  expect(h64).toContain('Time');
  for (const c of ['Size', 'Waterfall']) expect(h64).not.toContain(c);
  const h72 = at(72);
  for (const c of ['Type', 'Time', 'Size']) expect(h72).toContain(c);
  expect(h72).not.toContain('Waterfall');
  const h100 = at(100);
  for (const c of ['Type', 'Time', 'Size', 'Waterfall']) expect(h100).toContain(c);
});

test('waterfall bar renders in rows at wide widths', () => {
  const es = [entry({ id: '1', startTs: 0, durationMs: 100 }), entry({ id: '2', startTs: 100, durationMs: 100 })];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} width={100} />);
  expect(lastFrame()).toContain('█');
});

test('name is truncated to the name budget, with host context alongside', () => {
  const longName = 'x'.repeat(70);
  const es = [entry({ id: '1', url: `https://host.test/${longName}` })];
  const { lastFrame } = render(<NetworkPanel entries={es} selected={0} focused height={8} width={100} />);
  const frame = lastFrame()!;
  expect(frame).toContain('x'.repeat(43) + '…');
  expect(frame).not.toContain('x'.repeat(44));
  expect(frame).toContain('host.t');
});

test('configured columns render method, cookies and host cells', () => {
  const es = [entry({ id: '1', method: 'POST', requestHeaders: { Cookie: 'a=1; b=2' }, url: 'https://host.test/api/users' })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={120}
      columns={['status', 'method', 'cookies', 'host', 'name']} />,
  );
  const frame = lastFrame()!;
  const header = headerLine(frame);
  expect(header).toContain('Meth');
  expect(header).toContain('Ck');
  expect(header).toContain('Host');
  for (const c of ['Type', 'Time', 'Size', 'Waterfall']) expect(header).not.toContain(c);
  expect(frame).toContain('POST');
  expect(frame).toContain('  2 ');
  expect(frame).toContain('host.test');
});

test('the url column replaces the short name with the full URL', () => {
  const es = [entry({ id: '1', url: 'https://host.test/api/users?page=2' })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={100} columns={['status', 'url']} />,
  );
  const frame = lastFrame()!;
  expect(frame.split('\n').find(l => l.includes('URL'))).toBeTruthy();
  expect(frame).toContain('https://host.test/api/users?page=2');
});

test('a disabled status column disappears from header and rows', () => {
  const es = [entry({ id: '1' })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={100} columns={['time', 'name']} />,
  );
  const frame = lastFrame()!;
  expect(headerLine(frame)).not.toContain('St');
  expect(frame).not.toContain('200');
  expect(frame).toContain('142ms');
});

test('narrow terminals collapse the lowest-priority enabled columns first', () => {
  const es = [entry({ id: '1' })];
  const at = (width: number): string => {
    const { lastFrame } = render(
      <NetworkPanel entries={es} selected={0} focused height={8} width={width}
        columns={['status', 'time', 'cookies', 'waterfall', 'name']} />,
    );
    return headerLine(lastFrame()!);
  };
  const narrow = at(40);
  expect(narrow).toContain('Name');
  for (const c of ['Time', 'Ck', 'Waterfall']) expect(narrow).not.toContain(c);
  const mid = at(48);
  expect(mid).toContain('Time');
  for (const c of ['Ck', 'Waterfall']) expect(mid).not.toContain(c);
  const wider = at(55);
  expect(wider).toContain('Time');
  expect(wider).toContain('Ck');
  expect(wider).not.toContain('Waterfall');
  const wide = at(120);
  for (const c of ['Time', 'Ck', 'Waterfall']) expect(wide).toContain(c);
});

test('the active sort column header carries a direction arrow', () => {
  const es = [entry({ id: '1' })];
  const at = (sortKey: 'size' | 'time' | 'arrival', sortDir: 'asc' | 'desc'): string => {
    const { lastFrame } = render(
      <NetworkPanel entries={es} selected={0} focused height={8} width={100} sortKey={sortKey} sortDir={sortDir} />,
    );
    return headerLine(lastFrame()!);
  };
  expect(at('size', 'desc')).toContain('Size↓');
  expect(at('size', 'asc')).toContain('Size↑');
  expect(at('time', 'desc')).toContain('Time↓');
  const plain = at('arrival', 'asc');
  expect(plain).not.toContain('↓');
  expect(plain).not.toContain('↑');
});

test('the protocol column renders the protocol and blanks when absent', () => {
  const es = [entry({ id: '1', protocol: 'h2' }), entry({ id: '2', protocol: undefined, url: 'https://a.test/two' })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={100} columns={['status', 'protocol', 'name']} />,
  );
  const frame = lastFrame()!;
  expect(headerLine(frame)).toContain('Proto');
  expect(frame).toContain('h2');
});

test('the priority column abbreviates the CDP priority names', () => {
  const at = (priority: string | undefined): string => {
    const { lastFrame } = render(
      <NetworkPanel entries={[entry({ id: '1', priority })]} selected={0} focused height={8} width={100} columns={['status', 'priority', 'name']} />,
    );
    return lastFrame()!;
  };
  expect(headerLine(at('VeryHigh'))).toContain('Pri');
  expect(at('VeryHigh')).toContain('VH');
  expect(at('High')).toContain('Hi');
  expect(at('Medium')).toContain('Med');
  expect(at('Low')).toContain('Lo');
  expect(at('VeryLow')).toContain('VL');
});

test('the initiator column shows script file:line, reads the top stack frame, and falls back to the type', () => {
  const es = [
    entry({ id: '1', initiator: { type: 'script', url: 'https://cdn.test/app.bundle.js', lineNumber: 42 } }),
    entry({ id: '2', url: 'https://a.test/two', initiator: { type: 'script', stack: [{ functionName: 'f', url: 'https://cdn.test/main.js', lineNumber: 7 }] } }),
    entry({ id: '3', url: 'https://a.test/three', initiator: { type: 'parser' } }),
  ];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={120} columns={['status', 'initiator', 'name']} />,
  );
  const frame = lastFrame()!;
  expect(headerLine(frame)).toContain('Initiator');
  expect(frame).toContain('app.bundle.js:42');
  expect(frame).toContain('main.js:7');
  expect(frame).toContain('parser');
});

test('the set-cookies column counts response cookies and blanks at zero', () => {
  const es = [entry({ id: '1', setCookies: ['a=1', 'b=2'] }), entry({ id: '2', url: 'https://a.test/two' })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={100} columns={['status', 'set-cookies', 'name']} />,
  );
  const frame = lastFrame()!;
  expect(headerLine(frame)).toContain('SC');
  expect(frame).toContain('  2 ');
});

test('the remote column renders ip:port and truncates long addresses', () => {
  const long = '2001:0db8:85a3:0000:0000:8a2e:0370:7334:65535';
  const es = [entry({ id: '1', remoteAddress: '93.184.216.34:443' }), entry({ id: '2', url: 'https://a.test/two', remoteAddress: long })];
  const { lastFrame } = render(
    <NetworkPanel entries={es} selected={0} focused height={8} width={120} columns={['status', 'remote', 'name']} />,
  );
  const frame = lastFrame()!;
  expect(headerLine(frame)).toContain('Remote');
  expect(frame).toContain('93.184.216.34:443');
  expect(frame).not.toContain(long);
  expect(frame).toContain('…');
});

test('the new optional columns collapse before the existing columns as width shrinks', () => {
  const es = [entry({ id: '1', protocol: 'h2', remoteAddress: '10.0.0.1:80' })];
  const at = (width: number): string => {
    const { lastFrame } = render(
      <NetworkPanel entries={es} selected={0} focused height={8} width={width}
        columns={['status', 'host', 'protocol', 'remote', 'name']} />,
    );
    return headerLine(lastFrame()!);
  };
  const narrow = at(60);
  expect(narrow).toContain('Host');
  for (const c of ['Proto', 'Remote']) expect(narrow).not.toContain(c);
  const wide = at(120);
  for (const c of ['Host', 'Proto', 'Remote']) expect(wide).toContain(c);
});

test('domain grouping renders domain headers with counts above their entries at constant height', () => {
  const es = [
    entry({ id: '1', url: 'https://a.test/one' }),
    entry({ id: '2', url: 'https://cdn.test/lib.js' }),
    entry({ id: '3', url: 'https://a.test/two' }),
  ];
  const groups = buildNetGroups(es, 'domain', new Set());
  const { lastFrame } = render(<NetworkPanel entries={es} groups={groups} selected={0} focused height={10} width={100} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(10);
  expect(frame).toContain('a.test (2)');
  expect(frame).toContain('cdn.test (1)');
  expect(frame).toContain('▾');
  expect(frame).toContain('one');
  expect(frame).toContain('lib.js');
});

test('a collapsed domain group folds to a header and hides its entries', () => {
  const es = [
    entry({ id: '1', url: 'https://a.test/one' }),
    entry({ id: '2', url: 'https://cdn.test/lib.js' }),
  ];
  const groups = buildNetGroups(es, 'domain', new Set(['cdn.test']));
  const visible = groupSelectable(groups);
  const { lastFrame } = render(<NetworkPanel entries={visible} groups={groups} selected={0} focused height={8} width={100} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).toContain('▸');
  expect(frame).toContain('cdn.test (1)');
  expect(frame).not.toContain('lib.js');
  expect(frame).toContain('one');
});

test('holds the exact-height contract at narrow widths without border glyphs', () => {
  const es = Array.from({ length: 12 }, (_, i) => entry({ id: String(i), url: `https://a.test/row${i}` }));
  for (const width of [40, 55, 72]) {
    for (const height of [6, 8, 12]) {
      const { lastFrame } = render(<NetworkPanel entries={es} selected={3} focused height={height} width={width} />);
      const frame = lastFrame()!;
      expect(lineCount(frame)).toBe(height);
      expect(frame).not.toContain('╭');
      expect(frame).not.toContain('│');
    }
  }
});
