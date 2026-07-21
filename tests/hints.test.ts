import { test, expect } from 'vitest';
import { fitHintRows, fitHints, hint, hintsFor, hintWidth, HELP_HINT, type Hint, type HintState } from '../src/tui/lib/hints.js';
import { displayWidth } from '../src/tui/lib/format.js';
import { t } from '../src/tui/lib/i18n.js';

const baseState = (over: Partial<HintState> = {}): HintState => ({
  activeTool: 'network',
  attached: true,
  pickerOpen: false,
  paletteOpen: false,
  newTabPrompt: false,
  netPicker: null,
  netGroup: false,
  overrideManager: false,
  blockManager: false,
  mapManager: false,
  netDiffOpen: false,
  sessionControl: false,
  helpOpen: false,
  notifOpen: false,
  detailOpen: false,
  detailTab: 'summary',
  detailHasBody: false,
  detailMsgFilterEditing: false,
  conPicker: false,
  conCtxPicker: false,
  conFilterEditing: false,
  conInputEditing: false,
  replPopupOpen: false,
  conDetailOpen: false,
  conDetailExpandable: false,
  filterEditing: false,
  searchEditing: false,
  tlSelect: false,
  tlAnchor: false,
  tlRange: false,
  declEdit: false,
  elSubview: false,
  elSearching: false,
  elComputedMode: false,
  elComputedFilterEditing: false,
  elListenersMode: false,
  elClassesMode: false,
  elClassesInput: false,
  elHintMode: false,
  elInspecting: false,
  storageEditing: false,
  settingsEditing: false,
  settingsSearching: false,
  ...over,
});

const rendered = (items: Hint[]) => items.map(h => `${h.key} ${h.label}`).join(' · ');

test('keeps every item in order when the line fits', () => {
  const items = [hint('/', '필터', 3), hint('x', '타입', 2), HELP_HINT];
  expect(fitHints(items, 80)).toEqual(items);
});

test('drops the lowest-priority items first, rightmost on ties', () => {
  const items = [hint('a', 'aaaa', 3), hint('b', 'bbbb', 2), hint('c', 'cccc', 2), hint('d', 'dddd', 1), HELP_HINT];
  const full = displayWidth(rendered(items));
  const once = fitHints(items, full - 1);
  expect(once.map(h => h.key)).toEqual(['a', 'b', 'c', '?']);
  const twice = fitHints(items, displayWidth(rendered(once)) - 1);
  expect(twice.map(h => h.key)).toEqual(['a', 'b', '?']);
});

test('never clips mid-item: every kept item is whole and the line fits', () => {
  const items = [hint('/', '필터', 3), hint('x', '타입', 2), hint('⏎', '상세', 3), hint('^F', '검색', 1), HELP_HINT];
  for (let width = 0; width <= displayWidth(rendered(items)); width++) {
    const kept = fitHints(items, width);
    for (const h of kept) expect(items).toContainEqual(h);
    if (kept.length > 1) expect(displayWidth(rendered(kept))).toBeLessThanOrEqual(width);
  }
});

test('the help item survives alone at tiny widths', () => {
  const items = [hint('/', '필터', 3), hint('x', '타입', 2), hint('s', '정렬', 2), HELP_HINT];
  expect(fitHints(items, 0)).toEqual([HELP_HINT]);
  expect(fitHints(items, hintWidth(HELP_HINT))).toEqual([HELP_HINT]);
});

test('measures CJK labels at double width', () => {
  expect(hintWidth(hint('?', '도움말'))).toBe(8);
  const items = [hint('a', '도움말', 1), HELP_HINT];
  expect(fitHints(items, 19)).toEqual(items);
  expect(fitHints(items, 13)).toEqual([HELP_HINT]);
});

test('hintsFor: the tab picker overrides everything else', () => {
  const keys = hintsFor(baseState({ pickerOpen: true, helpOpen: true, detailOpen: true })).map(h => h.key);
  expect(keys).toEqual(['타이핑', 'j/k', '⏎', '^X', '^W', 'esc']);
});

test('hintsFor: the new-tab prompt overrides even the picker', () => {
  const keys = hintsFor(baseState({ newTabPrompt: true, pickerOpen: true, helpOpen: true })).map(h => h.key);
  expect(keys).toEqual(['타이핑', '⏎', 'esc']);
});

test('hintsFor: an unattached non-settings tool offers attach/new-tab/quit plus help', () => {
  const items = hintsFor(baseState({ attached: false, activeTool: 'console' }));
  expect(items.map(h => h.key)).toEqual(['b', 't', 'q', ':', '!', '?']);
  expect(items).toContainEqual(HELP_HINT);
});

test('hintsFor: the network tool shows filter/type/sort plus session keys when idle', () => {
  const keys = hintsFor(baseState()).map(h => h.key);
  expect(keys).toEqual(['/', 'x', 's', '⏎', 'v', 'd', 'z', '^F', '.', 'b', '[/]', 't', '^X', '^W', ':', '!', '?']);
});

test('hintsFor: the diff hint label goes through translation', () => {
  expect(hintsFor(baseState()).find(h => h.key === 'd')?.label).toBe(t('hint.diff'));
});

test('hintsFor: the console tool leads with the REPL input key when idle', () => {
  const keys = hintsFor(baseState({ activeTool: 'console' })).map(h => h.key);
  expect(keys).toEqual(['i', '/', 'x', 'E', '⏎', '␣', 'T', 'C', 'Y', 'j/k', 'gg/G', '.', 'b', '[/]', 't', '^X', '^W', ':', '!', '?']);
});

test('hintsFor: console REPL input mode shows run/history/esc', () => {
  const items = hintsFor(baseState({ activeTool: 'console', conInputEditing: true }));
  expect(items.map(h => h.key)).toEqual(['타이핑', '⏎', '↑/↓', 'esc']);
  expect(items[1].label).toBe('실행');
  expect(items[2].label).toBe('기록');
});

test('hintsFor: an open completion popup swaps in candidate/accept/close hints', () => {
  const items = hintsFor(baseState({ activeTool: 'console', conInputEditing: true, replPopupOpen: true }));
  expect(items.map(h => `${h.key} ${h.label}`)).toEqual(['↑/↓ 후보', 'Tab 채택', 'esc 닫기']);
});

test('hintsFor: the console detail pane shows scroll/wrap/copy keys', () => {
  const keys = hintsFor(baseState({ activeTool: 'console', conDetailOpen: true })).map(h => h.key);
  expect(keys).toEqual(['j/k', 'w', 'y', 'e', 'esc']);
});

test('hintsFor: the console level picker uses the multi-select picker hints', () => {
  const keys = hintsFor(baseState({ activeTool: 'console', conPicker: true })).map(h => h.key);
  expect(keys).toEqual(['j/k', '␣', '⏎', 'esc']);
});

test('hintsFor: the console context picker uses the single-select picker hints', () => {
  const keys = hintsFor(baseState({ activeTool: 'console', conCtxPicker: true })).map(h => h.key);
  expect(keys).toEqual(['j/k', '⏎', 'esc']);
});

test('hintsFor: console filter editing shows the console filter syntax', () => {
  const items = hintsFor(baseState({ activeTool: 'console', conFilterEditing: true }));
  expect(items.map(h => h.key)).toEqual(['타이핑', '⏎/esc']);
  expect(items[0].label).toContain('-제외');
});

test('idle session keys: ., b, and : land on row 1 and ^F/[/]/^X/^W flow to row 2 at 100 cols', () => {
  const [row1, row2] = fitHintRows(hintsFor(baseState()), 98, 2);
  expect(row1.map(h => h.key)).toContain('.');
  expect(row1.map(h => h.key)).toContain('b');
  expect(row1.map(h => h.key)).toContain(':');
  expect(row2.map(h => h.key)).toEqual(['d', '^F', '[/]', 't', '^X', '^W', '!']);
});

test('idle session keys: . and b flow to early row 2 at 80 cols while : keeps row 1', () => {
  const [row1, row2] = fitHintRows(hintsFor(baseState()), 78, 2);
  expect(row1.map(h => h.key)).not.toContain('.');
  expect(row1.map(h => h.key)).toContain(':');
  expect(row2.map(h => h.key)).toEqual(['^F', '.', 'b', '[/]', 't', '^X', '^W']);
});

test('hintsFor: the open command palette shows search/move/run keys', () => {
  const keys = hintsFor(baseState({ paletteOpen: true })).map(h => h.key);
  expect(keys).toEqual(['타이핑', 'j/k', '⏎', 'esc']);
});

test('hintsFor: the session control overlay shows change/run keys', () => {
  const keys = hintsFor(baseState({ sessionControl: true })).map(h => h.key);
  expect(keys).toEqual(['j/k', 'h/l·␣', '⏎', 'esc']);
});

test('detail hints show the wrap key only where wrap applies', () => {
  const keys = (over: Partial<HintState>) => hintsFor(baseState({ detailOpen: true, ...over })).map(h => h.key);
  expect(keys({ detailTab: 'body' })).toContain('w');
  expect(keys({ detailTab: 'request', detailHasBody: true })).toContain('w');
  expect(keys({ detailTab: 'request', detailHasBody: false })).not.toContain('w');
  expect(keys({ detailTab: 'summary' })).not.toContain('w');
  expect(keys({ detailTab: 'response' })).not.toContain('w');
});

test('hintsFor: timeline select labels esc by anchor, applied range, then exit', () => {
  const esc = (s: HintState) => hintsFor(s).find(h => h.key === 'esc')?.label;
  expect(esc(baseState({ tlSelect: true, tlAnchor: true, tlRange: true }))).toBe('선택 취소');
  expect(esc(baseState({ tlSelect: true, tlRange: true }))).toBe('필터 해제');
  expect(esc(baseState({ tlSelect: true }))).toBe('종료');
});

test('hintsFor: elements subview and declaration edit take precedence over the tree', () => {
  expect(hintsFor(baseState({ activeTool: 'elements' })).map(h => h.key)).toEqual(['j/k', 'h/l', '⏎', '/', 'n/N', 'I', 'f', '.', ';', 'o', 'b+s/a/r', 'zR/zM', 'A', 'x', 'y', 'H', 'P', ':', '!', '?']);
  expect(hintsFor(baseState({ activeTool: 'elements', elSubview: true })).map(h => h.key)).toEqual(['j/k', '␣', 'i', '[/]', 'C', ',', 'L', 'p', '.', ';', 'o', 'A', 'y', 'e', 'r', 'c', 'a', 'H', 'P', 'esc', ':', '!', '?']);
  expect(hintsFor(baseState({ activeTool: 'elements', elSubview: true, declEdit: true }))[0].label).toBe('prop: value');
});

test('hintsFor: the class editor and its input prompt take precedence over the subview', () => {
  expect(hintsFor(baseState({ activeTool: 'elements', elSubview: true, elClassesMode: true })).map(h => h.key)).toEqual(['j/k', '␣', 'a', 'esc']);
  expect(hintsFor(baseState({ activeTool: 'elements', elSubview: true, elClassesMode: true, elClassesInput: true })).map(h => h.key)).toEqual(['타이핑', '⏎', 'esc']);
});

test('hintsFor: the elements computed mode and its filter editing take precedence over the subview', () => {
  expect(hintsFor(baseState({ activeTool: 'elements', elSubview: true, elComputedMode: true })).map(h => h.key)).toEqual(['j/k', '/', 'esc']);
  expect(hintsFor(baseState({ activeTool: 'elements', elSubview: true, elComputedMode: true, elComputedFilterEditing: true })).map(h => h.key)).toEqual(['타이핑', '⏎/esc']);
});

test('fitHintRows with one row matches fitHints', () => {
  const items = [hint('a', 'aaaa', 3), hint('b', 'bbbb', 2), hint('c', 'cccc', 1), HELP_HINT];
  const full = displayWidth(rendered(items));
  expect(fitHintRows(items, full, 1)).toEqual([fitHints(items, full)]);
  expect(fitHintRows(items, full - 1, 1)).toEqual([fitHints(items, full - 1)]);
});

test('fitHintRows keeps everything on row 1 when it fits, leaving row 2 empty', () => {
  const items = [hint('a', 'aaaa', 3), hint('b', 'bbbb', 2), HELP_HINT];
  const [row1, row2] = fitHintRows(items, 200, 2);
  expect(row1).toEqual(items);
  expect(row2).toEqual([]);
});

test('fitHintRows overflows to row 2 instead of dropping, keeping high priority on row 1', () => {
  const items = [hint('a', 'aaaa', 3), hint('b', 'bbbb', 1), hint('c', 'cccc', 2), hint('d', 'dddd', 1), HELP_HINT];
  const oneWidth = hintWidth(items[0]);
  const width = oneWidth * 2 + hintWidth(HELP_HINT) + 3 * 2;
  const [row1, row2] = fitHintRows(items, width, 2);
  expect(row1.map(h => h.key)).toEqual(['a', 'c', '?']);
  expect(row2.map(h => h.key)).toEqual(['b', 'd']);
  expect(displayWidth(rendered(row1))).toBeLessThanOrEqual(width);
  expect(displayWidth(rendered(row2))).toBeLessThanOrEqual(width);
});

test('fitHintRows truncates row 2 by priority once both rows are full', () => {
  const items = [
    hint('a', 'aaaa', 3), hint('b', 'bbbb', 3), hint('c', 'cccc', 2),
    hint('d', 'dddd', 2), hint('e', 'eeee', 1), hint('f', 'ffff', 1),
  ];
  const oneWidth = hintWidth(items[0]);
  const width = oneWidth * 2 + 3;
  const [row1, row2] = fitHintRows(items, width, 2);
  expect(row1.map(h => h.key)).toEqual(['a', 'b']);
  expect(row2.map(h => h.key)).toEqual(['c', 'd']);
});

test('hintsFor: settings works detached and switches for editing and searching', () => {
  expect(hintsFor(baseState({ attached: false, activeTool: 'settings' })).map(h => h.key)).toEqual(['j/k', 'h/l', '⏎', '/', ':', '!', '?']);
  expect(hintsFor(baseState({ activeTool: 'settings', settingsEditing: true })).map(h => h.key)).toEqual(['타이핑', '⏎', 'esc']);
  expect(hintsFor(baseState({ activeTool: 'settings', settingsSearching: true })).map(h => h.key)).toEqual(['타이핑', '⏎/esc']);
});
