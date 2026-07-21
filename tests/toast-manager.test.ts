import { test, expect } from 'vitest';
import {
  ToastManager,
  TOAST_DEDUPE_MS,
  TOAST_HISTORY_CAP,
  TOAST_ICONS,
  TOAST_TTL_MS,
  displayToast,
} from '../src/tui/lib/toast-manager.js';

test('push defaults to info and records msg, level, and timestamp', () => {
  const m = new ToastManager();
  const e = m.push('hello', undefined, 1000);
  expect(e.msg).toBe('hello');
  expect(e.level).toBe('info');
  expect(e.ts).toBe(1000);
  expect(e.count).toBe(1);
  expect(m.size).toBe(1);
});

test('history returns entries newest first', () => {
  const m = new ToastManager();
  m.push('first', 'info', 1000);
  m.push('second', 'error', 2000);
  m.push('third', 'success', 3000);
  expect(m.history().map(e => e.msg)).toEqual(['third', 'second', 'first']);
});

test('history is capped and drops the oldest entries', () => {
  const m = new ToastManager();
  for (let i = 0; i < TOAST_HISTORY_CAP + 10; i++) m.push(`msg-${i}`, 'info', i * 10_000);
  expect(m.size).toBe(TOAST_HISTORY_CAP);
  const h = m.history();
  expect(h[0].msg).toBe(`msg-${TOAST_HISTORY_CAP + 9}`);
  expect(h[h.length - 1].msg).toBe('msg-10');
});

test('consecutive duplicates within the dedupe window collapse into one entry', () => {
  const m = new ToastManager();
  const a = m.push('same', 'info', 1000);
  const b = m.push('same', 'info', 1000 + TOAST_DEDUPE_MS);
  expect(b.id).toBe(a.id);
  expect(b.count).toBe(2);
  expect(m.size).toBe(1);
  expect(displayToast(b)).toBe('same ×2');
});

test('duplicates outside the window, non-consecutive, or with another level stay separate', () => {
  const m = new ToastManager();
  m.push('same', 'info', 1000);
  m.push('same', 'info', 1000 + TOAST_DEDUPE_MS + 1);
  expect(m.size).toBe(2);
  m.push('same', 'error', 1000 + TOAST_DEDUPE_MS + 2);
  expect(m.size).toBe(3);
  m.push('other', 'error', 1000 + TOAST_DEDUPE_MS + 3);
  m.push('same', 'error', 1000 + TOAST_DEDUPE_MS + 4);
  expect(m.size).toBe(5);
});

test('a dedupe hit refreshes the timestamp so a burst keeps collapsing', () => {
  const m = new ToastManager();
  m.push('tick', 'info', 1000);
  m.push('tick', 'info', 1900);
  const e = m.push('tick', 'info', 2800);
  expect(e.count).toBe(3);
  expect(m.size).toBe(1);
});

test('error and warn outlive info and success', () => {
  expect(TOAST_TTL_MS.info).toBe(3000);
  expect(TOAST_TTL_MS.success).toBe(3000);
  expect(TOAST_TTL_MS.warn).toBe(5000);
  expect(TOAST_TTL_MS.error).toBe(5000);
});

test('level icons: info renders bare, the rest carry a glyph', () => {
  expect(TOAST_ICONS.info).toBe('');
  expect(TOAST_ICONS.success).toBe('✓');
  expect(TOAST_ICONS.warn).toBe('⚠');
  expect(TOAST_ICONS.error).toBe('✖');
});
