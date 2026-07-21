import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { clampWindowStart } from '../src/tui/lib/list-window.js';
import { NetworkPanel } from '../src/tui/panels/NetworkPanel.js';
import type { NetworkEntry } from '../src/store/types.js';

const entry = (over: Partial<NetworkEntry>): NetworkEntry => ({
  id: 'x', url: 'https://a.test/api', method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {}, startTs: 0,
  status: 200, statusText: 'OK', durationMs: 142, encodedBytes: 2150,
  ...over,
});

const rows = (n: number): NetworkEntry[] =>
  Array.from({ length: n }, (_, i) => entry({ id: String(i), url: `https://a.test/row${i}x` }));

test('clampWindowStart returns 0 when the list fits or the budget is empty', () => {
  expect(clampWindowStart(5, 8, 3, 10)).toBe(0);
  expect(clampWindowStart(5, 100, 3, 0)).toBe(0);
  expect(clampWindowStart(5, 0, 0, 10)).toBe(0);
});

test('clampWindowStart keeps the window still while the cursor moves inside it', () => {
  expect(clampWindowStart(13, 100, 18, 10)).toBe(13);
  expect(clampWindowStart(13, 100, 13, 10)).toBe(13);
  expect(clampWindowStart(13, 100, 22, 10)).toBe(13);
});

test('clampWindowStart shifts only when the cursor crosses an edge', () => {
  expect(clampWindowStart(13, 100, 12, 10)).toBe(12);
  expect(clampWindowStart(13, 100, 23, 10)).toBe(14);
});

test('clampWindowStart lands jumps at the nearest edge', () => {
  expect(clampWindowStart(0, 100, 99, 10)).toBe(90);
  expect(clampWindowStart(90, 100, 0, 10)).toBe(0);
  expect(clampWindowStart(40, 100, 75, 10)).toBe(66);
  expect(clampWindowStart(40, 100, 5, 10)).toBe(5);
});

test('clampWindowStart stays bottom-anchored while following streaming appends', () => {
  let start = clampWindowStart(0, 100, 99, 10);
  expect(start).toBe(90);
  start = clampWindowStart(start, 101, 100, 10);
  expect(start).toBe(91);
  start = clampWindowStart(start, 105, 104, 10);
  expect(start).toBe(95);
});

test('clampWindowStart keeps the window still when rows append below a parked cursor', () => {
  expect(clampWindowStart(40, 100, 45, 10)).toBe(40);
  expect(clampWindowStart(40, 120, 45, 10)).toBe(40);
});

test('clampWindowStart clamps when the list shrinks', () => {
  expect(clampWindowStart(90, 20, 5, 10)).toBe(5);
  expect(clampWindowStart(90, 20, 15, 10)).toBe(10);
  expect(clampWindowStart(90, 15, 14, 10)).toBe(5);
});

test('clampWindowStart treats an out-of-range selection as clamped', () => {
  expect(clampWindowStart(13, 100, -1, 10)).toBe(0);
  expect(clampWindowStart(0, 100, 500, 10)).toBe(90);
});

test('pressing k at the bottom moves the highlight up without shifting the window', () => {
  const es = rows(20);
  const { lastFrame, rerender } = render(<NetworkPanel entries={es} selected={19} focused height={8} />);
  expect(lastFrame()).toContain('row13x');
  expect(lastFrame()).not.toContain('row12x');

  rerender(<NetworkPanel entries={es} selected={18} focused height={8} />);
  const frame = lastFrame()!;
  expect(frame).toContain('row13x');
  expect(frame).not.toContain('row12x');
  expect(frame).toContain('row19x');
  expect(frame.split('\n').find(l => l.includes('row18x'))!.startsWith('▌')).toBe(true);
  expect(frame.split('\n').find(l => l.includes('row19x'))!.startsWith('▌')).toBe(false);
});

test('the window shifts once the cursor walks past its top edge', () => {
  const es = rows(20);
  const { lastFrame, rerender } = render(<NetworkPanel entries={es} selected={19} focused height={8} />);
  for (let sel = 18; sel >= 12; sel--) rerender(<NetworkPanel entries={es} selected={sel} focused height={8} />);
  const frame = lastFrame()!;
  expect(frame).toContain('row12x');
  expect(frame).toContain('row18x');
  expect(frame).not.toContain('row19x');
  expect(frame.split('\n').find(l => l.includes('row12x'))!.startsWith('▌')).toBe(true);
});

test('tail selection keeps the view bottom-anchored as entries stream in', () => {
  const { lastFrame, rerender } = render(<NetworkPanel entries={rows(20)} selected={19} focused height={8} />);
  rerender(<NetworkPanel entries={rows(21)} selected={20} focused height={8} />);
  const frame = lastFrame()!;
  expect(frame).toContain('row20x');
  expect(frame).toContain('row14x');
  expect(frame).not.toContain('row13x');
  expect(frame.split('\n').find(l => l.includes('row20x'))!.startsWith('▌')).toBe(true);
});

test('a parked cursor keeps its window while entries stream in below', () => {
  const es = rows(20);
  const { lastFrame, rerender } = render(<NetworkPanel entries={es} selected={19} focused height={8} />);
  rerender(<NetworkPanel entries={es} selected={18} focused height={8} />);
  rerender(<NetworkPanel entries={rows(30)} selected={18} focused height={8} />);
  const frame = lastFrame()!;
  expect(frame).toContain('row13x');
  expect(frame).toContain('row19x');
  expect(frame).not.toContain('row20x');
  expect(frame.split('\n').find(l => l.includes('row18x'))!.startsWith('▌')).toBe(true);
});

test('gg then G land the cursor visible at the list edges', () => {
  const es = rows(30);
  const { lastFrame, rerender } = render(<NetworkPanel entries={es} selected={20} focused height={8} />);
  rerender(<NetworkPanel entries={es} selected={0} focused height={8} />);
  expect(lastFrame()).toContain('row0x');
  expect(lastFrame()).toContain('row6x');
  rerender(<NetworkPanel entries={es} selected={29} focused height={8} />);
  expect(lastFrame()).toContain('row29x');
  expect(lastFrame()).toContain('row23x');
});

test('a filter shrink keeps the cursor visible with a clamped window', () => {
  const { lastFrame, rerender } = render(<NetworkPanel entries={rows(30)} selected={29} focused height={8} />);
  rerender(<NetworkPanel entries={rows(10)} selected={5} focused height={8} />);
  const frame = lastFrame()!;
  expect(frame).toContain('row5x');
  expect(frame).toContain('row3x');
  expect(frame).toContain('row9x');
});
