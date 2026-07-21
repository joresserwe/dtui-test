import type { Key } from 'ink';
import type { PausedView, ScriptInfo } from '../../store/debugger.js';
import type { Line } from '../overlays/DetailOverlay.js';
import { clampWindowStart } from '../lib/list-window.js';
import { pausedPaneHeights, SOURCES_LIST_CHROME, SOURCES_VIEWER_CHROME } from '../panels/SourcesPanel.js';
import type { ListNav } from '../lib/keys.js';
import type { Attached } from '../hooks/use-session-manager.js';
import { EVENT_BP_CATEGORIES, type SourcesTool } from '../hooks/use-sources-tool.js';

export interface SourcesKeyCtx {
  src: SourcesTool;
  attached: Attached | null;
  bodyH: number;
  listNav: ListNav;
  gPending: { current: boolean };
  scripts: ScriptInfo[];
  paused: PausedView | null;
  scopeLines: Line[];
  withEditor: (initial: string, ext?: string) => Promise<string | null>;
}

function handleStepKey(ctx: SourcesKeyCtx, input: string): boolean {
  const session = ctx.attached?.session;
  if (!session) return false;
  if (ctx.paused) {
    if (input === 'n') {
      ctx.src.stepOver(session);
      return true;
    }
    if (input === 's') {
      ctx.src.stepInto(session);
      return true;
    }
    if (input === 'o') {
      ctx.src.stepOut(session);
      return true;
    }
    if (input === 'c') {
      ctx.src.resumeNow(session);
      return true;
    }
  } else if (input === 'p') {
    ctx.src.pauseNow(session);
    return true;
  }
  return false;
}

function moveCursor(
  len: number,
  budget: number,
  setCursor: (v: number) => void,
  setScroll: (fn: (s: number) => number) => void,
): (target: number) => void {
  return target => {
    const next = Math.max(0, Math.min(target, Math.max(0, len - 1)));
    setCursor(next);
    setScroll(s => clampWindowStart(s, len, next, budget));
  };
}

function navWithCursor(
  input: string,
  key: Key,
  gPending: { current: boolean },
  cursor: number,
  page: number,
  moveTo: (target: number) => void,
  len: number,
): boolean {
  if (key.downArrow || input === 'j') {
    moveTo(cursor + 1);
    return true;
  }
  if (key.upArrow || input === 'k') {
    moveTo(cursor - 1);
    return true;
  }
  if (key.ctrl && input === 'd') {
    moveTo(cursor + page);
    return true;
  }
  if (key.ctrl && input === 'u') {
    moveTo(cursor - page);
    return true;
  }
  if (input === 'G') {
    moveTo(len - 1);
    return true;
  }
  if (input === 'g' && !key.ctrl) {
    if (gPending.current) {
      gPending.current = false;
      moveTo(0);
    } else {
      gPending.current = true;
    }
    return true;
  }
  return false;
}

export function handleSourcesViewerKey(ctx: SourcesKeyCtx, input: string, key: Key): void {
  const { src, attached, bodyH, gPending } = ctx;
  const script = src.viewScript;
  if (!script) return;
  if (key.escape || input === 'q') {
    src.closeViewer();
    return;
  }
  if (handleStepKey(ctx, input)) return;
  const prettyRes = src.prettyOn.has(script.scriptId) ? src.prettyMaps.get(script.scriptId) : undefined;
  const bpLine = prettyRes ? (prettyRes.displayToOriginal[Math.min(src.srcCursor, Math.max(0, prettyRes.displayToOriginal.length - 1))] ?? 0) : src.srcCursor;
  if (input === 'b' && attached) {
    src.toggleBreakpoint(attached.session, script, bpLine);
    return;
  }
  if (input === 'B' && attached) {
    src.openBpEdit(attached.session, script, 'condition', bpLine);
    return;
  }
  if (input === 'L' && attached) {
    src.openBpEdit(attached.session, script, 'logpoint', bpLine);
    return;
  }
  if (input === 'P') {
    src.togglePretty(script);
    return;
  }
  if (input === 'e' && attached) {
    void src.liveEdit(attached.session, script, ctx.withEditor);
    return;
  }
  if (input === 'X' && attached) {
    src.cyclePauseOnExceptions(attached.session);
    return;
  }
  const text = src.sources.get(script.scriptId);
  const len = prettyRes ? prettyRes.lines.length : Array.isArray(text) ? text.length : 0;
  const budget = Math.max(1, bodyH - SOURCES_VIEWER_CHROME);
  const page = Math.max(1, Math.floor(budget / 2));
  const moveTo = moveCursor(len, budget, src.setSrcCursor, src.setSrcScroll);
  navWithCursor(input, key, gPending, Math.min(src.srcCursor, Math.max(0, len - 1)), page, moveTo, len);
}

function handlePausedViewKey(ctx: SourcesKeyCtx, input: string, key: Key): void {
  const { src, attached, bodyH, listNav, gPending, scopeLines } = ctx;
  const paused = ctx.paused!;
  const session = attached!.session;
  if (key.escape) {
    src.setPausedDismissed(true);
    return;
  }
  const { scopeH, watchH } = pausedPaneHeights(bodyH, paused.frames.length, src.watches.length + (src.watchInput !== null ? 1 : 0));
  if (input === 'w') {
    const hasWatch = src.watches.length > 0 && watchH > 0;
    src.setPausedFocus(f => (f === 'stack' ? 'scope' : f === 'scope' && hasWatch ? 'watch' : 'stack'));
    return;
  }
  if (input === '+') {
    src.openWatchInput(pausedPaneHeights(bodyH, paused.frames.length, src.watches.length + 1).watchH > 0);
    return;
  }
  if (src.pausedFocus === 'watch') {
    const len = src.watches.length;
    const sel = Math.min(src.watchSel, Math.max(0, len - 1));
    if (input === 'd' && len) {
      src.removeWatch(sel);
      return;
    }
    listNav(input, key, len, src.setWatchSel, Math.max(1, watchH));
    return;
  }
  if (src.pausedFocus === 'stack') {
    if (key.return) {
      const frame = paused.frames[Math.min(src.frameSel, Math.max(0, paused.frames.length - 1))];
      if (frame) {
        const script = session.debug.scriptById(frame.scriptId) ?? { scriptId: frame.scriptId, url: frame.url, endLine: 0 };
        src.openScript(session, script, frame.line);
      }
      return;
    }
    listNav(input, key, paused.frames.length, src.setFrameSel, Math.max(1, Math.floor(paused.frames.length / 2)));
    return;
  }
  const maxCursor = Math.max(0, scopeLines.length - 1);
  const cursor = Math.min(src.scopeCursor, maxCursor);
  const node = scopeLines[cursor]?.node;
  const collapse = () => {
    if (!node || !src.scopeExpanded.has(node.path)) return;
    src.setScopeExpanded(prev => {
      const next = new Set(prev);
      next.delete(node.path);
      return next;
    });
  };
  const expand = () => {
    if (!node || src.scopeExpanded.has(node.path)) return;
    src.setScopeExpanded(prev => new Set(prev).add(node.path));
    if (!src.scopeChildren.has(node.objectId)) src.fetchScopeChildren(session, node.objectId);
  };
  if (key.return || input === ' ') {
    if (node) {
      if (src.scopeExpanded.has(node.path)) collapse();
      else expand();
    }
    return;
  }
  if (input === 'l' || key.rightArrow) {
    expand();
    return;
  }
  if (input === 'h' || key.leftArrow) {
    collapse();
    return;
  }
  const moveTo = moveCursor(scopeLines.length, scopeH, src.setScopeCursor, src.setScopeScroll);
  navWithCursor(input, key, gPending, cursor, Math.max(1, Math.floor(scopeH / 2)), moveTo, scopeLines.length);
}

export function handleSourcesKey(ctx: SourcesKeyCtx, input: string, key: Key): boolean {
  const { src, attached, bodyH, listNav, gPending, scripts, paused } = ctx;
  if (!attached) return false;
  const page = Math.max(1, Math.floor((bodyH - SOURCES_LIST_CHROME) / 2));
  if (src.origin) {
    if (key.escape || input === 'q') {
      src.setOrigin(null);
      return true;
    }
    const text = src.origin.text;
    const len = Array.isArray(text) ? text.length : 0;
    const budget = Math.max(1, bodyH - SOURCES_VIEWER_CHROME);
    const moveTo = moveCursor(len, budget, src.setOriginCursor, src.setOriginScroll);
    navWithCursor(input, key, gPending, Math.min(src.originCursor, Math.max(0, len - 1)), Math.max(1, Math.floor(budget / 2)), moveTo, len);
    return true;
  }
  if (src.mapScript) {
    const script = src.mapScript;
    if (key.escape || input === 'q' || input === 'm') {
      src.setMapScript(null);
      return true;
    }
    const map = src.maps.get(script.scriptId);
    const count = map && map !== 'error' ? map.sources.length : 0;
    if (key.return && count) {
      src.openOrigin(script, Math.min(src.mapSel, count - 1));
      return true;
    }
    listNav(input, key, count, src.setMapSel, page);
    return true;
  }
  if (src.xhrMode) {
    const list = attached.session.debug.xhrBreakpoints();
    if (key.escape || input === 'F') {
      src.setXhrMode(false);
      return true;
    }
    if (input === 'a') {
      src.setXhrInput('');
      return true;
    }
    if ((input === 'd' || input === ' ') && list.length) {
      src.removeXhr(attached.session, list[Math.min(src.xhrSel, list.length - 1)]);
      src.setXhrSel(s => Math.max(0, Math.min(s, list.length - 2)));
      return true;
    }
    listNav(input, key, list.length, src.setXhrSel, page);
    return true;
  }
  if (src.eventMode) {
    if (key.escape || input === 'E') {
      src.setEventMode(false);
      return true;
    }
    if (input === ' ' || key.return) {
      src.toggleEvent(attached.session, EVENT_BP_CATEGORIES[Math.min(src.eventSel, EVENT_BP_CATEGORIES.length - 1)]);
      return true;
    }
    listNav(input, key, EVENT_BP_CATEGORIES.length, src.setEventSel, page);
    return true;
  }
  if (handleStepKey(ctx, input)) return true;
  if (input === 'X') {
    src.cyclePauseOnExceptions(attached.session);
    return true;
  }
  if (paused && !src.pausedDismissed) {
    handlePausedViewKey(ctx, input, key);
    return true;
  }
  if (input === '/') {
    src.setSrcFilterEditing(true);
    return true;
  }
  if (input === 'x' && scripts.length) {
    src.toggleBlackbox(attached.session, scripts[Math.min(src.srcSel, scripts.length - 1)]);
    return true;
  }
  if (input === 'm' && scripts.length) {
    src.openMapList(scripts[Math.min(src.srcSel, scripts.length - 1)]);
    return true;
  }
  if (input === 'F') {
    src.setXhrMode(true);
    src.setXhrSel(0);
    return true;
  }
  if (input === 'E') {
    src.setEventMode(true);
    src.setEventSel(0);
    return true;
  }
  if (key.return && scripts.length) {
    const script = scripts[Math.min(src.srcSel, scripts.length - 1)];
    src.openScript(attached.session, script);
    return true;
  }
  if (key.escape) {
    if (src.srcFilter) {
      src.setSrcFilter('');
      src.setSrcSel(0);
      return true;
    }
    if (paused && src.pausedDismissed) {
      src.setPausedDismissed(false);
      return true;
    }
    return false;
  }
  return listNav(input, key, scripts.length, src.setSrcSel, page);
}
