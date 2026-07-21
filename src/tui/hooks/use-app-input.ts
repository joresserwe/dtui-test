import { useRef } from 'react';
import { useInput, type Key } from 'ink';
import type { Endpoint } from '../../cdp/discovery.js';
import { closePage, type PageTarget } from '../../cdp/targets.js';
import type { BlockPattern, DebugSession, MapRemoteRule, OverrideRule, ThrottleName } from '../../engine.js';
import type { MultiTabs, TabSection } from '../lib/multi-tabs.js';
import type { ConsoleEntry, NetworkEntry } from '../../store/types.js';
import { pickerItems, type PickerItem, type PickerSection, type PickerSessionRow } from '../overlays/TabPicker.js';
import { TOOLS, type Tool } from '../panels/ToolTabs.js';
import { dispatchInput, editLine, makeFollowNav, makeListNav } from '../lib/keys.js';
import { handleDetailKey } from '../keys/detail-keys.js';
import { handleElementsKey } from '../keys/elements-keys.js';
import { handleStorageKey, handleStorageDetailKey } from '../keys/storage-keys.js';
import { handleAuditKey, handleAuditDetailKey } from '../keys/audit-keys.js';
import { handleSourcesKey, handleSourcesViewerKey } from '../keys/sources-keys.js';
import { handleComponentsKey } from '../keys/components-keys.js';
import { handleSettingsKey } from '../keys/settings-keys.js';
import { handleNetworkKey } from '../keys/network-keys.js';
import { handleConsoleDetailKey, handleConsoleKey, submitConsoleInput } from '../keys/console-keys.js';
import type { Line, DetailTab } from '../overlays/DetailOverlay.js';
import { HELP_CHROME, helpRows } from '../overlays/HelpOverlay.js';
import { parseCookieAttrs, type StorageRow, type StorageView } from '../panels/StorageOverlay.js';
import { CSS_PROPERTIES } from '../lib/css-props.js';
import { normalizeUrl } from '../../util/url.js';
import { t } from '../lib/i18n.js';
import { dirname } from 'node:path';
import { harRoot } from '../../persist/har.js';
import { SESSION_CONTROL_ROWS } from '../overlays/SessionControl.js';
import { filterCommands, type Command, type CommandCtx } from '../lib/commands.js';
import { applyCacheDisabled, applyThrottle, cycleThrottle, exportSessionHar } from '../lib/session-actions.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import type { Toasts } from './use-toasts.js';
import type { Attached, SessionEntry, SessionKey } from './use-session-manager.js';
import type { NetworkTool } from './use-network-tool.js';
import type { ConsoleTool } from './use-console-tool.js';
import type { StorageTool } from './use-storage-tool.js';
import type { ElementsTool } from './use-elements-tool.js';
import type { SettingsTool } from './use-settings-tool.js';
import type { EmulationTool } from './use-emulation-tool.js';
import type { AuditTool } from './use-audit-tool.js';
import type { SourcesTool } from './use-sources-tool.js';
import type { ComponentsTool } from './use-components-tool.js';
import type { RecorderTool } from './use-recorder-tool.js';
import type { PausedView, ScriptInfo } from '../../store/debugger.js';
import type { ReplCompletion } from './use-repl-completion.js';

export const pickerCloseToken = (it: PickerItem): string =>
  it.kind === 'session' ? `s:${it.session.key}` : it.kind === 'tab' ? `t:${it.tab.id}` : '';

export interface AppInputDeps {
  ep: Endpoint;
  tabs: MultiTabs;
  columns: number;
  bodyH: number;
  helpH: number;
  editingRef: { current: boolean };
  whenNotEditing: (fn: () => void) => void;
  withEditor: (initial: string, ext?: string) => Promise<string | null>;
  copyFn: (text: string) => Promise<void>;
  exportHarFn: (session: DebugSession, entries?: NetworkEntry[]) => Promise<string>;
  openFolderFn: (dir: string) => Promise<void>;
  setToast: (msg: string, level?: ToastLevel) => void;
  toasts: Toasts;
  net: NetworkTool;
  con: ConsoleTool;
  revealNodeFromConsole: (objectId: string) => void;
  storage: StorageTool;
  el: ElementsTool;
  settings: SettingsTool;
  emu: EmulationTool;
  audit: AuditTool;
  src: SourcesTool;
  comp: ComponentsTool;
  rec: RecorderTool;
  srcScripts: ScriptInfo[];
  srcPaused: PausedView | null;
  srcScopeLines: Line[];
  attached: Attached | null;
  active: SessionEntry | null;
  sessions: () => SessionEntry[];
  openSession: (t: PageTarget, ep: Endpoint) => Promise<void>;
  openUrl: (url: string, ep: Endpoint, opts?: { incognito?: boolean }) => Promise<void>;
  switchTo: (key: SessionKey) => void;
  switchBy: (delta: number) => void;
  closeSession: (key: SessionKey) => Promise<boolean>;
  quit: () => void;
  throttle: ThrottleName;
  cacheDisabled: boolean;
  setThrottleState: (t: ThrottleName) => void;
  setCacheDisabledState: (v: boolean) => void;
  overrideRulesRef: { current: OverrideRule[] };
  blockedPatternsRef: { current: BlockPattern[] };
  overrideSeq: { current: number };
  setOverrideRules: (rules: OverrideRule[]) => void;
  overrideManager: boolean;
  setOverrideManager: React.Dispatch<React.SetStateAction<boolean>>;
  blockManager: boolean;
  setBlockManager: React.Dispatch<React.SetStateAction<boolean>>;
  setBlockTarget: React.Dispatch<React.SetStateAction<NetworkEntry | null>>;
  mapRemoteRef: { current: MapRemoteRule[] };
  mapSeq: { current: number };
  setMapRemoteRules: (rules: MapRemoteRule[]) => void;
  mapManager: boolean;
  setMapManager: React.Dispatch<React.SetStateAction<boolean>>;
  netDiff: { a: NetworkEntry; b: NetworkEntry } | null;
  setNetDiff: React.Dispatch<React.SetStateAction<{ a: NetworkEntry; b: NetworkEntry } | null>>;
  setNetDiffScroll: React.Dispatch<React.SetStateAction<number>>;
  netDiffLinesRich: Line[];
  netDiffMaxScroll: number;
  netDiffBudget: number;
  activeTool: Tool;
  setActiveTool: React.Dispatch<React.SetStateAction<Tool>>;
  setLayout: React.Dispatch<React.SetStateAction<'tabs' | 'split'>>;
  setHintsMode: React.Dispatch<React.SetStateAction<'2' | '1' | 'off'>>;
  helpOpen: boolean;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHelpScroll: React.Dispatch<React.SetStateAction<number>>;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifSel: number;
  setNotifSel: React.Dispatch<React.SetStateAction<number>>;
  sessionControlOpen: boolean;
  setSessionControlOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sessionControlSel: number;
  setSessionControlSel: React.Dispatch<React.SetStateAction<number>>;
  detailOpen: boolean;
  detailEntry: NetworkEntry | null;
  detailTab: DetailTab;
  setDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDetailEntry: React.Dispatch<React.SetStateAction<NetworkEntry | null>>;
  setDetailTab: React.Dispatch<React.SetStateAction<DetailTab>>;
  setDetailScroll: React.Dispatch<React.SetStateAction<number>>;
  setDetailWrap: React.Dispatch<React.SetStateAction<boolean>>;
  detailMsgFilter: string;
  setDetailMsgFilter: React.Dispatch<React.SetStateAction<string>>;
  detailMsgFilterEditing: boolean;
  setDetailMsgFilterEditing: React.Dispatch<React.SetStateAction<boolean>>;
  detailRich: Line[];
  detailMaxScroll: number;
  detailH: number;
  conDetailLinesRich: Line[];
  conDetailBudget: number;
  storageDetail: { row: StorageRow; view: StorageView } | null;
  setStorageDetail: React.Dispatch<React.SetStateAction<{ row: StorageRow; view: StorageView } | null>>;
  setStorageDetailScroll: React.Dispatch<React.SetStateAction<number>>;
  storageDetailLinesRich: Line[];
  storageDetailMaxScroll: number;
  storageDetailBudget: number;
  newTab: { incognito: boolean; value: string } | null;
  setNewTab: React.Dispatch<React.SetStateAction<{ incognito: boolean; value: string } | null>>;
  pickerOpen: boolean;
  setPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pickerQuery: string;
  setPickerQuery: React.Dispatch<React.SetStateAction<string>>;
  pickerSel: number;
  setPickerSel: React.Dispatch<React.SetStateAction<number>>;
  pickerSections: PickerSection[];
  pickerSessions: PickerSessionRow[];
  rawSections: TabSection[];
  paletteOpen: boolean;
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  paletteQuery: string;
  setPaletteQuery: React.Dispatch<React.SetStateAction<string>>;
  paletteSel: number;
  setPaletteSel: React.Dispatch<React.SetStateAction<number>>;
  paletteAvailable: Command[];
  paletteCtx: CommandCtx;
  closeArm: string | null;
  setCloseArm: React.Dispatch<React.SetStateAction<string | null>>;
  armClose: (token: string) => void;
  closeSessionTab: (entry: SessionEntry) => void;
  openHelp: () => void;
  openPalette: () => void;
  openTabPicker: () => void;
  openNotifications: () => void;
  openSessionControl: () => void;
  focusBrowser: () => void;
  closeActiveSession: () => void;
  armOrCloseActiveTab: () => void;
  reloadPage: () => void;
  copyContextAction: () => void;
  takeSnapshot: () => void;
  openNetSearch: () => void;
  netEntries: NetworkEntry[];
  markedEntries: NetworkEntry[];
  clampedNetSel: number;
  selEntry: NetworkEntry | undefined;
  tlEntries: NetworkEntry[];
  tlNow: number;
  conEntries: ConsoleEntry[];
  clampedConSel: number;
  storageRows: StorageRow[];
  replComp: ReplCompletion;
}

export function useAppInput(deps: AppInputDeps): void {
  const {
    ep,
    tabs,
    columns,
    bodyH,
    helpH,
    editingRef,
    whenNotEditing,
    withEditor,
    copyFn,
    exportHarFn,
    openFolderFn,
    setToast,
    toasts,
    net,
    con,
    revealNodeFromConsole,
    storage,
    el,
    settings,
    emu,
    audit,
    src,
    comp,
    rec,
    srcScripts,
    srcPaused,
    srcScopeLines,
    attached,
    active,
    sessions,
    openSession,
    openUrl,
    switchTo,
    switchBy,
    closeSession,
    quit,
    throttle,
    cacheDisabled,
    setThrottleState,
    setCacheDisabledState,
    overrideRulesRef,
    blockedPatternsRef,
    overrideSeq,
    setOverrideRules,
    overrideManager,
    setOverrideManager,
    blockManager,
    setBlockManager,
    setBlockTarget,
    mapRemoteRef,
    mapSeq,
    setMapRemoteRules,
    mapManager,
    setMapManager,
    netDiff,
    setNetDiff,
    setNetDiffScroll,
    netDiffLinesRich,
    netDiffMaxScroll,
    netDiffBudget,
    activeTool,
    setActiveTool,
    setLayout,
    setHintsMode,
    helpOpen,
    setHelpOpen,
    setHelpScroll,
    notifOpen,
    setNotifOpen,
    notifSel,
    setNotifSel,
    sessionControlOpen,
    setSessionControlOpen,
    sessionControlSel,
    setSessionControlSel,
    detailOpen,
    detailEntry,
    detailTab,
    setDetailOpen,
    setDetailEntry,
    setDetailTab,
    setDetailScroll,
    setDetailWrap,
    detailMsgFilter,
    setDetailMsgFilter,
    detailMsgFilterEditing,
    setDetailMsgFilterEditing,
    detailRich,
    detailMaxScroll,
    detailH,
    conDetailLinesRich,
    conDetailBudget,
    storageDetail,
    setStorageDetail,
    setStorageDetailScroll,
    storageDetailLinesRich,
    storageDetailMaxScroll,
    storageDetailBudget,
    newTab,
    setNewTab,
    pickerOpen,
    setPickerOpen,
    pickerQuery,
    setPickerQuery,
    pickerSel,
    setPickerSel,
    pickerSections,
    pickerSessions,
    rawSections,
    paletteOpen,
    setPaletteOpen,
    paletteQuery,
    setPaletteQuery,
    paletteSel,
    setPaletteSel,
    paletteAvailable,
    paletteCtx,
    closeArm,
    setCloseArm,
    armClose,
    closeSessionTab,
    openHelp,
    openPalette,
    openTabPicker,
    openNotifications,
    openSessionControl,
    focusBrowser,
    closeActiveSession,
    armOrCloseActiveTab,
    reloadPage,
    copyContextAction,
    takeSnapshot,
    openNetSearch,
    netEntries,
    markedEntries,
    clampedNetSel,
    selEntry,
    tlEntries,
    tlNow,
    conEntries,
    clampedConSel,
    storageRows,
    replComp,
  } = deps;
  const { netPicker, filterEditing, setFilterEditing, setUrlFilter, searchEditing, setSearchEditing, searchDraft, setSearchDraft, setSearchQuery, setNetSel, setNetSelId, setNetFollow, setNetColumns } = net;
  const { conPicker, conCtxPicker, conCtxId, conDetailEntry, conInputEditing, setConInputEditing, conInputDraft, setConInputDraft, setConFollow, conFilterEditing, setConFilterEditing, setConTextFilter } = con;
  const { storageView, cookieRows, storageSel, storageFilterEditing, setStorageFilterEditing, setStorageFilter, storageEditing, setStorageEditing, setStorageErr, reloadView } = storage;
  const { elSearching, setElSearching, elQuery, setElQuery, elSubview, declEdit, setDeclEdit, computedFilterEditing, setComputedFilterEditing, setComputedFilter, setComputedScroll, runElSearch, applyDecl } = el;
  const { settingsEditing, setSettingsEditing, setSettingsErr, settingsSearching, setSettingsSearching, setSettingsQuery, setSettingsSel } = settings;

  const gPending = useRef(false);
  const followNav = makeFollowNav(gPending);
  const listNav = makeListNav(gPending);

  const helpBudget = Math.max(1, helpH - HELP_CHROME);
  const helpMaxScroll = helpOpen ? Math.max(0, helpRows(activeTool).length - helpBudget) : 0;

  const handleKey = (input: string, key: Key) => {
    if (editingRef.current) return;
    if (input !== 'g') gPending.current = false;
    if (helpOpen) {
      if (key.escape || input === 'q' || input === '?') {
        setHelpOpen(false);
        setHelpScroll(0);
        return;
      }
      const page = Math.max(1, Math.floor(helpBudget / 2));
      listNav(input, key, helpMaxScroll + 1, setHelpScroll, page);
      return;
    }
    if (notifOpen) {
      if (key.escape || input === 'q' || input === '!') {
        setNotifOpen(false);
        return;
      }
      const entries = toasts.history();
      const sel = Math.min(notifSel, Math.max(0, entries.length - 1));
      if (key.downArrow || input === 'j') return setNotifSel(Math.min(sel + 1, Math.max(0, entries.length - 1)));
      if (key.upArrow || input === 'k') return setNotifSel(Math.max(0, sel - 1));
      if (key.return) {
        const entry = entries[sel];
        if (entry)
          void copyFn(entry.msg).then(
            () => setToast(t('toast.copied'), 'success'),
            () => setToast(t('toast.copyFailed'), 'error'),
          );
      }
      return;
    }
    if (sessionControlOpen) {
      const entry = active;
      if (!entry || key.escape || input === 'q' || input === '.') {
        setSessionControlOpen(false);
        return;
      }
      if (key.downArrow || input === 'j') return setSessionControlSel(i => Math.min(i + 1, SESSION_CONTROL_ROWS - 1));
      if (key.upArrow || input === 'k') return setSessionControlSel(i => Math.max(0, i - 1));
      const dir = key.leftArrow || input === 'h' ? -1 : key.rightArrow || input === 'l' ? 1 : 0;
      const run = key.return || input === ' ';
      if (sessionControlSel === 0 && (dir !== 0 || run)) {
        applyThrottle(entry.session, cycleThrottle(throttle, dir === -1 ? -1 : 1), setThrottleState, setToast);
        return;
      }
      if (sessionControlSel === 1 && (dir !== 0 || run)) {
        applyCacheDisabled(entry.session, !cacheDisabled, setCacheDisabledState, setToast);
        return;
      }
      if (!run) return;
      if (sessionControlSel === 2) {
        if (!overrideRulesRef.current.length) return setToast(t('toast.noOverrideRules'));
        setSessionControlOpen(false);
        setOverrideManager(true);
        return;
      }
      if (sessionControlSel === 3) {
        if (!blockedPatternsRef.current.length) return setToast(t('toast.noBlockPatterns'));
        setSessionControlOpen(false);
        setBlockManager(true);
        return;
      }
      if (sessionControlSel === 4) {
        setSessionControlOpen(false);
        exportSessionHar(entry.session, exportHarFn, copyFn, setToast);
        return;
      }
      setSessionControlOpen(false);
      void openFolderFn(dirname(harRoot())).catch(() => setToast(t('toast.openFolderFailed'), 'error'));
      return;
    }
    if (detailOpen && detailEntry) {
      handleDetailKey(
        { detailEntry, detailRich, detailMaxScroll, detailH, detailTab, msgFilter: detailMsgFilter, setMsgFilter: setDetailMsgFilter, setMsgFilterEditing: setDetailMsgFilterEditing, gPending, setDetailOpen, setDetailEntry, setDetailTab, setDetailScroll, setDetailWrap, copyFn, setToast, withEditor },
        input,
        key,
      );
      return;
    }
    if (netDiff) {
      if (key.escape || input === 'q') {
        setNetDiff(null);
        setNetDiffScroll(0);
        return;
      }
      if (input === 'y') {
        void copyFn(netDiffLinesRich.map(l => l.text).join('\n')).then(
          () => setToast(t('toast.copied'), 'success'),
          () => setToast(t('toast.copyFailed'), 'error'),
        );
        return;
      }
      const page = Math.max(1, Math.floor(netDiffBudget / 2));
      listNav(input, key, netDiffMaxScroll + 1, setNetDiffScroll, page);
      return;
    }
    if (conDetailEntry) {
      handleConsoleDetailKey(
        { con, detailEntry: conDetailEntry, lines: conDetailLinesRich, pageH: conDetailBudget, session: attached?.session, gPending, copyFn, setToast, withEditor, whenNotEditing, revealNode: revealNodeFromConsole },
        input,
        key,
      );
      return;
    }
    if (storageDetail) {
      handleStorageDetailKey(
        { row: storageDetail.row, lines: storageDetailLinesRich, maxScroll: storageDetailMaxScroll, pageH: storageDetailBudget, gPending, setStorageDetail, setStorageDetailScroll, copyFn, setToast, withEditor },
        input,
        key,
      );
      return;
    }
    if (activeTool === 'audit' && audit.auditDetail) {
      handleAuditDetailKey({ audit, attached, bodyH, columns, listNav, copyFn }, input, key);
      return;
    }
    if (activeTool === 'sources' && src.viewScript) {
      handleSourcesViewerKey({ src, attached, bodyH, listNav, gPending, scripts: srcScripts, paused: srcPaused, scopeLines: srcScopeLines, withEditor }, input, key);
      return;
    }
    if (activeTool === 'elements' && el.hintInput) {
      handleElementsKey({ el, attached, bodyH, listNav, quit, setToast, withEditor, copyFn }, input, key);
      return;
    }
    if (input === '?') {
      openHelp();
      return;
    }
    if (input === ':') {
      openPalette();
      return;
    }
    if (key.tab) {
      setActiveTool(t => {
        const idx = TOOLS.findIndex(x => x.key === t);
        return TOOLS[(idx + (key.shift ? -1 : 1) + TOOLS.length) % TOOLS.length].key;
      });
      return;
    }
    if (input >= '1' && input <= String(TOOLS.length) && !(activeTool === 'elements' && el.animMode)) return setActiveTool(TOOLS[Number(input) - 1].key);
    if (input === ',' && !(activeTool === 'elements' && (elSubview || el.overviewMode || el.animMode))) return setActiveTool('settings');
    if (
      input === 'b' &&
      !key.ctrl &&
      !(activeTool === 'elements' && (el.yPendingRef.current || (attached && el.elMap && !elSubview)))
    ) {
      openTabPicker();
      return;
    }
    if (key.ctrl && input === 'f') {
      if (activeTool === 'network') openNetSearch();
      return;
    }
    if (input === 'f' && !(activeTool === 'elements' && attached && !elSubview)) {
      focusBrowser();
      return;
    }
    if ((input === '[' || input === ']') && !(activeTool === 'elements' && (elSubview || el.overviewMode || el.animMode))) {
      switchBy(input === '[' ? -1 : 1);
      return;
    }
    if (input === '.' && !(activeTool === 'elements' && attached)) {
      openSessionControl();
      return;
    }
    if (input === '!') {
      openNotifications();
      return;
    }
    if (key.ctrl && input === 'x') {
      closeActiveSession();
      return;
    }
    if (key.ctrl && input === 'w') {
      armOrCloseActiveTab();
      return;
    }

    if (activeTool === 'elements') {
      handleElementsKey({ el, attached, bodyH, listNav, quit, setToast, withEditor, copyFn }, input, key);
      return;
    }
    if (input === 'q') return quit();

    if (activeTool === 'storage' && handleStorageKey({ storage, attached, bodyH, listNav, copyFn, setToast, setStorageDetail, setStorageDetailScroll, withEditor }, input, key)) return;

    if (activeTool === 'audit' && handleAuditKey({ audit, attached, bodyH, columns, listNav, copyFn }, input, key)) return;

    if (activeTool === 'sources' && handleSourcesKey({ src, attached, bodyH, listNav, gPending, scripts: srcScripts, paused: srcPaused, scopeLines: srcScopeLines, withEditor }, input, key)) return;

    if (activeTool === 'components' && handleComponentsKey({ comp, attached, bodyH, listNav, setToast, copyFn, whenNotEditing }, input, key)) return;

    if (activeTool === 'settings') {
      handleSettingsKey(
        {
          settings,
          attached,
          allSessions: () => sessions().map(e => e.session),
          ep,
          throttle,
          bodyH,
          listNav,
          setToast,
          setLayout,
          setHintsMode,
          setNetColumns,
          setThrottleState,
          setCacheDisabledState,
        },
        input,
        key,
      );
      return;
    }

    if (
      activeTool === 'network' &&
      handleNetworkKey(
        {
          net,
          attached,
          bodyH,
          columns,
          tlEntries,
          tlNow,
          netEntries,
          markedEntries,
          clampedNetSel,
          selEntry,
          throttle,
          cacheDisabled,
          setThrottleState,
          setCacheDisabledState,
          overrideRulesRef,
          overrideSeq,
          setOverrideRules,
          setOverrideManager,
          blockedPatternsRef,
          setBlockTarget,
          setBlockManager,
          mapRemoteRef,
          mapSeq,
          setMapRemoteRules,
          setMapManager,
          setNetDiff,
          setNetDiffScroll,
          setDetailEntry,
          setDetailTab,
          setDetailScroll,
          setDetailOpen,
          setToast,
          copyFn,
          exportHarFn,
          withEditor,
          followNav,
        },
        input,
        key,
      )
    )
      return;

    if (activeTool === 'console' && handleConsoleKey({ con, conEntries, clampedConSel, bodyH, session: attached?.session, setToast, copyFn, followNav }, input, key)) return;

    if (attached) {
      if (input === 'r') {
        reloadPage();
        return;
      }
      if (input === 'y') {
        copyContextAction();
        return;
      }
      if (input === 'S') {
        takeSnapshot();
        return;
      }
    }
    if (input === 't') return setNewTab({ incognito: false, value: '' });
    if (input === 'I') return setNewTab({ incognito: true, value: '' });
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      quit();
      return;
    }
    if (netPicker || conPicker || conCtxPicker || emu.emuPicker || overrideManager || blockManager || mapManager || rec.recManagerOpen || rec.recDetail) return;
    if (rec.recPrompt) {
      const prompt = rec.recPrompt;
      if (key.escape) {
        if (prompt.kind === 'password') rec.submitPassword(null);
        else rec.setRecPrompt(null);
        return;
      }
      if (key.return) {
        if (prompt.kind === 'name') {
          if (rec.saveNamed(prompt.value, prompt.steps ?? [])) rec.setRecPrompt(null);
        } else if (prompt.kind === 'rename') {
          if (prompt.file) rec.renameRec(prompt.file, prompt.value);
          rec.setRecPrompt(null);
        } else {
          rec.submitPassword(prompt.value);
        }
        return;
      }
      editLine(input, key, fn => rec.setRecPrompt(p => (p ? { ...p, value: fn(p.value) } : p)));
      return;
    }
    if (newTab) {
      if (key.escape) {
        setNewTab(null);
        return;
      }
      if (key.return) {
        const raw = newTab.value.trim();
        const url = raw ? normalizeUrl(raw) : 'about:blank';
        const incognito = newTab.incognito;
        setNewTab(null);
        void openUrl(url, attached?.ep ?? ep, incognito ? { incognito: true } : undefined);
        return;
      }
      editLine(input, key, fn => setNewTab(p => (p ? { ...p, value: fn(p.value) } : p)));
      return;
    }
    if (pickerOpen) {
      if (key.escape) {
        setPickerOpen(false);
        return;
      }
      const items = pickerItems(pickerSections, pickerQuery, attached?.target.id, pickerSessions);
      if (key.return) {
        const it = items[Math.min(pickerSel, Math.max(0, items.length - 1))];
        setPickerOpen(false);
        if (it?.kind === 'session') {
          switchTo(it.session.key);
        } else if (it?.kind === 'tab') {
          const tep = rawSections[it.section]?.endpoint ?? ep;
          void openSession(it.tab, tep);
        } else if (it?.kind === 'new-tab') {
          setNewTab({ incognito: false, value: '' });
        }
        return;
      }
      if (key.ctrl && input === 'x') {
        const it = items[Math.min(pickerSel, Math.max(0, items.length - 1))];
        if (it?.kind === 'session') {
          void closeSession(it.session.key);
          setPickerSel(i => Math.max(0, Math.min(i, items.length - 2)));
        }
        return;
      }
      if (key.ctrl && input === 'w') {
        const it = items[Math.min(pickerSel, Math.max(0, items.length - 1))];
        if (!it || it.kind === 'new-tab') return;
        const token = pickerCloseToken(it);
        if (closeArm !== token) {
          armClose(token);
          return;
        }
        setCloseArm(null);
        if (it.kind === 'session') {
          const entry = sessions().find(e => e.key === it.session.key);
          if (entry) closeSessionTab(entry);
        } else {
          const tep = rawSections[it.section]?.endpoint ?? ep;
          const name = it.tab.title || it.tab.url;
          void closePage(tep, it.tab.id).then(
            () => {
              void tabs.refresh();
              setToast(t('toast.tabClosed', { name }), 'success');
            },
            () => setToast(t('toast.tabCloseFailed'), 'error'),
          );
        }
        setPickerSel(i => Math.max(0, Math.min(i, items.length - 2)));
        return;
      }
      if (key.downArrow || input === 'j') {
        setPickerSel(i => Math.min(i + 1, Math.max(0, items.length - 1)));
        return;
      }
      if (key.upArrow || input === 'k') {
        setPickerSel(i => Math.max(0, i - 1));
        return;
      }
      editLine(input, key, fn => {
        setPickerQuery(fn);
        setPickerSel(0);
      });
      return;
    }
    if (paletteOpen) {
      if (key.escape) {
        setPaletteOpen(false);
        return;
      }
      const items = filterCommands(paletteAvailable, paletteQuery);
      if (key.return) {
        const cmd = items[Math.min(paletteSel, Math.max(0, items.length - 1))];
        setPaletteOpen(false);
        cmd?.run(paletteCtx);
        return;
      }
      if (key.downArrow || input === 'j') {
        setPaletteSel(i => Math.min(i + 1, Math.max(0, items.length - 1)));
        return;
      }
      if (key.upArrow || input === 'k') {
        setPaletteSel(i => Math.max(0, i - 1));
        return;
      }
      editLine(input, key, fn => {
        setPaletteQuery(fn);
        setPaletteSel(0);
      });
      return;
    }
    if (detailMsgFilterEditing) {
      if (key.return || key.escape) {
        setDetailMsgFilterEditing(false);
        return;
      }
      editLine(input, key, fn => {
        setDetailMsgFilter(fn);
        setDetailScroll(0);
      });
      return;
    }
    if (filterEditing) {
      if (key.return || key.escape) {
        setFilterEditing(false);
        return;
      }
      editLine(input, key, setUrlFilter);
      return;
    }
    if (conInputEditing) {
      // Esc keeps the draft (DevTools behavior); it survives until quit.
      if (key.escape) {
        if (replComp.visible) replComp.dismiss();
        else setConInputEditing(false);
        return;
      }
      if (replComp.visible && (key.tab || key.rightArrow)) {
        replComp.accept();
        return;
      }
      if (key.return) {
        if (replComp.visible && replComp.sel !== null) {
          replComp.accept();
          return;
        }
        const expr = conInputDraft.trim();
        if (!expr || !attached) return;
        con.conHistoryPush(expr);
        setConInputDraft('');
        setConFollow(true);
        submitConsoleInput(attached.session, expr, conCtxId);
        return;
      }
      if (key.upArrow || key.downArrow) {
        if (replComp.visible) {
          replComp.move(key.upArrow ? -1 : 1);
        } else {
          // The completion may still be armed; a history-recalled draft must
          // not pop it back up.
          replComp.dismiss();
          if (key.upArrow) con.conHistoryUp();
          else con.conHistoryDown();
        }
        return;
      }
      editLine(input, key, fn => {
        replComp.arm();
        con.conInputType(fn);
      }, { excludeTab: true });
      return;
    }
    if (conFilterEditing) {
      if (key.return || key.escape) {
        setConFilterEditing(false);
        return;
      }
      editLine(input, key, setConTextFilter);
      return;
    }
    if (searchEditing) {
      if (key.return) {
        setSearchEditing(false);
        setSearchQuery(searchDraft.trim());
        setNetSel(0);
        setNetSelId(null);
        setNetFollow(true);
        return;
      }
      if (key.escape) {
        setSearchEditing(false);
        return;
      }
      editLine(input, key, setSearchDraft);
      return;
    }
    if (storageFilterEditing) {
      if (key.return || key.escape) {
        setStorageFilterEditing(false);
        return;
      }
      editLine(input, key, fn => {
        setStorageFilter(fn);
        storage.setStorageSel(0);
      });
      return;
    }
    if (storageEditing) {
      if (key.escape) {
        setStorageEditing(null);
        return;
      }
      if (key.return) {
        const ed = storageEditing;
        const selRow = storageRows[Math.min(storageSel, Math.max(0, storageRows.length - 1))];
        setStorageEditing(null);
        if (attached) {
          void (async () => {
            try {
              if (ed.sw) {
                const session = attached.session;
                if (ed.sw.kind === 'push') await session.swDeliverPush(ed.sw.reg, ed.value);
                else if (ed.sw.kind === 'periodicSync') await session.swDispatchPeriodicSync(ed.sw.reg, ed.value);
                else await session.swDispatchSync(ed.sw.reg, ed.value, ed.sw.lastChance);
                setToast(t('toast.swDispatched'), 'success');
                return;
              }
              if (ed.attrs) {
                if (!selRow) return;
                const parsed = parseCookieAttrs(ed.value);
                if (parsed.error) {
                  setStorageErr(parsed.error);
                  return;
                }
                const merged = { ...selRow.attrs, ...parsed.attrs };
                if (selRow.attrs?.partitionKeyObj && !merged.partitionKeyObj) {
                  await attached.session.deleteCookie({ name: selRow.key, domain: selRow.attrs.domain, path: selRow.attrs.path, partitionKey: selRow.attrs.partitionKeyObj });
                }
                await attached.session.setCookie(selRow.key, selRow.value, merged);
                await reloadView(attached.session, storageView);
                if (parsed.unknown.length) setStorageErr(t('storage.unknownAttrs', { attrs: parsed.unknown.join(', ') }));
                return;
              }
              let key = ed.key;
              let value = ed.value;
              if (ed.isNew) {
                const eq = ed.value.indexOf('=');
                if (eq < 0) {
                  setStorageErr(t('storage.useKeyValue'));
                  return;
                }
                key = ed.value.slice(0, eq);
                value = ed.value.slice(eq + 1);
              }
              if (storageView === 'cookies') {
                const attrs = ed.isNew ? cookieRows.find(r => r.key === key)?.attrs : selRow?.attrs;
                await attached.session.setCookie(key, value, attrs);
              } else await attached.session.setStorageItem(storageView === 'local', key, value);
              await reloadView(attached.session, storageView);
            } catch (e) {
              setStorageErr(e instanceof Error ? e.message : String(e));
            }
          })();
        }
        return;
      }
      editLine(input, key, fn => setStorageEditing(ed => (ed ? { ...ed, value: fn(ed.value) } : ed)));
      return;
    }
    if (activeTool === 'sources' && src.srcFilterEditing) {
      if (key.return || key.escape) {
        src.setSrcFilterEditing(false);
        return;
      }
      editLine(input, key, fn => {
        src.setSrcFilter(fn);
        src.setSrcSel(0);
      });
      return;
    }
    if (activeTool === 'sources' && src.bpEdit) {
      if (key.escape) {
        src.setBpEdit(null);
        return;
      }
      if (key.return) {
        if (attached) src.applyBpEdit(attached.session);
        else src.setBpEdit(null);
        return;
      }
      editLine(input, key, fn => src.setBpEdit(ed => (ed ? { ...ed, text: fn(ed.text) } : ed)), { excludeTab: true });
      return;
    }
    if (activeTool === 'sources' && src.watchInput !== null) {
      if (key.escape) {
        src.setWatchInput(null);
        return;
      }
      if (key.return) {
        const expr = src.watchInput.trim();
        src.setWatchInput(null);
        if (expr) src.addWatch(expr);
        return;
      }
      editLine(input, key, fn => src.setWatchInput(v => (v === null ? v : fn(v))), { excludeTab: true });
      return;
    }
    if (activeTool === 'sources' && src.xhrInput !== null) {
      if (key.escape) {
        src.setXhrInput(null);
        return;
      }
      if (key.return) {
        const url = src.xhrInput.trim();
        src.setXhrInput(null);
        if (url && attached) src.addXhr(attached.session, url);
        return;
      }
      editLine(input, key, fn => src.setXhrInput(v => (v === null ? v : fn(v))), { excludeTab: true });
      return;
    }
    if (activeTool === 'components' && comp.compFilterEditing) {
      if (key.return || key.escape) {
        comp.setCompFilterEditing(false);
        return;
      }
      editLine(input, key, fn => {
        comp.setCompFilter(fn);
        comp.setCompSel(0);
      });
      return;
    }
    if (activeTool === 'elements' && el.classesInput !== null) {
      if (key.escape) {
        el.setClassesInput(null);
        return;
      }
      if (key.return) {
        const name = el.classesInput.trim();
        el.setClassesInput(null);
        if (name && attached && el.domNode) el.addClassEntry(attached.session, el.domNode.nodeId, el.domNode.selector, name);
        return;
      }
      editLine(input, key, fn => el.setClassesInput(v => (v === null ? v : fn(v))), { excludeTab: true });
      return;
    }
    if (activeTool === 'elements' && declEdit) {
      if (key.escape) {
        setDeclEdit(null);
        return;
      }
      if (key.return) {
        applyDecl();
        return;
      }
      if (key.tab) {
        setDeclEdit(ed => {
          if (!ed || ed.text.includes(':')) return ed;
          const base = ed.prefix ?? ed.text;
          const matches = CSS_PROPERTIES.filter(p => p.startsWith(base));
          if (matches.length === 0) return ed;
          const idx = ed.prefix === null ? 0 : (ed.matchIdx + 1) % matches.length;
          return { ...ed, text: matches[idx], prefix: base, matchIdx: idx };
        });
        return;
      }
      editLine(input, key, fn => setDeclEdit(ed => (ed ? { ...ed, text: fn(ed.text), prefix: null, matchIdx: -1 } : ed)));
      return;
    }
    if (activeTool === 'elements' && computedFilterEditing && !helpOpen) {
      if (key.return || key.escape) {
        setComputedFilterEditing(false);
        return;
      }
      editLine(input, key, fn => {
        setComputedFilter(fn);
        setComputedScroll(0);
      }, { excludeTab: true });
      return;
    }
    if (activeTool === 'elements' && attached && elSearching && !helpOpen) {
      if (key.escape) {
        setElSearching(false);
        return;
      }
      if (key.return) {
        setElSearching(false);
        if (elQuery && attached) runElSearch(attached.session, elQuery);
        return;
      }
      editLine(input, key, setElQuery, { excludeTab: true });
      return;
    }
    if (activeTool === 'settings' && !helpOpen) {
      if (settingsEditing) {
        if (key.escape) {
          setSettingsEditing(null);
          setSettingsErr(undefined);
          return;
        }
        if (key.return) {
          handleKey(input, key);
          return;
        }
        editLine(input, key, fn => setSettingsEditing(ed => (ed ? { ...ed, value: fn(ed.value) } : ed)));
        return;
      }
      if (settingsSearching) {
        if (key.return || key.escape) {
          setSettingsSearching(false);
          return;
        }
        editLine(input, key, fn => {
          setSettingsQuery(fn);
          setSettingsSel(0);
        }, { excludeTab: true });
        return;
      }
    }
    dispatchInput(input, key, handleKey);
  });
}
