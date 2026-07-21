import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ConsoleDetailOverlay, consoleCopyText, consoleDetailLines, consoleEntriesText, CONSOLE_DETAIL_CHROME } from '../src/tui/overlays/ConsoleDetailOverlay.js';
import type { ConsoleArg, ConsoleEntry } from '../src/store/types.js';

const entry: ConsoleEntry = {
  kind: 'exception',
  text: 'TypeError: boom\nsecond line of the message',
  ts: Date.UTC(2026, 0, 2, 3, 4, 5, 678),
  url: 'https://a.test/app.js',
  line: 42,
  stack: '    at doIt (https://a.test/app.js:42)\n    at main (https://a.test/app.js:7)',
  count: 3,
};

test('consoleDetailLines carries the full message, source location, and stack', () => {
  const texts = consoleDetailLines(entry, 200, false).map(l => l.text);
  expect(texts).toContain('TypeError: boom');
  expect(texts).toContain('second line of the message');
  expect(texts).toContain('https://a.test/app.js:42');
  expect(texts).toContain('  at doIt (https://a.test/app.js:42)');
  expect(texts).toContain('  at main (https://a.test/app.js:7)');
});

test('consoleDetailLines wraps long message lines at the given width', () => {
  const long: ConsoleEntry = { kind: 'log', text: 'a'.repeat(25) + 'TAIL', ts: 0 };
  const wrapped = consoleDetailLines(long, 25, true).map(l => l.text);
  expect(wrapped[0]).toBe('a'.repeat(25));
  expect(wrapped[1]).toBe('TAIL');
  const unwrapped = consoleDetailLines(long, 25, false).map(l => l.text);
  expect(unwrapped[0]).toBe('a'.repeat(25) + 'TAIL');
});

test('the overlay renders the level badge, HH:MM:SS.mmm timestamp, and ×N badge', () => {
  const { lastFrame } = render(<ConsoleDetailOverlay entry={entry} scroll={0} height={14} width={80} />);
  const frame = lastFrame()!;
  expect(frame).toContain('EXCEPTION');
  expect(frame).toMatch(/\d{2}:\d{2}:\d{2}\.678/);
  expect(frame).toContain('×3');
  expect(frame).toContain('TypeError: boom');
  expect(frame).toContain('at doIt');
});

test('scroll offsets the visible window and shows a position indicator', () => {
  const tall: ConsoleEntry = { kind: 'log', text: Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n'), ts: 0 };
  const height = 8;
  const { lastFrame } = render(<ConsoleDetailOverlay entry={tall} scroll={5} height={height} width={60} />);
  const frame = lastFrame()!;
  expect(frame).toContain('line-5');
  expect(frame).not.toContain('line-0\n');
  expect(frame).toContain(`(6-${5 + height - CONSOLE_DETAIL_CHROME}/30)`);
});

test('consoleCopyText joins the message and stack', () => {
  expect(consoleCopyText(entry)).toBe(`${entry.text}\n${entry.stack}`);
  expect(consoleCopyText({ kind: 'log', text: 'solo', ts: 0 })).toBe('solo');
});

test('consoleEntriesText tags errors/warnings, appends counts, and keeps stacks', () => {
  const out = consoleEntriesText([
    { kind: 'error', text: 'boom', ts: 1, stack: '    at f (x:1)' },
    { kind: 'warn', text: 'careful', ts: 2 },
    { kind: 'log', text: 'ping', ts: 3, count: 4 },
  ]);
  expect(out).toBe('[error] boom\n    at f (x:1)\n[warn] careful\nping (×4)');
});

const tableArg: ConsoleArg = {
  type: 'object', subtype: 'array', objectId: 'tbl',
  preview: {
    type: 'object', subtype: 'array',
    properties: [
      { name: '0', type: 'object', valuePreview: { type: 'object', properties: [{ name: 'x', type: 'number', value: '1' }] } },
      { name: '1', type: 'object', valuePreview: { type: 'object', properties: [{ name: 'x', type: 'number', value: '2' }] } },
    ],
  },
};

test('consoleDetailLines renders a table as a supplement while keeping the arg[0] tree expandable', () => {
  const e: ConsoleEntry = { kind: 'log', text: 'console.table', ts: 0, args: [tableArg] };
  const lines = consoleDetailLines(e, 80, false, { expanded: new Set(), children: new Map() });
  const texts = lines.map(l => l.text);
  expect(texts.some(l => l.includes('(index)') && l.includes('x'))).toBe(true);
  const root = lines.find(l => l.node && l.text.includes('▸'));
  expect(root).toBeDefined();
  expect(root!.node).toEqual({ path: 'a0', objectId: 'tbl' });
});
