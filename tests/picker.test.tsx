import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Picker } from '../src/tui/Picker.js';

const candidates = [
  { kind: 'comet' as const, name: 'Comet', path: '/mnt/c/Program Files/Perplexity/Comet/Application/comet.exe', viaWsl: true },
  { kind: 'chrome' as const, name: 'Google Chrome', path: '/usr/bin/google-chrome', viaWsl: false },
];

const flatten = (frame: string) =>
  frame.split('\n').map(l => l.replace(/[│╭-╰─]/g, '').trim()).join(' ').replace(/\s+/g, ' ');

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

test('busy state shows what is launching and that it can take a moment', () => {
  const { lastFrame } = render(
    <Picker candidates={candidates} selected={1} profile="tool" busy="launching Google Chrome…" />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('profile: tool');
  expect(frame).toContain('isolated');
  expect(frame).toContain('launching Google Chrome…');
  expect(flatten(frame)).toContain('can take a few seconds');
});

test('error state renders a long message in full, wrapped not truncated', () => {
  const long =
    'The browser opened its DevTools port on the Windows side, but WSL cannot reach the Windows loopback and the interop relay could not connect. Workarounds: enable mirrored networking in .wslconfig, add a netsh portproxy for the port, or pass --host with a reachable address.';
  const { lastFrame } = render(
    <Picker candidates={candidates} selected={0} profile="existing" error={long} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('launch failed');
  expect(flatten(frame)).toContain(long);
});

test('idle state shows neutral guidance', () => {
  const local = candidates.filter(c => !c.viaWsl);
  const { lastFrame } = render(<Picker candidates={local} selected={0} profile="existing" />);
  const flat = flatten(lastFrame()!);
  expect(flat).toContain('DevTools port');
  expect(flat).not.toContain('WSL');
  expect(flat).not.toContain('README');
});

test('shows the relay note only when a viaWsl candidate exists', () => {
  const { lastFrame } = render(<Picker candidates={candidates} selected={0} profile="existing" />);
  expect(flatten(lastFrame()!)).toContain('automatic relay');
  const local = candidates.filter(c => !c.viaWsl);
  const { lastFrame: localFrame } = render(<Picker candidates={local} selected={0} profile="existing" />);
  expect(flatten(localFrame()!)).not.toContain('automatic relay');
});

test('guidance yields to busy and error states', () => {
  const { lastFrame } = render(
    <Picker candidates={candidates} selected={0} profile="existing" error="boom" />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('boom');
  expect(flatten(frame)).not.toContain('DevTools port open and attaches');
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
