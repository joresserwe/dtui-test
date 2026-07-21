import { test, expect } from 'vitest';
import {
  decodeMappings,
  decodeVlq,
  loadSourceMap,
  originalPositionFor,
  parseSourceMap,
  resolveSourceMapUrl,
  resolveSourceUrl,
} from '../src/util/source-map.js';

test('decodeVlq decodes single values including negatives and continuations', () => {
  expect(decodeVlq('A')).toEqual([0]);
  expect(decodeVlq('C')).toEqual([1]);
  expect(decodeVlq('D')).toEqual([-1]);
  expect(decodeVlq('gB')).toEqual([16]);
  expect(decodeVlq('AAAA')).toEqual([0, 0, 0, 0]);
  expect(decodeVlq('IACA')).toEqual([4, 0, 1, 0]);
});

test('decodeMappings resolves relative segments to absolute positions across lines', () => {
  const lines = decodeMappings('AAAA,IAAI;AACA');
  expect(lines).toEqual([
    [
      [0, 0, 0, 0],
      [4, 0, 0, 4],
    ],
    [[0, 0, 1, 4]],
  ]);
});

test('decodeMappings handles empty lines and 1-field segments', () => {
  const lines = decodeMappings(';AAAA;;IAAI,C');
  expect(lines[0]).toEqual([]);
  expect(lines[1]).toEqual([[0, 0, 0, 0]]);
  expect(lines[2]).toEqual([]);
  expect(lines[3]).toEqual([
    [4, 0, 0, 4],
    [5],
  ]);
});

test('originalPositionFor picks the closest segment at or before the column', () => {
  const map = parseSourceMap(JSON.stringify({ version: 3, sources: ['src/app.ts'], mappings: 'AAAA,IAAI;AACA' }));
  expect(originalPositionFor(map, 0, 2)).toEqual({ source: 'src/app.ts', line: 0, column: 0 });
  expect(originalPositionFor(map, 0, 5)).toEqual({ source: 'src/app.ts', line: 0, column: 4 });
  expect(originalPositionFor(map, 1, 0)).toEqual({ source: 'src/app.ts', line: 1, column: 4 });
  expect(originalPositionFor(map, 5, 0)).toBeNull();
});

test('parseSourceMap keeps sources, sourcesContent, and sourceRoot', () => {
  const map = parseSourceMap(
    JSON.stringify({ version: 3, sources: ['a.ts'], sourcesContent: ['const a = 1;'], sourceRoot: 'src/', mappings: 'AAAA' }),
  );
  expect(map.sources).toEqual(['a.ts']);
  expect(map.sourcesContent).toEqual(['const a = 1;']);
  expect(map.sourceRoot).toBe('src/');
});

test('resolveSourceMapUrl resolves relative map URLs against the script URL', () => {
  expect(resolveSourceMapUrl('https://a.test/js/app.min.js', 'app.min.js.map')).toBe('https://a.test/js/app.min.js.map');
  expect(resolveSourceMapUrl('https://a.test/js/app.min.js', '/maps/app.map')).toBe('https://a.test/maps/app.map');
  expect(resolveSourceMapUrl('', 'data:application/json;base64,e30=')).toBe('data:application/json;base64,e30=');
});

test('loadSourceMap decodes inline base64 data: URLs without fetching', async () => {
  const json = JSON.stringify({ version: 3, sources: ['src/app.ts'], mappings: 'AAAA' });
  const url = `data:application/json;charset=utf-8;base64,${Buffer.from(json).toString('base64')}`;
  const map = await loadSourceMap('https://a.test/app.js', url, () => Promise.reject(new Error('no fetch')));
  expect(map.sources).toEqual(['src/app.ts']);
});

test('loadSourceMap fetches non-data URLs resolved against the script', async () => {
  const fetched: string[] = [];
  const json = JSON.stringify({ version: 3, sources: ['src/app.ts'], mappings: 'AAAA' });
  const map = await loadSourceMap('https://a.test/js/app.js', 'app.js.map', async url => {
    fetched.push(url);
    return json;
  });
  expect(fetched).toEqual(['https://a.test/js/app.js.map']);
  expect(map.sources).toEqual(['src/app.ts']);
});

test('resolveSourceUrl joins sourceRoot and resolves against the map URL', () => {
  expect(resolveSourceUrl('https://a.test/js/app.js.map', 'app.ts', 'src/')).toBe('https://a.test/js/src/app.ts');
  expect(resolveSourceUrl('https://a.test/js/app.js.map', '../app.ts')).toBe('https://a.test/app.ts');
  expect(resolveSourceUrl('https://a.test/js/app.js.map', 'webpack://proj/src/a.ts')).toBe('webpack://proj/src/a.ts');
});
