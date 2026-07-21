import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HELP_CHROME, HelpOverlay, helpRows, helpSections } from '../src/tui/overlays/HelpOverlay.js';

const TITLES = ['전역', 'Network', '상세', 'Elements', 'Console', 'Storage', 'Sources', 'Components', 'Audit', 'Settings', '픽커/타임라인', '에뮬레이션 (:)'];

test('helpSections keeps the canonical order when no tool applies', () => {
  expect(helpSections().map(s => s.title)).toEqual(TITLES);
});

test('helpSections puts the active tool first and 전역 second', () => {
  expect(helpSections('storage').map(s => s.title)).toEqual([
    'Storage', '전역', 'Network', '상세', 'Elements', 'Console', 'Sources', 'Components', 'Audit', 'Settings', '픽커/타임라인', '에뮬레이션 (:)',
  ]);
  expect(helpSections('network').map(s => s.title).slice(0, 2)).toEqual(['Network', '전역']);
  expect(helpSections('console').map(s => s.title).slice(0, 2)).toEqual(['Console', '전역']);
});

test('every section keeps its bindings regardless of ordering', () => {
  for (const tool of ['network', 'console', 'elements', 'storage', 'sources', 'components', 'audit', 'settings'] as const) {
    const sections = helpSections(tool);
    expect(sections.map(s => s.title).sort()).toEqual([...TITLES].sort());
    const keys = sections.flatMap(s => s.keys.map(([k]) => k));
    expect(keys).toContain('Tab / Shift-Tab');
    expect(keys).toContain('O / Ctrl-O');
    expect(keys).toContain('Enter / Esc (z)');
  }
});

test('helpRows flattens sections into headers and key rows', () => {
  const rows = helpRows('settings');
  expect(rows[0]).toEqual({ kind: 'header', title: 'Settings' });
  const headers = rows.filter(r => r.kind === 'header').map(r => (r as { title: string }).title);
  expect(headers).toEqual(['Settings', '전역', 'Network', '상세', 'Elements', 'Console', 'Storage', 'Sources', 'Components', 'Audit', '픽커/타임라인', '에뮬레이션 (:)']);
});

test('renders a constant frame height with a scroll indicator when overflowing', () => {
  const frame = render(<HelpOverlay tool="network" height={12} width={70} />).lastFrame()!;
  const lines = frame.split('\n');
  expect(lines.length).toBe(12);
  const total = helpRows('network').length;
  expect(frame).toContain(`${12 - HELP_CHROME}/${total}`);
  expect(frame).toContain('▼ 더 있음');
  expect(frame).toContain('── Network');
});

test('scroll clamps to the end and reveals the last binding without the more marker', () => {
  const frame = render(<HelpOverlay tool="network" scroll={9999} height={12} width={70} />).lastFrame()!;
  expect(frame.split('\n').length).toBe(12);
  expect(frame).toContain('인쇄 미디어 에뮬레이션 토글');
  expect(frame).not.toContain('▼ 더 있음');
});

test('shows no scroll indicator when everything fits', () => {
  const total = helpRows().length;
  const frame = render(<HelpOverlay height={total + HELP_CHROME} width={90} />).lastFrame()!;
  expect(frame).not.toContain('더 있음');
  expect(frame).not.toContain(`/${total}`);
  expect(frame).toContain('── 전역');
  expect(frame).toContain('── 픽커/타임라인');
});

test('the storage sw-events row lists the capital-S lastChance sync binding', () => {
  const keys = helpRows('storage').filter(r => r.kind === 'key').map(r => (r as { keys: string }).keys);
  expect(keys).toContain('p / s / S / P (sw)');
});

test('key rows align the key column with the description', () => {
  const frame = render(<HelpOverlay tool="storage" height={30} width={70} />).lastFrame()!;
  expect(frame).toContain('X                   사이트 데이터 비우기 — 한 번 더 누르면 실행');
});
