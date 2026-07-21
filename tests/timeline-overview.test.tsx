import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TimelineOverview, TIMELINE_HEIGHT } from '../src/tui/panels/TimelineOverview.js';
import type { NetworkEntry } from '../src/store/types.js';

const req = (id: string, startTs: number, durationMs?: number, error?: string): NetworkEntry => ({
  id, url: `https://a.test/${id}`, method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {},
  startTs, durationMs, error, encodedBytes: 2048,
});

const NOW = 1_000_000;
const entries = [req('a', 0, 4000), req('b', 1000, 2000), req('c', 8000, 2000)];

test('renders exactly TIMELINE_HEIGHT rows with a braille area chart', () => {
  const { lastFrame } = render(
    <TimelineOverview entries={entries} width={60} applied={null} now={NOW} />,
  );
  const lines = lastFrame()!.split('\n');
  expect(lines.length).toBe(TIMELINE_HEIGHT);
  expect(lastFrame()).toMatch(/[⣀-⣿]/);
});

test('axis row shows the origin, total span, and a request summary', () => {
  const frame = render(
    <TimelineOverview entries={entries} width={60} applied={null} now={NOW} />,
  ).lastFrame()!;
  expect(frame).toContain('0.0s');
  expect(frame).toContain('10.0s');
  expect(frame).toContain('3 req');
  expect(frame).toContain('6.0kB');
});

test('the passive strip renders no cursor marker', () => {
  const frame = render(
    <TimelineOverview entries={entries} width={60} cursor={10} applied={null} now={NOW} />,
  ).lastFrame()!;
  expect(frame).not.toContain('│');
});

test('range-select mode renders a │ column marker and the cursor time', () => {
  const frame = render(
    <TimelineOverview entries={entries} width={60} active cursor={29} anchor={null} applied={null} now={NOW} />,
  ).lastFrame()!;
  expect(frame).toContain('│');
  expect(frame).toContain('5.0s');
  expect(frame).not.toContain('3 req');
});

test('the cursor time readout follows cursor movement', () => {
  const at = (cursor: number) =>
    render(
      <TimelineOverview entries={entries} width={60} active cursor={cursor} anchor={null} applied={null} now={NOW} />,
    ).lastFrame()!;
  expect(at(0)).toContain('0.0s');
  expect(at(29)).toContain('5.0s');
  expect(at(46)).toContain('7.9s');
});

test('an active selection shows ┃ edges, its time range, and the request count', () => {
  const frame = render(
    <TimelineOverview entries={entries} width={60} active cursor={30} anchor={5} applied={null} now={NOW} />,
  ).lastFrame()!;
  expect(frame).toContain('┃');
  expect(frame).toContain('│');
  expect(frame).toMatch(/0\.9s–5\.3s · 2건/);
  expect(frame).not.toContain('3 req');
});

test('the selection count grows as the selection extends', () => {
  const upTo = (cursor: number) =>
    render(
      <TimelineOverview entries={entries} width={60} active cursor={cursor} anchor={5} applied={null} now={NOW} />,
    ).lastFrame()!;
  expect(upTo(30)).toContain('· 2건');
  expect(upTo(57)).toContain('· 3건');
});

test('an applied range is highlighted with its range and count when no selection is active', () => {
  const frame = render(
    <TimelineOverview entries={entries} width={60} applied={{ start: 2000, end: 6000 }} now={NOW} />,
  ).lastFrame()!;
  expect(frame).toContain('┃');
  expect(frame).toContain('2.0s–6.0s · 2건');
});

test('empty capture shows a dim placeholder at the same height', () => {
  const r = render(<TimelineOverview entries={[]} width={60} applied={null} now={NOW} />);
  const lines = r.lastFrame()!.split('\n');
  expect(lines.length).toBe(TIMELINE_HEIGHT);
  expect(r.lastFrame()).toContain('요청 없음');
});

test('the cursor is clamped inside the chart width', () => {
  const frame = render(
    <TimelineOverview entries={entries} width={30} active cursor={999} anchor={null} applied={null} now={NOW} />,
  ).lastFrame()!;
  expect(frame).toContain('│');
  expect(frame.split('\n')[0]!.length).toBeLessThanOrEqual(30);
});
