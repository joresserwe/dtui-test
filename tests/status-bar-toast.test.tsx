import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StatusBar } from '../src/tui/panels/StatusBar.js';
import { TOAST_COLORS } from '../src/tui/lib/toast-manager.js';
import { theme } from '../src/tui/lib/theme.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

test('an info toast renders without an icon, keeping the bare │ separator', () => {
  const frame = stripAnsi(render(<StatusBar browser="chrome" throttle="off" toast="plain note" toastLevel="info" />).lastFrame()!);
  expect(frame).toContain('│ plain note');
  expect(frame).not.toContain('✖');
  expect(frame).not.toContain('✓');
});

test('a level-less toast renders like info', () => {
  const frame = stripAnsi(render(<StatusBar browser="chrome" throttle="off" toast="reconnecting…" />).lastFrame()!);
  expect(frame).toContain('│ reconnecting…');
  expect(frame).not.toContain('✖');
});

test('an error toast renders the ✖ segment before the text', () => {
  const raw = render(<StatusBar browser="chrome" throttle="off" toast="copy failed" toastLevel="error" />).lastFrame()!;
  expect(stripAnsi(raw)).toContain('│ ✖ copy failed');
});

test('a success toast renders ✓ and a warn toast renders ⚠', () => {
  const ok = stripAnsi(render(<StatusBar browser="chrome" throttle="off" toast="saved" toastLevel="success" />).lastFrame()!);
  expect(ok).toContain('│ ✓ saved');
  const warn = stripAnsi(render(<StatusBar browser="chrome" throttle="off" toast="careful" toastLevel="warn" />).lastFrame()!);
  expect(warn).toContain('│ ⚠ careful');
});

test('level colors come from theme tokens', () => {
  expect(TOAST_COLORS.error).toBe(theme.err);
  expect(TOAST_COLORS.warn).toBe(theme.warn);
  expect(TOAST_COLORS.success).toBe(theme.ok);
  expect(TOAST_COLORS.info).toBeUndefined();
});
