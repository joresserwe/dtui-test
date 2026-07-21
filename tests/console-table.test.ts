import { test, expect } from 'vitest';
import { detectConsoleTable, renderConsoleTable } from '../src/tui/lib/console-table.js';
import type { ConsoleArg, ConsoleEntry, ConsolePreviewProp } from '../src/store/types.js';

const prop = (name: string, value: string, type = 'number'): ConsolePreviewProp => ({ name, type, value });

const objRow = (name: string, props: ConsolePreviewProp[]): ConsolePreviewProp => ({
  name, type: 'object', valuePreview: { type: 'object', properties: props },
});

const arg = (properties: ConsolePreviewProp[], subtype?: string, overflow = false): ConsoleArg => ({
  type: 'object', ...(subtype ? { subtype } : {}), objectId: 'o1',
  preview: { type: 'object', ...(subtype ? { subtype } : {}), ...(overflow ? { overflow: true } : {}), properties },
});

const entry = (a?: ConsoleArg): ConsoleEntry => ({ kind: 'log', text: 'console.table', ts: 0, args: a ? [a] : undefined });

test('detects an array of objects with a union of columns keyed by row index', () => {
  const table = detectConsoleTable(entry(arg([
    objRow('0', [prop('name', 'alice', 'string'), prop('age', '30')]),
    objRow('1', [prop('name', 'bob', 'string'), prop('city', 'NYC', 'string')]),
  ], 'array')));
  expect(table).not.toBeNull();
  expect(table!.indexHeader).toBe('(index)');
  expect(table!.columns).toEqual(['name', 'age', 'city']);
  expect(table!.rows[0]).toEqual({ index: '0', cells: ['"alice"', '30', undefined] });
  expect(table!.rows[1]).toEqual({ index: '1', cells: ['"bob"', undefined, '"NYC"'] });
});

test('detects an object of objects using the property keys as the index', () => {
  const table = detectConsoleTable(entry(arg([
    objRow('alice', [prop('age', '30')]),
    objRow('bob', [prop('age', '25')]),
  ])));
  expect(table!.rows.map(r => r.index)).toEqual(['alice', 'bob']);
  expect(table!.columns).toEqual(['age']);
});

test('primitive rows collapse into a Values column', () => {
  const table = detectConsoleTable(entry(arg([
    objRow('0', [prop('a', '1')]),
    prop('1', '2'),
  ], 'array')));
  expect(table!.columns).toEqual(['a', 'Values']);
  expect(table!.rows[0].cells).toEqual(['1', undefined]);
  expect(table!.rows[1].cells).toEqual([undefined, '2']);
});

test('an all-primitive console.table renders a Values-only column', () => {
  const e: ConsoleEntry = { ...entry(arg([prop('0', '1'), prop('1', '2')], 'array')), table: true };
  const table = detectConsoleTable(e)!;
  expect(table).not.toBeNull();
  expect(table.columns).toEqual(['Values']);
  expect(table.rows).toEqual([
    { index: '0', cells: ['1'] },
    { index: '1', cells: ['2'] },
  ]);
});

test('returns null for non-tabular shapes', () => {
  expect(detectConsoleTable(entry(arg([prop('0', '1'), prop('1', '2')], 'array')))).toBeNull();
  expect(detectConsoleTable(entry(arg([prop('a', '1')])))).toBeNull();
  expect(detectConsoleTable(entry())).toBeNull();
  expect(detectConsoleTable({ kind: 'log', text: 'x', ts: 0 })).toBeNull();
});

test('truncates to 8 columns and 100 rows with counts', () => {
  const manyCols = Array.from({ length: 10 }, (_, i) => prop(`c${i}`, String(i)));
  const table = detectConsoleTable(entry(arg([objRow('0', manyCols)], 'array')))!;
  expect(table.columns).toHaveLength(8);
  expect(table.moreCols).toBe(2);

  const manyRows = Array.from({ length: 101 }, (_, i) => objRow(String(i), [prop('a', String(i))]));
  const bigTable = detectConsoleTable(entry(arg(manyRows, 'array')))!;
  expect(bigTable.rows).toHaveLength(100);
  expect(bigTable.moreRows).toBe(1);
});

test('renderConsoleTable emits a header, a separator, aligned rows and a truncation footer', () => {
  const table = detectConsoleTable(entry(arg([
    objRow('0', [prop('name', 'alice', 'string'), prop('age', '30')]),
    objRow('1', [prop('name', 'bob', 'string'), prop('age', '25')]),
  ], 'array')))!;
  const lines = renderConsoleTable(table, 80);
  expect(lines[0]).toContain('(index)');
  expect(lines[0]).toContain('name');
  expect(lines[0]).toContain('age');
  expect(lines[1]).toMatch(/^─+┼─/);
  expect(lines.some(l => l.includes('"alice"'))).toBe(true);
  const overflowTable = { ...table, moreRows: 3 };
  const footer = renderConsoleTable(overflowTable, 80).at(-1)!;
  expect(footer).toContain('…');
  expect(footer).toContain('3');
});
