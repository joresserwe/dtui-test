import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { getMediaQueries } from '../src/cdp/css.js';
import {
  aggregateMediaQueries,
  buildCssOverviewScript,
  normalizeOverview,
  rgbToHex,
} from '../src/tui/lib/css-overview.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('getMediaQueries enables CSS and maps text/source', async () => {
  const calls: string[] = [];
  mock.respond('CSS.enable', () => { calls.push('enable'); return {}; });
  mock.respond('CSS.getMediaQueries', () => ({
    medias: [
      { text: '(max-width: 600px)', source: 'mediaRule' },
      { text: 'print', source: 'linkedSheet' },
      {},
    ],
  }));
  expect(await getMediaQueries(conn)).toEqual([
    { text: '(max-width: 600px)', source: 'mediaRule' },
    { text: 'print', source: 'linkedSheet' },
    { text: '', source: '' },
  ]);
  expect(calls).toContain('enable');
});

test('getMediaQueries tolerates a missing medias list', async () => {
  mock.respond('CSS.getMediaQueries', () => ({}));
  expect(await getMediaQueries(conn)).toEqual([]);
});

test('buildCssOverviewScript embeds the element cap and samples computed styles', () => {
  const script = buildCssOverviewScript(1234);
  expect(script).toContain('1234');
  expect(script).toContain('getComputedStyle');
  expect(script).toContain('backgroundColor');
  expect(script).toContain('fontFamily');
});

test('normalizeOverview maps buckets and folds media queries', () => {
  const data = normalizeOverview(
    {
      elements: 12,
      truncated: true,
      text: [['rgb(51, 51, 51)', 10], ['rgb(255, 0, 0)', 2]],
      background: [['rgb(255, 255, 255)', 9]],
      border: [],
      fonts: [['Arial, sans-serif', 12]],
    },
    [
      { text: '(max-width: 600px)', source: 'mediaRule' },
      { text: '(max-width: 600px)', source: 'mediaRule' },
      { text: 'print', source: 'linkedSheet' },
    ],
  );
  expect(data.elements).toBe(12);
  expect(data.truncated).toBe(true);
  expect(data.text).toEqual([
    { value: 'rgb(51, 51, 51)', count: 10 },
    { value: 'rgb(255, 0, 0)', count: 2 },
  ]);
  expect(data.background).toEqual([{ value: 'rgb(255, 255, 255)', count: 9 }]);
  expect(data.border).toEqual([]);
  expect(data.fonts).toEqual([{ value: 'Arial, sans-serif', count: 12 }]);
  expect(data.medias).toEqual([
    { text: '(max-width: 600px)', source: 'mediaRule', count: 2 },
    { text: 'print', source: 'linkedSheet', count: 1 },
  ]);
});

test('normalizeOverview survives a malformed payload', () => {
  const data = normalizeOverview(null, []);
  expect(data.elements).toBe(0);
  expect(data.text).toEqual([]);
  expect(data.fonts).toEqual([]);
  expect(data.medias).toEqual([]);
});

test('aggregateMediaQueries counts duplicates and keeps order of first sight', () => {
  expect(aggregateMediaQueries([
    { text: 'a', source: 's1' },
    { text: 'b', source: 's2' },
    { text: 'a', source: 's1' },
  ])).toEqual([
    { text: 'a', source: 's1', count: 2 },
    { text: 'b', source: 's2', count: 1 },
  ]);
});

test('rgbToHex converts rgb()/rgba(), normalizes hex, parses hsl, rejects the rest', () => {
  expect(rgbToHex('rgb(255, 0, 128)')).toBe('#ff0080');
  expect(rgbToHex('rgba(0, 0, 0, 0.5)')).toBe('#000000');
  expect(rgbToHex('#abcdef')).toBe('#abcdef');
  expect(rgbToHex('#abc')).toBe('#aabbcc');
  expect(rgbToHex('#ff008080')).toBe('#ff0080');
  expect(rgbToHex('hsl(0, 100%, 50%)')).toBe('#ff0000');
  expect(rgbToHex('hsl(120, 100%, 50%)')).toBe('#00ff00');
  expect(rgbToHex('#xyz')).toBeNull();
  expect(rgbToHex('rebeccapurple')).toBeNull();
});
