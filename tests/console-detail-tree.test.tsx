import { test, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3';
});
import {
  ConsoleDetailOverlay,
  consoleDetailLines,
  consoleSubtreeText,
  objectTreeLines,
  objectTreeArgAtPath,
  objectTreeSubtreeText,
  type ConsoleChildren,
  type ConsoleDetailTree,
  type ObjectTreeRoot,
} from '../src/tui/overlays/ConsoleDetailOverlay.js';
import { handleConsoleDetailKey } from '../src/tui/keys/console-keys.js';
import type { ConsoleTool } from '../src/tui/hooks/use-console-tool.js';
import type { DebugSession } from '../src/engine.js';
import type { ConsoleEntry } from '../src/store/types.js';
import type { Key } from 'ink';

const SEP = '';

const objEntry: ConsoleEntry = {
  kind: 'log',
  text: 'user: {a: 1, b: Object}',
  ts: 0,
  args: [
    { type: 'string', value: 'user:' },
    {
      type: 'object', objectId: 'obj-1',
      preview: {
        type: 'object', description: 'Object',
        properties: [
          { name: 'a', type: 'number', value: '1' },
          { name: 'b', type: 'object', value: 'Object' },
        ],
      },
    },
  ],
};

const PROPS: Record<string, Array<{ name: string; value: any }>> = {
  'obj-1': [
    { name: 'a', value: { type: 'number', value: 1 } },
    { name: 'b', value: { type: 'object', objectId: 'obj-2', preview: { type: 'object', description: 'Object', properties: [{ name: 'c', type: 'number', value: '2' }] } } },
  ],
  'obj-2': [{ name: 'c', value: { type: 'number', value: 2 } }],
};

interface HarnessOpts {
  pageH?: number;
  failIds?: string[];
  noSession?: boolean;
  countCalls?: { n: number };
}

function makeHarness(entry: ConsoleEntry, opts: HarnessOpts = {}) {
  const st = {
    entry: entry as ConsoleEntry | null,
    scroll: 0,
    cursor: 0,
    wrap: true,
    expanded: new Set<string>(),
    children: new Map<string, ConsoleChildren>(),
  };
  const apply = <T,>(cur: T, v: T | ((p: T) => T)): T => (typeof v === 'function' ? (v as (p: T) => T)(cur) : v);
  const con = {
    get conDetailCursor() { return st.cursor; },
    get conDetailExpanded() { return st.expanded; },
    get conDetailChildren() { return st.children; },
    setConDetailEntry: (v: any) => { st.entry = apply(st.entry, v); },
    setConDetailScroll: (v: any) => { st.scroll = apply(st.scroll, v); },
    setConDetailCursor: (v: any) => { st.cursor = apply(st.cursor, v); },
    setConDetailWrap: (v: any) => { st.wrap = apply(st.wrap, v); },
    setConDetailExpanded: (v: any) => { st.expanded = apply(st.expanded, v); },
    setConDetailChildren: (v: any) => { st.children = apply(st.children, v); },
    resetConDetail: () => { st.scroll = 0; st.cursor = 0; st.expanded = new Set(); st.children = new Map(); },
  } as unknown as ConsoleTool;
  const session = opts.noSession ? undefined : ({
    getProperties: async (objectId: string) => {
      if (opts.countCalls) opts.countCalls.n++;
      if (opts.failIds?.includes(objectId)) throw new Error('Could not find object with given id');
      return PROPS[objectId] ?? [];
    },
  } as unknown as DebugSession);
  const copied: string[] = [];
  const gPending = { current: false };
  const lines = () => consoleDetailLines(entry, 80, false, { expanded: st.expanded, children: st.children });
  const press = (input: string, key: Partial<Key> = {}) => {
    handleConsoleDetailKey(
      {
        con,
        detailEntry: entry,
        lines: lines(),
        pageH: opts.pageH ?? 10,
        session,
        gPending,
        copyFn: async t => { copied.push(t); },
        setToast: () => {},
        withEditor: async () => null,
        whenNotEditing: fn => fn(),
      },
      input,
      { escape: false, return: false, ctrl: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, ...key } as Key,
    );
  };
  const tick = () => new Promise<void>(r => setTimeout(r, 0));
  return { st, con, copied, press, lines, tick };
}

test('args with objectIds render expandable roots only when a tree is supplied', () => {
  const tree: ConsoleDetailTree = { expanded: new Set(), children: new Map() };
  const withTree = consoleDetailLines(objEntry, 80, false, tree);
  const root = withTree.find(l => l.node);
  expect(root?.text).toBe('▸ {a: 1, b: Object}');
  expect(root?.node).toEqual({ path: 'a1', objectId: 'obj-1' });
  const without = consoleDetailLines(objEntry, 80, false);
  expect(without.some(l => l.node !== undefined || l.text.includes('▸'))).toBe(false);
});

test('enter fetches children, renders them indented, nests, and h collapses', async () => {
  const h = makeHarness(objEntry);
  h.press('j');
  h.press('j');
  expect(h.st.cursor).toBe(2);
  h.press('', { return: true });
  await h.tick();
  expect(h.st.expanded.has('a1')).toBe(true);
  let texts = h.lines().map(l => l.text);
  expect(texts[2]).toBe('▾ {a: 1, b: Object}');
  expect(texts[3]).toBe('    a: 1');
  expect(texts[4]).toBe('  ▸ b: {c: 2}');
  h.press('j');
  h.press('j');
  h.press('l');
  await h.tick();
  texts = h.lines().map(l => l.text);
  expect(texts[4]).toBe('  ▾ b: {c: 2}');
  expect(texts[5]).toBe('      c: 2');
  h.press('h');
  expect(h.st.expanded.has(`a1${SEP}b`)).toBe(false);
  expect(h.lines().map(l => l.text)[4]).toBe('  ▸ b: {c: 2}');
});

test('space toggles a root and re-expanding reuses the cached children', async () => {
  const countCalls = { n: 0 };
  const h = makeHarness(objEntry, { countCalls });
  h.press('j');
  h.press('j');
  h.press(' ');
  await h.tick();
  expect(h.st.expanded.has('a1')).toBe(true);
  h.press(' ');
  expect(h.st.expanded.has('a1')).toBe(false);
  h.press(' ');
  await h.tick();
  expect(h.st.expanded.has('a1')).toBe(true);
  expect(countCalls.n).toBe(1);
});

test('cursor movement follows with a clamped scroll window', () => {
  const tall: ConsoleEntry = { kind: 'log', text: Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n'), ts: 0 };
  const h = makeHarness(tall, { pageH: 5 });
  for (let i = 0; i < 10; i++) h.press('j');
  expect(h.st.cursor).toBe(10);
  expect(h.st.scroll).toBe(6);
  h.press('G');
  expect(h.st.cursor).toBe(29);
  expect(h.st.scroll).toBe(25);
  h.press('g');
  h.press('g');
  expect(h.st.cursor).toBe(0);
  expect(h.st.scroll).toBe(0);
  h.press('k');
  expect(h.st.cursor).toBe(0);
  h.press('d', { ctrl: true });
  expect(h.st.cursor).toBe(2);
});

test('y on an expandable node copies the fetched subtree as JSON-ish text', async () => {
  const h = makeHarness(objEntry);
  h.press('j');
  h.press('j');
  h.press('', { return: true });
  await h.tick();
  h.press('j');
  h.press('j');
  h.press('l');
  await h.tick();
  h.press('k');
  h.press('k');
  expect(h.st.cursor).toBe(2);
  h.press('y');
  await h.tick();
  expect(h.copied[0]).toBe('{\n  a: 1,\n  b: {\n    c: 2\n  }\n}');
  h.press('g');
  h.press('g');
  h.press('y');
  await h.tick();
  expect(h.copied[1]).toBe('user: {a: 1, b: Object}');
});

test('consoleSubtreeText falls back to the inline preview for unfetched children', () => {
  const tree: ConsoleDetailTree = { expanded: new Set(), children: new Map() };
  expect(consoleSubtreeText(objEntry, tree, 'a1')).toBe('{a: 1, b: Object}');
});

test('a failed getProperties degrades to a dim stale marker without throwing', async () => {
  const h = makeHarness(objEntry, { failIds: ['obj-1'] });
  h.press('j');
  h.press('j');
  h.press('', { return: true });
  await h.tick();
  expect(h.st.children.get('obj-1')).toBe('stale');
  const stale = h.lines().find(l => l.text.includes('(만료된 객체)'));
  expect(stale).toBeDefined();
  expect(stale!.segs![0].dim).toBe(true);
});

test('without a session an expandable node simply does not expand', () => {
  const h = makeHarness(objEntry, { noSession: true });
  h.press('j');
  h.press('j');
  h.press('', { return: true });
  expect(h.st.expanded.size).toBe(0);
});

test('the overlay inverts the cursor line', () => {
  const tree: ConsoleDetailTree = { expanded: new Set(), children: new Map() };
  const lines = consoleDetailLines(objEntry, 80, false, tree);
  const { lastFrame } = render(
    <ConsoleDetailOverlay entry={objEntry} scroll={0} height={12} width={80} lines={lines} cursor={2} />,
  );
  expect(lastFrame()).toContain('[7m');
});

const sectionRoots: ObjectTreeRoot[] = [
  {
    name: 'props',
    arg: {
      type: 'object', objectId: 'obj-1',
      preview: { type: 'object', description: 'Object', properties: [{ name: 'a', type: 'number', value: '1' }] },
    },
  },
  { name: 'hooks (raw)', arg: { type: 'object', subtype: 'array', objectId: 'obj-2', description: 'Array(1)' } },
];

test('objectTreeLines renders named expandable roots with indexed paths', () => {
  const tree: ConsoleDetailTree = { expanded: new Set(), children: new Map() };
  const lines = objectTreeLines(sectionRoots, tree);
  expect(lines).toHaveLength(2);
  expect(lines[0].text).toContain('▸ props:');
  expect(lines[0].node).toEqual({ path: 's0', objectId: 'obj-1' });
  expect(lines[1].node).toEqual({ path: 's1', objectId: 'obj-2' });
  const opened = objectTreeLines(sectionRoots, {
    expanded: new Set(['s0']),
    children: new Map([['obj-1', [{ name: 'a', value: { type: 'number', value: 1 } }]]]),
  });
  expect(opened.map(l => l.text)).toContain('    a: 1');
});

test('objectTreeArgAtPath descends fetched children and subtree text matches', () => {
  const tree: ConsoleDetailTree = {
    expanded: new Set(['s0']),
    children: new Map([['obj-1', [{ name: 'a', value: { type: 'number', value: 1 } }]]]),
  };
  expect(objectTreeArgAtPath(sectionRoots, tree, 's0')?.objectId).toBe('obj-1');
  expect(objectTreeArgAtPath(sectionRoots, tree, `s0${SEP}a`)).toEqual({ type: 'number', value: 1 });
  expect(objectTreeArgAtPath(sectionRoots, tree, 's9')).toBeUndefined();
  expect(objectTreeSubtreeText(sectionRoots, tree, 's0')).toBe('{\n  a: 1\n}');
});

const tableEntry: ConsoleEntry = {
  kind: 'log', text: 'console.table',
  ts: 0,
  args: [{
    type: 'object', subtype: 'array', objectId: 'tbl',
    preview: {
      type: 'object', subtype: 'array',
      properties: [{ name: '0', type: 'object', valuePreview: { type: 'object', properties: [{ name: 'x', type: 'number', value: '1' }] } }],
    },
  }],
};

test('a detected table renders the grid yet keeps arg[0] expandable via getProperties', async () => {
  const countCalls = { n: 0 };
  const h = makeHarness(tableEntry, { countCalls });
  const rootIdx = h.lines().findIndex(l => l.node);
  expect(h.lines().some(l => l.text.includes('(index)'))).toBe(true);
  expect(rootIdx).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < rootIdx; i++) h.press('j');
  h.press('', { return: true });
  await h.tick();
  expect(h.st.expanded.has('a0')).toBe(true);
  expect(countCalls.n).toBe(1);
});
