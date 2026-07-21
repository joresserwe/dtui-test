import { test, expect } from 'vitest';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoxModel } from '../src/cdp/dom.js';
import type { MatchedRule } from '../src/cdp/css.js';
import {
  OUTER_HTML_CAP,
  buildContextMd,
  clipFromQuad,
  collectElementData,
  elementDataFromParts,
  elementSlug,
  handoffRoot,
  runAgentCmd,
  writeHandoffBundle,
  type HandoffSession,
} from '../src/tui/lib/handoff.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('clipFromQuad returns the integer bounding box of the quad', () => {
  expect(clipFromQuad([10, 20, 110, 20, 110, 60, 10, 60])).toEqual({ x: 10, y: 20, width: 100, height: 40 });
});

test('clipFromQuad floors the origin and ceils the far edge on fractional quads', () => {
  expect(clipFromQuad([10.4, 20.6, 110.2, 20.6, 110.2, 60.1, 10.4, 60.1])).toEqual({ x: 10, y: 20, width: 101, height: 41 });
});

test('clipFromQuad adds the page offset before rounding', () => {
  expect(clipFromQuad([10, 20, 110, 20, 110, 60, 10, 60], { x: 0.5, y: 100 })).toEqual({ x: 10, y: 120, width: 101, height: 40 });
});

test('clipFromQuad clamps negative coordinates and keeps the far edge', () => {
  expect(clipFromQuad([-30, -10, 70, -10, 70, 40, -30, 40])).toEqual({ x: 0, y: 0, width: 70, height: 40 });
});

test('clipFromQuad enforces a minimum 1x1 clip for zero-area quads', () => {
  expect(clipFromQuad([5, 5, 5, 5, 5, 5, 5, 5])).toEqual({ x: 5, y: 5, width: 1, height: 1 });
});

test('clipFromQuad rejects missing, short, and non-finite quads', () => {
  expect(clipFromQuad(undefined)).toBeNull();
  expect(clipFromQuad([])).toBeNull();
  expect(clipFromQuad([1, 2, 3, 4])).toBeNull();
  expect(clipFromQuad([NaN, 0, 1, 0, 1, 1, 0, 1])).toBeNull();
});

const BOX: BoxModel = {
  content: [12, 22, 108, 22, 108, 58, 12, 58],
  padding: [11, 21, 109, 21, 109, 59, 11, 59],
  border: [10, 20, 110, 20, 110, 60, 10, 60],
  margin: [5, 15, 115, 15, 115, 65, 5, 65],
  width: 100,
  height: 40,
};

const MATCHED: MatchedRule[] = [
  {
    selector: '.btn',
    origin: 'regular',
    properties: [['color', 'red'], ['display', 'inline']],
    declarations: [
      { name: 'color', value: 'red', important: false, disabled: false },
      { name: 'display', value: 'inline', important: false, disabled: false },
    ],
    cssText: 'color: red; display: inline',
  },
  {
    selector: 'element.style',
    origin: 'inline',
    properties: [['color', 'blue']],
    declarations: [{ name: 'color', value: 'blue', important: false, disabled: false }],
    cssText: 'color: blue',
  },
];

const COMPUTED: Array<[string, string]> = [
  ['display', 'block'],
  ['color', 'rgb(0, 0, 255)'],
  ['tab-size', '8'],
];

test('elementDataFromParts marks overridden declarations and filters computed to the key subset', () => {
  const data = elementDataFromParts({
    url: 'https://x.test/',
    capturedAt: '2026-07-20T00:00:00.000Z',
    selectorPath: 'div#app > button.btn',
    outerHTML: '<button class="btn">go</button>',
    matched: MATCHED,
    computed: COMPUTED,
    box: BOX,
  });
  expect(data.rules).toHaveLength(2);
  expect(data.rules![0].declarations[0]).toEqual({ name: 'color', value: 'red', important: false, disabled: false, overridden: true });
  expect(data.rules![1].declarations[0].overridden).toBe(false);
  expect(data.computed).toEqual([['display', 'block'], ['color', 'rgb(0, 0, 255)']]);
  expect(data.box).toMatchObject({ width: 100, height: 40 });
  expect(data.missing).toEqual([]);
});

test('elementDataFromParts carries inherited labels through to the rules', () => {
  const data = elementDataFromParts({
    url: 'https://x.test/',
    capturedAt: '2026-07-20T00:00:00.000Z',
    selectorPath: 'div#app > button.btn',
    matched: [
      ...MATCHED,
      {
        selector: 'body',
        origin: 'regular',
        properties: [['color', 'green'], ['font-size', '16px']],
        declarations: [
          { name: 'color', value: 'green', important: false, disabled: false },
          { name: 'font-size', value: '16px', important: false, disabled: false },
        ],
        cssText: 'color: green; font-size: 16px',
        inheritedFrom: 'body.page',
        inheritedIndex: 0,
      },
    ],
  });
  expect(data.rules).toHaveLength(3);
  expect('inheritedFrom' in data.rules![0]).toBe(false);
  expect(data.rules![2].inheritedFrom).toBe('body.page');
  expect(data.rules![2].declarations.map(d => [d.name, d.overridden])).toEqual([['color', true], ['font-size', false]]);
  const md = buildContextMd(data, { element: false, viewport: false });
  expect(md).toContain('### 3. `body` (regular, inherited from `body.page`)');
  expect(md).toContain('### 1. `.btn` (regular)');
});

test('elementDataFromParts caps huge outerHTML and flags the truncation', () => {
  const data = elementDataFromParts({
    url: 'u', capturedAt: 't', selectorPath: 's',
    outerHTML: 'x'.repeat(OUTER_HTML_CAP + 10),
  });
  expect(data.outerHTML).toHaveLength(OUTER_HTML_CAP);
  expect(data.outerHTMLTruncated).toBe(true);
});

test('elementDataFromParts records a null box as missing', () => {
  const data = elementDataFromParts({ url: 'u', capturedAt: 't', selectorPath: 's', box: null });
  expect(data.box).toBeNull();
  expect(data.missing).toContain('box');
});

function fakeSession(over: Partial<HandoffSession> = {}): HandoffSession {
  return {
    url: 'https://shop.test/checkout',
    outerHTML: async () => '<button class="btn">go</button>',
    computedStyles: async () => COMPUTED,
    matchedRules: async () => MATCHED,
    boxModel: async () => BOX,
    scrollIntoView: async () => {},
    pageOffset: async () => ({ x: 0, y: 0 }),
    screenshot: async () => Buffer.from('png-bytes').toString('base64'),
    ...over,
  };
}

test('collectElementData survives per-part failures and lists them as missing', async () => {
  const data = await collectElementData(
    fakeSession({ matchedRules: async () => { throw new Error('no css'); } }),
    7,
    'div > button',
  );
  expect(data.rules).toBeUndefined();
  expect(data.missing).toContain('rules');
  expect(data.outerHTML).toBe('<button class="btn">go</button>');
});

test('buildContextMd renders every section with markers and screenshot notes', () => {
  const data = elementDataFromParts({
    url: 'https://x.test/',
    capturedAt: '2026-07-20T00:00:00.000Z',
    selectorPath: 'div#app > button.btn',
    outerHTML: '<button class="btn">go</button>',
    matched: MATCHED,
    computed: COMPUTED,
    box: BOX,
  });
  const md = buildContextMd(data, { element: true, viewport: true });
  expect(md).toContain('# Element handoff');
  expect(md).toContain('- url: https://x.test/');
  expect(md).toContain('- selector: `div#app > button.btn`');
  expect(md).toContain('- size: 100×40 px');
  expect(md).toContain('- border: (10, 20) 100×40');
  expect(md).toContain('### 1. `.btn` (regular)');
  expect(md).toContain('- `color: red` [overridden]');
  expect(md).toContain('- `color: blue`');
  expect(md).toContain('- display: block');
  expect(md).toContain('```html');
  expect(md).toContain('- element.png — cropped to the element border box');
  expect(md).not.toContain('- missing:');
});

test('buildContextMd notes missing parts and skipped screenshots', () => {
  const data = elementDataFromParts({ url: 'u', capturedAt: 't', selectorPath: 'p', box: null });
  data.missing.push('element.png');
  const md = buildContextMd(data, { element: false, viewport: true });
  expect(md).toContain('- missing: box, element.png');
  expect(md).toContain('- no box model');
  expect(md).toContain('- element.png — not captured');
  expect(md).toContain('- viewport.png — full viewport');
});

test('elementSlug uses the last selector segment', () => {
  expect(elementSlug('div#app > button.btn')).toBe('button-btn');
  expect(elementSlug('BODY')).toBe('body');
  expect(elementSlug('')).toBe('');
});

test('handoffRoot honors XDG_DATA_HOME', () => {
  expect(handoffRoot({ XDG_DATA_HOME: '/data' }, 'linux')).toBe('/data/devtools-tui/handoff');
});

test('writeHandoffBundle writes context.md and both screenshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-handoff-'));
  const clips: unknown[] = [];
  const session = fakeSession({
    pageOffset: async () => ({ x: 0, y: 250 }),
    screenshot: async clip => {
      clips.push(clip);
      return Buffer.from(clip ? 'element-shot' : 'viewport-shot').toString('base64');
    },
  });
  const now = new Date('2026-07-20T01:02:03.000Z');
  const { dir, missing } = await writeHandoffBundle(session, 7, 'div#app > button.btn', root, now);
  expect(dir).toBe(join(root, '2026-07-20T01-02-03-button-btn'));
  expect(missing).toEqual([]);
  const files = (await readdir(dir)).sort();
  expect(files).toEqual(['context.md', 'element.png', 'viewport.png']);
  expect(clips).toEqual([{ x: 10, y: 270, width: 100, height: 40 }, undefined]);
  expect(await readFile(join(dir, 'element.png'), 'utf8')).toBe('element-shot');
  expect(await readFile(join(dir, 'viewport.png'), 'utf8')).toBe('viewport-shot');
  const md = await readFile(join(dir, 'context.md'), 'utf8');
  expect(md).toContain('- url: https://shop.test/checkout');
  expect(md).toContain('- `color: red` [overridden]');
});

test('writeHandoffBundle degrades gracefully without a box model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-handoff-'));
  const session = fakeSession({
    boxModel: async () => null,
    screenshot: async clip => (clip ? null : Buffer.from('viewport-shot').toString('base64')),
  });
  const { dir, missing } = await writeHandoffBundle(session, 7, 'div.hidden', root);
  expect(missing).toEqual(['box', 'element.png']);
  expect(existsSync(join(dir, 'element.png'))).toBe(false);
  expect(existsSync(join(dir, 'viewport.png'))).toBe(true);
  const md = await readFile(join(dir, 'context.md'), 'utf8');
  expect(md).toContain('- missing: box, element.png');
});

test('writeHandoffBundle reports a failed viewport capture in missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-handoff-'));
  const session = fakeSession({ screenshot: async () => null });
  const { dir, missing } = await writeHandoffBundle(session, 7, 'div', root);
  expect(missing).toEqual(['element.png', 'viewport.png']);
  expect(existsSync(join(dir, 'context.md'))).toBe(true);
});

test('runAgentCmd runs the command with the bundle dir as argument', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui agent-'));
  const script = join(dir, 'agent.mjs');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(script, "import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nwriteFileSync(join(process.argv[2], 'marker'), 'ok');\n");
  const errors: string[] = [];
  runAgentCmd(`node ${JSON.stringify(script)}`, dir, m => errors.push(m));
  const deadline = Date.now() + 3000;
  while (!existsSync(join(dir, 'marker')) && Date.now() < deadline) await sleep(20);
  expect(await stat(join(dir, 'marker')).then(() => true, () => false)).toBe(true);
  expect(errors).toEqual([]);
});

test('runAgentCmd surfaces a failing command through onError', async () => {
  const errors: string[] = [];
  runAgentCmd('definitely-not-a-command-xyz', '/tmp', m => errors.push(m));
  const deadline = Date.now() + 3000;
  while (!errors.length && Date.now() < deadline) await sleep(20);
  expect(errors.length).toBeGreaterThan(0);
});

test('runAgentCmd reports a signal death instead of staying silent', async () => {
  const errors: string[] = [];
  runAgentCmd('kill -9 $$', '/tmp', m => errors.push(m));
  const deadline = Date.now() + 3000;
  while (!errors.length && Date.now() < deadline) await sleep(20);
  expect(errors.join(' ')).toMatch(/SIGKILL|signal/);
});

test('writeHandoffBundle uniquifies the bundle dir on a same-second collision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtui-handoff-'));
  const now = new Date('2026-07-20T01:02:03.000Z');
  const first = await writeHandoffBundle(fakeSession(), 7, 'div#app > button.btn', root, now);
  const second = await writeHandoffBundle(fakeSession(), 7, 'div#app > button.btn', root, now);
  expect(second.dir).not.toBe(first.dir);
  expect(second.dir).toBe(join(root, '2026-07-20T01-02-03-button-btn-2'));
  expect((await readdir(second.dir)).sort()).toEqual(['context.md', 'element.png', 'viewport.png']);
});
