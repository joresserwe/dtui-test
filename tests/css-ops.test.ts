import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { getComputedStyles, getMatchedRules, getPlatformFonts, ruleContextLabels, setStyleText, createStyleSheet, addRule, forcePseudoState } from '../src/cdp/css.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('computed styles come back as name/value pairs after enable', async () => {
  const calls: string[] = [];
  mock.respond('CSS.enable', () => { calls.push('enable'); return {}; });
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: 'color', value: 'rgb(0, 0, 0)' }, { name: 'display', value: 'block' }] }));
  expect(await getComputedStyles(conn, 42)).toEqual([['color', 'rgb(0, 0, 0)'], ['display', 'block']]);
  expect(calls).toContain('enable');
});

test('matched rules flatten selector + properties in order', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: 'body' }, origin: 'regular', style: { cssProperties: [{ name: 'margin', value: '0' }, { name: 'color', value: '' }] } } },
      { rule: { selectorList: { text: '.btn' }, origin: 'regular', style: { cssProperties: [{ name: 'color', value: 'red' }] } } },
    ],
  }));
  const rules = await getMatchedRules(conn, 42);
  expect(rules[0]).toMatchObject({ selector: 'body', origin: 'regular', properties: [['margin', '0']] });
  expect(rules[1]).toMatchObject({ selector: '.btn', origin: 'regular', properties: [['color', 'red']] });
});

test('matched rules expose editable range and cssText when present', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: '.btn' }, origin: 'regular', style: {
        styleSheetId: 'sheet-1',
        range: { startLine: 0, startColumn: 6, endLine: 0, endColumn: 20 },
        cssText: 'color: red; margin: 0 /* authored */',
        cssProperties: [{ name: 'color', value: 'red' }, { name: 'margin', value: '0' }],
      } } },
      { rule: { selectorList: { text: 'div' }, origin: 'user-agent', style: {
        cssProperties: [{ name: 'display', value: 'block' }],
      } } },
    ],
  }));
  const rules = await getMatchedRules(conn, 42);
  expect(rules[0]).toMatchObject({ selector: '.btn', styleSheetId: 'sheet-1', cssText: 'color: red; margin: 0 /* authored */' });
  expect(rules[0].ruleRange).toEqual({ startLine: 0, startColumn: 6, endLine: 0, endColumn: 20 });
  expect(rules[1].styleSheetId).toBeUndefined();
  expect(rules[1].ruleRange).toBeUndefined();
  expect(rules[1].cssText).toBe('display: block');
});

test('matched rules expose per-declaration important/disabled/range', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: '.btn' }, origin: 'regular', style: {
        styleSheetId: 'sheet-1',
        range: { startLine: 0, startColumn: 6, endLine: 0, endColumn: 60 },
        cssText: 'color: red !important; /* margin: 0; */ padding: 4px;',
        cssProperties: [
          { name: 'color', value: 'red !important', important: true, range: { startLine: 0, startColumn: 6, endLine: 0, endColumn: 28 } },
          { name: 'margin', value: '0', disabled: true, range: { startLine: 0, startColumn: 29, endLine: 0, endColumn: 45 } },
          { name: 'padding', value: '4px', range: { startLine: 0, startColumn: 46, endLine: 0, endColumn: 59 } },
          { name: 'color', value: 'red' },
          { name: 'padding', value: '4px' },
          { name: 'padding-top', value: '4px' },
        ],
      } } },
    ],
  }));
  const [rule] = await getMatchedRules(conn, 42);
  expect(rule.declarations).toEqual([
    { name: 'color', value: 'red !important', important: true, disabled: false, range: { startLine: 0, startColumn: 6, endLine: 0, endColumn: 28 } },
    { name: 'margin', value: '0', important: false, disabled: true, range: { startLine: 0, startColumn: 29, endLine: 0, endColumn: 45 } },
    { name: 'padding', value: '4px', important: false, disabled: false, range: { startLine: 0, startColumn: 46, endLine: 0, endColumn: 59 } },
    { name: 'padding-top', value: '4px', important: false, disabled: false },
  ]);
});

test('the inline style joins the matched list last as element.style', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: '.btn' }, origin: 'regular', style: { cssProperties: [{ name: 'color', value: 'red' }] } } },
    ],
    inlineStyle: {
      styleSheetId: 'inline-1',
      range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 12 },
      cssText: 'color: blue;',
      cssProperties: [{ name: 'color', value: 'blue', range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 12 } }],
    },
  }));
  const rules = await getMatchedRules(conn, 42);
  expect(rules).toHaveLength(2);
  expect(rules[1]).toMatchObject({ selector: 'element.style', origin: 'inline', styleSheetId: 'inline-1', cssText: 'color: blue;' });
  expect(rules[1].ruleRange).toEqual({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 12 });
});

test('inherited rules append after own rules with ancestor labels and inheritable-only declarations', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: '.btn' }, origin: 'regular', style: { cssProperties: [{ name: 'color', value: 'red' }] } } },
    ],
    inherited: [
      { matchedCSSRules: [
        { rule: { selectorList: { text: '#card' }, origin: 'regular', style: { cssProperties: [
          { name: 'color', value: 'blue' },
          { name: 'width', value: '10px' },
          { name: '--accent', value: 'teal' },
        ] } } },
      ] },
      { matchedCSSRules: [
        { rule: { selectorList: { text: 'body' }, origin: 'regular', style: { cssProperties: [{ name: 'font-size', value: '16px' }] } } },
      ] },
    ],
  }));
  const rules = await getMatchedRules(conn, 42, ['div#card', 'body']);
  expect(rules).toHaveLength(3);
  expect(rules[0].selector).toBe('.btn');
  expect(rules[0].inheritedFrom).toBeUndefined();
  expect(rules[0].inheritedIndex).toBeUndefined();
  expect(rules[1]).toMatchObject({ selector: '#card', inheritedFrom: 'div#card', inheritedIndex: 0 });
  expect(rules[1].properties).toEqual([['color', 'blue'], ['--accent', 'teal']]);
  expect(rules[1].declarations!.map(d => d.name)).toEqual(['color', '--accent']);
  expect(rules[2]).toMatchObject({ selector: 'body', inheritedFrom: 'body', inheritedIndex: 1 });
});

test('inherited rules without any inheritable declaration are dropped', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [],
    inherited: [
      { matchedCSSRules: [
        { rule: { selectorList: { text: '.box' }, origin: 'regular', style: { cssProperties: [{ name: 'width', value: '10px' }, { name: 'margin', value: '0' }] } } },
        { rule: { selectorList: { text: '.text' }, origin: 'regular', style: { cssProperties: [{ name: 'color', value: 'blue' }] } } },
      ] },
    ],
  }));
  const rules = await getMatchedRules(conn, 42, ['div']);
  expect(rules.map(r => r.selector)).toEqual(['.text']);
});

test('an ancestor inline style joins its group last as element.style', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [],
    inherited: [
      {
        inlineStyle: { cssProperties: [{ name: 'color', value: 'green' }, { name: 'height', value: '5px' }] },
        matchedCSSRules: [
          { rule: { selectorList: { text: 'main' }, origin: 'regular', style: { cssProperties: [{ name: 'color', value: 'blue' }] } } },
        ],
      },
    ],
  }));
  const rules = await getMatchedRules(conn, 42, ['main.wrap']);
  expect(rules.map(r => r.selector)).toEqual(['main', 'element.style']);
  expect(rules[1]).toMatchObject({ origin: 'inline', inheritedFrom: 'main.wrap', inheritedIndex: 0 });
  expect(rules[1].properties).toEqual([['color', 'green']]);
});

test('missing ancestor labels fall back to a positional name', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [],
    inherited: [
      { matchedCSSRules: [{ rule: { selectorList: { text: 'p' }, origin: 'regular', style: { cssProperties: [{ name: 'color', value: 'blue' }] } } }] },
    ],
  }));
  const rules = await getMatchedRules(conn, 42);
  expect(rules[0].inheritedFrom).toBe('ancestor 1');
});

test('a parsedOk: false property surfaces on its declaration; parsed ones stay unmarked', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: '.x' }, origin: 'regular', style: {
        cssProperties: [
          { name: 'colr', value: 'red', parsedOk: false, range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 } },
          { name: 'width', value: '10px', parsedOk: true, range: { startLine: 0, startColumn: 11, endLine: 0, endColumn: 23 } },
          { name: 'margin', value: '0', range: { startLine: 0, startColumn: 24, endLine: 0, endColumn: 33 } },
        ],
      } } },
    ],
  }));
  const [ruleView] = await getMatchedRules(conn, 42);
  expect(ruleView.declarations![0].parsedOk).toBe(false);
  expect(ruleView.declarations![1].parsedOk).toBeUndefined();
  expect(ruleView.declarations![2].parsedOk).toBeUndefined();
});

test('ruleContextLabels formats layers, container queries and scopes outermost-first', () => {
  expect(ruleContextLabels({})).toEqual([]);
  expect(ruleContextLabels({ layers: [{ text: 'components.button' }, { text: 'base' }] }))
    .toEqual(['@layer base', '@layer components.button']);
  expect(ruleContextLabels({ layers: [{}] })).toEqual(['@layer']);
  expect(ruleContextLabels({ containerQueries: [{ text: '(min-width: 400px)', name: 'card' }] }))
    .toEqual(['@container card (min-width: 400px)']);
  expect(ruleContextLabels({ containerQueries: [{ text: '(min-width: 400px)' }] }))
    .toEqual(['@container (min-width: 400px)']);
  expect(ruleContextLabels({ scopes: [{ text: '(.card)' }] })).toEqual(['@scope (.card)']);
  expect(ruleContextLabels({
    layers: [{ text: 'base' }],
    containerQueries: [{ text: '(min-width: 400px)' }],
    scopes: [{ text: '(.card)' }],
  })).toEqual(['@layer base', '@container (min-width: 400px)', '@scope (.card)']);
});

test('matched and inherited rules carry context labels; plain rules carry none', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getMatchedStylesForNode', () => ({
    matchedCSSRules: [
      { rule: { selectorList: { text: '.btn' }, origin: 'regular', layers: [{ text: 'base' }],
        containerQueries: [{ text: '(min-width: 400px)', name: 'card' }],
        style: { cssProperties: [{ name: 'color', value: 'red' }] } } },
      { rule: { selectorList: { text: '.plain' }, origin: 'regular', style: { cssProperties: [{ name: 'margin', value: '0' }] } } },
    ],
    inherited: [
      { matchedCSSRules: [
        { rule: { selectorList: { text: 'body' }, origin: 'regular', scopes: [{ text: '(.page)' }],
          style: { cssProperties: [{ name: 'color', value: 'blue' }] } } },
      ] },
    ],
  }));
  const rules = await getMatchedRules(conn, 42, ['body']);
  expect(rules[0].contexts).toEqual(['@layer base', '@container card (min-width: 400px)']);
  expect(rules[1].contexts).toBeUndefined();
  expect(rules[2]).toMatchObject({ selector: 'body', inheritedFrom: 'body', contexts: ['@scope (.page)'] });
});

test('getPlatformFonts maps family, glyph count and custom flag', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getPlatformFontsForNode', p => {
    expect(p.nodeId).toBe(42);
    return { fonts: [
      { familyName: 'Inter', glyphCount: 12, isCustomFont: true },
      { familyName: 'Arial', glyphCount: 3 },
    ] };
  });
  expect(await getPlatformFonts(conn, 42)).toEqual([
    { family: 'Inter', glyphs: 12, custom: true },
    { family: 'Arial', glyphs: 3, custom: false },
  ]);
});

test('getPlatformFonts tolerates a fontless response', async () => {
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getPlatformFontsForNode', () => ({}));
  expect(await getPlatformFonts(conn, 42)).toEqual([]);
});

test('forcePseudoState sends the forced pseudo classes', async () => {
  mock.respond('CSS.enable', () => ({}));
  let seen: any;
  mock.respond('CSS.forcePseudoState', p => { seen = p; return {}; });
  await forcePseudoState(conn, 42, ['hover']);
  expect(seen).toEqual({ nodeId: 42, forcedPseudoClasses: ['hover'] });
});

test('setStyleText sends a CSS.setStyleTexts edit', async () => {
  let seen: any;
  mock.respond('CSS.setStyleTexts', p => { seen = p; return { styles: [] }; });
  await setStyleText(conn, 'sheet-1', { startLine: 0, startColumn: 6, endLine: 0, endColumn: 20 }, 'color: blue');
  expect(seen).toEqual({ edits: [{ styleSheetId: 'sheet-1', range: { startLine: 0, startColumn: 6, endLine: 0, endColumn: 20 }, text: 'color: blue' }] });
});

test('createStyleSheet and addRule map to the CSS domain', async () => {
  mock.respond('CSS.createStyleSheet', p => { expect(p.frameId).toBe('frame-1'); return { styleSheetId: 'inspector-1' }; });
  let ruleParams: any;
  mock.respond('CSS.addRule', p => { ruleParams = p; return { rule: {} }; });
  const id = await createStyleSheet(conn, 'frame-1');
  expect(id).toBe('inspector-1');
  await addRule(conn, 'inspector-1', '.new { color: green }');
  expect(ruleParams).toMatchObject({ styleSheetId: 'inspector-1', ruleText: '.new { color: green }' });
  expect(ruleParams.location).toEqual({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 });
});
