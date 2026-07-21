import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ArchiveApp } from '../src/tui/ArchiveApp.js';
import type { NetworkEntry, ConsoleEntry } from '../src/store/types.js';
import { waitForFrame } from './helpers/wait-for.js';

const network: NetworkEntry[] = [
  { id: 'r1', url: 'https://a.test/api', method: 'GET', type: 'XHR', requestHeaders: {}, responseHeaders: {}, startTs: 1, status: 200, durationMs: 42 },
];
const console: ConsoleEntry[] = [{ kind: 'error', text: 'archived-error', ts: 2 }];
const consoleMixed: ConsoleEntry[] = [
  {
    kind: 'error', text: 'archived-error', ts: 2,
    url: 'https://a.test/app.js', line: 7,
    stack: '    at archived (https://a.test/app.js:7)',
  },
  { kind: 'warn', text: 'archived-warn', ts: 3 },
  { kind: 'log', text: 'archived-log', ts: 4 },
];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ESC = '';
const CTRL_D = '';
const CTRL_U = '';

function manyRows(n: number): NetworkEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`, url: `https://a.test/row${i}`, method: 'GET', type: 'XHR' as const,
    requestHeaders: {}, responseHeaders: {}, startTs: i + 1, status: 200, durationMs: 10,
  }));
}

test('renders the archive header, tool bar, and network read-only', () => {
  const { lastFrame } = render(<ArchiveApp data={{ network, console, meta: { url: 'https://a.test/' } }} />);
  const frame = lastFrame()!;
  expect(frame).toContain('▸ archive: https://a.test/');
  expect(frame).toContain('1 Network');
  expect(frame).toContain('2 Console');
  const rawLines = frame.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
  expect(rawLines.some(l => /^─+$/.test(l))).toBe(true);
  expect(frame).not.toContain('╯');
  expect(frame).not.toContain('╰');
  expect(frame).toContain('api');
  expect(frame).toContain('q 종료');
});

test('renders a limitation line when provided', () => {
  const { lastFrame } = render(<ArchiveApp data={{ network, console }} limitation="bodies not archived" />);
  expect(lastFrame()).toContain('bodies not archived');
});

test('the frame is a constant-height full screen', () => {
  const { lastFrame } = render(<ArchiveApp data={{ network, console }} />);
  expect(lastFrame()!.split('\n').length).toBe(23);
});

test('1 and 2 switch between the Network and Console tools', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  expect(lastFrame()).toContain('api');
  stdin.write('2');
  await waitForFrame(lastFrame, 'archived-error');
  stdin.write('1');
  await waitForFrame(lastFrame, 'api');
});

test('Tab does not switch tools', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  expect(lastFrame()).toContain('api');
  stdin.write('\t');
  await sleep(40);
  expect(lastFrame()).toContain('api');
  expect(lastFrame()).not.toContain('archived-error');
});

test('2 switches to the Console tool', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  stdin.write('2');
  await waitForFrame(lastFrame, 'archived-error');
});

test('Enter opens the detail overlay on the focused network row', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  stdin.write('1');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/api');
});

test('an archived WebSocket entry exposes the Messages tab (5)', async () => {
  const ws: NetworkEntry = {
    id: 'ws1', url: 'wss://a.test/sock', method: 'GET', type: 'WebSocket',
    requestHeaders: {}, responseHeaders: {}, startTs: 1,
    wsFrames: [{ dir: 'received', opcode: 1, payload: 'pong-frame', ts: 2 }],
  };
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network: [ws], console }} />);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('Messages');
  stdin.write('5');
  await waitForFrame(lastFrame, 'pong-frame');
});

test('detail overlay switches tabs and closes on Esc', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toMatch(/type\s+XHR/);
  stdin.write('3');
  await sleep(30);
  expect(lastFrame()).not.toContain('XHR');
  expect(lastFrame()).toMatch(/status\s+200/);
  stdin.write(ESC);
  await sleep(30);
  expect(lastFrame()).not.toContain('Summary');
});

test('G jumps to the bottom and Enter opens that row', async () => {
  const rows = manyRows(6);
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network: rows, console }} />);
  await sleep(30);
  stdin.write('G');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/row5');
});

test('gg returns to the top row', async () => {
  const rows = manyRows(6);
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network: rows, console }} />);
  await sleep(30);
  stdin.write('G');
  await sleep(30);
  stdin.write('gg');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/row0');
});

test('Ctrl-d and Ctrl-u page through the network list', async () => {
  const rows = manyRows(20);
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network: rows, console }} />);
  await sleep(30);
  stdin.write(CTRL_D);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).not.toContain('a.test/row0');
  stdin.write(ESC);
  await sleep(30);
  stdin.write(CTRL_U);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).toContain('a.test/row0');
});

test('w wraps a long body line in the detail overlay and the setting persists across reopen', async () => {
  const withBody: NetworkEntry[] = [
    { ...network[0], mimeType: 'text/plain', body: 'a'.repeat(180) + 'MARKER', bodyBase64: false, bodyTruncated: false },
  ];
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network: withBody, console }} />);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('4');
  await waitForFrame(lastFrame, 'response body');
  expect(lastFrame()).not.toContain('MARKER');
  stdin.write('w');
  await waitForFrame(lastFrame, 'MARKER');

  stdin.write(ESC);
  await sleep(30);
  expect(lastFrame()).not.toContain('response body');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('4');
  await waitForFrame(lastFrame, 'response body');
  expect(lastFrame()).toContain('MARKER');
});

test('x cycles the console level filter and / applies a console text filter', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console: consoleMixed }} />);
  await sleep(30);
  stdin.write('2');
  await waitForFrame(lastFrame, 'archived-log');
  stdin.write('x');
  await waitForFrame(lastFrame, '[error]');
  expect(lastFrame()).toContain('archived-error');
  expect(lastFrame()).not.toContain('archived-warn');
  expect(lastFrame()).toContain('1/3건');
  for (let i = 0; i < 6; i++) stdin.write('x');
  await sleep(60);
  expect(lastFrame()).toContain('archived-warn');
  stdin.write('/');
  await sleep(30);
  stdin.write('archived -warn');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, '/archived -warn');
  expect(lastFrame()).toContain('archived-error');
  expect(lastFrame()).not.toContain('archived-warn');
  expect(lastFrame()).toContain('2/3건');
});

test('Enter on a console entry opens the console detail and Esc returns; space expands inline', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console: consoleMixed }} />);
  await sleep(30);
  stdin.write('2');
  await waitForFrame(lastFrame, 'archived-log');
  stdin.write('gg');
  await sleep(30);
  expect(lastFrame()).not.toContain('at archived');
  stdin.write(' ');
  await waitForFrame(lastFrame, 'at archived');
  stdin.write(' ');
  await sleep(30);
  expect(lastFrame()).not.toContain('at archived');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'ERROR');
  const frame = lastFrame()!;
  expect(frame).toContain('https://a.test/app.js:7');
  expect(frame).toContain('at archived');
  stdin.write(ESC);
  await sleep(30);
  expect(lastFrame()).not.toContain('ERROR');
  expect(lastFrame()).toContain('archived-log');
});

test('q exits the archive viewer', async () => {
  const { stdin, frames } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  stdin.write('q');
  await sleep(50);
  const before = frames.length;
  stdin.write('w');
  await sleep(50);
  expect(frames.length).toBe(before);
});

test('the w hint is scoped to the Body tab and a Request tab with a body', async () => {
  const withPost: NetworkEntry[] = [{ ...network[0], postData: 'q=1' }];
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network: withPost, console }} />);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  expect(lastFrame()).not.toContain('w 줄바꿈');
  stdin.write('2');
  await sleep(30);
  expect(lastFrame()).toContain('w 줄바꿈');
  stdin.write('3');
  await sleep(30);
  expect(lastFrame()).not.toContain('w 줄바꿈');
  stdin.write('4');
  await sleep(30);
  expect(lastFrame()).toContain('w 줄바꿈');
});

test('the w hint stays hidden on the Request tab without a request body', async () => {
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console }} />);
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Summary');
  stdin.write('2');
  await sleep(30);
  expect(lastFrame()).not.toContain('w 줄바꿈');
});

test('archived object previews show in the console detail without expansion markers', async () => {
  const withArgs: ConsoleEntry[] = [{
    kind: 'log', text: 'user: {a: 1}', ts: 5,
    args: [
      { type: 'string', value: 'user:' },
      { type: 'object', description: 'Object', preview: { type: 'object', description: 'Object', properties: [{ name: 'a', type: 'number', value: '1' }] } },
    ],
  }];
  const { lastFrame, stdin } = render(<ArchiveApp data={{ network, console: withArgs }} />);
  await sleep(30);
  stdin.write('2');
  await waitForFrame(lastFrame, 'user: {a: 1}');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'LOG');
  const frame = lastFrame()!;
  expect(frame).toContain('user: {a: 1}');
  expect(frame).not.toContain('▸ {a: 1}');
  expect(frame).not.toContain('▾');
});
