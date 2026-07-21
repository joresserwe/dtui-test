import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Picker } from '../src/tui/Picker.js';

const candidates = [
  { kind: 'comet' as const, name: 'Comet', path: '/mnt/c/Program Files/Perplexity/Comet/Application/comet.exe', viaWsl: true },
  { kind: 'chrome' as const, name: 'Google Chrome', path: '/usr/bin/google-chrome', viaWsl: false },
];

test('lists candidates with paths and wsl marker', () => {
  const { lastFrame } = render(<Picker candidates={candidates} selected={0} profile="existing" />);
  const frame = lastFrame()!;
  expect(frame).toContain('Pick a browser');
  expect(frame).toContain('Comet');
  expect(frame).toContain('(windows)');
  expect(frame).toContain('Google Chrome');
  expect(frame).toContain('profile: existing');
  expect(frame).toContain('⏎ launch');
});

test('shows busy and error lines and tool profile explanation', () => {
  const { lastFrame } = render(
    <Picker candidates={candidates} selected={1} profile="tool" busy="launching Google Chrome…" error="boom" />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('profile: tool');
  expect(frame).toContain('isolated');
  expect(frame).toContain('launching Google Chrome…');
  expect(frame).toContain('boom');
});

test('renders the WSL networking hint when a viaWsl candidate exists', () => {
  const { lastFrame } = render(<Picker candidates={candidates} selected={0} profile="existing" />);
  expect(lastFrame()).toContain('mirrored networking');
});

test('omits the WSL networking hint when no viaWsl candidate exists', () => {
  const local = candidates.filter(c => !c.viaWsl);
  const { lastFrame } = render(<Picker candidates={local} selected={0} profile="existing" />);
  expect(lastFrame()).not.toContain('mirrored networking');
});

test('empty state points at --browser-path', () => {
  const { lastFrame } = render(<Picker candidates={[]} selected={0} profile="existing" />);
  expect(lastFrame()).toContain('--browser-path');
});

test('empty state shows the manual launch recipe', () => {
  const { lastFrame } = render(<Picker candidates={[]} selected={0} profile="existing" />);
  const frame = lastFrame()!;
  expect(frame).toContain('--remote-debugging-port=9222');
  expect(frame).toContain('--user-data-dir');
});
