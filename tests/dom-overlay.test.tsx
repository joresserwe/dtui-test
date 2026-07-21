import { test, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { DomOverlay, matchedCursorLine, matchedLines } from '../src/tui/overlays/DomOverlay.js';
import type { MatchedRule } from '../src/cdp/css.js';

const node = {
  selector: '#app .btn',
  nodeId: 42,
  outerHTML: '<button class="btn">Go</button>',
  computed: [['display', 'inline-block'], ['color', 'rgb(255, 0, 0)']] as Array<[string, string]>,
  matched: [{ selector: '.btn', origin: 'regular', properties: [['color', 'red']] as Array<[string, string]> }],
  box: { content: [], padding: [], border: [], margin: [], width: 80, height: 32 },
};

test('renders the query, node header, box model, computed and matched', () => {
  const { lastFrame } = render(
    <DomOverlay query="#app .btn" node={node} highlighting watching={false} mutationCount={0} ruleSelected={-1} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('Elements');
  expect(frame).toContain('#42');
  expect(frame).toContain('button');
  expect(frame).toContain('80');
  expect(frame).toContain('display');
  expect(frame).toContain('inline-block');
  expect(frame).toContain('.btn');
  expect(frame).toContain('highlight:on');
});

test('syntax highlighting leaves the outerHTML and matched-rule text intact', () => {
  const { lastFrame } = render(
    <DomOverlay query="#app .btn" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('<button class="btn">Go</button>');
  expect(frame).toContain('.btn { color: red }');
});

test('shows the no-box and watching status', () => {
  const { lastFrame } = render(
    <DomOverlay query="div" node={{ ...node, box: null }} highlighting={false} watching mutationCount={3} ruleSelected={-1} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('selector: div');
  expect(frame).toContain('no box');
  expect(frame).toContain('3');
});

test('renders the box-model breakdown from populated quads', () => {
  const boxed = {
    ...node,
    box: {
      content: [10, 10, 90, 10, 90, 42, 10, 42],
      padding: [5, 5, 95, 5, 95, 47, 5, 47],
      border: [3, 3, 97, 3, 97, 49, 3, 49],
      margin: [-5, -5, 105, -5, 105, 57, -5, 57],
      width: 80,
      height: 32,
    },
  };
  const { lastFrame } = render(
    <DomOverlay query="#app .btn" node={boxed} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('80');
  expect(frame).toContain('margin');
  expect(frame).toContain('padding');
  expect(frame).toContain('8/8');
});

test('shows an error line and empty state', () => {
  const { lastFrame } = render(
    <DomOverlay query=".missing" node={null} highlighting={false} watching={false} mutationCount={0} error="no match for .missing" ruleSelected={-1} />,
  );
  expect(lastFrame()).toContain('no match for .missing');
});

test('marks the selected matched rule and read-only rules', () => {
  const nodeWithRules = {
    ...node,
    matched: [
      { selector: '.btn', origin: 'regular', properties: [['color', 'red']] as Array<[string, string]>, cssText: 'color: red', styleSheetId: 's1', ruleRange: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 } },
      { selector: 'button', origin: 'user-agent', properties: [['display', 'inline']] as Array<[string, string]>, cssText: 'display: inline' },
    ],
  };
  const { lastFrame } = render(
    <DomOverlay query="#app .btn" node={nodeWithRules} highlighting={false} watching={false} mutationCount={0} ruleSelected={1} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('.btn');
  expect(frame).toContain('button');
  expect(frame).toContain('read-only');
});

test('a decl prop renders the append input', () => {
  const { lastFrame } = render(
    <DomOverlay query="#app .btn" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} decl="col" />,
  );
  expect(lastFrame()).toContain('append: col▌');
});

test('is borderless with a full-width rule and no footer hints', () => {
  const frame = render(
    <DomOverlay query="#app .btn" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} width={70} />,
  ).lastFrame()!;
  expect(frame).not.toContain('╔');
  expect(frame).not.toContain('╭');
  expect(frame).toContain('─'.repeat(70));
  expect(frame).not.toContain('a add decl');
  expect(frame).not.toContain('Esc close');
});

const lineCount = (el: React.ReactElement) => render(el).lastFrame()!.split('\n').length;

const manyRules = {
  ...node,
  computed: Array.from({ length: 30 }, (_, i) => [`prop-${i}`, `val-${i}`]) as Array<[string, string]>,
  matched: Array.from({ length: 30 }, (_, i) => ({ selector: `.rule-${i}`, origin: 'regular', properties: [['color', 'red']] as Array<[string, string]> })),
};

test('renders exactly height rows across every state combination', () => {
  const heights = [24, 30, 40, 18];
  for (const height of heights) {
    expect(lineCount(
      <DomOverlay query="a" node={manyRules} highlighting watching mutationCount={7} ruleSelected={29} decl="col" error="boom" height={height} />,
    )).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={null} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={manyRules} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={manyRules} highlighting={false} watching={false} mutationCount={0} ruleSelected={29} height={height} />,
    )).toBe(height);
  }
});

test('uses a constant height at the default with no height prop', () => {
  expect(lineCount(
    <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} />,
  )).toBe(lineCount(
    <DomOverlay query="a" node={null} highlighting watching mutationCount={2} ruleSelected={-1} decl="x" error="e" height={24} />,
  ));
});

test('keeps the selected matched rule visible when windowed', () => {
  const { lastFrame } = render(
    <DomOverlay query="a" node={manyRules} highlighting={false} watching={false} mutationCount={0} ruleSelected={29} height={24} />,
  );
  expect(lastFrame()).toContain('.rule-29');
});

test('honours an explicit width', () => {
  const frame = render(
    <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} width={60} />,
  ).lastFrame()!;
  expect(Math.max(...frame.split('\n').map(l => l.length))).toBe(60);
});

const range = (startColumn: number, endColumn: number) => ({ startLine: 0, startColumn, endLine: 0, endColumn });

const declRules: MatchedRule[] = [
  {
    selector: '.a',
    origin: 'regular',
    properties: [['color', 'red'], ['width', '10px'], ['margin', '0'], ['margin-top', '0px']],
    declarations: [
      { name: 'color', value: 'red', important: false, disabled: false, range: range(6, 17) },
      { name: 'width', value: '10px', important: false, disabled: false, range: range(18, 30) },
      { name: 'margin', value: '0', important: false, disabled: true, range: range(31, 47) },
      { name: 'margin-top', value: '0px', important: false, disabled: false },
    ],
    styleSheetId: 's1',
    ruleRange: range(6, 47),
    cssText: 'color: red; width: 10px; /* margin: 0; */',
  },
  {
    selector: '.b',
    origin: 'regular',
    properties: [['color', 'blue']],
    declarations: [{ name: 'color', value: 'blue', important: false, disabled: false, range: range(0, 11) }],
    styleSheetId: 's1',
    ruleRange: range(0, 11),
    cssText: 'color: blue',
  },
];

const declNode = { ...node, matched: declRules };

test('the selected rule expands into checkbox declaration rows', () => {
  const frame = render(
    <DomOverlay query="a" node={declNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={0} height={26} />,
  ).lastFrame()!;
  expect(frame).toContain('.a {');
  expect(frame).toContain('[x] color: red');
  expect(frame).toContain('[x] width: 10px');
  expect(frame).toContain('[ ] margin: 0');
  expect(frame).toContain('· margin-top: 0px');
  expect(frame).toContain('.b { color: blue }');
});

test('matchedLines expands only the selected rule and cursor maps to a flat decl', () => {
  const lines = matchedLines(declRules, 0);
  expect(lines.map(l => l.kind)).toEqual(['header', 'decl', 'decl', 'decl', 'decl', 'close', 'joined']);
  expect(matchedCursorLine(lines, 0, { rule: 0, decl: 2 })).toBe(3);
  expect(matchedCursorLine(lines, 1, null)).toBe(6);
  expect(matchedCursorLine(lines, -1, null)).toBe(-1);
});

test('the decl cursor stays visible when the expanded rule overflows the window', () => {
  const many: MatchedRule[] = [
    {
      selector: '.big',
      origin: 'regular',
      properties: Array.from({ length: 30 }, (_, i) => [`p-${i}`, `${i}px`] as [string, string]),
      declarations: Array.from({ length: 30 }, (_, i) => ({ name: `p-${i}`, value: `${i}px`, important: false, disabled: false, range: range(i, i) })),
      styleSheetId: 's1',
      ruleRange: range(0, 99),
      cssText: 'x',
    },
  ];
  const frame = render(
    <DomOverlay query="a" node={{ ...node, matched: many }} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={29} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('p-29: 29px');
  expect(frame.split('\n').length).toBe(24);
});

test('an inline-replace edit renders the edit label instead of append', () => {
  const frame = render(
    <DomOverlay query="a" node={declNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={0} decl="color: blue" declReplace height={26} />,
  ).lastFrame()!;
  expect(frame).toContain('edit: color: blue▌');
  expect(frame).not.toContain('append:');
});

test('a forced pseudo class shows in the status line', () => {
  const frame = render(
    <DomOverlay query="a" node={declNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} pseudo=":hover" height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('forced :hover');
});

const fullComputed = {
  ...node,
  computed: [
    ['display', 'block'],
    ['align-items', 'center'],
    ['align-content', 'stretch'],
    ['z-index', 'auto'],
  ] as Array<[string, string]>,
};

test('computed mode lists every computed property with a count', () => {
  const frame = render(
    <DomOverlay query="a" node={fullComputed} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} computedMode height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('computed (4/4)');
  expect(frame).toContain('align-items');
  expect(frame).toContain('z-index');
  expect(frame).not.toContain('matched rules');
  expect(frame.split('\n').length).toBe(24);
});

test('computed mode filters by substring and shows the filter row', () => {
  const frame = render(
    <DomOverlay query="a" node={fullComputed} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} computedMode computedFilter="align" height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('computed (2/4)');
  expect(frame).toContain('align-items');
  expect(frame).not.toContain('z-index');
  expect(frame).toContain('/align');
});

test('computed filter editing renders the input cursor', () => {
  const frame = render(
    <DomOverlay query="a" node={fullComputed} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} computedMode computedFilter="al" computedFilterEditing height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('/al▌');
});

test('computed mode scrolls and keeps exactly height rows', () => {
  const big = {
    ...node,
    computed: Array.from({ length: 60 }, (_, i) => [`prop-${String(i).padStart(2, '0')}`, `${i}`] as [string, string]),
  };
  for (const scroll of [0, 20, 999]) {
    const frame = render(
      <DomOverlay query="a" node={big} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} computedMode computedScroll={scroll} height={24} />,
    ).lastFrame()!;
    expect(frame.split('\n').length).toBe(24);
    if (scroll === 0) expect(frame).toContain('prop-00');
    if (scroll === 999) expect(frame).toContain('prop-59');
  }
});

test('the default subview keeps only interesting computed properties', () => {
  const frame = render(
    <DomOverlay query="a" node={fullComputed} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('display: block');
  expect(frame).not.toContain('align-items');
});

test('an overridden declaration keeps its text in both joined and expanded rows', () => {
  const collapsed = render(
    <DomOverlay query="a" node={declNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={26} />,
  ).lastFrame()!;
  expect(collapsed).toContain('color: red');
  const expanded = render(
    <DomOverlay query="a" node={declNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={0} height={26} />,
  ).lastFrame()!;
  expect(expanded).toContain('[x] color: red');
});

const inheritedRules: MatchedRule[] = [
  {
    selector: '.own',
    origin: 'regular',
    properties: [['color', 'red']],
    declarations: [{ name: 'color', value: 'red', important: false, disabled: false, range: range(0, 11) }],
    styleSheetId: 's1',
    ruleRange: range(0, 11),
    cssText: 'color: red',
  },
  {
    selector: '#card',
    origin: 'regular',
    properties: [['color', 'blue'], ['font-size', '14px']],
    declarations: [
      { name: 'color', value: 'blue', important: false, disabled: false, range: range(0, 12) },
      { name: 'font-size', value: '14px', important: false, disabled: false, range: range(13, 29) },
    ],
    styleSheetId: 's2',
    ruleRange: range(0, 29),
    cssText: 'color: blue; font-size: 14px',
    inheritedFrom: 'div#card',
    inheritedIndex: 0,
  },
  {
    selector: 'body',
    origin: 'regular',
    properties: [['font-size', '16px']],
    declarations: [{ name: 'font-size', value: '16px', important: false, disabled: false }],
    cssText: 'font-size: 16px',
    inheritedFrom: 'body',
    inheritedIndex: 1,
  },
];

test('matchedLines inserts one header per inherited group', () => {
  const lines = matchedLines(inheritedRules, -1);
  expect(lines.map(l => l.kind)).toEqual(['joined', 'inherited', 'joined', 'inherited', 'joined']);
  expect(lines[1].rule).toBe(1);
  expect(lines[3].rule).toBe(2);
});

test('inherited sections render their ancestor header and rules', () => {
  const frame = render(
    <DomOverlay query="a" node={{ ...node, matched: inheritedRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={26} />,
  ).lastFrame()!;
  expect(frame).toContain('div#card에서 상속');
  expect(frame).toContain('body에서 상속');
  expect(frame).toContain('#card { color: blue; font-size: 14px }');
});

test('an expanded inherited rule renders checkbox declaration rows', () => {
  const frame = render(
    <DomOverlay query="a" node={{ ...node, matched: inheritedRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={1} declSel={1} height={26} />,
  ).lastFrame()!;
  expect(frame).toContain('[x] color: blue');
  expect(frame).toContain('[x] font-size: 14px');
});

test('the decl cursor walks into inherited rules and stays visible', () => {
  const frame = render(
    <DomOverlay query="a" node={{ ...node, matched: inheritedRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={2} declSel={3} height={26} />,
  ).lastFrame()!;
  expect(frame).toContain('body {');
  expect(frame).toContain('· font-size: 16px');
  expect(frame).toContain('read-only');
});

test('renders exactly height rows with inherited sections across heights', () => {
  for (const height of [18, 24, 30]) {
    expect(lineCount(
      <DomOverlay query="a" node={{ ...node, matched: inheritedRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={{ ...node, matched: inheritedRules }} highlighting watching mutationCount={1} ruleSelected={1} declSel={1} error="e" height={height} />,
    )).toBe(height);
  }
});

test('renders exactly height rows with expanded declarations across heights', () => {
  for (const height of [18, 24, 30]) {
    expect(lineCount(
      <DomOverlay query="a" node={declNode} highlighting watching mutationCount={2} ruleSelected={0} declSel={2} decl="x" error="e" height={height} />,
    )).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={declNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={1} declSel={4} height={height} />,
    )).toBe(height);
  }
});

test('the rendered-fonts line lists family and glyph counts', () => {
  const withFonts = { ...node, fonts: [{ family: 'Inter', glyphs: 12, custom: true }, { family: 'Arial', glyphs: 3, custom: false }] };
  const frame = render(
    <DomOverlay query="a" node={withFonts} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('렌더 폰트: Inter* (glyphs 12) · Arial (glyphs 3)');
});

test('the fonts line falls back to a dash without font data', () => {
  const frame = render(
    <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('렌더 폰트: —');
});

const invalidRules: MatchedRule[] = [
  {
    selector: '.bad',
    origin: 'regular',
    properties: [['colr', 'red'], ['width', '10px']],
    declarations: [
      { name: 'colr', value: 'red', important: false, disabled: false, parsedOk: false, range: range(0, 10) },
      { name: 'width', value: '10px', important: false, disabled: false, range: range(11, 23) },
    ],
    styleSheetId: 's1',
    ruleRange: range(0, 23),
    cssText: 'colr: red; width: 10px',
  },
];

test('an invalid declaration gets the warning marker in joined and expanded rows', () => {
  const collapsed = render(
    <DomOverlay query="a" node={{ ...node, matched: invalidRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} />,
  ).lastFrame()!;
  expect(collapsed).toContain('⚠ colr: red');
  const expanded = render(
    <DomOverlay query="a" node={{ ...node, matched: invalidRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={0} height={24} />,
  ).lastFrame()!;
  expect(expanded).toContain('[x] ⚠ colr: red');
  expect(expanded).toContain('[x] width: 10px');
});

const varRules: MatchedRule[] = [
  {
    selector: '.var',
    origin: 'regular',
    properties: [['color', 'var(--accent)'], ['gap', 'var(--missing)']],
    declarations: [
      { name: 'color', value: 'var(--accent)', important: false, disabled: false, range: range(0, 20) },
      { name: 'gap', value: 'var(--missing)', important: false, disabled: false, range: range(21, 40) },
    ],
    styleSheetId: 's1',
    ruleRange: range(0, 40),
    cssText: 'color: var(--accent); gap: var(--missing)',
  },
];

const varNode = { ...node, computed: [['--accent', 'teal'], ['color', 'teal']] as Array<[string, string]>, matched: varRules };

test('a var() declaration shows its resolved value inline and in the status line', () => {
  const frame = render(
    <DomOverlay query="a" node={varNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={0} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('color: var(--accent) → teal');
  expect(frame).toContain('--accent = teal');
});

test('an unresolvable var() shows a question mark', () => {
  const frame = render(
    <DomOverlay query="a" node={varNode} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={1} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('gap: var(--missing) → ?');
  expect(frame).toContain('--missing = ?');
});

const contextRules: MatchedRule[] = [
  {
    selector: '.card',
    origin: 'regular',
    properties: [['color', 'red']],
    declarations: [{ name: 'color', value: 'red', important: false, disabled: false, range: range(0, 10) }],
    styleSheetId: 's1',
    ruleRange: range(0, 10),
    cssText: 'color: red',
    contexts: ['@layer base', '@container card (min-width: 400px)'],
  },
];

test('context labels prefix the rule in joined and header rows', () => {
  const collapsed = render(
    <DomOverlay query="a" node={{ ...node, matched: contextRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} height={24} />,
  ).lastFrame()!;
  expect(collapsed).toContain('@layer base @container card (min-width: 400px) .card {');
  const expanded = render(
    <DomOverlay query="a" node={{ ...node, matched: contextRules }} highlighting={false} watching={false} mutationCount={0} ruleSelected={0} declSel={0} height={24} />,
  ).lastFrame()!;
  expect(expanded).toContain('@layer base @container card (min-width: 400px) .card {');
  expect(expanded).toContain('[x] color: red');
});

const classList = [
  { name: 'btn', on: true },
  { name: 'primary', on: false },
  { name: 'wide', on: true },
];

test('classes mode lists checkbox rows with the cursor and count', () => {
  const frame = render(
    <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} classesMode classes={classList} classesSel={1} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('classes (3)');
  expect(frame).toContain('[x] .btn');
  expect(frame).toContain('[ ] .primary');
  expect(frame).toContain('[x] .wide');
  expect(frame).not.toContain('matched rules');
});

test('classes mode shows the add-class prompt while typing', () => {
  const frame = render(
    <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} classesMode classes={classList} classesSel={0} classesInput="fresh" height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('클래스: fresh▌');
});

test('classes mode renders the empty state and keeps exactly height rows', () => {
  for (const height of [18, 24, 30]) {
    const el = (
      <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} classesMode classes={[]} classesSel={0} height={height} />
    );
    expect(render(el).lastFrame()!).toContain('클래스 없음');
    expect(lineCount(el)).toBe(height);
    expect(lineCount(
      <DomOverlay query="a" node={node} highlighting watching mutationCount={1} ruleSelected={-1} classesMode classes={classList} classesSel={2} classesInput="x" error="e" height={height} />,
    )).toBe(height);
  }
});

test('classes mode windows a long class list around the cursor', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `cls-${String(i).padStart(2, '0')}`, on: true }));
  const frame = render(
    <DomOverlay query="a" node={node} highlighting={false} watching={false} mutationCount={0} ruleSelected={-1} classesMode classes={many} classesSel={39} height={24} />,
  ).lastFrame()!;
  expect(frame).toContain('.cls-39');
  expect(frame.split('\n').length).toBe(24);
});
