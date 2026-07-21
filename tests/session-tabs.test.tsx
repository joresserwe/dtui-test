import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SessionTabs, stripLabel, stripWindow, type StripSession } from '../src/tui/panels/SessionTabs.js';
import { displayWidth } from '../src/tui/lib/format.js';

const s = (key: string, title: string, count = 0, status: StripSession['status'] = 'live'): StripSession =>
  ({ key, title, count, status });

const clean = (frame: string) => frame.replace(/\x1b\[[0-9;]*m/g, '');

test('renders every session with its count; the viewed one gets ◉, background ●', () => {
  const frame = clean(render(
    <SessionTabs sessions={[s('a', 'My Shop', 128), s('b', 'API Console', 41)]} activeKey="a" width={80} />,
  ).lastFrame()!);
  const [row] = frame.split('\n');
  expect(row).toContain('◉ My Shop 128');
  expect(row).toContain('● API Console 41');
});

test('the rule row carries a ━ segment exactly under the viewed label', () => {
  const sessions = [s('a', 'My Shop', 128), s('b', 'API Console', 41)];
  const frame = clean(render(<SessionTabs sessions={sessions} activeKey="b" width={80} />).lastFrame()!);
  const bar = frame.split('\n')[1];
  const label0 = stripLabel(sessions[0], false);
  const label1 = stripLabel(sessions[1], true);
  const pre = 1 + displayWidth(label0) + 3;
  expect(bar.indexOf('━')).toBe(pre);
  expect(bar.lastIndexOf('━')).toBe(pre + displayWidth(label1) - 1);
  expect(bar.startsWith('─')).toBe(true);
  expect(bar.endsWith('─')).toBe(true);
});

test('a reconnecting session shows ↻', () => {
  const frame = clean(render(
    <SessionTabs sessions={[s('a', 'My Shop', 3), s('b', 'Blog', 0, 'reconnecting')]} activeKey="a" width={80} />,
  ).lastFrame()!);
  expect(frame.split('\n')[0]).toContain('↻ Blog 0');
});

test('overflow keeps the viewed session visible behind a leading ellipsis', () => {
  const sessions = Array.from({ length: 8 }, (_, i) => s(`k${i}`, `Tab number ${i}`, i));
  const frame = clean(render(<SessionTabs sessions={sessions} activeKey="k7" width={40} />).lastFrame()!);
  const row = frame.split('\n')[0];
  expect(row).toContain('◉ Tab number 7');
  expect(row).toContain('…');
  expect(row).not.toContain('Tab number 0');
});

test('the strip has no right-side hint area and spends the full width on tabs', () => {
  const sessions = Array.from({ length: 5 }, (_, i) => s(`k${i}`, `Sess ${i}`, 10));
  const frame = clean(render(<SessionTabs sessions={sessions} activeKey="k0" width={80} />).lastFrame()!);
  const row = frame.split('\n')[0];
  for (let i = 0; i < 5; i++) expect(row).toContain(`Sess ${i}`);
  expect(row).not.toContain('전환');
  expect(row).not.toContain('도움말');
});

test('stripWindow keeps everything when it fits and anchors on the active label', () => {
  expect(stripWindow([10, 10, 10], 0, 100)).toEqual({ start: 0, end: 2 });
  expect(stripWindow([10, 10, 10], 1, 10)).toEqual({ start: 1, end: 1 });
  expect(stripWindow([10, 10, 10, 10], 3, 25)).toEqual({ start: 2, end: 3 });
  expect(stripWindow([10, 10, 10, 10], 0, 25)).toEqual({ start: 0, end: 1 });
});
