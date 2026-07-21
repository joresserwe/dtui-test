import type { BlockPattern, DebugSession, MapRemoteRule, OverrideRule, ThrottleName } from '../../engine.js';
import type { ConsoleEntry, NetworkEntry } from '../../store/types.js';
import type { Tool } from '../panels/ToolTabs.js';
import type { StorageRow, StorageView } from '../panels/StorageOverlay.js';
import type { DetailTab } from '../overlays/DetailOverlay.js';
import type { ToastLevel } from './toast-manager.js';
import type { NetworkTool } from '../hooks/use-network-tool.js';
import type { ConsoleTool } from '../hooks/use-console-tool.js';
import type { StorageTool } from '../hooks/use-storage-tool.js';
import type { ElementsTool } from '../hooks/use-elements-tool.js';
import type { EmulationTool } from '../hooks/use-emulation-tool.js';
import type { RecorderTool } from '../hooks/use-recorder-tool.js';
import type { CommandCtx } from './commands.js';
import {
  addMapRemoteForEntry,
  addOverrideForEntry,
  clearNetworkLog,
  editNetworkConditions,
  openDiffForMarked,
  openMapRemoteManager,
  copyEntryBody,
  copyEntryCurl,
  copyEntryFetch,
  copyEntryNodeFetch,
  copyEntryUrl,
  cycleTimeWindow,
  editAndResendEntry,
  openBlockManager,
  openBlockPicker,
  openEntryDetail,
  openOverrideManager,
  openTimelineSelect,
  resendEntry,
} from '../keys/network-keys.js';
import { clearConsoleLog, copyConsoleAll, openConsoleDetail } from '../keys/console-keys.js';
import { applyCacheDisabled, applyThrottle, cycleThrottle, exportSessionHar } from './session-actions.js';
import { t } from './i18n.js';

export interface CommandCtxDeps {
  activeTool: Tool;
  session: DebugSession | undefined;
  hasActive: boolean;
  multiSession: boolean;
  selEntry: NetworkEntry | undefined;
  markedEntries: NetworkEntry[];
  conEntries: ConsoleEntry[];
  clampedConSel: number;
  storageRows: StorageRow[];
  columns: number;
  tlEntries: NetworkEntry[];
  tlNow: number;
  throttle: ThrottleName;
  cacheDisabled: boolean;
  net: NetworkTool;
  con: ConsoleTool;
  storage: StorageTool;
  emu: EmulationTool;
  el: ElementsTool;
  rec: RecorderTool;
  setActiveTool: (tool: Tool) => void;
  setNewTab: (v: { incognito: boolean; value: string } | null) => void;
  switchBy: (dir: -1 | 1) => void;
  setToast: (msg: string, level?: ToastLevel) => void;
  copyFn: (text: string) => Promise<void>;
  exportHarFn: (session: DebugSession) => Promise<string>;
  withEditor: (initial: string, ext?: string) => Promise<string | null>;
  overrideRulesRef: { current: OverrideRule[] };
  blockedPatternsRef: { current: BlockPattern[] };
  overrideSeq: { current: number };
  setOverrideRules: (rules: OverrideRule[]) => void;
  setOverrideManager: (v: boolean) => void;
  setBlockManager: (v: boolean) => void;
  setBlockTarget: (entry: NetworkEntry | null) => void;
  mapRemoteRef: { current: MapRemoteRule[] };
  mapSeq: { current: number };
  setMapRemoteRules: (rules: MapRemoteRule[]) => void;
  setMapManager: (v: boolean) => void;
  setNetDiff: (v: { a: NetworkEntry; b: NetworkEntry } | null) => void;
  setNetDiffScroll: (n: number) => void;
  setThrottleState: (t: ThrottleName) => void;
  setCacheDisabledState: (v: boolean) => void;
  setDetailEntry: (entry: NetworkEntry | null) => void;
  setDetailTab: (tab: DetailTab) => void;
  setDetailScroll: (scroll: number) => void;
  setDetailOpen: (open: boolean) => void;
  setStorageDetail: (v: { row: StorageRow; view: StorageView } | null) => void;
  setStorageDetailScroll: (scroll: number) => void;
  openTabPicker: () => void;
  closeActiveSession: () => void;
  closeActiveTab: () => void;
  focusBrowser: () => void;
  reloadPage: () => void;
  takeSnapshot: () => void;
  copyContext: () => void;
  openSessionControl: () => void;
  openNotifications: () => void;
  openHelp: () => void;
  openNetSearch: () => void;
}

export function buildCommandCtx(d: CommandCtxDeps): CommandCtx {
  const { net, con, storage, emu, el, rec, session } = d;
  return {
    tool: d.activeTool,
    attached: !!session,
    hasActive: d.hasActive,
    multiSession: d.multiSession,
    hasSelEntry: !!d.selEntry,
    hasMarkedPair: d.markedEntries.length === 2,
    hasSelConEntry: d.conEntries.length > 0,
    hasStorageRow: d.storageRows.length > 0,
    hasElSel: el.elSelId !== null,
    recording: rec.recording,
    hasRecordings: rec.hasRecordings,
    openTabPicker: d.openTabPicker,
    openNewTab: incognito => d.setNewTab({ incognito, value: '' }),
    switchSession: dir => d.switchBy(dir),
    closeActiveSession: d.closeActiveSession,
    closeActiveTab: d.closeActiveTab,
    focusBrowser: d.focusBrowser,
    reloadPage: d.reloadPage,
    takeSnapshot: d.takeSnapshot,
    copyContext: d.copyContext,
    openSessionControl: d.openSessionControl,
    openNotifications: d.openNotifications,
    openHelp: d.openHelp,
    setTool: d.setActiveTool,
    netFilter: () => net.setFilterEditing(true),
    netSearch: d.openNetSearch,
    netTypePicker: () => net.setNetPicker('type'),
    netSortPicker: () => net.setNetPicker('sort'),
    netColumnPicker: () => net.setNetPicker('columns'),
    netTimeline: () => openTimelineSelect(net, d.tlEntries, d.tlNow, Math.max(1, d.columns - 2)),
    netWindow: () => cycleTimeWindow(net),
    netClear: () => clearNetworkLog(net, session, d.setToast),
    netThrottle: () => {
      if (session) applyThrottle(session, cycleThrottle(d.throttle), d.setThrottleState, d.setToast);
    },
    netCache: () => {
      if (session) applyCacheDisabled(session, !d.cacheDisabled, d.setCacheDisabledState, d.setToast);
    },
    netHar: () => {
      if (session) exportSessionHar(session, d.exportHarFn, d.copyFn, d.setToast);
    },
    netOverrideManager: () => openOverrideManager(d.overrideRulesRef, d.setOverrideManager, d.setToast),
    netBlockManager: () => openBlockManager(d.blockedPatternsRef, d.setBlockManager, d.setToast),
    netConditions: () => {
      if (session) editNetworkConditions(session, d.withEditor, d.setThrottleState, d.setToast);
    },
    netDiffPair: () => openDiffForMarked(d.markedEntries, d.setNetDiff, d.setNetDiffScroll, d.setToast),
    netAddMapRemote: () => {
      if (session && d.selEntry) addMapRemoteForEntry(session, d.selEntry, d.withEditor, d.mapRemoteRef, d.mapSeq, d.setMapRemoteRules, d.setToast);
    },
    netMapManager: () => openMapRemoteManager(d.mapRemoteRef, d.setMapManager, d.setToast),
    netCopyCurl: () => {
      if (d.selEntry) copyEntryCurl(d.selEntry, d.copyFn, d.setToast);
    },
    netCopyFetch: () => {
      if (d.selEntry) copyEntryFetch(d.selEntry, d.copyFn, d.setToast);
    },
    netCopyNodeFetch: () => {
      if (d.selEntry) copyEntryNodeFetch(d.selEntry, d.copyFn, d.setToast);
    },
    netCopyUrl: () => {
      if (d.selEntry) copyEntryUrl(d.selEntry, d.copyFn, d.setToast);
    },
    netCopyBody: () => {
      if (d.selEntry) copyEntryBody(d.selEntry, d.copyFn, d.setToast);
    },
    netGroup: () => {
      net.setNetGroup(m => (m === 'domain' ? 'none' : 'domain'));
      net.setCollapsedGroups(new Set());
      net.setNetSelId(null);
    },
    netResend: () => {
      if (session && d.selEntry) resendEntry(session, d.selEntry, d.setToast);
    },
    netEditResend: () => {
      if (session && d.selEntry) editAndResendEntry(session, d.selEntry, d.withEditor, d.setToast);
    },
    netAddOverride: () => {
      if (session && d.selEntry) addOverrideForEntry(session, d.selEntry, d.withEditor, d.overrideRulesRef, d.overrideSeq, d.setOverrideRules, d.setToast);
    },
    netBlock: () => {
      if (d.selEntry) openBlockPicker(net, d.selEntry, d.setBlockTarget);
    },
    netDetail: () => {
      if (d.selEntry) openEntryDetail(d.selEntry, { setDetailEntry: d.setDetailEntry, setDetailTab: d.setDetailTab, setDetailScroll: d.setDetailScroll, setDetailOpen: d.setDetailOpen });
    },
    netPeek: () => net.setPeek(p => !p),
    conFilter: () => con.setConFilterEditing(true),
    conInput: () => con.setConInputEditing(true),
    conLevelPicker: () => con.setConPicker(true),
    conClear: () => clearConsoleLog(con, session, d.setToast),
    conCopyAll: () => copyConsoleAll(d.conEntries, d.copyFn, d.setToast),
    conDetail: () => {
      if (d.conEntries.length > 0) openConsoleDetail(con, d.conEntries[d.clampedConSel]);
    },
    storageFilter: () => storage.setStorageFilterEditing(true),
    storageDetail: () => {
      const row = d.storageRows[Math.min(storage.storageSel, Math.max(0, d.storageRows.length - 1))];
      if (row) {
        d.setStorageDetail({ row, view: storage.storageView });
        d.setStorageDetailScroll(0);
      }
    },
    storageCopy: () => {
      const row = d.storageRows[Math.min(storage.storageSel, Math.max(0, d.storageRows.length - 1))];
      if (row)
        void d.copyFn(row.value).then(
          () => d.setToast(t('toast.copied'), 'success'),
          () => d.setToast(t('toast.copyFailed'), 'error'),
        );
    },
    elDuplicate: () => {
      if (session && el.elSelId !== null) el.duplicateNode(session, el.elSelId);
    },
    elCssOverview: () => {
      if (session) el.openCssOverview(session);
    },
    elAnimations: () => {
      if (session) el.openAnimations();
    },
    emuDevice: () => emu.setEmuPicker('device'),
    emuCpu: () => emu.setEmuPicker('cpu'),
    emuColor: () => emu.setEmuPicker('color'),
    emuVision: () => emu.setEmuPicker('vision'),
    emuGeo: () => emu.setEmuPicker('geo'),
    emuContrast: () => emu.setEmuPicker('contrast'),
    emuTimezone: () => emu.setEmuPicker('timezone'),
    emuReducedMotion: () => emu.toggleReducedMotion(session, d.setToast),
    emuForcedColors: () => emu.toggleForcedColors(session, d.setToast),
    emuTouch: () => emu.toggleTouch(session, d.setToast),
    emuPaint: () => emu.togglePaint(session, d.setToast),
    emuPrint: () => emu.togglePrint(session, d.setToast),
    emuUserAgent: () => emu.setEmuPicker('userAgent'),
    emuLocale: () => emu.setEmuPicker('locale'),
    emuIdle: () => emu.setEmuPicker('idle'),
    emuOrientation: () => emu.setEmuPicker('orientation'),
    emuAutoDark: () => emu.toggleAutoDark(session, d.setToast),
    emuRotate: () => emu.rotateDevice(session, d.setToast),
    emuWebauthn: () => emu.toggleWebAuthn(session, d.setToast),
    recStart: () => {
      if (session) rec.start(session);
    },
    recStop: () => {
      if (session) rec.stop(session);
    },
    recReplay: () => rec.openManager(),
    recManager: () => rec.openManager(),
  };
}
