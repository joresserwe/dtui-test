import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ConsolePanel, filterConsoleEntries, normalizeTimerText } from '../src/tui/panels/ConsolePanel.js';
import type { ConsoleEntry } from '../src/store/types.js';

const entries: ConsoleEntry[] = [
  { kind: 'error', text: 'TypeError: boom', ts: 1, stack: '    at doIt (https://a.test/app.js:120)' },
  { kind: 'warn', text: 'careful', ts: 2 },
  { kind: 'log', text: 'hello world', ts: 3 },
];

const lineCount = (frame: string): number => frame.split('\n').length;

test('renders kinds with markers and no border or title', () => {
  const { lastFrame } = render(<ConsolePanel entries={entries} selected={0} expanded={new Set()} focused height={8} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).not.toContain('Console');
  expect(frame).not.toContain('╭');
  expect(frame).toContain('✖ TypeError: boom');
  expect(frame).toContain('⚠ careful');
  expect(frame).toContain('· hello world');
  expect(frame).not.toContain('at doIt');
});

test('marks the selected entry with a cyan bar in the gutter', () => {
  const { lastFrame } = render(<ConsolePanel entries={entries} selected={1} expanded={new Set()} focused height={8} />);
  const frame = lastFrame()!;
  const line = frame.split('\n').find(l => l.includes('careful'))!;
  expect(line.startsWith('▌')).toBe(true);
  expect(frame.split('\n').find(l => l.includes('TypeError'))!.startsWith('▌')).toBe(false);
});

test('omits the selection bar when unfocused', () => {
  const { lastFrame } = render(<ConsolePanel entries={entries} selected={0} expanded={new Set()} focused={false} height={8} />);
  expect(lastFrame()).not.toContain('▌');
});

test('expanded entries show their stack while keeping height constant', () => {
  const { lastFrame } = render(<ConsolePanel entries={entries} selected={0} expanded={new Set([0])} focused height={8} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(8);
  expect(frame).toContain('at doIt (https://a.test/app.js:120)');
});

test('windows flat lines so the selected entry stays visible when stacks are expanded', () => {
  const stacky: ConsoleEntry[] = [
    { kind: 'error', text: 'first', ts: 1, stack: 'a\nb\nc\nd\ne\nf' },
    { kind: 'log', text: 'middle', ts: 2 },
    { kind: 'log', text: 'target', ts: 3 },
  ];
  const { lastFrame } = render(<ConsolePanel entries={stacky} selected={2} expanded={new Set([0])} focused height={6} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(6);
  expect(frame).toContain('target');
});

test('scrolls to keep selection visible and shows placeholder when empty', () => {
  const many: ConsoleEntry[] = Array.from({ length: 20 }, (_, i) => ({ kind: 'log', text: `line${i}`, ts: i }));
  const { lastFrame } = render(<ConsolePanel entries={many} selected={19} expanded={new Set()} focused height={6} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(6);
  expect(frame).toContain('line19');
  expect(frame).not.toContain('line0 ');

  const { lastFrame: empty } = render(<ConsolePanel entries={[]} selected={0} expanded={new Set()} focused={false} height={6} />);
  const emptyFrame = empty()!;
  expect(lineCount(emptyFrame)).toBe(6);
  expect(emptyFrame).toContain('콘솔 출력 없음');
});

test('keeps the first entry visible when selection is at the start', () => {
  const many: ConsoleEntry[] = Array.from({ length: 20 }, (_, i) => ({ kind: 'log', text: `line${i}`, ts: i }));
  const { lastFrame } = render(<ConsolePanel entries={many} selected={0} expanded={new Set()} focused height={6} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(6);
  expect(frame).toContain('line0');
  expect(frame).not.toContain('line19');
});

test('renders exactly height rows across sizes, selection states and expansions', () => {
  const many: ConsoleEntry[] = Array.from({ length: 25 }, (_, i) => ({
    kind: 'error', text: `line${i}`, ts: i, stack: 'x\ny\nz',
  }));
  for (const height of [5, 6, 8, 12] as const) {
    for (const selected of [0, 4, 12, 24]) {
      const expanded = new Set([0, 5, 12, 20]);
      const { lastFrame } = render(<ConsolePanel entries={many} selected={selected} expanded={expanded} focused height={height} />);
      expect(lineCount(lastFrame()!)).toBe(height);
    }
  }
});

test('renders exactly height rows at a narrow width', () => {
  const { lastFrame } = render(<ConsolePanel entries={entries} selected={0} expanded={new Set()} focused height={6} width={30} />);
  const frame = lastFrame()!;
  expect(lineCount(frame)).toBe(6);
  expect(frame).not.toContain('╭');
});

test('a collapsed entry shows a ×N badge', () => {
  const collapsed: ConsoleEntry[] = [{ kind: 'log', text: 'ping', ts: 1, count: 4 }];
  const { lastFrame } = render(<ConsolePanel entries={collapsed} selected={0} expanded={new Set()} focused height={4} width={40} />);
  expect(lastFrame()).toContain('ping ×4');
});

test('a wide row right-aligns the source basename:line and a narrow one drops it', () => {
  const sourced: ConsoleEntry[] = [{ kind: 'browser', text: 'net err', ts: 1, url: 'https://a.test/js/vendor.js?v=1', line: 42 }];
  const wide = render(<ConsolePanel entries={sourced} selected={1} expanded={new Set()} focused height={3} width={60} />);
  const row = wide.lastFrame()!.split('\n').find(l => l.includes('net err'))!;
  expect(row).toContain('vendor.js:42');
  expect(row.trimEnd().endsWith('vendor.js:42')).toBe(true);

  const narrow = render(<ConsolePanel entries={sourced} selected={1} expanded={new Set()} focused height={3} width={22} />);
  expect(narrow.lastFrame()).not.toContain('vendor.js:42');
  expect(narrow.lastFrame()).toContain('net err');
});

test('timer and trace kinds render their own markers', () => {
  const es: ConsoleEntry[] = [
    { kind: 'timer', text: 'load: 5 ms', ts: 1 },
    { kind: 'trace', text: 'traced', ts: 2, stack: '   at f (x:1)' },
  ];
  const { lastFrame } = render(<ConsolePanel entries={es} selected={0} expanded={new Set()} focused height={4} width={60} />);
  const frame = lastFrame()!;
  expect(frame).toContain('⧗ load: 5ms');
  expect(frame).toContain('↳ traced');
});

test('timer durations normalize the unit and switch to seconds past a second', () => {
  const es: ConsoleEntry[] = [
    { kind: 'timer', text: 'quick: 1.5 ms', ts: 1 },
    { kind: 'timer', text: 'slow: 2500 ms', ts: 2 },
  ];
  const { lastFrame } = render(<ConsolePanel entries={es} selected={0} expanded={new Set()} focused height={4} width={60} />);
  const frame = lastFrame()!;
  expect(frame).toContain('quick: 1.5ms');
  expect(frame).toContain('slow: 2.5s');
});

test('normalizeTimerText rewrites only the trailing duration token', () => {
  expect(normalizeTimerText('load 100ms check: 5 ms')).toBe('load 100ms check: 5ms');
  expect(normalizeTimerText('wait 30ms: 2500 ms')).toBe('wait 30ms: 2.5s');
  expect(normalizeTimerText('no duration here')).toBe('no duration here');
});

test('stack expansion is keyed by entry id when the entry carries one', () => {
  const es: ConsoleEntry[] = [
    { id: 10, kind: 'error', text: 'first', ts: 1, stack: '    at aFn (x:1)' },
    { id: 11, kind: 'error', text: 'second', ts: 2, stack: '    at bFn (x:2)' },
  ];
  const { lastFrame } = render(<ConsolePanel entries={es} selected={0} expanded={new Set([11])} focused height={6} />);
  const frame = lastFrame()!;
  expect(frame).toContain('at bFn');
  expect(frame).not.toContain('at aFn');
});

test('a snapshotted ctxLabel renders without a live context map', () => {
  const es: ConsoleEntry[] = [{ kind: 'log', text: 'from-frame', ts: 1, ctxId: 2, ctxLabel: 'ads.example.com' }];
  const { lastFrame } = render(<ConsolePanel entries={es} selected={0} expanded={new Set()} focused height={3} width={70} />);
  expect(lastFrame()!).toContain('⟨ads.example.com⟩');
});

test('a message from a non-default context is tagged and a default one is not', () => {
  const es: ConsoleEntry[] = [
    { kind: 'log', text: 'from-frame', ts: 1, ctxId: 2 },
    { kind: 'log', text: 'from-top', ts: 2, ctxId: 1 },
  ];
  const labels = new Map([[2, 'ads.example.com']]);
  const { lastFrame } = render(
    <ConsolePanel entries={es} selected={0} expanded={new Set()} focused height={4} width={70} ctxLabels={labels} />,
  );
  const rows = lastFrame()!.split('\n');
  const framed = rows.find(l => l.includes('from-frame'))!;
  expect(framed).toContain('⟨ads.example.com⟩');
  expect(rows.find(l => l.includes('from-top'))!).not.toContain('⟨');
});

test('the prompt row shows the selected context tag', () => {
  const { lastFrame } = render(
    <ConsolePanel entries={[]} selected={0} expanded={new Set()} focused height={4} width={60} input="doc" ctxLabel="ads.example.com" />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('❯ doc');
  expect(frame).toContain('⟨ads.example.com⟩');
});

test('showTimestamps prefixes each row with a clock time and is off by default', () => {
  const es: ConsoleEntry[] = [{ kind: 'log', text: 'stamped', ts: 1234 }];
  const on = render(<ConsolePanel entries={es} selected={0} expanded={new Set()} focused height={3} width={60} showTimestamps />);
  expect(on.lastFrame()!).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} stamped/);
  const off = render(<ConsolePanel entries={es} selected={0} expanded={new Set()} focused height={3} width={60} />);
  expect(off.lastFrame()!).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
});

test('an eager preview renders dim under the prompt at constant height', () => {
  const many: ConsoleEntry[] = Array.from({ length: 10 }, (_, i) => ({ kind: 'log', text: `l${i}`, ts: i }));
  const { lastFrame } = render(
    <ConsolePanel entries={many} selected={9} expanded={new Set()} focused height={6} width={40} input="1+2" eager="3" />,
  );
  const rows = lastFrame()!.split('\n');
  expect(rows).toHaveLength(6);
  expect(rows[4]).toContain('❯ 1+2');
  expect(rows[5]).toContain('3');
});

const filterable: ConsoleEntry[] = [
  { kind: 'error', text: 'boom happened', ts: 1 },
  { kind: 'exception', text: 'TypeError boom', ts: 2 },
  { kind: 'warn', text: 'careful now', ts: 3 },
  { kind: 'log', text: 'hello boom world', ts: 4 },
];

test('filterConsoleEntries: an error level filter also matches exceptions', () => {
  expect(filterConsoleEntries(filterable, ['error'], '').map(e => e.kind)).toEqual(['error', 'exception']);
  expect(filterConsoleEntries(filterable, ['warn'], '').map(e => e.kind)).toEqual(['warn']);
  expect(filterConsoleEntries(filterable, [], '')).toHaveLength(4);
});

test('filterConsoleEntries: tokens AND-combine and -token negates', () => {
  expect(filterConsoleEntries(filterable, [], 'boom').map(e => e.ts)).toEqual([1, 2, 4]);
  expect(filterConsoleEntries(filterable, [], 'boom hello').map(e => e.ts)).toEqual([4]);
  expect(filterConsoleEntries(filterable, [], 'boom -hello').map(e => e.ts)).toEqual([1, 2]);
  expect(filterConsoleEntries(filterable, [], 'BOOM').map(e => e.ts)).toEqual([1, 2, 4]);
});

test('filterConsoleEntries: levels and text combine', () => {
  expect(filterConsoleEntries(filterable, ['error'], '-type').map(e => e.ts)).toEqual([1]);
});

test('filterConsoleEntries: /regex/ and -/regex/ tokens match and negate case-insensitively', () => {
  const es: ConsoleEntry[] = [
    { kind: 'error', text: 'GET /users/42 failed', ts: 1 },
    { kind: 'log', text: 'GET /users/abc ok', ts: 2 },
    { kind: 'log', text: 'POST /posts', ts: 3 },
  ];
  expect(filterConsoleEntries(es, [], '/users\\/\\d+/').map(e => e.ts)).toEqual([1]);
  expect(filterConsoleEntries(es, [], '/FAILED/').map(e => e.ts)).toEqual([1]);
  expect(filterConsoleEntries(es, [], '-/users/').map(e => e.ts)).toEqual([3]);
  expect(filterConsoleEntries(es, [], '/users/ -/\\d+/').map(e => e.ts)).toEqual([2]);
});

test('filterConsoleEntries: a broken /regex/ falls back to a literal substring match', () => {
  const es: ConsoleEntry[] = [
    { kind: 'log', text: 'has /(/ literal', ts: 1 },
    { kind: 'log', text: 'no match here', ts: 2 },
  ];
  expect(() => filterConsoleEntries(es, [], '/(/')).not.toThrow();
  expect(filterConsoleEntries(es, [], '/(/').map(e => e.ts)).toEqual([1]);
});

test('filterConsoleEntries: input/result rows are exempt from the level filter but not the text filter', () => {
  const repl: ConsoleEntry[] = [
    { kind: 'error', text: 'boom happened', ts: 1 },
    { kind: 'input', text: 'sum(1, 2)', ts: 2 },
    { kind: 'result', text: '3', ts: 3 },
    { kind: 'log', text: 'sum logged', ts: 4 },
  ];
  expect(filterConsoleEntries(repl, ['error'], '').map(e => e.ts)).toEqual([1, 2, 3]);
  expect(filterConsoleEntries(repl, ['error'], 'sum').map(e => e.ts)).toEqual([2]);
  expect(filterConsoleEntries(repl, [], 'sum').map(e => e.ts)).toEqual([2, 4]);
});

test('input and result entries render REPL markers', () => {
  const repl: ConsoleEntry[] = [
    { kind: 'input', text: '1+2', ts: 1 },
    { kind: 'result', text: '3', ts: 2 },
  ];
  const { lastFrame } = render(<ConsolePanel entries={repl} selected={0} expanded={new Set()} focused height={4} width={40} />);
  const frame = lastFrame()!;
  expect(frame).toContain('❯ 1+2');
  expect(frame).toContain('◂ 3');
});

test('an input draft reserves the bottom row as a prompt line at constant height', () => {
  const many: ConsoleEntry[] = Array.from({ length: 10 }, (_, i) => ({ kind: 'log', text: `line${i}`, ts: i }));
  const { lastFrame } = render(
    <ConsolePanel entries={many} selected={9} expanded={new Set()} focused height={5} width={40} input="doc" />,
  );
  const frame = lastFrame()!;
  const rows = frame.split('\n');
  expect(rows).toHaveLength(5);
  expect(rows[4]).toContain('❯ doc');
  expect(frame).toContain('line9');

  const { lastFrame: empty } = render(
    <ConsolePanel entries={[]} selected={0} expanded={new Set()} focused height={5} width={40} input="" />,
  );
  const emptyRows = empty()!.split('\n');
  expect(emptyRows).toHaveLength(5);
  expect(emptyRows[4]).toContain('❯');
  expect(empty()!).toContain('콘솔 출력 없음');
});
