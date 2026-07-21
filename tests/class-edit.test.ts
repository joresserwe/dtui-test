import { test, expect } from 'vitest';
import { composeClassAttr, createSerialQueue, isClassToken, parseClassEntries } from '../src/tui/lib/class-edit.js';
import { HIDE_CLASS } from '../src/cdp/dom.js';

test('parseClassEntries splits, dedupes and marks every class on', () => {
  expect(parseClassEntries('btn  primary btn')).toEqual([
    { name: 'btn', on: true },
    { name: 'primary', on: true },
  ]);
});

test('parseClassEntries handles a missing attribute', () => {
  expect(parseClassEntries(undefined)).toEqual([]);
  expect(parseClassEntries('   ')).toEqual([]);
});

test('parseClassEntries hides the inspector hide-marker class', () => {
  expect(parseClassEntries(`btn ${HIDE_CLASS}`)).toEqual([{ name: 'btn', on: true }]);
});

test('composeClassAttr keeps enabled entries and drops disabled ones', () => {
  const entries = [
    { name: 'btn', on: true },
    { name: 'primary', on: false },
  ];
  expect(composeClassAttr(entries, 'btn primary')).toBe('btn');
});

test('composeClassAttr preserves unmanaged tokens such as the hide marker', () => {
  const entries = [{ name: 'btn', on: false }];
  expect(composeClassAttr(entries, `btn ${HIDE_CLASS}`)).toBe(HIDE_CLASS);
});

test('composeClassAttr appends re-enabled and newly added entries', () => {
  const entries = [
    { name: 'btn', on: true },
    { name: 'fresh', on: true },
  ];
  expect(composeClassAttr(entries, 'btn')).toBe('btn fresh');
});

test('composeClassAttr yields an empty string when everything is off', () => {
  expect(composeClassAttr([{ name: 'btn', on: false }], 'btn')).toBe('');
});

test('isClassToken rejects whitespace and quotes', () => {
  expect(isClassToken('btn-primary')).toBe(true);
  expect(isClassToken('with space')).toBe(false);
  expect(isClassToken('quo"te')).toBe(false);
  expect(isClassToken('')).toBe(false);
});

test('createSerialQueue runs a read-modify-write pair without interleaving', async () => {
  const q = createSerialQueue();
  let shared = 'a';
  const order: string[] = [];
  const rmw = (add: string) => async () => {
    const snapshot = shared;
    await new Promise(r => setTimeout(r, 5));
    shared = `${snapshot} ${add}`;
    order.push(add);
  };
  await Promise.all([q(rmw('b')), q(rmw('c'))]);
  expect(shared).toBe('a b c');
  expect(order).toEqual(['b', 'c']);
});

test('createSerialQueue keeps running after a task rejects', async () => {
  const q = createSerialQueue();
  await expect(q(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  await expect(q(() => Promise.resolve(42))).resolves.toBe(42);
});
