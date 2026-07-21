import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SettingsPanel } from '../src/tui/panels/SettingsPanel.js';
import { describeSettings } from '../src/settings.js';

const rows = describeSettings({});

test('renders search hint and setting rows', () => {
  const { lastFrame } = render(<SettingsPanel rows={rows} query="" selected={0} />);
  const frame = lastFrame()!;
  expect(frame).toContain('Settings');
  expect(frame).toContain('/ 검색');
  expect(frame).toContain('port');
  expect(frame).toContain('9222');
});

test('shows section headers without a query and a flat list with one', () => {
  const grouped = render(<SettingsPanel rows={rows} query="" selected={0} height={20} />).lastFrame()!;
  expect(grouped).toContain('── 연결');
  expect(grouped).toContain('── 표시');
  expect(grouped).toContain('── 캡처');

  const flat = render(<SettingsPanel rows={rows} query="po" selected={0} height={20} />).lastFrame()!;
  expect(flat).not.toContain('── 연결');
  expect(flat).not.toContain('── 표시');
  expect(flat).not.toContain('── 캡처');
});

test('enum rows render option chips including the current value', () => {
  const grouped = render(<SettingsPanel rows={rows} query="" selected={0} height={20} />).lastFrame()!;
  expect(grouped).toContain('tabs');
  expect(grouped).toContain('split');
  expect(grouped).toContain('fast3g');
  expect(grouped).toContain('slow3g');
});

const lineCount = (el: React.ReactElement) => render(el).lastFrame()!.split('\n').length;

const many = Array.from({ length: 30 }, (_, i) => ({
  key: `k${i}`, value: `v${i}`, source: 'default' as const,
  kind: 'text' as const, description: `desc ${i}`, section: '연결',
}));

test('renders exactly height rows across every state combination', () => {
  for (const height of [14, 20, 8]) {
    expect(lineCount(
      <SettingsPanel rows={many} query="q" selected={29} editing={{ key: 'k', value: 'v' }} error="boom" height={height} />,
    )).toBe(height);
    expect(lineCount(<SettingsPanel rows={many} query="" selected={0} height={height} />)).toBe(height);
    expect(lineCount(<SettingsPanel rows={rows} query="po" selected={0} height={height} />)).toBe(height);
    expect(lineCount(<SettingsPanel rows={[]} query="zzz" selected={0} height={height} />)).toBe(height);
  }
});

test('uses a constant height at the default with no height prop', () => {
  expect(lineCount(<SettingsPanel rows={rows} query="po" selected={0} />))
    .toBe(lineCount(<SettingsPanel rows={[]} query="zzz" selected={0} editing={{ key: 'k', value: 'v' }} error="e" height={14} />));
});

test('empty filter result shows a placeholder', () => {
  const { lastFrame } = render(<SettingsPanel rows={[]} query="zzz" selected={0} />);
  expect(lastFrame()).toContain('일치하는 설정 없음');
});

test('keeps the selected row visible when windowed', () => {
  const { lastFrame } = render(<SettingsPanel rows={many} query="q" selected={29} height={14} />);
  expect(lastFrame()).toContain('k29');
});

test('honours an explicit width and is borderless', () => {
  const frame = render(<SettingsPanel rows={rows} query="po" selected={0} height={12} width={50} />).lastFrame()!;
  expect(frame).not.toContain('╔');
  expect(frame).not.toContain('╭');
  expect(frame).toContain('─'.repeat(50));
  expect(Math.max(...frame.split('\n').map(l => l.length))).toBe(50);
});

test('shows the search cursor only while searching', () => {
  const active = render(<SettingsPanel rows={rows} query="po" searching selected={0} />).lastFrame()!;
  expect(active).toContain('/po▌');
  const idle = render(<SettingsPanel rows={rows} query="po" selected={0} />).lastFrame()!;
  expect(idle).toContain('/po');
  expect(idle).not.toContain('/po▌');
});

test('selected row carries a cyan gutter and no footer hint', () => {
  const frame = render(<SettingsPanel rows={rows} query="po" selected={0} height={12} />).lastFrame()!;
  expect(frame).toContain('▌');
  expect(frame).not.toContain('Esc close');
  expect(frame).not.toContain('type to filter');
});

test('renders editing and error slots', () => {
  const frame = render(
    <SettingsPanel rows={rows} query="" selected={0} editing={{ key: 'port', value: '9333' }} error="invalid port" height={16} />,
  ).lastFrame()!;
  expect(frame).toContain('edit port: 9333');
  expect(frame).toContain('invalid port');
});
