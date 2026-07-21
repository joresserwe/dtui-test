import { test, expect } from 'vitest';
import { ConsoleStore, persistableConsoleEntry } from '../src/store/console.js';

const objectArg = (objectId: string, props: Array<[string, string, string]> = [['a', 'number', '1']]) => ({
  type: 'object', className: 'Object', description: 'Object', objectId,
  preview: { type: 'object', description: 'Object', overflow: false, properties: props.map(([name, type, value]) => ({ name, type, value })) },
});

test('formats consoleAPICalled args and maps warning kind', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'warning', timestamp: 1700000000500,
    args: [
      { type: 'string', value: 'count:' },
      { type: 'number', value: 3 },
      { type: 'object', description: 'Object', preview: {} },
      { type: 'undefined' },
    ],
    stackTrace: { callFrames: [{ functionName: 'doIt', url: 'https://a.test/app.js', lineNumber: 119 }] },
  });
  const [e] = store.entries();
  expect(e).toMatchObject({ kind: 'warn', text: 'count: 3 Object undefined', ts: 1700000000500 });
  expect(e.stack).toContain('doIt (https://a.test/app.js:120)');
});

test('maps timeEnd to a timer kind and keeps the backend duration text', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'timeEnd', timestamp: 1, args: [{ type: 'string', value: 'mylabel: 1.5 ms' }],
  });
  const [e] = store.entries();
  expect(e.kind).toBe('timer');
  expect(e.text).toBe('mylabel: 1.5 ms');
});

test('maps trace to a trace kind and captures the stack frames', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'trace', timestamp: 1, args: [{ type: 'string', value: 'traced!' }],
    stackTrace: { callFrames: [
      { functionName: 'inner', url: 'https://a.test/app.js', lineNumber: 4 },
      { functionName: 'outer', url: 'https://a.test/app.js', lineNumber: 9 },
    ] },
  });
  const [e] = store.entries();
  expect(e.kind).toBe('trace');
  expect(e.text).toBe('traced!');
  expect(e.stack).toContain('at inner (https://a.test/app.js:5)');
  expect(e.stack).toContain('at outer (https://a.test/app.js:10)');
});

test('captures exceptions with location', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.exceptionThrown', {
    timestamp: 1700000001000,
    exceptionDetails: {
      text: 'Uncaught', lineNumber: 41, url: 'https://a.test/app.js',
      exception: { description: "TypeError: Cannot read properties of undefined (reading 'id')\n    at app.js:42" },
    },
  });
  const [e] = store.entries();
  expect(e.kind).toBe('exception');
  expect(e.text).toContain('TypeError');
  expect(e.url).toBe('https://a.test/app.js');
  expect(e.line).toBe(42);
});

test('maps Log.entryAdded levels', () => {
  const store = new ConsoleStore();
  const feed = (level: string) =>
    store.handleEvent('Log.entryAdded', { entry: { level, text: `msg-${level}`, timestamp: 1, url: 'https://a.test/' } });
  ['error', 'warning', 'info'].forEach(feed);
  expect(store.entries().map(e => e.kind)).toEqual(['error', 'warn', 'browser']);
});

test('clear() empties entries, resets dropped, and emits update', () => {
  const store = new ConsoleStore(2);
  for (let i = 0; i < 3; i++) {
    store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: i, args: [{ type: 'number', value: i }] });
  }
  expect(store.dropped).toBe(1);
  let updated = false;
  store.on('update', () => { updated = true; });
  store.clear();
  expect(store.entries()).toEqual([]);
  expect(store.dropped).toBe(0);
  expect(updated).toBe(true);
});

test('consecutive identical entries collapse into one with a count and a refreshed ts', () => {
  const store = new ConsoleStore();
  const feed = (ts: number) =>
    store.handleEvent('Runtime.consoleAPICalled', {
      type: 'log', timestamp: ts, args: [{ type: 'string', value: 'ping' }],
      stackTrace: { callFrames: [{ functionName: 'f', url: 'https://a.test/app.js', lineNumber: 1 }] },
    });
  feed(100);
  feed(200);
  feed(300);
  const items = store.entries();
  expect(items).toHaveLength(1);
  expect(items[0].count).toBe(3);
  expect(items[0].ts).toBe(300);
});

test('non-consecutive duplicates and different stacks do not collapse', () => {
  const store = new ConsoleStore();
  const feed = (text: string, stack?: string) =>
    store.handleEvent('Runtime.consoleAPICalled', {
      type: 'log', timestamp: 1, args: [{ type: 'string', value: text }],
      ...(stack ? { stackTrace: { callFrames: [{ functionName: stack, url: 'https://a.test/app.js', lineNumber: 1 }] } } : {}),
    });
  feed('a');
  feed('b');
  feed('a');
  feed('a', 'other');
  expect(store.entries().map(e => [e.text, e.count ?? 1])).toEqual([
    ['a', 1],
    ['b', 1],
    ['a', 1],
    ['a', 1],
  ]);
});

test('a differing kind breaks the collapse run', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [{ type: 'string', value: 'x' }] });
  store.handleEvent('Runtime.consoleAPICalled', { type: 'error', timestamp: 2, args: [{ type: 'string', value: 'x' }] });
  expect(store.entries().map(e => e.kind)).toEqual(['log', 'error']);
});

test('collapsed occurrences still emit one entry event each for persistence', () => {
  const store = new ConsoleStore();
  const seen: number[] = [];
  store.on('entry', e => seen.push(e.ts));
  for (const ts of [1, 2, 3]) {
    store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: ts, args: [{ type: 'string', value: 'dup' }] });
  }
  expect(seen).toEqual([1, 2, 3]);
  expect(store.entries()).toHaveLength(1);
});

test('object args render their preview in text and stay on the entry with objectId', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1,
    args: [{ type: 'string', value: 'user:' }, objectArg('obj-1')],
  });
  const [e] = store.entries();
  expect(e.text).toBe('user: {a: 1}');
  expect(e.args).toHaveLength(2);
  expect(e.args![1]).toMatchObject({ objectId: 'obj-1', preview: { type: 'object' } });
});

test('plain primitive args do not attach an args array', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1,
    args: [{ type: 'string', value: 'hi' }, { type: 'number', value: 3 }],
  });
  expect(store.entries()[0].args).toBeUndefined();
});

test('format specifiers substitute through the store text', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1,
    args: [
      { type: 'string', value: '%c%s took %dms' },
      { type: 'string', value: 'color: red' },
      { type: 'string', value: 'fetch' },
      { type: 'number', value: 12.7 },
    ],
  });
  expect(store.entries()[0].text).toBe('fetch took 12ms');
});

test('exceptionThrown keeps the exception object as an expandable arg', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.exceptionThrown', {
    timestamp: 1,
    exceptionDetails: {
      text: 'Uncaught', lineNumber: 1, url: 'https://a.test/app.js',
      exception: { type: 'object', subtype: 'error', className: 'TypeError', description: 'TypeError: boom', objectId: 'err-1' },
    },
  });
  const [e] = store.entries();
  expect(e.args).toHaveLength(1);
  expect(e.args![0]).toMatchObject({ objectId: 'err-1', subtype: 'error' });
});

test('entries with distinct objectIds but identical text still collapse', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [objectArg('obj-1')] });
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [objectArg('obj-2')] });
  const items = store.entries();
  expect(items).toHaveLength(1);
  expect(items[0].count).toBe(2);
  expect(items[0].args![0].objectId).toBe('obj-1');
});

test('differing previews produce different text and do not collapse', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [objectArg('obj-1', [['a', 'number', '1']])] });
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [objectArg('obj-2', [['a', 'number', '2']])] });
  expect(store.entries()).toHaveLength(2);
});

test('persistableConsoleEntry strips objectIds and keeps previews', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [objectArg('obj-1')] });
  const persisted = persistableConsoleEntry(store.entries()[0]);
  expect(persisted.id).toBeUndefined();
  expect(persisted.args![0].objectId).toBeUndefined();
  expect(persisted.args![0].preview).toMatchObject({ type: 'object' });
  expect(persisted.text).toBe('{a: 1}');
  const plain = { kind: 'log' as const, text: 'x', ts: 1 };
  expect(persistableConsoleEntry(plain)).toBe(plain);
});

test('caps entries', () => {
  const store = new ConsoleStore(2);
  for (let i = 0; i < 3; i++) {
    store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: i, args: [{ type: 'number', value: i }] });
  }
  expect(store.entries().map(e => e.text)).toEqual(['1', '2']);
  expect(store.dropped).toBe(1);
});

test('entries get monotonic ids that survive eviction and stay unique across clear', () => {
  const store = new ConsoleStore(2);
  for (let i = 0; i < 3; i++) {
    store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: i, args: [{ type: 'number', value: i }] });
  }
  expect(store.entries().map(e => e.id)).toEqual([2, 3]);
  store.clear();
  store.push({ kind: 'input', text: 'x', ts: 1 });
  expect(store.entries()[0].id).toBe(4);
});

test('a collapsed run keeps the id of its first occurrence', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [{ type: 'string', value: 'dup' }] });
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [{ type: 'string', value: 'dup' }] });
  const [e] = store.entries();
  expect(e.id).toBe(1);
  expect(e.count).toBe(2);
});

test('entries() returns a stable array until the store mutates', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [{ type: 'string', value: 'a' }] });
  const first = store.entries();
  expect(store.entries()).toBe(first);
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [{ type: 'string', value: 'a' }] });
  const collapsed = store.entries();
  expect(collapsed).not.toBe(first);
  store.push({ kind: 'input', text: 'x', ts: 3 });
  const pushed = store.entries();
  expect(pushed).not.toBe(collapsed);
  store.clear();
  expect(store.entries()).not.toBe(pushed);
});

test('ctxLabelFor snapshots the context label onto the entry at ingest', () => {
  const store = new ConsoleStore();
  store.ctxLabelFor = id => (id === 2 ? 'ads.example.com' : undefined);
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1, args: [{ type: 'string', value: 'framed' }], executionContextId: 2,
  });
  store.handleEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 2, args: [{ type: 'string', value: 'top' }], executionContextId: 1,
  });
  const [framed, top] = store.entries();
  expect(framed.ctxLabel).toBe('ads.example.com');
  expect(top.ctxLabel).toBeUndefined();
});

test('a console.table call marks the entry with the table flag', () => {
  const store = new ConsoleStore();
  store.handleEvent('Runtime.consoleAPICalled', { type: 'table', timestamp: 1, args: [objectArg('tbl')] });
  store.handleEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 2, args: [{ type: 'string', value: 'plain' }] });
  const [tbl, plain] = store.entries();
  expect(tbl.kind).toBe('log');
  expect(tbl.table).toBe(true);
  expect(plain.table).toBeUndefined();
});

test('push appends synthesized entries verbatim, never collapsing repeats, and emits entry', () => {
  const store = new ConsoleStore();
  const seen: string[] = [];
  store.on('entry', e => seen.push(e.text));
  store.push({ kind: 'input', text: '1+1', ts: 1 });
  store.push({ kind: 'result', text: '2', ts: 2 });
  store.push({ kind: 'input', text: '1+1', ts: 3 });
  store.push({ kind: 'result', text: '2', ts: 4 });
  expect(store.entries().map(e => [e.kind, e.text, e.count])).toEqual([
    ['input', '1+1', undefined],
    ['result', '2', undefined],
    ['input', '1+1', undefined],
    ['result', '2', undefined],
  ]);
  expect(seen).toEqual(['1+1', '2', '1+1', '2']);
});
