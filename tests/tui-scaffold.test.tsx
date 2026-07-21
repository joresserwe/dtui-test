import { test, expect } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { useEmitterTick } from '../src/tui/hooks/use-emitter.js';
import { fmtMs, fmtBytes, truncate, prettyBody, statusColor } from '../src/tui/lib/format.js';

test('ink renders in the test harness', () => {
  const { lastFrame } = render(<Text>devtools-tui</Text>);
  expect(lastFrame()).toContain('devtools-tui');
});

function Ticker({ em }: { em: EventEmitter }) {
  const tick = useEmitterTick(em, ['update'], undefined, 10);
  return <Text>tick:{tick}</Text>;
}

test('useEmitterTick re-renders on emitter events, throttled', async () => {
  const em = new EventEmitter();
  const { lastFrame } = render(<Ticker em={em} />);
  expect(lastFrame()).toContain('tick:0');
  em.emit('update');
  em.emit('update');
  em.emit('update');
  await new Promise(r => setTimeout(r, 60));
  expect(lastFrame()).toContain('tick:1');
});

test('format helpers', () => {
  expect(fmtMs(142.4)).toBe('142ms');
  expect(fmtMs(2350)).toBe('2.4s');
  expect(fmtMs(undefined)).toBe('-');
  expect(fmtBytes(512)).toBe('512B');
  expect(fmtBytes(2150)).toBe('2.1kB');
  expect(fmtBytes(3_400_000)).toBe('3.2MB');
  expect(truncate('abcdef', 4)).toBe('abc…');
  expect(truncate('ab', 4)).toBe('ab');
  expect(prettyBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
  expect(prettyBody('not json', 'application/json')).toBe('not json');
  expect(prettyBody('a=1&b=two', 'application/x-www-form-urlencoded')).toBe('a = 1\nb = two');
  expect(statusColor({ status: 200 })).toBe('green');
  expect(statusColor({ status: 302 })).toBe('yellow');
  expect(statusColor({ status: 404 })).toBe('red');
  expect(statusColor({ error: 'x' })).toBe('red');
  expect(statusColor({})).toBe('gray');
});
