import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Endpoint } from '../cdp/discovery.js';
import type { PageTarget } from '../cdp/targets.js';
import { DebugSession, type BlockPattern, type MapRemoteRule, type OverrideRule, type ThrottleName } from '../engine.js';
import type { BrowserSession } from '../cdp/browser.js';
import { epKey, type MultiTabs } from './lib/multi-tabs.js';
import type { ConsoleEntry, NetworkEntry } from '../store/types.js';
import { useEmitterTick } from './hooks/use-emitter.js';
import { useTerminalSize } from './hooks/use-terminal-size.js';
import { pickerItems, type PickerSection, type PickerSessionRow } from './overlays/TabPicker.js';
import { SessionTabs, type StripSession } from './panels/SessionTabs.js';
import { ToolTabs, type Tool } from './panels/ToolTabs.js';
import { filterEntries, sortNetEntries, type NetSortDir, type NetSortKey } from './panels/NetworkPanel.js';
import { networkSummary } from './lib/net-summary.js';
import { buildNetGroups, groupSelectable } from './lib/net-group.js';
import { applyNetCopy, applyNetCopyAll } from './keys/network-keys.js';
import { searchEntries } from './lib/search.js';
import { filterConsoleEntries, ReplCompletionPopup, replPopupSize } from './panels/ConsolePanel.js';
import { useReplCompletion } from './hooks/use-repl-completion.js';
import { CONSOLE_DETAIL_CHROME, consoleDetailLines } from './overlays/ConsoleDetailOverlay.js';
import { DETAIL_CHROME, detailTabRich, type DetailTab } from './overlays/DetailOverlay.js';
import { DIFF_CHROME } from './overlays/DiffOverlay.js';
import { netDiffLines } from './lib/net-diff.js';
import { formatMapRemoteRuleText, parseMapRemoteText } from './lib/map-remote-text.js';
import { intersectsRange } from './lib/timeline.js';
import { StatusBar } from './panels/StatusBar.js';
import { filterStorageRows, storageViewRows, type StorageRow, type StorageView } from './panels/StorageOverlay.js';
import { STORAGE_DETAIL_CHROME, storageDetailLines } from './overlays/StorageDetailOverlay.js';
import { loadConfig } from '../config.js';
import { realEditorRunner, type EditorRunner } from './lib/editor.js';
import { formatOverrideRuleText, parseOverrideText } from './lib/override-text.js';
import { useEditorSuspend } from './hooks/use-editor-suspend.js';
import { useToasts } from './hooks/use-toasts.js';
import { displayToast } from './lib/toast-manager.js';
import { displayWidth, truncate } from './lib/format.js';
import { theme } from './lib/theme.js';
import { Dimmed } from './lib/dim.js';
import { fitHintRows, hintsFor } from './lib/hints.js';
import { t, useLang } from './lib/i18n.js';
import { WINDOWS } from './lib/windows.js';
import { captureSnapshot, snapshotRoot } from '../persist/snapshot.js';
import { exportHar as writeHarExport, harRoot } from '../persist/har.js';
import { openFolder as openFolderDefault } from '../util/open-folder.js';
import { ModalHost, domainBlockPattern } from './overlays/ModalHost.js';
import { PanelArea } from './panels/PanelArea.js';
import { Rule } from './panels/Rule.js';
import { availableCommands } from './lib/commands.js';
import { buildCommandCtx } from './lib/command-ctx.js';
import { buildSnapshotDeps } from './lib/session-context.js';
import { useSessionManager } from './hooks/use-session-manager.js';
import { useViewSnapshots } from './hooks/use-view-snapshots.js';
import { useCloseArm } from './hooks/use-close-arm.js';
import { useAppInput, pickerCloseToken } from './hooks/use-app-input.js';
import { useAppActions } from './hooks/use-app-actions.js';
import { useStorageTool } from './hooks/use-storage-tool.js';
import { useSettingsTool } from './hooks/use-settings-tool.js';
import { useNetworkTool } from './hooks/use-network-tool.js';
import { useConsoleTool } from './hooks/use-console-tool.js';
import { useEagerEval } from './hooks/use-eager-eval.js';
import { contextItems, contextTag, nonDefaultContextLabels } from './lib/exec-context.js';
import { useElementsTool } from './hooks/use-elements-tool.js';
import { useEmulationTool, emulationStatus, emuInitial } from './hooks/use-emulation-tool.js';
import { useAuditTool, type AuditRunnerFn } from './hooks/use-audit-tool.js';
import { useSourcesTool } from './hooks/use-sources-tool.js';
import { useComponentsTool } from './hooks/use-components-tool.js';
import { useRecorderTool } from './hooks/use-recorder-tool.js';
import { filterScripts, scopeTreeLines, shortLoc, type SourcesViewData } from './panels/SourcesPanel.js';
import type { DebugPersistState, PausedView } from '../store/debugger.js';
import { buildHostDelegate, type LiveBridge } from '../mcp/delegate.js';
import { buildSelectorPath } from './lib/selector-path.js';

export type { ViewSnapshot } from './hooks/use-view-snapshots.js';

export interface AppProps {
  ep: Endpoint;
  tabs: MultiTabs;
  browsers?: Map<string, BrowserSession | null>;
  initialUrl?: string;
  attach?: (t: PageTarget, ep: Endpoint) => Promise<DebugSession>;
  clipboard?: (text: string) => Promise<void>;
  snapshot?: (session: DebugSession) => Promise<string>;
  exportHar?: (session: DebugSession, entries?: NetworkEntry[]) => Promise<string>;
  openFolder?: (dir: string) => Promise<void>;
  editRunner?: EditorRunner;
  reconnectBaseMs?: number;
  liveBridge?: LiveBridge;
  auditRun?: AuditRunnerFn;
}

export function App({ ep, tabs, browsers, initialUrl, attach, clipboard, snapshot, exportHar, openFolder, editRunner, reconnectBaseMs = 1000, liveBridge, auditRun }: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  useLang();
  const toasts = useToasts();
  const { toast, setToast, clearToast } = toasts;
  const editFn = useMemo(() => editRunner ?? realEditorRunner(), [editRunner]);
  const { editingRef, toastStaleRef, whenNotEditing, withEditor } = useEditorSuspend(editFn, clearToast);
  toasts.bindSuspend({ editingRef, toastStaleRef });
  const attachFn = useMemo(
    () =>
      attach ??
      ((t: PageTarget, tep: Endpoint) => {
        const cfg = loadConfig();
        return DebugSession.attach(t, { browser: tep.browser, bodyCapBytes: cfg.bodyCapBytes, persistSanitize: cfg.persistSanitize });
      }),
    [attach],
  );
  const browserFor = useCallback(
    (e: Endpoint): BrowserSession | null => browsers?.get(epKey(e)) ?? null,
    [browsers],
  );
  const copyFn =
    clipboard ??
    (async (text: string) => {
      const { default: clip } = await import('clipboardy');
      await clip.write(text);
    });
  const snapshotFn =
    snapshot ?? ((session: DebugSession) => captureSnapshot(snapshotRoot(), buildSnapshotDeps(session, ep.browser)));
  const exportHarFn =
    exportHar ??
    ((session: DebugSession, entries?: NetworkEntry[]) =>
      writeHarExport(harRoot(), session.url, entries ?? session.network.entries(), {
        browser: ep.browser,
        bodyCap: session.bodyCap,
        sanitize: session.harSanitize,
      }));
  const openFolderFn = openFolder ?? openFolderDefault;

  const [activeTool, setActiveTool] = useState<Tool>('network');
  const [layout, setLayout] = useState<'tabs' | 'split'>(loadConfig().layout ?? 'tabs');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpScroll, setHelpScroll] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<NetworkEntry | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('summary');
  const [detailScroll, setDetailScroll] = useState(0);
  const [detailWrap, setDetailWrap] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerSel, setPickerSel] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteSel, setPaletteSel] = useState(0);
  const [newTab, setNewTab] = useState<{ incognito: boolean; value: string } | null>(null);
  const { closeArm, setCloseArm, armClose } = useCloseArm(whenNotEditing);
  const net = useNetworkTool();
  const {
    netSel,
    setNetSel,
    netSelId,
    setNetSelId,
    netFollow,
    setNetFollow,
    netSort,
    setNetSort,
    netColumns,
    netPicker,
    setNetPicker,
    netGroup,
    collapsedGroups,
    tlSelect,
    tlCursor,
    tlAnchor,
    tlRange,
    typeFilters,
    urlFilter,
    filterEditing,
    searchQuery,
    searchDraft,
    searchEditing,
    win,
    peek,
    applyTypeFilter,
    applyColumns,
  } = net;
  const con = useConsoleTool();
  const {
    conSel,
    conFollow,
    expanded,
    conLevelFilters,
    conTextFilter,
    conFilterEditing,
    conPicker,
    setConPicker,
    conCtxPicker,
    setConCtxPicker,
    conCtxId,
    setConCtxId,
    conDetailEntry,
    conDetailScroll,
    setConDetailScroll,
    conDetailWrap,
    conDetailCursor,
    conDetailExpanded,
    conDetailChildren,
    conInputEditing,
    conInputDraft,
    conTimestamps,
    applyLevelFilter,
  } = con;
  const storage = useStorageTool({ whenNotEditing });
  const {
    storageView,
    storageFilter,
    storageFilterEditing,
    storageEditing,
    bgSub,
    loadStorage,
    reloadView,
  } = storage;
  const [storageDetail, setStorageDetail] = useState<{ row: StorageRow; view: StorageView } | null>(null);
  const [storageDetailScroll, setStorageDetailScroll] = useState(0);
  const overrideSeq = useRef(0);
  const [overrideManager, setOverrideManager] = useState(false);
  const blockSeq = useRef(0);
  const [blockManager, setBlockManager] = useState(false);
  const mapSeq = useRef(0);
  const [mapManager, setMapManager] = useState(false);
  const [netDiff, setNetDiff] = useState<{ a: NetworkEntry; b: NetworkEntry } | null>(null);
  const [netDiffScroll, setNetDiffScroll] = useState(0);
  const [detailMsgFilter, setDetailMsgFilter] = useState('');
  const [detailMsgFilterEditing, setDetailMsgFilterEditing] = useState(false);
  const [sessionControlOpen, setSessionControlOpen] = useState(false);
  const [sessionControlSel, setSessionControlSel] = useState(0);
  const [blockTarget, setBlockTarget] = useState<NetworkEntry | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifSel, setNotifSel] = useState(0);

  const frameH = Math.max(14, rows - 1);
  const [hintsMode, setHintsMode] = useState<'2' | '1' | 'off'>(loadConfig().hints ?? '2');
  const hintRowCount = hintsMode === '2' ? 2 : hintsMode === '1' ? 1 : 0;
  const bodyH = Math.max(8, frameH - 5 - hintRowCount);
  const detailH = Math.max(1, bodyH - DETAIL_CHROME);

  const { handleViewSwitch, handleSessionEnd } = useViewSnapshots({
    activeTool,
    setActiveTool,
    net,
    con,
    storage,
    setDetailOpen,
    setDetailEntry,
    setDetailScroll,
    setSessionControlOpen,
    setNotifOpen,
    setPaletteOpen,
    setStorageDetail,
    setStorageDetailScroll,
  });

  const { attached, attachedRef, active, sessions, reconnecting, openSession, openUrl, switchTo, switchBy, closeSession, patchEntry, quit } = useSessionManager({
    ep,
    tabs,
    browsers,
    initialUrl,
    attachFn,
    browserFor,
    reconnectBaseMs,
    setToast,
    whenNotEditing,
    onViewSwitch: handleViewSwitch,
    onSessionEnd: handleSessionEnd,
    exit,
  });

  const activeEntryRef = useRef(active);
  activeEntryRef.current = active;
  const throttle: ThrottleName = active?.throttle ?? 'off';
  const cacheDisabled = active?.cacheDisabled ?? false;
  const overrideRules = active?.overrides ?? [];
  const blockedPatterns = active?.blocked ?? [];
  const mapRemoteRules = active?.mapRemote ?? [];
  const overrideRulesRef = useMemo(() => ({ get current(): OverrideRule[] { return activeEntryRef.current?.overrides ?? []; } }), []);
  const blockedPatternsRef = useMemo(() => ({ get current(): BlockPattern[] { return activeEntryRef.current?.blocked ?? []; } }), []);
  const mapRemoteRef = useMemo(() => ({ get current(): MapRemoteRule[] { return activeEntryRef.current?.mapRemote ?? []; } }), []);
  const setThrottleState = (v: ThrottleName) => {
    if (active) patchEntry(active.key, { throttle: v, customConditions: active.session.customConditions });
  };
  const setCacheDisabledState = (v: boolean) => {
    if (active) patchEntry(active.key, { cacheDisabled: v });
  };
  const setOverrideRules = (rules: OverrideRule[]) => {
    if (active) patchEntry(active.key, { overrides: rules });
  };
  const setMapRemoteRules = (rules: MapRemoteRule[]) => {
    if (active) patchEntry(active.key, { mapRemote: rules });
  };

  const replComp = useReplCompletion({
    session: attached?.session,
    editing: conInputEditing,
    draft: conInputDraft,
    history: con.conHistory,
    contextId: conCtxId,
    whenNotEditing,
    onAccept: next => con.conInputType(() => next),
  });
  const conEager = useEagerEval({ session: attached?.session, editing: conInputEditing, draft: conInputDraft, contextId: conCtxId, whenNotEditing });

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const persistDebug = useCallback((session: DebugSession, state: DebugPersistState) => {
    const entry = sessionsRef.current().find(e => e.session === session);
    if (entry) patchEntry(entry.key, { debug: state });
  }, [patchEntry]);

  const el = useElementsTool({ attached, activeTool, editingRef, notify: setToast, persistDebug });
  const { elSearching, elSubview, declEdit, computedMode, computedFilterEditing } = el;
  const { listenersMode: elListenersMode, hintInput: elHintInput, inspecting: elInspecting } = el;

  const elRef = useRef(el);
  elRef.current = el;

  const [pendingConsoleReveal, setPendingConsoleReveal] = useState<string | null>(null);
  const [revealTargetNode, setRevealTargetNode] = useState<number | null>(null);
  const revealNodeFromConsole = useCallback((objectId: string) => {
    con.setConDetailEntry(null);
    con.resetConDetail();
    setActiveTool('elements');
    setPendingConsoleReveal(objectId);
  }, [con, setActiveTool]);
  useEffect(() => {
    if (pendingConsoleReveal === null || activeTool !== 'elements' || !attached || !el.elMap) return;
    const session = attached.session;
    const objectId = pendingConsoleReveal;
    setPendingConsoleReveal(null);
    void session.requestNode(objectId).then(
      nodeId => {
        if (nodeId !== null) setRevealTargetNode(nodeId);
        else setToast(t('components.toast.revealFailed'), 'error');
      },
      () => setToast(t('components.toast.revealFailed'), 'error'),
    );
  }, [pendingConsoleReveal, activeTool, attached, el.elMap, setToast]);
  useEffect(() => {
    const map = el.elMap;
    if (revealTargetNode === null || !map || !map.has(revealTargetNode)) return;
    el.setElExpanded(prev => {
      const next = new Set(prev);
      let p = map.get(revealTargetNode)?.parentId;
      while (p !== undefined) {
        next.add(p);
        p = map.get(p)?.parentId;
      }
      return next;
    });
    el.setElSelId(revealTargetNode);
    setRevealTargetNode(null);
  }, [revealTargetNode, el.elMap, el.setElExpanded, el.setElSelId]);

  const audit = useAuditTool({ attached, activeTool, notify: setToast, whenNotEditing, runFn: auditRun });
  const auditRef = useRef(audit);
  auditRef.current = audit;

  const comp = useComponentsTool({ attached, activeTool, notify: setToast, whenNotEditing, revealObject: revealNodeFromConsole });

  const rec = useRecorderTool({ attached, notify: setToast, whenNotEditing });

  const src = useSourcesTool({ attached, activeTool, notify: setToast, whenNotEditing, persistDebug });

  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  useEffect(() => {
    const session = attached?.session;
    if (!session) return;
    const store = session.debug;
    const onPaused = (p: PausedView) => {
      if (activeToolRef.current === 'sources') return;
      const top = p.frames[0];
      whenNotEditing(() =>
        setToast(t('sources.toast.paused', { loc: top ? shortLoc(top.url, top.scriptId, top.line) : p.reason })),
      );
    };
    store.on('paused', onPaused);
    return () => {
      store.off('paused', onPaused);
    };
  }, [attached?.session, setToast]);

  useEffect(() => {
    if (!liveBridge) return;
    liveBridge.setDelegate(buildHostDelegate({
      sessions: () =>
        sessions()
          .filter(e => e.status !== 'closing')
          .map(e => ({ session: e.session, title: e.target.title || e.target.url, fallbackId: e.key, openedAt: e.openedAt })),
      activeSession: () => attachedRef.current?.session ?? null,
      selection: () => {
        const cur = elRef.current;
        const nodeId = cur.elSubview && cur.domNode ? cur.domNode.nodeId : cur.elSelId;
        if (nodeId === null) return null;
        const selector = cur.elMap?.has(nodeId)
          ? buildSelectorPath(cur.elMap, nodeId)
          : cur.domNode?.nodeId === nodeId
            ? cur.domNode.selector
            : String(nodeId);
        return { nodeId, selector };
      },
      latestLhr: session => auditRef.current.latestLhrFor(session),
      runAudit: (session, opts) => {
        const entry = sessions().find(e => e.session === session);
        if (!entry) return Promise.reject(new Error('unknown session'));
        return auditRef.current.runForMcp(session, entry.ep, opts);
      },
    }));
    return () => liveBridge.setDelegate(null);
  }, [liveBridge, sessions, attachedRef]);

  const emu = useEmulationTool();

  const settings = useSettingsTool({ activeTool, ep, throttle });
  const { settingsSearching, settingsEditing } = settings;

  useEffect(() => {
    if (activeTool !== 'storage' || !attached) return;
    storage.setStorageSel(0);
    storage.setConfirmClear(false);
    void loadStorage(attached.session);
  }, [activeTool, attached?.session, loadStorage]);

  useEffect(() => {
    if (activeTool !== 'storage' || !attached) return;
    const session = attached.session;
    if (storageView !== 'cookies' && storageView !== 'local' && storageView !== 'session') {
      void reloadView(session, storageView);
    }
    return () => {
      if (storageView === 'shared') void session.disableSharedStorageTracking();
      else if (storageView === 'background') {
        void session.disablePreloadTracking();
        void session.disableReporting();
      }
    };
  }, [activeTool, attached?.session, storageView, bgSub, reloadView]);

  useEffect(() => {
    if (activeTool !== 'storage' || !attached) return;
    const session = attached.session;
    let timer: NodeJS.Timeout | undefined;
    const debounced = (view: StorageView) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reloadView(session, view), 150);
      timer.unref?.();
    };
    const onStorage = ({ local }: { local: boolean }) => debounced(local ? 'local' : 'session');
    const onNav = () => debounced('cookies');
    const onSw = () => debounced('sw');
    const onBg = () => debounced('background');
    const onShared = () => debounced('shared');
    session.on('dom-storage', onStorage);
    session.on('frame-navigated', onNav);
    session.on('sw-updated', onSw);
    session.on('bg-services-updated', onBg);
    session.on('preload-updated', onBg);
    session.on('reporting-updated', onBg);
    session.on('shared-storage-updated', onShared);
    return () => {
      if (timer) clearTimeout(timer);
      session.off('dom-storage', onStorage);
      session.off('frame-navigated', onNav);
      session.off('sw-updated', onSw);
      session.off('bg-services-updated', onBg);
      session.off('preload-updated', onBg);
      session.off('reporting-updated', onBg);
      session.off('shared-storage-updated', onShared);
    };
  }, [activeTool, attached?.session, reloadView]);

  const commitOverrides = useCallback((next: OverrideRule[]) => {
    const entry = activeEntryRef.current;
    if (!entry) return;
    patchEntry(entry.key, { overrides: next });
    void entry.session.setOverrides(next.filter(r => r.enabled)).catch(() => setToast(t('toast.overrideFailed'), 'error'));
  }, [patchEntry, setToast]);

  const commitBlocked = useCallback((next: BlockPattern[]) => {
    const entry = activeEntryRef.current;
    if (!entry) return;
    patchEntry(entry.key, { blocked: next });
    void entry.session.setBlocked(next.filter(p => p.enabled).map(p => p.pattern)).catch(() => setToast(t('toast.blockFailed'), 'error'));
  }, [patchEntry, setToast]);

  const commitMapRemote = useCallback((next: MapRemoteRule[]) => {
    const entry = activeEntryRef.current;
    if (!entry) return;
    patchEntry(entry.key, { mapRemote: next });
    void entry.session.setMapRemote(next.filter(r => r.enabled)).catch(() => setToast(t('toast.mapRemoteFailed'), 'error'));
  }, [patchEntry, setToast]);

  useEffect(() => {
    const onAdded = ({ tabs: added }: { endpoint: Endpoint; tabs: PageTarget[] }) => {
      if (editingRef.current || !added.length || !attachedRef.current) return;
      const first = added[0];
      const label = truncate(first.title || first.url, 40);
      setToast(added.length > 1 ? t('toast.newTabs', { n: added.length }) : t('toast.newTabNamed', { name: label }));
    };
    tabs.on('added', onAdded);
    return () => {
      tabs.off('added', onAdded);
    };
  }, [tabs, setToast]);

  useEmitterTick(tabs, ['update'], editingRef);
  useEmitterTick(attached?.session.network, ['update'], editingRef);
  useEmitterTick(attached?.session.console, ['entry', 'update'], editingRef);
  useEmitterTick(attached?.session.debug, ['update'], editingRef);
  useEmitterTick(attached?.session, ['page-timing', 'contexts-changed'], editingRef);

  const conCtxIdRef = useRef(conCtxId);
  conCtxIdRef.current = conCtxId;

  useEffect(() => {
    const session = attached?.session;
    if (!session) return;
    // Cached detail children hold objectIds that died with their execution
    // context; dropping them forces a refetch on the next expand.
    const onCleared = () =>
      whenNotEditing(() => {
        con.setConDetailChildren(new Map());
        con.setConDetailExpanded(new Set());
        setConCtxId(undefined);
      });
    const onDestroyed = (id: number) =>
      whenNotEditing(() => {
        if (conCtxIdRef.current !== id) return;
        setConCtxId(undefined);
        setToast(t('toast.ctxFellBack'));
      });
    session.on('contexts-cleared', onCleared);
    session.on('context-destroyed', onDestroyed);
    return () => {
      session.off('contexts-cleared', onCleared);
      session.off('context-destroyed', onDestroyed);
    };
  }, [attached?.session]);

  const rawNet = attached ? attached.session.network.entries() : [];
  const maxTs = rawNet.reduce((m, e) => Math.max(m, e.startTs), 0);
  const sinceTs = WINDOWS[win].ms ? maxTs - WINDOWS[win].ms : undefined;
  const tlNow = Date.now();
  const tlEntries = attached ? searchEntries(filterEntries(rawNet, typeFilters, urlFilter, sinceTs), searchQuery) : [];
  const netEntries = sortNetEntries(tlRange ? tlEntries.filter(e => intersectsRange(e, tlRange, tlNow)) : tlEntries, netSort.key, netSort.dir);
  const netGroupRows = netGroup === 'domain' ? buildNetGroups(netEntries, 'domain', collapsedGroups) : null;
  const displayEntries = netGroupRows ? groupSelectable(netGroupRows) : netEntries;
  const netSummary = networkSummary(netEntries);
  const markedEntries = net.marked.size
    ? [...net.marked].map(id => rawNet.find(e => e.id === id)).filter((e): e is NetworkEntry => e !== undefined)
    : [];
  const pinnedIdx = netSelId === null ? -1 : displayEntries.findIndex(e => e.id === netSelId);
  const clampedNetSel = netFollow && !tlRange && netSort.key === 'arrival'
    ? Math.max(0, displayEntries.length - 1)
    : pinnedIdx >= 0
      ? pinnedIdx
      : Math.min(netSel, Math.max(0, displayEntries.length - 1));
  const rawCon: ConsoleEntry[] = attached ? attached.session.console.entries() : [];
  const conEntries: ConsoleEntry[] = useMemo(
    () => filterConsoleEntries(rawCon, conLevelFilters, conTextFilter),
    [rawCon, conLevelFilters, conTextFilter],
  );
  const conSelIdx = conEntries.findIndex(e => e.id === conSel);
  const clampedConSel = conFollow ? Math.max(0, conEntries.length - 1) : Math.max(0, conSelIdx);
  const execContexts = attached ? attached.session.executionContexts() : [];
  const conCtxLabels = nonDefaultContextLabels(execContexts);
  const selectedCtx = conCtxId !== undefined ? execContexts.find(c => c.id === conCtxId) : undefined;
  const conCtxLabel = selectedCtx ? contextTag(selectedCtx) : undefined;
  const conDetailTree = attached ? { expanded: conDetailExpanded, children: conDetailChildren } : undefined;
  const conDetailLinesRich = useMemo(
    () => (conDetailEntry ? consoleDetailLines(conDetailEntry, columns, conDetailWrap, conDetailTree) : []),
    [conDetailEntry, conDetailEntry?.count, conDetailEntry?.ts, columns, conDetailWrap, conDetailExpanded, conDetailChildren, attached],
  );
  const conDetailBudget = Math.max(1, bodyH - CONSOLE_DETAIL_CHROME);
  const conDetailMaxScroll = Math.max(0, conDetailLinesRich.length - conDetailBudget);
  const conDetailCursorClamped = Math.min(conDetailCursor, Math.max(0, conDetailLinesRich.length - 1));
  useEffect(() => {
    if (conDetailEntry) setConDetailScroll(s => Math.min(s, conDetailMaxScroll));
  }, [conDetailEntry, conDetailMaxScroll]);
  const storageRows = filterStorageRows(storageViewRows(storage), storageFilter);
  const storageDepth =
    storageView === 'idb' ? (storage.idbStore ? 2 : storage.idbDb ? 1 : 0)
    : storageView === 'cache' ? (storage.cacheOpen ? 1 : 0)
    : 0;
  const storageDetailLinesRich = useMemo(
    () => (storageDetail ? storageDetailLines(storageDetail.row, storageDetail.view, columns) : []),
    [storageDetail, columns],
  );
  const storageDetailBudget = Math.max(1, bodyH - STORAGE_DETAIL_CHROME);
  const storageDetailMaxScroll = Math.max(0, storageDetailLinesRich.length - storageDetailBudget);
  useEffect(() => {
    if (storageDetail) setStorageDetailScroll(s => Math.min(s, storageDetailMaxScroll));
  }, [storageDetail, storageDetailMaxScroll]);
  const dbgStore = attached?.session.debug;
  const srcPaused = dbgStore?.paused ?? null;
  const srcScriptsAll = dbgStore ? dbgStore.scripts() : [];
  const srcScripts = filterScripts(srcScriptsAll, src.srcFilter);
  const srcFrame = srcPaused ? srcPaused.frames[Math.min(src.frameSel, Math.max(0, srcPaused.frames.length - 1))] : undefined;
  const srcScopeLines = useMemo(
    () => (srcFrame ? scopeTreeLines(srcFrame.scopes, { expanded: src.scopeExpanded, children: src.scopeChildren }) : []),
    [srcFrame, src.scopeExpanded, src.scopeChildren],
  );
  const srcData: SourcesViewData = {
    scripts: srcScripts,
    totalScripts: srcScriptsAll.length,
    breakpoints: dbgStore ? dbgStore.breakpoints() : [],
    pauseState: dbgStore?.pauseOnExceptions ?? 'none',
    paused: srcPaused,
    scopeLines: srcScopeLines,
    blackboxed: dbgStore ? dbgStore.blackboxedUrls() : [],
    xhrBreakpoints: dbgStore ? dbgStore.xhrBreakpoints() : [],
    eventBreakpoints: dbgStore ? dbgStore.eventBreakpoints() : [],
  };
  const domBpNodes = new Set((dbgStore ? dbgStore.domBreakpoints() : []).map(d => d.nodeId));
  const selEntry: NetworkEntry | undefined = displayEntries[clampedNetSel];
  const detailRich = useMemo(
    () => (detailOpen && detailEntry ? detailTabRich(detailEntry, detailTab, columns, detailWrap, detailMsgFilter) : []),
    [detailOpen, detailEntry, detailEntry?.status, detailEntry?.body, detailEntry?.bodyTruncated, detailEntry?.wsFrames?.length, detailEntry?.wsFramesDropped, detailTab, columns, detailWrap, detailMsgFilter],
  );
  const detailMaxScroll = Math.max(0, detailRich.length - detailH);
  useEffect(() => {
    if (detailOpen) setDetailScroll(s => Math.min(s, detailMaxScroll));
  }, [detailOpen, detailMaxScroll]);
  useEffect(() => {
    setDetailMsgFilter('');
    setDetailMsgFilterEditing(false);
  }, [detailEntry?.id]);
  const netDiffLinesRich = useMemo(() => (netDiff ? netDiffLines(netDiff.a, netDiff.b, columns) : []), [netDiff, columns]);
  const netDiffBudget = Math.max(1, bodyH - DIFF_CHROME);
  const netDiffMaxScroll = Math.max(0, netDiffLinesRich.length - netDiffBudget);
  const helpH = Math.min(bodyH, 30);

  const liveSessions = sessions().filter(e => e.status !== 'closing');
  const stripSessions: StripSession[] = liveSessions.map(e => ({
    key: e.key,
    title: e.target.title || e.target.url,
    count: e.session.network.size,
    status: e.status === 'reconnecting' ? 'reconnecting' : 'live',
  }));
  const pickerSessions: PickerSessionRow[] = liveSessions.map(e => ({
    key: e.key,
    targetId: e.target.id,
    title: e.target.title || e.target.url,
    url: e.target.url,
    count: e.session.network.size,
    status: e.status === 'reconnecting' ? 'reconnecting' : 'live',
    viewed: e.key === active?.key,
  }));

  const rawSections = tabs.sections();
  const nameCount = new Map<string, number>();
  for (const s of rawSections) nameCount.set(s.endpoint.browser, (nameCount.get(s.endpoint.browser) ?? 0) + 1);
  const pickerSections: PickerSection[] = rawSections.map(s => ({
    browser: (nameCount.get(s.endpoint.browser) ?? 1) > 1 ? `${s.endpoint.browser} :${s.endpoint.port}` : s.endpoint.browser,
    groups: s.groups,
  }));

  const {
    closeSessionTab,
    openHelp,
    openTabPicker,
    openPalette,
    openNotifications,
    openSessionControl,
    focusBrowser,
    closeActiveSession,
    armOrCloseActiveTab,
    reloadPage,
    copyContextAction,
    takeSnapshot,
    openNetSearch,
  } = useAppActions({
    tabs,
    attached,
    active,
    closeSession,
    closeArm,
    setCloseArm,
    armClose,
    setToast,
    copyFn,
    snapshotFn,
    selEntry,
    net,
    setHelpOpen,
    setHelpScroll,
    setPickerOpen,
    setPickerQuery,
    setPickerSel,
    setPaletteOpen,
    setPaletteQuery,
    setPaletteSel,
    setNotifOpen,
    setNotifSel,
    setSessionControlOpen,
    setSessionControlSel,
  });

  const paletteCtx = buildCommandCtx({
    activeTool,
    session: attached?.session,
    hasActive: !!active,
    multiSession: liveSessions.length > 1,
    selEntry,
    markedEntries,
    conEntries,
    clampedConSel,
    storageRows,
    columns,
    tlEntries,
    tlNow,
    throttle,
    cacheDisabled,
    net,
    con,
    storage,
    emu,
    el,
    rec,
    setActiveTool,
    setNewTab,
    switchBy,
    setToast,
    copyFn,
    exportHarFn,
    withEditor,
    overrideRulesRef,
    blockedPatternsRef,
    overrideSeq,
    setOverrideRules,
    setOverrideManager,
    setBlockManager,
    setBlockTarget,
    mapRemoteRef,
    mapSeq,
    setMapRemoteRules,
    setMapManager,
    setNetDiff,
    setNetDiffScroll,
    setThrottleState,
    setCacheDisabledState,
    setDetailEntry,
    setDetailTab,
    setDetailScroll,
    setDetailOpen,
    setStorageDetail,
    setStorageDetailScroll,
    openTabPicker,
    closeActiveSession,
    closeActiveTab: armOrCloseActiveTab,
    focusBrowser,
    reloadPage,
    takeSnapshot,
    copyContext: copyContextAction,
    openSessionControl,
    openNotifications,
    openHelp,
    openNetSearch,
  });
  const paletteAvailable = availableCommands(paletteCtx);

  const applySort = (value: string, dir?: NetSortDir) => {
    setNetPicker(null);
    if (value === 'arrival') {
      setNetSort({ key: 'arrival', dir: 'asc' });
      setNetFollow(true);
      return;
    }
    const key = value as NetSortKey;
    setNetSort(s => ({ key, dir: dir ?? (s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc') }));
    setNetSelId(selEntry?.id ?? null);
    setNetSel(clampedNetSel);
    setNetFollow(false);
  };

  const toggleOverride = (id: string) => {
    commitOverrides(overrideRulesRef.current.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const deleteOverride = (id: string) => {
    const next = overrideRulesRef.current.filter(r => r.id !== id);
    commitOverrides(next);
    if (!next.length) setOverrideManager(false);
  };

  const editOverride = (id: string) => {
    const rule = overrideRulesRef.current.find(r => r.id === id);
    if (!rule) return;
    void (async () => {
      const initial = formatOverrideRuleText(rule);
      const edited = await withEditor(initial, 'txt');
      if (edited === null) return;
      // Trailing whitespace is insignificant: parseOverrideText strips it from the body.
      if (edited.replace(/\s+$/, '') === initial.replace(/\s+$/, '')) return;
      const draft = parseOverrideText(edited);
      if (!draft) {
        setToast(t('toast.ruleParseFailed'), 'error');
        return;
      }
      commitOverrides(overrideRulesRef.current.map(r => (r.id === id ? { ...r, ...draft } : r)));
      setToast(t('toast.overrideUpdated'), 'success');
    })();
  };

  const applyBlock = (choice: string) => {
    setNetPicker(null);
    const target = blockTarget;
    setBlockTarget(null);
    if (!target) return;
    const pattern = choice === 'domain' ? domainBlockPattern(target.url) : target.url;
    if (!pattern) return;
    const entry = activeEntryRef.current;
    if (!entry) return;
    const next = [...entry.blocked, { id: `bl-${blockSeq.current++}`, pattern, enabled: true }];
    patchEntry(entry.key, { blocked: next });
    void entry.session.setBlocked(next.filter(p => p.enabled).map(p => p.pattern)).then(
      () => setToast(t('toast.blockAdded'), 'success'),
      () => setToast(t('toast.blockFailed'), 'error'),
    );
  };

  const applyCopy = (choice: string) => {
    setNetPicker(null);
    if (choice.startsWith('all-')) {
      const session = attached?.session;
      if (!session) return;
      const targets = markedEntries.length ? markedEntries : netEntries;
      applyNetCopyAll(choice, targets, { browser: ep.browser, bodyCap: session.bodyCap, sanitize: session.harSanitize }, copyFn, setToast);
      return;
    }
    if (selEntry) applyNetCopy(choice, selEntry, copyFn, setToast);
  };

  const toggleBlock = (id: string) => {
    commitBlocked(blockedPatternsRef.current.map(p => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
  };

  const deleteBlock = (id: string) => {
    const next = blockedPatternsRef.current.filter(p => p.id !== id);
    commitBlocked(next);
    if (!next.length) setBlockManager(false);
  };

  const toggleMapRule = (id: string) => {
    commitMapRemote(mapRemoteRef.current.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const deleteMapRule = (id: string) => {
    const next = mapRemoteRef.current.filter(r => r.id !== id);
    commitMapRemote(next);
    if (!next.length) setMapManager(false);
  };

  const editMapRule = (id: string) => {
    const rule = mapRemoteRef.current.find(r => r.id === id);
    if (!rule) return;
    void (async () => {
      const initial = formatMapRemoteRuleText(rule);
      const edited = await withEditor(initial, 'txt');
      if (edited === null || edited === initial) return;
      const draft = parseMapRemoteText(edited);
      if (!draft) {
        setToast(t('toast.ruleParseFailed'), 'error');
        return;
      }
      commitMapRemote(mapRemoteRef.current.map(r => (r.id === id ? { ...r, ...draft } : r)));
      setToast(t('toast.mapRemoteUpdated'), 'success');
    })();
  };

  useAppInput({
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
    netEntries: displayEntries,
    markedEntries,
    clampedNetSel,
    selEntry,
    tlEntries,
    tlNow,
    conEntries,
    clampedConSel,
    storageRows,
    replComp,
  });

  const toastHistory = notifOpen ? toasts.history() : [];

  const pickerConfirmClose = (() => {
    if (!pickerOpen || closeArm === null) return false;
    const items = pickerItems(pickerSections, pickerQuery, attached?.target.id, pickerSessions);
    const it = items[Math.min(pickerSel, Math.max(0, items.length - 1))];
    return !!it && pickerCloseToken(it) === closeArm;
  })();

  const applyEmuPick = (value: string) => {
    const session = attached?.session;
    if (emu.emuPicker === 'device') {
      if (value === 'custom') emu.applyCustomDevice(session, withEditor, setToast);
      else emu.applyDevice(session, value, setToast);
    }
    else if (emu.emuPicker === 'cpu') emu.applyCpu(session, value, setToast);
    else if (emu.emuPicker === 'color') emu.applyColor(session, value, setToast);
    else if (emu.emuPicker === 'vision') emu.applyVision(session, value, setToast);
    else if (emu.emuPicker === 'geo') emu.applyGeo(session, value, setToast);
    else if (emu.emuPicker === 'contrast') emu.applyContrast(session, value, setToast);
    else if (emu.emuPicker === 'timezone') emu.applyTimezone(session, value, setToast);
    else if (emu.emuPicker === 'userAgent') emu.applyUserAgent(session, value, setToast);
    else if (emu.emuPicker === 'locale') emu.applyLocale(session, value, setToast);
    else if (emu.emuPicker === 'idle') emu.applyIdle(session, value, setToast);
    else if (emu.emuPicker === 'orientation') {
      if (value === 'custom') emu.applyCustomOrientation(session, withEditor, setToast);
      else emu.applyOrientation(session, value, setToast);
    }
  };

  const modalOpen =
    !!newTab || pickerOpen || paletteOpen || !!netPicker || conPicker || conCtxPicker || !!emu.emuPicker || blockManager || overrideManager || mapManager ||
    rec.recManagerOpen || !!rec.recDetail || !!rec.recPrompt ||
    (sessionControlOpen && !!active) || notifOpen || helpOpen;
  const modal = modalOpen ? (
    <ModalHost
      bodyH={bodyH}
      columns={columns}
      newTab={newTab}
      picker={{
        open: pickerOpen,
        sections: pickerSections,
        query: pickerQuery,
        selected: pickerSel,
        attachedId: attached?.target.id,
        sessions: pickerSessions,
        confirmClose: pickerConfirmClose,
      }}
      palette={{ open: paletteOpen, commands: paletteAvailable, query: paletteQuery, selected: paletteSel }}
      netPicker={{
        kind: netPicker,
        typeFilters,
        sortKey: netSort.key,
        netColumns,
        blockTarget,
        copyTarget: selEntry ?? null,
        copyAllCount: markedEntries.length || netEntries.length,
        copyAllMarked: markedEntries.length > 0,
        onApplyType: applyTypeFilter,
        onApplySort: applySort,
        onApplyBlock: applyBlock,
        onApplyColumns: applyColumns,
        onApplyCopy: applyCopy,
        onCancel: () => setNetPicker(null),
        onCancelBlock: () => {
          setNetPicker(null);
          setBlockTarget(null);
        },
      }}
      conPicker={{ open: conPicker, levelFilters: conLevelFilters, onApply: applyLevelFilter, onCancel: () => setConPicker(false) }}
      conCtxPicker={{
        open: conCtxPicker,
        items: contextItems(execContexts),
        initial: [String(conCtxId ?? execContexts.find(c => c.isDefault)?.id ?? '')],
        onPick: value => {
          const ctx = execContexts.find(c => c.id === Number(value));
          setConCtxPicker(false);
          if (!ctx || ctx.isDefault) {
            setConCtxId(undefined);
            setToast(t('toast.ctxDefault'));
          } else {
            setConCtxId(ctx.id);
            setToast(t('toast.ctxSwitched', { name: contextTag(ctx) }));
          }
        },
        onCancel: () => setConCtxPicker(false),
      }}
      emuPicker={{
        kind: emu.emuPicker,
        initial: emu.emuPicker ? emuInitial(attached?.session, emu.emuPicker) : [],
        onPick: applyEmuPick,
        onCancel: () => emu.setEmuPicker(null),
      }}
      managers={{
        blockOpen: blockManager,
        overrideOpen: overrideManager,
        mapOpen: mapManager,
        blockedPatterns,
        overrideRules,
        mapRemoteRules,
        onToggleBlock: toggleBlock,
        onDeleteBlock: deleteBlock,
        onCloseBlock: () => setBlockManager(false),
        onEditOverride: editOverride,
        onToggleOverride: toggleOverride,
        onDeleteOverride: deleteOverride,
        onCloseOverride: () => setOverrideManager(false),
        onEditMap: editMapRule,
        onToggleMap: toggleMapRule,
        onDeleteMap: deleteMapRule,
        onCloseMap: () => setMapManager(false),
      }}
      recorder={{
        managerOpen: rec.recManagerOpen,
        detail: rec.recDetail,
        recordings: rec.recordings,
        prompt: rec.recPrompt,
        onReplay: file => {
          if (attached) rec.replay(attached.session, file);
        },
        onOpenDetail: file => rec.openDetail(file),
        onDetailReplay: () => {
          if (attached && rec.recDetail) rec.replay(attached.session, rec.recDetail.file);
        },
        onCloseDetail: () => rec.setRecDetail(null),
        onRename: file => rec.setRecPrompt({ kind: 'rename', value: '', file }),
        onDelete: file => rec.deleteRec(file),
        onCloseManager: () => rec.setRecManagerOpen(false),
      }}
      sessionControl={{
        open: sessionControlOpen,
        hasActive: !!active,
        title: active ? active.target.title || active.target.url : '',
        throttle,
        cacheDisabled,
        selected: sessionControlSel,
      }}
      notifications={{ open: notifOpen, entries: toastHistory, selected: notifSel }}
      help={{ open: helpOpen, tool: activeTool, scroll: helpScroll, height: helpH }}
    />
  ) : null;

  const panel = (
    <PanelArea
      bodyH={bodyH}
      columns={columns}
      layout={layout}
      activeTool={activeTool}
      attached={!!attached}
      netView={{
        entries: displayEntries,
        groups: netGroupRows ?? undefined,
        selected: clampedNetSel,
        columns: netColumns,
        sortKey: netSort.key,
        sortDir: netSort.dir,
        tlEntries,
        tlSelect,
        tlCursor,
        tlAnchor,
        tlRange,
        tlNow,
        peek,
        selEntry,
        marked: net.marked,
        summary: netSummary,
        total: rawNet.length,
        pageTiming: attached?.session.pageTiming ?? {},
      }}
      conView={{ entries: conEntries, selected: clampedConSel, expanded, input: conInputEditing ? conInputDraft : undefined, eager: conInputEditing ? conEager : undefined, showTimestamps: conTimestamps, ctxLabels: conCtxLabels, ctxLabel: conCtxLabel }}
      detail={{ open: detailOpen, entry: detailEntry, tab: detailTab, scroll: detailScroll, lines: detailRich, highlight: searchQuery || undefined }}
      netDiff={{ data: netDiff, scroll: netDiffScroll, lines: netDiffLinesRich }}
      conDetail={{ entry: conDetailEntry, scroll: conDetailScroll, lines: conDetailLinesRich, wrap: conDetailWrap, cursor: conDetailTree ? conDetailCursorClamped : undefined }}
      storageDetail={{ data: storageDetail, scroll: storageDetailScroll, lines: storageDetailLinesRich }}
      el={el}
      domBpNodes={domBpNodes}
      storage={storage}
      settings={settings}
      audit={audit}
      src={src}
      srcData={srcData}
      comp={comp}
    />
  );

  const replPopupOpen =
    conInputEditing &&
    replComp.visible &&
    !modal &&
    !detailOpen &&
    !conDetailEntry &&
    (activeTool === 'console' || (layout === 'split' && bodyH - 1 >= 14));
  const replPopup = (() => {
    if (!replPopupOpen) return null;
    const { rows, width } = replPopupSize(replComp.items);
    // The REPL prompt is the row above the bottom rule, so the popup bottom
    // sits directly on top of it; left tracks the token being completed
    // (2 = '❯ ' prompt width).
    const top = Math.max(0, bodyH - 2 - rows);
    const left = Math.max(0, Math.min(2 + displayWidth(conInputDraft.slice(0, replComp.tokenStart)), columns - width));
    return (
      <Box position="absolute" top={top} left={left}>
        <ReplCompletionPopup items={replComp.items} selected={replComp.sel} />
      </Box>
    );
  })();

  const content = (
    <Box height={bodyH} width={columns}>
      {modal ? <Dimmed>{panel}</Dimmed> : panel}
      {replPopup}
      {modal ? (
        <Box position="absolute" top={0} left={0} width={columns} height={bodyH} justifyContent="center" alignItems="center">
          {modal}
        </Box>
      ) : null}
    </Box>
  );

  const activeOverrides = overrideRules.filter(r => r.enabled).length;
  const activeBlocked = blockedPatterns.filter(p => p.enabled).length;
  const activeMapRules = mapRemoteRules.filter(r => r.enabled).length;

  const countText =
    activeTool === 'network' && attached
      ? `${netEntries.length !== rawNet.length ? `${netEntries.length}/` : ''}${t('status.count', { n: rawNet.length })}${WINDOWS[win].label !== 'all' ? ` · window:${WINDOWS[win].label}` : ''}${typeFilters.length ? ` · [${typeFilters.join(',')}]` : ''}${netGroup === 'domain' ? ' · group:domain' : ''}${markedEntries.length ? ` · ◆${markedEntries.length}` : ''}`
      : activeTool === 'console' && attached
        ? `${conEntries.length !== rawCon.length ? `${conEntries.length}/` : ''}${t('status.count', { n: rawCon.length })}${conLevelFilters.length ? ` · [${conLevelFilters.join(',')}]` : ''}`
        : undefined;

  const footerHintRows = fitHintRows(
    hintsFor({
      activeTool,
      attached: !!attached,
      pickerOpen,
      paletteOpen,
      newTabPrompt: !!newTab,
      netPicker,
      emuPicker: emu.emuPicker,
      netGroup: netGroup === 'domain',
      overrideManager,
      blockManager,
      mapManager,
      netDiffOpen: !!netDiff,
      sessionControl: sessionControlOpen,
      helpOpen,
      notifOpen,
      detailOpen,
      detailTab,
      detailHasBody: !!detailEntry?.postData,
      detailMsgFilterEditing,
      conPicker,
      conCtxPicker,
      conFilterEditing,
      conInputEditing,
      replPopupOpen,
      conDetailOpen: !!conDetailEntry,
      conDetailExpandable: !!conDetailEntry && !!conDetailLinesRich[conDetailCursorClamped]?.node,
      filterEditing,
      searchEditing,
      tlSelect,
      tlAnchor: tlAnchor !== null,
      tlRange: !!tlRange,
      declEdit: !!declEdit,
      elSubview,
      elSearching,
      elComputedMode: computedMode,
      elComputedFilterEditing: computedFilterEditing,
      elListenersMode,
      elClassesMode: el.classesMode,
      elClassesInput: el.classesInput !== null,
      elHintMode: elHintInput !== null,
      elInspecting,
      storageEditing: !!storageEditing,
      storageFilterEditing,
      storageDetailOpen: !!storageDetail,
      storageView,
      storageDepth,
      auditRunning: !!attached && audit.auditRunning?.session === attached.session,
      auditHasResult: !!audit.auditResult,
      auditDetailOpen: !!audit.auditDetail,
      compFilterEditing: comp.compFilterEditing,
      compHasTree: !!comp.compTree,
      compInspectOpen: !!comp.compInspect,
      srcFilterEditing: src.srcFilterEditing,
      srcViewer: !!src.viewScript,
      srcPausedView: !!srcPaused && !src.pausedDismissed,
      srcPausedFocus: src.pausedFocus,
      srcPaused: !!srcPaused,
      srcBpEdit: src.bpEdit?.kind ?? null,
      srcWatchInput: src.watchInput !== null,
      srcHasWatches: src.watches.length > 0,
      srcXhrMode: src.xhrMode,
      srcXhrInput: src.xhrInput !== null,
      srcEventMode: src.eventMode,
      settingsEditing: !!settingsEditing,
      settingsSearching,
    }),
    Math.max(1, columns - 2),
    hintRowCount,
  );

  return (
    <Box flexDirection="column" width={columns} height={frameH}>
      {stripSessions.length ? (
        <SessionTabs sessions={stripSessions} activeKey={active?.key ?? null} width={columns} />
      ) : (
        <>
          <Box paddingX={1} width={columns}>
            <Text wrap="truncate">
              {tabs.error ? (
                <Text color="red">{tabs.error}</Text>
              ) : (
                <>
                  <Text color={theme.muted}>{ep.browser.split('/')[0] || 'browser'}</Text>
                  <Text color={theme.faint}>{' · '}</Text>
                  <Text color={theme.muted}>{'○'}</Text>
                  <Text color={theme.muted}>{` ${t('app.noTabHeader')}`}</Text>
                </>
              )}
            </Text>
          </Box>
          <Rule columns={columns} />
        </>
      )}
      <ToolTabs active={activeTool} width={columns} />
      {content}
      {hintRowCount === 0
        ? null
        : footerHintRows.slice(0, hintRowCount).map((row, r) => (
            <Box key={`hints-${r}`} paddingX={1} width={columns}>
              <Text wrap="truncate">
                {row.length === 0 ? ' ' : null}
                {row.map((h, i) => (
                  <Text key={`${h.key}-${i}`}>
                    {i > 0 ? <Text color={theme.faint}> · </Text> : null}
                    <Text color={theme.key}>{h.key}</Text>
                    <Text color={theme.muted}> {h.label}</Text>
                  </Text>
                ))}
              </Text>
            </Box>
          ))}
      <StatusBar
        browser={(attached?.ep ?? ep).browser}
        throttle={throttle}
        nocache={cacheDisabled}
        override={activeOverrides ? `override:${activeOverrides}` : undefined}
        blocked={activeBlocked ? `block:${activeBlocked}` : undefined}
        mapped={activeMapRules ? `map:${activeMapRules}` : undefined}
        emulation={emulationStatus(attached?.session)}
        sort={netSort.key !== 'arrival' ? `sort:${netSort.key}${netSort.dir === 'desc' ? '↓' : '↑'}` : undefined}
        range={tlRange?.label}
        recording={attached?.session.sessionDir}
        recCount={rec.recording ? rec.recSteps : undefined}
        dropped={(attached?.session.network.dropped ?? 0) + (attached?.session.console.dropped ?? 0)}
        count={countText}
        filter={
          detailOpen && detailTab === 'messages' && (detailMsgFilter || detailMsgFilterEditing) ? detailMsgFilter
          : activeTool === 'network' && urlFilter ? urlFilter
          : activeTool === 'console' && conTextFilter ? conTextFilter
          : activeTool === 'storage' && storageFilter ? storageFilter
          : activeTool === 'sources' && src.srcFilter ? src.srcFilter
          : activeTool === 'components' && comp.compFilter ? comp.compFilter
          : undefined
        }
        filterEditing={detailMsgFilterEditing || (activeTool === 'network' && filterEditing) || (activeTool === 'console' && conFilterEditing) || (activeTool === 'storage' && storageFilterEditing) || (activeTool === 'sources' && src.srcFilterEditing) || (activeTool === 'components' && comp.compFilterEditing)}
        search={
          activeTool === 'network'
            ? searchEditing
              ? searchDraft
              : searchQuery
                ? `${searchQuery} (${netEntries.length})`
                : undefined
            : undefined
        }
        searchEditing={activeTool === 'network' && searchEditing}
        toast={reconnecting ? t('status.reconnecting', { n: reconnecting }) : toast ? displayToast(toast) : undefined}
        toastLevel={reconnecting ? undefined : toast?.level}
        width={columns}
      />
    </Box>
  );
}
