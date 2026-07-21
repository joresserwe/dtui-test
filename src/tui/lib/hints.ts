import { displayWidth } from './format.js';
import { t } from './i18n.js';
import type { Tool } from '../panels/ToolTabs.js';
import type { DetailTab } from '../overlays/DetailOverlay.js';
import type { StorageView } from '../panels/StorageOverlay.js';
import type { EmuPickerKind } from '../hooks/use-emulation-tool.js';

export interface Hint {
  key: string;
  label: string;
  priority: number;
}

export const hint = (key: string, label: string, priority = 1): Hint => ({ key, label, priority });

export const HELP_HINT: Hint = hint('?', t('hint.help'), 9);

const SEP_WIDTH = 3;

export const hintWidth = (h: Hint): number => displayWidth(h.key) + 1 + displayWidth(h.label);

export function fitHints(items: Hint[], width: number): Hint[] {
  const kept = [...items];
  const total = () => kept.reduce((w, h, i) => w + hintWidth(h) + (i > 0 ? SEP_WIDTH : 0), 0);
  while (kept.length > 1 && total() > width) {
    let drop = 0;
    for (let i = 1; i < kept.length; i++) {
      if (kept[i].priority <= kept[drop].priority) drop = i;
    }
    kept.splice(drop, 1);
  }
  return kept;
}

export function fitHintRows(items: Hint[], width: number, rows: number): Hint[][] {
  if (rows <= 1) return [fitHints(items, width)];
  const indexed = items.map((h, i) => ({ h, i }));
  const byPriority = [...indexed].sort((a, b) => b.h.priority - a.h.priority || a.i - b.i);
  const first = new Set<number>();
  let used = 0;
  for (const { h, i } of byPriority) {
    const w = hintWidth(h) + (first.size ? SEP_WIDTH : 0);
    if (used + w > width) continue;
    first.add(i);
    used += w;
  }
  const row1 = indexed.filter(x => first.has(x.i)).map(x => x.h);
  const rest = indexed.filter(x => !first.has(x.i)).map(x => x.h);
  return [row1, rest.length ? fitHints(rest, width) : []];
}

export interface HintState {
  activeTool: Tool;
  attached: boolean;
  pickerOpen: boolean;
  paletteOpen: boolean;
  newTabPrompt: boolean;
  netPicker: 'type' | 'sort' | 'columns' | 'block' | 'copy' | null;
  emuPicker: EmuPickerKind | null;
  netGroup: boolean;
  overrideManager: boolean;
  blockManager: boolean;
  mapManager: boolean;
  netDiffOpen: boolean;
  sessionControl: boolean;
  helpOpen: boolean;
  notifOpen: boolean;
  detailOpen: boolean;
  detailTab: DetailTab;
  detailHasBody: boolean;
  detailMsgFilterEditing: boolean;
  conPicker: boolean;
  conCtxPicker: boolean;
  conFilterEditing: boolean;
  conInputEditing: boolean;
  replPopupOpen: boolean;
  conDetailOpen: boolean;
  conDetailExpandable: boolean;
  filterEditing: boolean;
  searchEditing: boolean;
  tlSelect: boolean;
  tlAnchor: boolean;
  tlRange: boolean;
  declEdit: boolean;
  elSubview: boolean;
  elSearching: boolean;
  elComputedMode: boolean;
  elComputedFilterEditing: boolean;
  elListenersMode: boolean;
  elClassesMode: boolean;
  elClassesInput: boolean;
  elHintMode: boolean;
  elInspecting: boolean;
  storageEditing: boolean;
  storageFilterEditing: boolean;
  storageDetailOpen: boolean;
  storageView: StorageView;
  storageDepth: number;
  auditRunning: boolean;
  auditHasResult: boolean;
  auditDetailOpen: boolean;
  compFilterEditing: boolean;
  compHasTree: boolean;
  compInspectOpen: boolean;
  srcFilterEditing: boolean;
  srcViewer: boolean;
  srcPausedView: boolean;
  srcPausedFocus: 'stack' | 'scope' | 'watch';
  srcPaused: boolean;
  srcBpEdit: 'condition' | 'logpoint' | null;
  srcWatchInput: boolean;
  srcHasWatches: boolean;
  srcXhrMode: boolean;
  srcXhrInput: boolean;
  srcEventMode: boolean;
  settingsEditing: boolean;
  settingsSearching: boolean;
}

const withHelp = (items: Hint[]): Hint[] => [...items, hint(':', t('hint.palette'), 9), hint('!', t('hint.notifications')), hint('?', t('hint.help'), 9)];

// Wrap only reflows the Body tab and the Request tab's raw-body region.
export const wrapApplies = (tab: DetailTab, hasBody: boolean): boolean =>
  tab === 'body' || (tab === 'request' && hasBody);

const sessionHints = (): Hint[] => [
  hint('.', t('hint.control'), 2),
  hint('b', t('header.hintSwitch'), 2),
  hint('[/]', t('hint.session'), 1),
  hint('t', t('hint.newTab')),
  hint('^X', t('hint.closeSession')),
  hint('^W', t('hint.closeTab')),
];

export function hintsFor(s: HintState): Hint[] {
  return s.newTabPrompt
    ? [hint(t('key.typing'), 'URL', 3), hint('⏎', t('hint.openAttach'), 3), hint('esc', t('hint.cancel'), 2)]
    : s.pickerOpen
    ? [hint(t('key.typing'), t('hint.search')), hint('j/k', t('hint.move'), 2), hint('⏎', t('hint.viewAttach'), 3), hint('^X', t('hint.closeSession')), hint('^W', t('hint.closeTab')), hint('esc', t('hint.close'), 2)]
    : s.paletteOpen
    ? [hint(t('key.typing'), t('hint.search'), 3), hint('j/k', t('hint.move'), 2), hint('⏎', t('hint.run'), 3), hint('esc', t('hint.close'), 2)]
    : s.netPicker || s.conPicker || s.conCtxPicker || s.emuPicker
      ? s.netPicker === 'sort'
        ? [hint('j/k', t('hint.move')), hint('⏎', t('hint.select'), 3), hint('h/l', t('hint.ascDesc'), 2), hint('esc', t('hint.close'), 2)]
        : s.netPicker === 'block' || s.netPicker === 'copy' || s.conCtxPicker || s.emuPicker
          ? [hint('j/k', t('hint.move')), hint('⏎', t('hint.select'), 3), hint('esc', t('hint.close'), 2)]
          : [hint('j/k', t('hint.move')), hint('␣', t('hint.select'), 3), hint('⏎', t('hint.apply'), 3), hint('esc', t('hint.close'), 2)]
    : s.overrideManager || s.mapManager
      ? [hint('j/k', t('hint.move')), hint('␣', t('hint.onOff'), 3), hint('⏎', t('hint.edit'), 3), hint('d', t('hint.delete'), 3), hint('esc', t('hint.close'), 2)]
    : s.blockManager
      ? [hint('j/k', t('hint.move')), hint('␣', t('hint.onOff'), 3), hint('d', t('hint.delete'), 3), hint('esc', t('hint.close'), 2)]
    : s.sessionControl
      ? [hint('j/k', t('hint.move')), hint('h/l·␣', t('hint.change'), 3), hint('⏎', t('hint.run'), 3), hint('esc', t('hint.close'), 2)]
    : s.helpOpen
      ? [hint('j/k', t('hint.scroll'), 3), hint('gg/G', t('hint.topBottom')), hint('esc', t('hint.close'), 2)]
    : s.notifOpen
      ? [hint('j/k', t('hint.move'), 2), hint('⏎', t('hint.copyMsg'), 3), hint('esc', t('hint.close'), 2)]
      : s.detailMsgFilterEditing
        ? [hint(t('key.typing'), t('hint.filter'), 3), hint('⏎/esc', t('hint.done'), 2)]
      : s.detailOpen
        ? [
            hint('h/l', t('hint.tab'), 3),
            hint('j/k', t('hint.scroll'), 2),
            ...(s.detailTab === 'messages' ? [hint('/', t('hint.filter'), 2)] : []),
            ...(wrapApplies(s.detailTab, s.detailHasBody) ? [hint('w', t('hint.wrap'))] : []),
            hint('y', t('hint.copy')),
            hint('e', t('hint.editor')),
            hint('esc', t('hint.close'), 2),
          ]
      : s.netDiffOpen
        ? [hint('j/k', t('hint.scroll'), 3), hint('gg/G', t('hint.topBottom')), hint('y', t('hint.copy'), 2), hint('esc', t('hint.close'), 2)]
      : s.conDetailOpen
        ? [
            hint('j/k', t('hint.scroll'), 3),
            ...(s.conDetailExpandable ? [hint('⏎/l·h', t('hint.expand'), 3), hint('s', t('hint.storeGlobal')), hint('I', t('hint.reveal'))] : []),
            hint('w', t('hint.wrap')),
            hint('y', t('hint.copy'), 2),
            hint('e', t('hint.editor')),
            hint('esc', t('hint.close'), 2),
          ]
      : s.conInputEditing
        ? s.replPopupOpen
          ? [hint('↑/↓', t('hint.candidates'), 3), hint('Tab', t('hint.accept'), 3), hint('esc', t('hint.close'), 2)]
          : [hint(t('key.typing'), 'JS', 3), hint('⏎', t('hint.run'), 3), hint('↑/↓', t('hint.history'), 2), hint('esc', t('hint.close'), 2)]
      : s.conFilterEditing
        ? [hint(t('key.typing'), t('hint.conFilterSyntax'), 3), hint('⏎/esc', t('hint.done'), 2)]
        : s.filterEditing
          ? [hint(t('key.typing'), t('hint.filterSyntax'), 3), hint('⏎/esc', t('hint.done'), 2)]
          : s.searchEditing
            ? [hint(t('key.typing'), t('hint.searchAll'), 3), hint('⏎', t('hint.apply'), 2), hint('esc', t('hint.cancel'))]
          : !s.attached && s.activeTool !== 'settings'
            ? withHelp([hint('b', t('hint.pickTab'), 3), hint('t', t('hint.newTab'), 2), hint('q', t('hint.quit'), 2)])
          : s.activeTool === 'network'
            ? s.tlSelect
              ? withHelp([hint('h/l', t('hint.move'), 3), hint('H/L', t('hint.jump')), hint('0/$', t('hint.topBottom')), hint('v', t('hint.markApply'), 3), hint('⏎', t('hint.apply'), 2), hint('esc', s.tlAnchor ? t('hint.cancelSelection') : s.tlRange ? t('hint.clearFilter') : t('hint.exit'), 2)])
              : withHelp([hint('/', t('hint.filter'), 3), hint('x', t('hint.type'), 2), hint('s', t('hint.sort'), 2), hint('⏎', t('hint.detail'), 3), ...(s.netGroup ? [hint('h/l', t('hint.fold'), 2)] : []), hint('v', t('hint.mark'), 2), hint('d', t('hint.diff'), 0), hint('z', t('hint.range'), 2), hint('^F', t('hint.search')), ...sessionHints()])
            : s.activeTool === 'console'
              ? withHelp([hint('i', t('hint.input'), 3), hint('/', t('hint.filter'), 3), hint('x', t('hint.level'), 2), hint('E', t('hint.context'), 2), hint('⏎', t('hint.detail'), 3), hint('␣', t('hint.stack'), 2), hint('T', t('hint.timestamps')), hint('C', t('hint.clear')), hint('Y', t('hint.copyAll')), hint('j/k', t('hint.move'), 2), hint('gg/G', t('hint.topBottom')), ...sessionHints()])
              : s.activeTool === 'elements'
                ? s.declEdit
                  ? [hint(t('key.typing'), 'prop: value', 3), hint('tab', t('hint.autocomplete'), 2), hint('⏎', t('hint.apply'), 2), hint('esc', t('hint.cancel'))]
                  : s.elComputedFilterEditing
                    ? [hint(t('key.typing'), t('hint.partialMatch'), 3), hint('⏎/esc', t('hint.done'), 2)]
                  : s.elComputedMode
                    ? [hint('j/k', t('hint.scroll'), 3), hint('/', t('hint.filter'), 3), hint('esc', t('hint.back'), 2)]
                  : s.elClassesInput
                    ? [hint(t('key.typing'), t('hint.className'), 3), hint('⏎', t('hint.add'), 2), hint('esc', t('hint.cancel'), 2)]
                  : s.elClassesMode
                    ? [hint('j/k', t('hint.move'), 3), hint('␣', t('hint.toggle'), 3), hint('a', t('hint.add'), 2), hint('esc', t('hint.back'), 2)]
                  : s.elListenersMode
                    ? [hint('j/k', t('hint.scroll'), 3), hint('esc', t('hint.back'), 2)]
                  : s.elHintMode
                    ? [hint(t('key.typing'), t('hint.hintLabel'), 3), hint('esc', t('hint.cancel'), 2)]
                  : s.elSubview
                    ? withHelp([hint('j/k', t('hint.decl'), 3), hint('␣', t('hint.toggle'), 3), hint('i', t('hint.value'), 2), hint('[/]', '±1/±10', 2), hint('C', 'computed', 2), hint(',', t('hint.classes'), 2), hint('L', t('hint.listeners')), hint('p', ':hov'), hint('.', t('hint.click'), 2), hint(';', t('hint.hover')), hint('o', 'grid/flex'), hint('A', t('hint.attrs')), hint('y', t('hint.copy')), hint('e', 'HTML', 2), hint('r', t('hint.rule')), hint('c', 'CSS'), hint('a', t('hint.declaration')), hint('H', t('hint.hide')), hint('P', t('hint.pin')), hint('esc', t('hint.tree'), 2)])
                    : s.elSearching
                      ? [hint(t('key.typing'), t('hint.domSearch'), 3), hint('⏎', t('hint.move'), 2), hint('esc', t('hint.cancel'))]
                      : s.elInspecting
                        ? [hint('esc/I', t('hint.cancel'), 3)]
                        : withHelp([hint('j/k', t('hint.move'), 2), hint('h/l', t('hint.foldUnfold'), 2), hint('⏎', t('hint.detail'), 3), hint('/', t('hint.search'), 2), hint('n/N', t('hint.nextPrev')), hint('I', t('hint.inspect'), 2), hint('f', t('hint.hints'), 2), hint('.', t('hint.click'), 2), hint(';', t('hint.hover')), hint('o', 'grid/flex'), hint('b+s/a/r', t('hint.el.domBp'), 2), hint('zR/zM', t('hint.recursive')), hint('A', t('hint.attrs')), hint('x', t('hint.delete')), hint('y', t('hint.copy')), hint('H', t('hint.hide')), hint('P', t('hint.pin'))])
                : s.activeTool === 'storage'
                  ? s.storageDetailOpen
                    ? [hint('j/k', t('hint.scroll'), 3), hint('y', t('hint.copy'), 2), hint('e', t('hint.editor')), hint('esc', t('hint.close'), 2)]
                    : s.storageFilterEditing
                      ? [hint(t('key.typing'), t('hint.conFilterSyntax'), 3), hint('⏎/esc', t('hint.done'), 2)]
                      : s.storageEditing
                        ? [hint(t('key.typing'), t('hint.enterValue'), 3), hint('⏎', t('hint.save'), 2), hint('esc', t('hint.cancel'))]
                        : s.storageView === 'sw'
                          ? withHelp([hint('u', t('hint.swUpdate'), 3), hint('B', t('hint.swBypass'), 3), hint('p', t('hint.swPush'), 2), hint('s/S', t('hint.swSync'), 2), hint('P', t('hint.swPeriodic')), hint('h/l', t('hint.view'), 2), hint('y', t('hint.copy'))])
                          : s.storageView === 'background'
                            ? withHelp([hint('T', t('hint.bgSub'), 3), hint('r', t('hint.bgRecord'), 2), hint('⏎', t('hint.detail'), 3), hint('h/l', t('hint.view'), 2), hint('/', t('hint.filter'))])
                          : s.storageView === 'pst'
                            ? withHelp([hint('d', t('hint.pstClear'), 3), hint('h/l', t('hint.view'), 2), hint('/', t('hint.filter'), 2), hint('y', t('hint.copy'))])
                          : s.storageView === 'app' || s.storageView === 'frames' || s.storageView === 'shared'
                            ? withHelp([hint('⏎', t('hint.detail'), 3), hint('h/l', t('hint.view'), 2), hint('/', t('hint.filter'), 2), hint('y', t('hint.copy'))])
                          : s.storageView === 'idb' || s.storageView === 'cache'
                            ? s.storageDepth > 0
                              ? withHelp([hint('⏎', t('hint.open'), 3), hint('h', t('hint.up'), 3), hint('/', t('hint.filter'), 2), hint('y', t('hint.copy')), ...(s.storageView === 'idb' && s.storageDepth === 2 ? [hint('e', t('hint.edit'), 2)] : []), hint('d', t('hint.delete'), 2), hint('D', t('hint.clearAll'), 2)])
                              : withHelp([hint('⏎', t('hint.open'), 3), hint('h/l', t('hint.view'), 2), hint('/', t('hint.filter'), 2), hint('y', t('hint.copy')), ...(s.storageView === 'cache' ? [hint('D', t('hint.delete'), 2)] : []), hint('X', t('hint.clearAll'))])
                            : withHelp([hint('/', t('hint.filter'), 3), hint('⏎', t('hint.detail'), 3), hint('h/l', t('hint.view'), 2), hint('e', t('hint.edit'), 2), hint('a', t('hint.attr'), 2), hint('y', t('hint.copy')), ...(s.storageView === 'cookies' ? [hint('Y', t('hint.exportCookies'))] : []), hint('n', t('hint.add')), hint('d', t('hint.delete')), hint('X', t('hint.clearAll'))])
                : s.activeTool === 'sources'
                  ? s.srcFilterEditing
                    ? [hint(t('key.typing'), t('hint.partialMatch'), 3), hint('⏎/esc', t('hint.done'), 2)]
                    : s.srcBpEdit
                      ? [
                          hint(t('key.typing'), t(s.srcBpEdit === 'logpoint' ? 'hint.src.logTemplate' : 'hint.src.condExpr'), 3),
                          hint('⏎', t('hint.apply'), 2),
                          hint('esc', t('hint.cancel'), 2),
                        ]
                    : s.srcWatchInput
                      ? [hint(t('key.typing'), t('hint.src.watchExpr'), 3), hint('⏎', t('hint.add'), 2), hint('esc', t('hint.cancel'), 2)]
                    : s.srcXhrInput
                      ? [hint(t('key.typing'), t('hint.src.xhrSubstring'), 3), hint('⏎', t('hint.add'), 2), hint('esc', t('hint.cancel'), 2)]
                    : s.srcXhrMode
                      ? [hint('j/k', t('hint.move'), 2), hint('a', t('hint.add'), 3), hint('d', t('hint.delete'), 3), hint('esc', t('hint.back'), 2)]
                    : s.srcEventMode
                      ? [hint('j/k', t('hint.move'), 2), hint('␣', t('hint.toggle'), 3), hint('esc', t('hint.back'), 2)]
                    : s.srcViewer
                      ? [
                          hint('j/k', t('hint.scroll'), 3),
                          hint('b', t('hint.src.breakpoint'), 3),
                          hint('B', t('hint.src.condBp'), 2),
                          hint('L', t('hint.src.logpoint'), 2),
                          hint('P', t('hint.src.pretty')),
                          hint('e', t('hint.edit')),
                          ...(s.srcPaused
                            ? [hint('n/s/o', t('hint.src.step'), 2), hint('c', t('hint.src.resume'), 3)]
                            : [hint('p', t('hint.src.pause'))]),
                          hint('X', t('hint.src.exceptions')),
                          hint('esc', t('hint.back'), 2),
                        ]
                      : s.srcPausedView
                        ? [
                            hint('n/s/o', t('hint.src.step'), 3),
                            hint('c', t('hint.src.resume'), 3),
                            hint('j/k', s.srcPausedFocus === 'stack' ? t('hint.src.frames') : s.srcPausedFocus === 'scope' ? t('hint.src.vars') : t('hint.src.watch'), 2),
                            ...(s.srcPausedFocus === 'scope'
                              ? [hint('⏎/l·h', t('hint.expand'), 2)]
                              : s.srcPausedFocus === 'watch'
                                ? [hint('d', t('hint.delete'), 2)]
                                : [hint('⏎', t('hint.src.openSource'), 2)]),
                            hint('+', t('hint.src.watch'), 2),
                            hint('w', t('hint.src.focus'), 2),
                            hint('X', t('hint.src.exceptions')),
                            hint('esc', t('hint.src.toList')),
                          ]
                        : withHelp([
                            hint('/', t('hint.filter'), 3),
                            hint('⏎', t('hint.open'), 3),
                            ...(s.srcPaused
                              ? [hint('c', t('hint.src.resume'), 2), hint('esc', t('hint.src.toPaused'), 2)]
                              : [hint('p', t('hint.src.pause'))]),
                            hint('x', t('hint.src.blackbox'), 2),
                            hint('m', t('hint.src.map')),
                            hint('F', t('hint.src.xhrBp'), 2),
                            hint('E', t('hint.src.eventBp')),
                            hint('X', t('hint.src.exceptions'), 2),
                            hint('j/k', t('hint.move'), 2),
                            ...sessionHints(),
                          ])
                : s.activeTool === 'components'
                  ? s.compInspectOpen
                    ? [
                        hint('⏎/l·h', t('hint.expand'), 3),
                        hint('s', t('hint.storeGlobal'), 2),
                        hint('y', t('hint.copy'), 2),
                        hint('j/k', t('hint.move'), 2),
                        hint('esc', t('hint.close'), 2),
                      ]
                    : s.compFilterEditing
                    ? [hint(t('key.typing'), t('hint.partialMatch'), 3), hint('⏎/esc', t('hint.done'), 2)]
                    : s.compHasTree
                      ? withHelp([
                          hint('H', t('hint.comp.highlight'), 3),
                          hint('⏎', t('hint.comp.reveal'), 3),
                          hint('i', t('hint.comp.inspect'), 2),
                          hint('h/l', t('hint.fold'), 2),
                          hint('/', t('hint.filter'), 2),
                          hint('r', t('hint.comp.rescan'), 2),
                          hint('j/k', t('hint.move'), 2),
                          hint('gg/G', t('hint.topBottom')),
                          ...sessionHints(),
                        ])
                      : withHelp([hint('r', t('hint.comp.rescan'), 3), ...sessionHints()])
                : s.activeTool === 'audit'
                  ? s.auditDetailOpen
                    ? [hint('j/k', t('hint.scroll'), 3), hint('gg/G', t('hint.topBottom')), hint('esc', t('hint.close'), 2)]
                    : s.auditRunning
                      ? [hint('esc', t('hint.cancel'), 3)]
                      : withHelp([
                          hint('r', t('hint.run'), 3),
                          hint('m', t('hint.audit.preset'), 2),
                          hint('p/a/B/s', t('hint.audit.cats'), 2),
                          ...(s.auditHasResult
                            ? [hint('j/k', t('hint.move'), 2), hint('⏎', t('hint.detail'), 3), hint('E', t('hint.audit.export'), 2), hint('h/l', t('hint.audit.pastRuns'))]
                            : []),
                          ...sessionHints(),
                        ])
                  : s.settingsEditing
                    ? [hint(t('key.typing'), t('hint.enterValue'), 3), hint('⏎', t('hint.save'), 2), hint('esc', t('hint.cancel'))]
                    : s.settingsSearching
                      ? [hint(t('key.typing'), t('hint.search'), 3), hint('⏎/esc', t('hint.done'), 2)]
                      : withHelp([hint('j/k', t('hint.move'), 2), hint('h/l', t('hint.flipValue'), 2), hint('⏎', t('hint.edit'), 3), hint('/', t('hint.search'), 2)]);
}
