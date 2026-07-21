import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PeekOverlay, PEEK_HEIGHT } from '../src/tui/overlays/PeekOverlay.js';
import type { NetworkEntry } from '../src/store/types.js';

const entry: NetworkEntry = {
  id: 'r1', url: 'https://api.test/data', method: 'POST', type: 'XHR',
  status: 200, statusText: 'OK', mimeType: 'application/json',
  requestHeaders: {}, responseHeaders: {},
  startTs: 0, durationMs: 142, encodedBytes: 2150,
  body: '{"ok":true}',
};

const lineCount = (el: React.JSX.Element) => render(el).lastFrame()!.split('\n').length;

test('short URL entry renders exactly PEEK_HEIGHT rows', () => {
  expect(lineCount(<PeekOverlay entry={entry} />)).toBe(PEEK_HEIGHT);
});

test('very long URL is clipped to PEEK_HEIGHT with an ellipsis on the last URL row', () => {
  const url = 'https://api.test/' + 'segment/'.repeat(60) + 'end';
  const long = { ...entry, url };
  const frame = render(<PeekOverlay entry={long} width={40} />).lastFrame()!;
  expect(frame.split('\n').length).toBe(PEEK_HEIGHT);
  expect(frame).toContain('…');
});

test('failed and pending entries stay exactly PEEK_HEIGHT rows', () => {
  const failed = { ...entry, status: undefined, statusText: undefined, error: 'net::ERR_FAILED' };
  const pending = { ...entry, status: undefined, statusText: undefined, error: undefined, body: undefined };
  expect(lineCount(<PeekOverlay entry={failed} />)).toBe(PEEK_HEIGHT);
  expect(lineCount(<PeekOverlay entry={pending} />)).toBe(PEEK_HEIGHT);
  expect(render(<PeekOverlay entry={failed} />).lastFrame()).toContain('FAIL (net::ERR_FAILED)');
  expect(render(<PeekOverlay entry={pending} />).lastFrame()).toContain('pending');
});

test('URL chunks contain the middle of a long URL rather than truncating early', () => {
  const url = 'https://api.test/' + Array.from({ length: 25 }, (_, i) => `k${i}=v${i}`).join('&');
  const frame = render(<PeekOverlay entry={{ ...entry, url }} />).lastFrame()!;
  expect(frame).toContain('k18=v18');
  expect(frame).not.toContain('…');
});

test('shows method, status, type, mime, timing and size', () => {
  const frame = render(<PeekOverlay entry={entry} />).lastFrame()!;
  expect(frame).toContain('POST');
  expect(frame).toContain('200 OK');
  expect(frame).toContain('XHR');
  expect(frame).toContain('application/json');
  expect(frame).toContain('time 142ms');
  expect(frame).toContain('size 2.1kB');
  expect(frame).toContain('body captured');
});

test('shows the Network-list Name of the request', () => {
  const frame = render(<PeekOverlay entry={{ ...entry, url: 'https://api.test/v2/users/profile.json' }} />).lastFrame()!;
  expect(frame).toContain('profile.json');
});

test('shows the derived Name even when the full URL is clipped', () => {
  const url = 'https://api.test/' + 'segment/'.repeat(60) + 'finale.json';
  const frame = render(<PeekOverlay entry={{ ...entry, url }} width={40} />).lastFrame()!;
  expect(frame).toContain('finale.json');
});

test('shows the gql operation name instead of the URL-derived Name', () => {
  const frame = render(<PeekOverlay entry={{ ...entry, url: 'https://api.test/graphql', gqlOperation: 'FetchViewer' }} />).lastFrame()!;
  expect(frame).toContain('gql·FetchViewer');
});

test('omits the body-captured marker when no body was captured', () => {
  const frame = render(<PeekOverlay entry={{ ...entry, body: undefined }} />).lastFrame()!;
  expect(frame).not.toContain('body captured');
});
