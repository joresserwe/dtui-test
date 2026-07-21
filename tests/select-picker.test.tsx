import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SelectPicker, toggleSelection, type SelectPickerItem } from '../src/tui/overlays/SelectPicker.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ESC = '';

const ITEMS: SelectPickerItem[] = [
  { value: 'all', label: '모두', exclusive: true },
  { value: 'xhr', label: 'xhr' },
  { value: 'js', label: 'js' },
];

const GROUPED: SelectPickerItem[] = [
  { value: 'size', label: 'size' },
  { value: 'name', label: 'Name', group: 'label' },
  { value: 'url', label: 'URL', group: 'label' },
];

test('renders title, counter, rows and footer in the telescope style', () => {
  const frame = render(
    <SelectPicker title="타입 필터" items={ITEMS} multi initial={['all']} onCancel={() => {}} />,
  ).lastFrame()!;
  expect(frame).toContain('타입 필터');
  expect(frame).toContain('1/3');
  expect(frame).toContain('❯');
  expect(frame).toContain('●');
  expect(frame).toContain('모두');
  expect(frame).toContain('␣ 선택 · ⏎ 적용 · esc');
  expect(frame).toContain('╭');
});

test('the footer hint renders untruncated at a normal terminal width', () => {
  const sortItems: SelectPickerItem[] = [
    { value: 'arrival', label: '기본(도착순)' },
    { value: 'time', label: '시간(duration)' },
    { value: 'size', label: '크기(size)' },
  ];
  const footer = '⏎ 선택 · h/l 방향 · esc';
  const frame = render(
    <SelectPicker title="정렬" items={sortItems} directional footer={footer} onCancel={() => {}} />,
  ).lastFrame()!;
  const footerLine = frame.split('\n').find(l => l.includes('선택'))!;
  expect(footerLine).toContain(footer);
  expect(footerLine).not.toContain('…');
});

test('a tiny terminal clamps the picker without breaking the border', () => {
  const frame = render(
    <SelectPicker title="정렬" items={ITEMS} directional footer="⏎ 선택 · h/l 방향 · esc" width={20} onCancel={() => {}} />,
  ).lastFrame()!;
  const lines = frame.split('\n');
  const top = lines.find(l => l.includes('╭'))!;
  const bottom = lines.find(l => l.includes('╰'))!;
  expect([...top].filter(c => c === '─').length).toBe([...bottom].filter(c => c === '─').length);
});

test('j/k move the caret between rows', async () => {
  const { lastFrame, stdin } = render(
    <SelectPicker title="t" items={ITEMS} multi onCancel={() => {}} />,
  );
  const caretRow = () => lastFrame()!.split('\n').find(l => l.includes('❯'))!;
  expect(caretRow()).toContain('모두');
  stdin.write('j');
  await sleep(20);
  expect(caretRow()).toContain('xhr');
  stdin.write('k');
  await sleep(20);
  expect(caretRow()).toContain('모두');
});

test('multi: space toggles, Enter applies checked values in item order, Esc cancels', async () => {
  let applied: string[] | undefined;
  let cancelled = false;
  const { stdin, lastFrame } = render(
    <SelectPicker title="t" items={ITEMS} multi onApply={v => { applied = v; }} onCancel={() => { cancelled = true; }} />,
  );
  stdin.write('j');
  await sleep(20);
  stdin.write(' ');
  await sleep(20);
  expect(lastFrame()).toContain('●');
  stdin.write('j');
  await sleep(20);
  stdin.write(' ');
  await sleep(20);
  stdin.write('\r');
  await sleep(20);
  expect(applied).toEqual(['xhr', 'js']);
  stdin.write(ESC);
  await sleep(20);
  expect(cancelled).toBe(true);
});

test('single: Enter picks the highlighted value and initial sets the caret', async () => {
  let picked: string | undefined;
  const { stdin } = render(
    <SelectPicker title="t" items={ITEMS} initial={['xhr']} onPick={v => { picked = v; }} onCancel={() => {}} />,
  );
  stdin.write('\r');
  await sleep(20);
  expect(picked).toBe('xhr');
});

test('single directional: h and l pick with an explicit direction', async () => {
  const picks: Array<[string, string | undefined]> = [];
  const { stdin } = render(
    <SelectPicker title="t" items={ITEMS} directional onPick={(v, d) => { picks.push([v, d]); }} onCancel={() => {}} />,
  );
  stdin.write('h');
  await sleep(20);
  stdin.write('l');
  await sleep(20);
  expect(picks).toEqual([['all', 'asc'], ['all', 'desc']]);
});

test('hintAlign right pads between the label and the hint', () => {
  const items: SelectPickerItem[] = [
    { value: 'a', label: 'https://a.test/quite/long/pattern', hint: '200 · on' },
    { value: 'b', label: 'short', hint: '503 · off' },
  ];
  const frame = render(
    <SelectPicker title="t" items={items} hintAlign="right" onCancel={() => {}} />,
  ).lastFrame()!;
  const row = frame.split('\n').find(l => l.includes('short'))!;
  expect(row).toMatch(/short\s{3,}503 · off/);
});

test('toggleSelection: exclusive item clears the rest and vice versa', () => {
  expect([...toggleSelection(ITEMS, new Set(['xhr', 'js']), 'all')]).toEqual(['all']);
  expect([...toggleSelection(ITEMS, new Set(['all']), 'xhr')]).toEqual(['xhr']);
  expect([...toggleSelection(ITEMS, new Set(['xhr']), 'xhr')]).toEqual([]);
});

test('toggleSelection: grouped items behave like radio buttons', () => {
  expect([...toggleSelection(GROUPED, new Set(['size', 'name']), 'url')].sort()).toEqual(['size', 'url']);
  expect([...toggleSelection(GROUPED, new Set(['name']), 'name')]).toEqual(['name']);
});
