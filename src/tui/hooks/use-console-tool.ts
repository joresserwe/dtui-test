import { useCallback, useRef, useState } from 'react';
import type { ConsoleEntry, ConsoleKind } from '../../store/types.js';
import type { ConsoleChildren } from '../overlays/ConsoleDetailOverlay.js';
import { CONSOLE_HISTORY_CAP, loadConfig, saveConfig } from '../../config.js';

export function useConsoleTool() {
  const [conSel, setConSel] = useState(0);
  const [conFollow, setConFollow] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [conLevelFilters, setConLevelFilters] = useState<ConsoleKind[]>([]);
  const [conTextFilter, setConTextFilter] = useState('');
  const [conFilterEditing, setConFilterEditing] = useState(false);
  const [conPicker, setConPicker] = useState(false);
  const [conCtxPicker, setConCtxPicker] = useState(false);
  const [conCtxId, setConCtxId] = useState<number | undefined>(undefined);
  const [conDetailEntry, setConDetailEntry] = useState<ConsoleEntry | null>(null);
  const [conDetailScroll, setConDetailScroll] = useState(0);
  const [conDetailWrap, setConDetailWrap] = useState(true);
  const [conDetailCursor, setConDetailCursor] = useState(0);
  const [conDetailExpanded, setConDetailExpanded] = useState<Set<string>>(new Set());
  const [conDetailChildren, setConDetailChildren] = useState<Map<string, ConsoleChildren>>(new Map());
  const [conInputEditing, setConInputEditing] = useState(false);
  const [conInputDraft, setConInputDraft] = useState('');
  const [conTimestamps, setConTimestamps] = useState(false);
  const [conHistory, setConHistory] = useState<string[]>(() => loadConfig().consoleHistory ?? []);
  // -1 = live draft; 0.. indexes conHistory (most recent first). The draft is
  // stashed when cycling starts so ↓ past the newest entry restores it.
  const conHistIdx = useRef(-1);
  const conHistStash = useRef('');

  const conInputType = useCallback((fn: (s: string) => string) => {
    conHistIdx.current = -1;
    setConInputDraft(fn);
  }, []);

  const conHistoryUp = () => {
    if (!conHistory.length) return;
    if (conHistIdx.current === -1) conHistStash.current = conInputDraft;
    conHistIdx.current = Math.min(conHistIdx.current + 1, conHistory.length - 1);
    setConInputDraft(conHistory[conHistIdx.current]);
  };

  const conHistoryDown = () => {
    if (conHistIdx.current === -1) return;
    conHistIdx.current -= 1;
    setConInputDraft(conHistIdx.current === -1 ? conHistStash.current : conHistory[conHistIdx.current]);
  };

  const conHistoryPush = (expr: string) => {
    conHistIdx.current = -1;
    conHistStash.current = '';
    if (conHistory[0] === expr) return;
    const next = [expr, ...conHistory].slice(0, CONSOLE_HISTORY_CAP);
    setConHistory(next);
    saveConfig({ consoleHistory: next });
  };

  const applyLevelFilter = useCallback((values: string[]) => {
    setConPicker(false);
    setConLevelFilters(values.includes('all') ? [] : (values as ConsoleKind[]));
    setConSel(0);
    setConFollow(true);
  }, []);

  const resetConDetail = useCallback(() => {
    setConDetailScroll(0);
    setConDetailCursor(0);
    setConDetailExpanded(new Set());
    setConDetailChildren(new Map());
  }, []);

  return {
    conSel,
    setConSel,
    conFollow,
    setConFollow,
    expanded,
    setExpanded,
    conLevelFilters,
    setConLevelFilters,
    conTextFilter,
    setConTextFilter,
    conFilterEditing,
    setConFilterEditing,
    conPicker,
    setConPicker,
    conCtxPicker,
    setConCtxPicker,
    conCtxId,
    setConCtxId,
    conDetailEntry,
    setConDetailEntry,
    conDetailScroll,
    setConDetailScroll,
    conDetailWrap,
    setConDetailWrap,
    conDetailCursor,
    setConDetailCursor,
    conDetailExpanded,
    setConDetailExpanded,
    conDetailChildren,
    setConDetailChildren,
    conInputEditing,
    setConInputEditing,
    conInputDraft,
    setConInputDraft,
    conTimestamps,
    setConTimestamps,
    conInputType,
    conHistory,
    conHistoryUp,
    conHistoryDown,
    conHistoryPush,
    resetConDetail,
    applyLevelFilter,
  };
}

export type ConsoleTool = ReturnType<typeof useConsoleTool>;
