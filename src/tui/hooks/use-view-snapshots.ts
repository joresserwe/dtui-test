import { useCallback, useRef } from 'react';
import type { Tool } from '../panels/ToolTabs.js';
import type { NetSortDir, NetSortKey, TypeFilter } from '../panels/NetworkPanel.js';
import type { StorageRow, StorageView } from '../panels/StorageOverlay.js';
import type { ConsoleKind, NetworkEntry } from '../../store/types.js';
import type { TimeRange } from '../lib/timeline.js';
import type { NetworkTool } from './use-network-tool.js';
import type { ConsoleTool } from './use-console-tool.js';
import type { StorageTool } from './use-storage-tool.js';
import type { SessionKey } from './use-session-manager.js';

// Captured when switching away from a session, restored when switching back;
// a session without a snapshot (fresh, or reopened after close) gets defaults.
export interface ViewSnapshot {
  activeTool: Tool;
  netSel: number;
  netSelId: string | null;
  netFollow: boolean;
  netSort: { key: NetSortKey; dir: NetSortDir };
  typeFilters: TypeFilter[];
  urlFilter: string;
  searchQuery: string;
  win: number;
  tlRange: (TimeRange & { label: string }) | null;
  peek: boolean;
  conSel: number;
  conFollow: boolean;
  expanded: Set<number>;
  conLevelFilters: ConsoleKind[];
  conTextFilter: string;
  storageView: StorageView;
  storageFilter: string;
}

export interface ViewSnapshotDeps {
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;
  net: NetworkTool;
  con: ConsoleTool;
  storage: StorageTool;
  setDetailOpen: (v: boolean) => void;
  setDetailEntry: (entry: NetworkEntry | null) => void;
  setDetailScroll: (scroll: number) => void;
  setSessionControlOpen: (v: boolean) => void;
  setNotifOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setStorageDetail: (v: { row: StorageRow; view: StorageView } | null) => void;
  setStorageDetailScroll: (scroll: number) => void;
}

export function useViewSnapshots(deps: ViewSnapshotDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const { activeTool, net, con, storage } = deps;
  const renderView: ViewSnapshot = {
    activeTool,
    netSel: net.netSel,
    netSelId: net.netSelId,
    netFollow: net.netFollow,
    netSort: net.netSort,
    typeFilters: net.typeFilters,
    urlFilter: net.urlFilter,
    searchQuery: net.searchQuery,
    win: net.win,
    tlRange: net.tlRange,
    peek: net.peek,
    conSel: con.conSel,
    conFollow: con.conFollow,
    expanded: con.expanded,
    conLevelFilters: con.conLevelFilters,
    conTextFilter: con.conTextFilter,
    storageView: storage.storageView,
    storageFilter: storage.storageFilter,
  };
  const viewRef = useRef(renderView);
  viewRef.current = renderView;
  const viewSnapshots = useRef(new Map<SessionKey, ViewSnapshot>());

  const clearTransientView = useCallback(() => {
    const d = depsRef.current;
    d.net.setTlSelect(false);
    d.net.setTlAnchor(null);
    d.net.setTlCursor(0);
    d.setDetailOpen(false);
    d.setDetailEntry(null);
    d.setDetailScroll(0);
    d.setSessionControlOpen(false);
    d.setNotifOpen(false);
    d.setPaletteOpen(false);
    d.con.setConDetailEntry(null);
    d.con.resetConDetail();
    d.con.setConPicker(false);
    d.con.setConFilterEditing(false);
    d.con.setConInputEditing(false);
    d.setStorageDetail(null);
    d.setStorageDetailScroll(0);
    d.storage.setStorageFilterEditing(false);
    d.storage.setStorageEditing(null);
    d.storage.resetNichePaths();
  }, []);

  const resetViewState = useCallback(() => {
    const d = depsRef.current;
    d.net.setNetSel(0);
    d.net.setNetSelId(null);
    d.net.setNetFollow(true);
    d.net.setNetSort({ key: 'arrival', dir: 'asc' });
    d.net.setTypeFilters([]);
    d.net.setUrlFilter('');
    d.net.setSearchQuery('');
    d.net.setSearchDraft('');
    d.net.setWin(0);
    d.net.setTlRange(null);
    d.net.setPeek(true);
    d.con.setConSel(0);
    d.con.setConFollow(true);
    d.con.setExpanded(new Set());
    d.con.setConLevelFilters([]);
    d.con.setConTextFilter('');
    d.storage.setStorageView('cookies');
    d.storage.setStorageFilter('');
    clearTransientView();
  }, [clearTransientView]);

  const restoreViewState = useCallback((s: ViewSnapshot) => {
    const d = depsRef.current;
    d.setActiveTool(s.activeTool);
    d.net.setNetSel(s.netSel);
    d.net.setNetSelId(s.netSelId);
    d.net.setNetFollow(s.netFollow);
    d.net.setNetSort(s.netSort);
    d.net.setTypeFilters(s.typeFilters);
    d.net.setUrlFilter(s.urlFilter);
    d.net.setSearchQuery(s.searchQuery);
    d.net.setSearchDraft(s.searchQuery);
    d.net.setWin(s.win);
    d.net.setTlRange(s.tlRange);
    d.net.setPeek(s.peek);
    d.con.setConSel(s.conSel);
    d.con.setConFollow(s.conFollow);
    d.con.setExpanded(s.expanded);
    d.con.setConLevelFilters(s.conLevelFilters);
    d.con.setConTextFilter(s.conTextFilter);
    d.storage.setStorageView(s.storageView);
    d.storage.setStorageFilter(s.storageFilter);
    clearTransientView();
  }, [clearTransientView]);

  const handleViewSwitch = useCallback((from: SessionKey | null, to: SessionKey | null) => {
    if (from !== null) viewSnapshots.current.set(from, viewRef.current);
    const snap = to !== null ? viewSnapshots.current.get(to) : undefined;
    if (snap) restoreViewState(snap);
    else resetViewState();
  }, [restoreViewState, resetViewState]);

  const handleSessionEnd = useCallback((key: SessionKey) => {
    viewSnapshots.current.delete(key);
  }, []);

  return { handleViewSwitch, handleSessionEnd };
}
