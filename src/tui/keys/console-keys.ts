import type { Key } from 'ink';
import type { DebugSession } from '../../engine.js';
import type { ConsoleEntry } from '../../store/types.js';
import { formatArg } from '../../store/console-format.js';
import { consoleArgAtPath, consoleCopyText, consoleEntriesText, consoleSubtreeText } from '../overlays/ConsoleDetailOverlay.js';
import type { Line } from '../overlays/DetailOverlay.js';
import { clampWindowStart } from '../lib/list-window.js';
import type { ConsoleTool } from '../hooks/use-console-tool.js';
import type { FollowNav } from '../lib/keys.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';

type SetToast = (msg: string, level?: ToastLevel) => void;

export interface ConsoleKeyCtx {
  con: ConsoleTool;
  conEntries: ConsoleEntry[];
  clampedConSel: number;
  bodyH: number;
  session: DebugSession | undefined;
  setToast: SetToast;
  copyFn: (text: string) => Promise<void>;
  followNav: FollowNav;
}

export function copyConsoleAll(entries: ConsoleEntry[], copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  if (!entries.length) {
    setToast(t('toast.consoleCopyEmpty'));
    return;
  }
  void copyFn(consoleEntriesText(entries)).then(
    () => setToast(t('toast.consoleCopied', { n: entries.length }), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function clearConsoleLog(con: ConsoleTool, session: DebugSession | undefined, setToast: SetToast): void {
  session?.console.clear();
  void session?.releaseReplObjects();
  con.setConSel(0);
  con.setConFollow(true);
  con.setExpanded(new Set());
  setToast(t('toast.logCleared'), 'success');
}

export function openConsoleDetail(con: ConsoleTool, entry: ConsoleEntry): void {
  con.setConDetailEntry(entry);
  con.resetConDetail();
}

export function submitConsoleInput(session: DebugSession, expression: string, contextId?: number): void {
  const store = session.console;
  store.push({ kind: 'input', text: expression, ts: Date.now() });
  void session.evaluate(expression, contextId).then(
    ({ result, exceptionDetails }) => {
      if (exceptionDetails) {
        store.handleEvent('Runtime.exceptionThrown', { timestamp: Date.now(), exceptionDetails });
        return;
      }
      store.push({
        kind: 'result',
        text: result ? formatArg(result) : 'undefined',
        ts: Date.now(),
        args: result?.objectId !== undefined ? [result] : undefined,
      });
    },
    err => {
      store.push({ kind: 'error', text: err instanceof Error ? err.message : String(err), ts: Date.now() });
    },
  );
}

export function handleConsoleKey(ctx: ConsoleKeyCtx, input: string, key: Key): boolean {
  const { con, conEntries, clampedConSel, bodyH, session, setToast, copyFn, followNav } = ctx;
  const page = Math.max(1, Math.floor((bodyH - 2) / 2));
  if (followNav(input, key, conEntries.length, clampedConSel, page, (idx, follow) => {
    con.setConSel(conEntries[idx]?.id ?? 0);
    con.setConFollow(follow);
  })) return true;
  if (key.return && conEntries.length > 0) {
    openConsoleDetail(con, conEntries[clampedConSel]);
    return true;
  }
  if (input === ' ' && conEntries.length > 0) {
    const id = conEntries[clampedConSel]?.id;
    if (id === undefined) return true;
    con.setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    return true;
  }
  if (input === 'i' && session) {
    con.setConInputEditing(true);
    return true;
  }
  if (input === 'x') {
    con.setConPicker(true);
    return true;
  }
  if (input === 'E' && session) {
    con.setConCtxPicker(true);
    return true;
  }
  if (input === '/') {
    con.setConFilterEditing(true);
    return true;
  }
  if (input === 'C') {
    clearConsoleLog(con, session, setToast);
    return true;
  }
  if (input === 'Y') {
    copyConsoleAll(conEntries, copyFn, setToast);
    return true;
  }
  if (input === 'T') {
    const next = !con.conTimestamps;
    con.setConTimestamps(next);
    setToast(t(next ? 'toast.timestampsShown' : 'toast.timestampsHidden'));
    return true;
  }
  if (key.escape && con.conTextFilter) {
    con.setConTextFilter('');
    con.setConSel(0);
    con.setConFollow(true);
    return true;
  }
  return false;
}

export interface ConsoleDetailKeyCtx {
  con: ConsoleTool;
  detailEntry: ConsoleEntry;
  lines: Line[];
  pageH: number;
  session: DebugSession | undefined;
  gPending: { current: boolean };
  copyFn: (text: string) => Promise<void>;
  setToast: SetToast;
  withEditor: (initial: string, ext?: string, opts?: { readonly?: boolean }) => Promise<string | null>;
  whenNotEditing: (fn: () => void) => void;
  revealNode: (objectId: string) => void;
}

export function handleConsoleDetailKey(ctx: ConsoleDetailKeyCtx, input: string, key: Key): boolean {
  const { con, detailEntry, lines, pageH, session, gPending, copyFn, setToast, withEditor, whenNotEditing, revealNode } = ctx;
  const maxCursor = Math.max(0, lines.length - 1);
  const cursor = Math.min(con.conDetailCursor, maxCursor);
  const node = lines[cursor]?.node;
  const tree = { expanded: con.conDetailExpanded, children: con.conDetailChildren };
  const moveTo = (c: number) => {
    const next = Math.max(0, Math.min(c, maxCursor));
    con.setConDetailCursor(next);
    con.setConDetailScroll(s => clampWindowStart(s, lines.length, next, pageH));
  };
  const collapseNode = () => {
    if (!node || !con.conDetailExpanded.has(node.path)) return;
    con.setConDetailExpanded(prev => {
      const next = new Set(prev);
      next.delete(node.path);
      return next;
    });
  };
  const expandNode = () => {
    if (!node || con.conDetailExpanded.has(node.path)) return;
    const open = () => con.setConDetailExpanded(prev => new Set(prev).add(node.path));
    if (con.conDetailChildren.has(node.objectId)) {
      open();
      return;
    }
    if (!session) return;
    void session.getProperties(node.objectId).then(
      props => whenNotEditing(() => {
        con.setConDetailChildren(prev => new Map(prev).set(node.objectId, props));
        open();
      }),
      // The objectId expires on navigation or release; the node degrades to a
      // dim stale marker instead of surfacing the protocol error.
      () => whenNotEditing(() => {
        con.setConDetailChildren(prev => new Map(prev).set(node.objectId, 'stale'));
        open();
      }),
    );
  };
  if (key.escape || input === 'q') {
    con.setConDetailEntry(null);
    con.resetConDetail();
    return true;
  }
  if (key.return || input === ' ') {
    if (node) {
      if (con.conDetailExpanded.has(node.path)) collapseNode();
      else expandNode();
    }
    return true;
  }
  if (input === 'l' || key.rightArrow) {
    expandNode();
    return true;
  }
  if (input === 'h' || key.leftArrow) {
    collapseNode();
    return true;
  }
  if (input === 'y') {
    const text = (node ? consoleSubtreeText(detailEntry, tree, node.path) : undefined) ?? consoleCopyText(detailEntry);
    void copyFn(text).then(
      () => setToast(t('toast.copied'), 'success'),
      () => setToast(t('toast.copyFailed'), 'error'),
    );
    return true;
  }
  if (input === 's' && session) {
    if (!node) {
      setToast(t('toast.storeGlobalNotObject'));
      return true;
    }
    void session.storeAsGlobal(node.objectId).then(
      name => whenNotEditing(() => setToast(t('toast.storedAsGlobal', { name }), 'success')),
      () => whenNotEditing(() => setToast(t('toast.storeGlobalFailed'), 'error')),
    );
    return true;
  }
  if (input === 'I' && session) {
    if (!node) {
      setToast(t('toast.notDomNode'));
      return true;
    }
    const arg = consoleArgAtPath(detailEntry, tree, node.path);
    if (arg?.subtype === 'node') revealNode(node.objectId);
    else setToast(t('toast.notDomNode'));
    return true;
  }
  if (input === 'e') {
    void withEditor(consoleCopyText(detailEntry), 'txt', { readonly: true });
    return true;
  }
  if (input === 'w') {
    con.setConDetailWrap(w => !w);
    return true;
  }
  const page = Math.max(1, Math.floor(pageH / 2));
  if (key.downArrow || input === 'j') moveTo(cursor + 1);
  else if (key.upArrow || input === 'k') moveTo(cursor - 1);
  else if (key.ctrl && input === 'd') moveTo(cursor + page);
  else if (key.ctrl && input === 'u') moveTo(cursor - page);
  else if (input === 'G') moveTo(maxCursor);
  else if (input === 'g') {
    if (gPending.current) {
      gPending.current = false;
      moveTo(0);
    } else {
      gPending.current = true;
    }
  }
  return true;
}
