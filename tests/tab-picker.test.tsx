import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TabPicker, pickerItems, type PickerSection, type PickerItem, type PickerSessionRow } from '../src/tui/overlays/TabPicker.js';
import type { TabGroup } from '../src/tui/lib/tabs-model.js';

const chrome: PickerSection = {
  browser: 'Chrome',
  groups: [
    { windowId: 10, tabs: [
      { id: 'a', title: 'CHZZK live', url: 'https://chzzk.naver.com/', wsUrl: 'ws://x' },
      { id: 'b', title: '', url: 'https://untitled.test/dashboard', wsUrl: 'ws://x' },
    ] },
    { windowId: 11, tabs: [
      { id: 'c', title: 'Docs', url: 'https://docs.test/guide', wsUrl: 'ws://x' },
    ] },
  ],
};

const firefox: PickerSection = {
  browser: 'Firefox',
  groups: [
    { windowId: 20, tabs: [
      { id: 'd', title: 'Mail', url: 'https://mail.test/inbox', wsUrl: 'ws://x' },
    ] },
  ],
};

const sections = [chrome, firefox];

const tabIds = (items: PickerItem[]) => items.flatMap(it => (it.kind === 'tab' ? [it.tab.id] : []));
const lines = (el: React.ReactElement) => render(el).lastFrame()!.split('\n');
const lineCount = (el: React.ReactElement) => lines(el).length;

test('flattens sections in order and always appends new-tab last', () => {
  const items = pickerItems(sections, '');
  expect(tabIds(items)).toEqual(['a', 'b', 'c', 'd']);
  expect(items[items.length - 1]).toEqual({ kind: 'new-tab' });
  expect(items.filter(it => it.kind === 'new-tab')).toHaveLength(1);
});

test('fuzzy filter matches a case-insensitive subsequence of title + url', () => {
  expect(tabIds(pickerItems([chrome], 'chzk'))).toEqual(['a']);
  expect(tabIds(pickerItems([chrome], 'CHZK'))).toEqual(['a']);
});

test('fuzzy filter matches title or url and keeps new-tab even with no tab match', () => {
  expect(tabIds(pickerItems([chrome], 'docs'))).toEqual(['c']);
  expect(tabIds(pickerItems([chrome], 'dashboard'))).toEqual(['b']);
  const none = pickerItems([chrome], 'zzzzz');
  expect(tabIds(none)).toEqual([]);
  expect(none).toEqual([{ kind: 'new-tab' }]);
});

test('otherWindow is relative to the attached tab within the same section', () => {
  const items = pickerItems([chrome], '', 'a').filter(it => it.kind === 'tab');
  expect(items.map(it => [it.tab.id, it.kind === 'tab' && it.otherWindow])).toEqual([
    ['a', false],
    ['b', false],
    ['c', true],
  ]);
});

test('otherWindow is false when the attached tab lives in a different section', () => {
  const items = pickerItems(sections, '', 'a').filter(it => it.kind === 'tab');
  const mail = items.find(it => it.kind === 'tab' && it.tab.id === 'd')!;
  expect(mail.kind === 'tab' && mail.otherWindow).toBe(false);
});

test('otherWindow is false everywhere when no tab is attached', () => {
  const items = pickerItems([chrome], '').filter(it => it.kind === 'tab');
  expect(items.every(it => it.kind === 'tab' && it.otherWindow === false)).toBe(true);
});

test('renders title, count, search line and footer', () => {
  const frame = render(<TabPicker sections={sections} query="" selected={0} height={16} />).lastFrame()!;
  expect(frame).toContain('탭 전환');
  expect(frame).toContain('4/4');
  expect(frame).toContain('❯ ▌');
  expect(frame).toContain('CHZZK live');
  expect(frame).toContain('새 탭 열기');
  expect(frame).toContain('⏎ 보기/연결');
});

test('the count reflects only matching tabs', () => {
  const frame = render(<TabPicker sections={[chrome]} query="docs" selected={0} height={14} />).lastFrame()!;
  expect(frame).toContain('1/3');
  expect(frame).toContain('❯ docs▌');
  expect(frame).toContain('Docs');
  expect(frame).not.toContain('CHZZK');
});

test('shows section headers only when more than one section', () => {
  const multi = render(<TabPicker sections={sections} query="" selected={0} height={16} />).lastFrame()!;
  expect(multi).toContain('Chrome');
  expect(multi).toContain('Firefox');

  const single = render(<TabPicker sections={[chrome]} query="" selected={0} height={16} />).lastFrame()!;
  expect(single).not.toContain('Chrome');
});

test('marks the attached tab and tags tabs in another window of its section', () => {
  const frame = render(<TabPicker sections={[chrome]} query="" selected={0} attachedId="a" height={14} />).lastFrame()!;
  expect(frame).toContain('▸ CHZZK live');
  expect(frame).toContain('(다른 창)');
  expect(frame).toContain('Docs');
});

test('shows the empty-tabs notice above the new-tab row when nothing matches', () => {
  const frame = render(<TabPicker sections={[chrome]} query="zzzzz" selected={0} height={14} />).lastFrame()!;
  expect(frame).toContain('일치하는 탭 없음');
  expect(frame).toContain('새 탭 열기');
  expect(frame).toContain('0/3');
});

test('the new-tab row is selectable', () => {
  const items = pickerItems([chrome], '');
  const last = items.length - 1;
  const frame = render(<TabPicker sections={[chrome]} query="" selected={last} height={14} />).lastFrame()!;
  const row = frame.split('\n').find(l => l.includes('새 탭 열기'))!;
  expect(row).toContain('❯');
});

const many: PickerSection[] = [
  { browser: 'Chrome', groups: [{ windowId: 1, tabs: Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`, title: `Chrome tab ${i}`, url: `https://c.test/${i}`, wsUrl: 'ws://x',
  })) }] },
  { browser: 'Firefox', groups: [{ windowId: 2, tabs: Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, title: `Firefox tab ${i}`, url: `https://f.test/${i}`, wsUrl: 'ws://x',
  })) }] },
];

test('renders exactly height rows across every state', () => {
  for (const height of [14, 20, 8]) {
    expect(lineCount(<TabPicker sections={many} query="" selected={0} height={height} />)).toBe(height);
    expect(lineCount(<TabPicker sections={many} query="" selected={59} height={height} />)).toBe(height);
    expect(lineCount(<TabPicker sections={many} query="tab" selected={40} height={height} />)).toBe(height);
    expect(lineCount(<TabPicker sections={sections} query="" selected={0} height={height} />)).toBe(height);
    expect(lineCount(<TabPicker sections={[chrome]} query="zzzzz" selected={0} height={height} />)).toBe(height);
    expect(lineCount(<TabPicker sections={[]} query="" selected={0} height={height} />)).toBe(height);
  }
});

test('windows the display rows so a deep selection stays visible past section headers', () => {
  const frame = render(<TabPicker sections={many} query="" selected={59} height={14} />).lastFrame()!;
  expect(frame).toContain('Firefox tab 29');
  expect(frame).not.toContain('Chrome tab 0');
});

test('keeps the first selection anchored to the top', () => {
  const frame = render(<TabPicker sections={many} query="" selected={0} height={14} />).lastFrame()!;
  expect(frame).toContain('Chrome tab 0');
  expect(frame).not.toContain('Firefox tab 29');
});

test('short rows never gain a spurious ellipsis, even with wide CJK text', () => {
  const cjk: PickerSection[] = [{
    browser: 'Chrome',
    groups: [
      { windowId: 1, tabs: [
        { id: 'a', title: '네이버 메일', url: 'https://mail.naver.com/', wsUrl: 'ws://x' },
        { id: 'b', title: 'Short', url: 'https://s.test/', wsUrl: 'ws://x' },
      ] },
      { windowId: 2, tabs: [
        { id: 'c', title: 'Docs', url: 'https://docs.test/', wsUrl: 'ws://x' },
      ] },
    ],
  }];
  const frame = render(
    <TabPicker sections={cjk} query="" selected={1} attachedId="a" height={12} width={80} />,
  ).lastFrame()!;
  for (const line of frame.split('\n')) {
    if (line.includes('새 탭')) continue;
    expect(line).not.toContain('…');
  }
});

test('honours an explicit width', () => {
  const frame = render(<TabPicker sections={sections} query="" selected={0} height={12} width={50} />).lastFrame()!;
  expect(frame.split('\n')[0].length).toBe(50);
});

const session = (over: Partial<PickerSessionRow> = {}): PickerSessionRow => ({
  key: 'ep#a',
  targetId: 'a',
  title: 'CHZZK live',
  url: 'https://chzzk.naver.com/',
  count: 12,
  status: 'live',
  viewed: false,
  ...over,
});

test('sessions come first, their tabs leave the tab group, and new-tab stays last', () => {
  const items = pickerItems([chrome], '', 'a', [session()]);
  expect(items[0].kind).toBe('session');
  expect(tabIds(items)).toEqual(['b', 'c']);
  expect(items[items.length - 1]).toEqual({ kind: 'new-tab' });
});

test('fuzzy filtering spans both the session and tab groups', () => {
  const chzk = pickerItems([chrome], 'chzk', 'a', [session()]);
  expect(chzk.filter(it => it.kind === 'session')).toHaveLength(1);
  expect(tabIds(chzk)).toEqual([]);
  const docs = pickerItems([chrome], 'docs', 'a', [session()]);
  expect(docs.filter(it => it.kind === 'session')).toHaveLength(0);
  expect(tabIds(docs)).toEqual(['c']);
});

test('renders the 세션/탭 section headers with the session row body', () => {
  const frame = render(
    <TabPicker sections={[chrome]} query="" selected={0} attachedId="a" sessions={[session({ viewed: true })]} height={16} />,
  ).lastFrame()!;
  const rows = frame.split('\n');
  const si = rows.findIndex(l => l.includes('── 세션 ─'));
  const ti = rows.findIndex(l => l.includes('── 탭 ─'));
  expect(si).toBeGreaterThan(-1);
  expect(ti).toBeGreaterThan(si);
  expect(rows[si + 1]).toContain('▸ CHZZK live');
  expect(rows[si + 1]).toContain('12건 · chzzk.naver.com/');
});

test('headers are display-only: selection indices land on session then tab rows', () => {
  const el = (sel: number) => render(
    <TabPicker sections={[chrome]} query="" selected={sel} attachedId="a" sessions={[session()]} height={16} />,
  ).lastFrame()!;
  const hit = (frame: string) => frame.split('\n').find(l => l.includes('❯') && !l.includes('❯ ▌'))!;
  expect(hit(el(0))).toContain('CHZZK live');
  expect(hit(el(1))).toContain('untitled.test/dashboard');
});

test('session rows mark reconnecting with ↻ and background live with ●', () => {
  const frame = render(
    <TabPicker
      sections={[chrome]}
      query=""
      selected={0}
      sessions={[session(), session({ key: 'ep#c', targetId: 'c', title: 'Docs', url: 'https://docs.test/guide', status: 'reconnecting' })]}
      height={16}
    />,
  ).lastFrame()!;
  expect(frame).toContain('● CHZZK live');
  expect(frame).toContain('↻ Docs');
});

test('plain tabs carry a ○ gutter under the 탭 header', () => {
  const frame = render(
    <TabPicker sections={[chrome]} query="" selected={0} attachedId="a" sessions={[session({ viewed: true })]} height={16} />,
  ).lastFrame()!;
  expect(frame).toContain('○ Docs');
});
