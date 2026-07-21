import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';
import type { BreakpointKind, DebugPersistState, PausedView, PauseState, ScriptInfo } from '../../store/debugger.js';
import { inlineArg } from '../../store/console-format.js';
import type { ConsoleChildren } from '../overlays/ConsoleDetailOverlay.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';
import { displayLineFor, prettyPrint, type PrettyResult } from '../lib/pretty-print.js';
import { loadSourceMap, resolveSourceMapUrl, resolveSourceUrl, fetchText, type SourceMapData } from '../../util/source-map.js';
import type { Attached } from './use-session-manager.js';
import type { Tool } from '../panels/ToolTabs.js';

export type SourceText = string[] | 'error';

export interface OriginView {
  title: string;
  text?: SourceText;
}

export type PausedFocus = 'stack' | 'scope' | 'watch';

export interface BpEdit {
  kind: Exclude<BreakpointKind, 'line'>;
  url: string;
  line: number;
  text: string;
}

export const WATCH_ERROR = '<error>';

export const SOURCE_CACHE_CAP = 30;

export function lruSet<K, V>(prev: Map<K, V>, key: K, value: V, cap: number): Map<K, V> {
  const next = new Map(prev);
  next.delete(key);
  next.set(key, value);
  while (next.size > cap) next.delete(next.keys().next().value as K);
  return next;
}

export const EVENT_BP_CATEGORIES = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'keydown',
  'keyup',
  'input',
  'change',
  'submit',
  'focus',
  'blur',
  'scroll',
] as const;

const PAUSE_CYCLE: Record<PauseState, PauseState> = { none: 'uncaught', uncaught: 'all', all: 'none' };

export interface SourcesToolOpts {
  attached: Attached | null;
  activeTool: Tool;
  notify: (msg: string, level?: ToastLevel) => void;
  whenNotEditing?: (fn: () => void) => void;
  persistDebug?: (session: DebugSession, state: DebugPersistState) => void;
}

export function useSourcesTool({ attached, activeTool, notify, whenNotEditing = fn => fn(), persistDebug }: SourcesToolOpts) {
  const [srcSel, setSrcSel] = useState(0);
  const [srcFilter, setSrcFilter] = useState('');
  const [srcFilterEditing, setSrcFilterEditing] = useState(false);
  const [viewScript, setViewScript] = useState<ScriptInfo | null>(null);
  const [srcCursor, setSrcCursor] = useState(0);
  const [srcScroll, setSrcScroll] = useState(0);
  const [sources, setSources] = useState<Map<string, SourceText>>(new Map());
  const [pausedDismissed, setPausedDismissed] = useState(false);
  const [frameSel, setFrameSel] = useState(0);
  const [pausedFocus, setPausedFocus] = useState<PausedFocus>('stack');
  const [scopeCursor, setScopeCursor] = useState(0);
  const [scopeScroll, setScopeScroll] = useState(0);
  const [scopeExpanded, setScopeExpanded] = useState<Set<string>>(new Set());
  const [scopeChildren, setScopeChildren] = useState<Map<string, ConsoleChildren>>(new Map());
  const [bpEdit, setBpEdit] = useState<BpEdit | null>(null);
  const [watches, setWatches] = useState<string[]>([]);
  const [watchVals, setWatchVals] = useState<(string | null)[]>([]);
  const [watchSel, setWatchSel] = useState(0);
  const [watchInput, setWatchInput] = useState<string | null>(null);
  const [xhrMode, setXhrMode] = useState(false);
  const [xhrSel, setXhrSel] = useState(0);
  const [xhrInput, setXhrInput] = useState<string | null>(null);
  const [eventMode, setEventMode] = useState(false);
  const [eventSel, setEventSel] = useState(0);
  const [prettyOn, setPrettyOn] = useState<Set<string>>(new Set());
  const [prettyMaps, setPrettyMaps] = useState<Map<string, PrettyResult>>(new Map());
  const [maps, setMaps] = useState<Map<string, SourceMapData | 'error'>>(new Map());
  const [mapScript, setMapScript] = useState<ScriptInfo | null>(null);
  const [mapSel, setMapSel] = useState(0);
  const [origin, setOrigin] = useState<OriginView | null>(null);
  const [originCursor, setOriginCursor] = useState(0);
  const [originScroll, setOriginScroll] = useState(0);
  const [liveEdited, setLiveEdited] = useState<Set<string>>(new Set());

  const guard = useRef(whenNotEditing);
  guard.current = whenNotEditing;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const persistRef = useRef(persistDebug);
  persistRef.current = persistDebug;
  const viewScriptRef = useRef(viewScript);
  viewScriptRef.current = viewScript;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const scopeChildrenRef = useRef(scopeChildren);
  scopeChildrenRef.current = scopeChildren;
  const bpEditRef = useRef(bpEdit);
  bpEditRef.current = bpEdit;
  const watchesRef = useRef(watches);
  watchesRef.current = watches;
  const srcCursorRef = useRef(srcCursor);
  srcCursorRef.current = srcCursor;
  const prettyOnRef = useRef(prettyOn);
  prettyOnRef.current = prettyOn;
  const prettyMapsRef = useRef(prettyMaps);
  prettyMapsRef.current = prettyMaps;
  const mapsRef = useRef(maps);
  mapsRef.current = maps;
  const fetching = useRef(new Set<string>());
  const mapFetching = useRef(new Set<string>());
  const watchGroupSeq = useRef(0);
  const watchGroupRef = useRef<string | null>(null);

  const persist = useCallback((session: DebugSession) => {
    persistRef.current?.(session, session.debug.persistState(true));
  }, []);

  const resetScope = useCallback(() => {
    setScopeCursor(0);
    setScopeScroll(0);
    setScopeExpanded(new Set());
    setScopeChildren(new Map());
  }, []);

  const ensureSource = useCallback((session: DebugSession, scriptId: string) => {
    if (sourcesRef.current.has(scriptId)) {
      setSources(prev => {
        const cached = prev.get(scriptId);
        if (cached === undefined) return prev;
        let last: string | undefined;
        for (const k of prev.keys()) last = k;
        if (last === scriptId) return prev;
        return lruSet(prev, scriptId, cached, SOURCE_CACHE_CAP);
      });
      return;
    }
    if (fetching.current.has(scriptId)) return;
    fetching.current.add(scriptId);
    void session.getScriptSource(scriptId).then(
      text => guard.current(() => {
        fetching.current.delete(scriptId);
        setSources(prev => lruSet(prev, scriptId, text.split(/\r?\n/), SOURCE_CACHE_CAP));
      }),
      () => guard.current(() => {
        fetching.current.delete(scriptId);
        setSources(prev => lruSet(prev, scriptId, 'error', SOURCE_CACHE_CAP));
      }),
    );
  }, []);

  const openScript = useCallback((session: DebugSession, script: ScriptInfo, line?: number) => {
    setViewScript(script);
    const at = line ?? 0;
    setSrcCursor(at);
    setSrcScroll(Math.max(0, at - 5));
    ensureSource(session, script.scriptId);
  }, [ensureSource]);

  const closeViewer = useCallback(() => {
    setViewScript(null);
  }, []);

  const togglePretty = useCallback((script: ScriptInfo) => {
    const id = script.scriptId;
    const text = sourcesRef.current.get(id);
    if (!Array.isArray(text)) return;
    const cursor = srcCursorRef.current;
    if (prettyOnRef.current.has(id)) {
      const res = prettyMapsRef.current.get(id);
      const next = res ? (res.displayToOriginal[Math.min(cursor, Math.max(0, res.displayToOriginal.length - 1))] ?? 0) : cursor;
      setPrettyOn(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setSrcCursor(next);
      setSrcScroll(Math.max(0, next - 5));
      return;
    }
    let res = prettyMapsRef.current.get(id);
    if (!res) {
      res = prettyPrint(text.join('\n'));
      setPrettyMaps(prev => new Map(prev).set(id, res!));
    }
    const next = displayLineFor(res, cursor);
    setPrettyOn(prev => new Set(prev).add(id));
    setSrcCursor(next);
    setSrcScroll(Math.max(0, next - 5));
  }, []);

  const ensureMap = useCallback((script: ScriptInfo) => {
    const id = script.scriptId;
    if (!script.sourceMapURL || mapsRef.current.has(id) || mapFetching.current.has(id)) return;
    mapFetching.current.add(id);
    void loadSourceMap(script.url, script.sourceMapURL).then(
      map => guard.current(() => {
        mapFetching.current.delete(id);
        setMaps(prev => new Map(prev).set(id, map));
      }),
      () => guard.current(() => {
        mapFetching.current.delete(id);
        setMaps(prev => new Map(prev).set(id, 'error'));
      }),
    );
  }, []);

  const openMapList = useCallback((script: ScriptInfo) => {
    if (!script.sourceMapURL) {
      notifyRef.current(t('sources.toast.mapNone'));
      return;
    }
    ensureMap(script);
    setMapScript(script);
    setMapSel(0);
  }, [ensureMap]);

  const openOrigin = useCallback((script: ScriptInfo, idx: number) => {
    const map = mapsRef.current.get(script.scriptId);
    if (!map || map === 'error') return;
    const source = map.sources[idx];
    if (source === undefined) return;
    setOriginCursor(0);
    setOriginScroll(0);
    const content = map.sourcesContent?.[idx];
    if (typeof content === 'string') {
      setOrigin({ title: source, text: content.split(/\r?\n/) });
      return;
    }
    setOrigin({ title: source });
    const mapUrl = resolveSourceMapUrl(script.url, script.sourceMapURL ?? '');
    void fetchText(resolveSourceUrl(mapUrl, source, map.sourceRoot)).then(
      text => guard.current(() => setOrigin(o => (o?.title === source ? { title: source, text: text.split(/\r?\n/) } : o))),
      () => guard.current(() => setOrigin(o => (o?.title === source ? { title: source, text: 'error' } : o))),
    );
  }, []);

  const liveEdit = useCallback(async (
    session: DebugSession,
    script: ScriptInfo,
    withEditor: (initial: string, ext?: string) => Promise<string | null>,
  ) => {
    const text = sourcesRef.current.get(script.scriptId);
    if (!Array.isArray(text)) return;
    const initial = text.join('\n');
    const edited = await withEditor(initial, 'js');
    if (edited === null) return;
    if (edited.replace(/\n$/, '') === initial.replace(/\n$/, '')) {
      notifyRef.current(t('sources.toast.editUnchanged'));
      return;
    }
    try {
      for (const dryRun of [true, false]) {
        const res = await session.setScriptSource(script.scriptId, edited, dryRun);
        if (res.status !== 'Ok') {
          const reason = (res.exceptionDetails as { text?: string } | undefined)?.text ?? res.status;
          notifyRef.current(t('sources.toast.editFailed', { reason }), 'error');
          return;
        }
      }
    } catch {
      notifyRef.current(t('sources.toast.editFailed', { reason: 'CDP' }), 'error');
      return;
    }
    const lines = edited.split(/\r?\n/);
    setSources(prev => lruSet(prev, script.scriptId, lines, SOURCE_CACHE_CAP));
    setPrettyMaps(prev => {
      if (!prev.has(script.scriptId)) return prev;
      const next = new Map(prev);
      next.set(script.scriptId, prettyPrint(lines.join('\n')));
      return next;
    });
    setMaps(prev => {
      if (!prev.has(script.scriptId)) return prev;
      const next = new Map(prev);
      next.delete(script.scriptId);
      return next;
    });
    setLiveEdited(prev => new Set(prev).add(script.scriptId));
    for (const bp of session.debug.breakpoints().filter(b => b.url === script.url)) {
      await session.removeBreakpoint(bp.id).catch(() => {});
      const spec = bp.kind !== 'line' && bp.condition !== undefined ? { kind: bp.kind, text: bp.condition } : undefined;
      await session.setBreakpointByUrl(bp.url, bp.line, spec).catch(() => {});
    }
    persist(session);
    notifyRef.current(t('sources.toast.editApplied'), 'success');
  }, [persist]);

  const toggleBreakpoint = useCallback((session: DebugSession, script: ScriptInfo, line: number) => {
    if (!script.url) {
      notifyRef.current(t('sources.toast.bpNeedsUrl'));
      return;
    }
    const existing = session.debug.breakpointAt(script.url, line);
    if (existing) {
      void session.removeBreakpoint(existing.id).then(
        () => guard.current(() => {
          persist(session);
          notifyRef.current(t('sources.toast.bpRemoved', { line: (existing.resolved?.line ?? existing.line) + 1 }));
        }),
        () => notifyRef.current(t('sources.toast.bpFailed'), 'error'),
      );
      return;
    }
    void session.setBreakpointByUrl(script.url, line).then(
      bp => guard.current(() => {
        persist(session);
        notifyRef.current(t('sources.toast.bpSet', { line: (bp.resolved?.line ?? bp.line) + 1 }), 'success');
      }),
      () => notifyRef.current(t('sources.toast.bpFailed'), 'error'),
    );
  }, [persist]);

  const openBpEdit = useCallback((session: DebugSession, script: ScriptInfo, kind: BpEdit['kind'], line: number) => {
    if (!script.url) {
      notifyRef.current(t('sources.toast.bpNeedsUrl'));
      return;
    }
    const existing = session.debug.breakpointAt(script.url, line);
    const text = existing && existing.kind === kind ? (existing.condition ?? '') : '';
    setBpEdit({ kind, url: script.url, line, text });
  }, []);

  const applyBpEdit = useCallback((session: DebugSession) => {
    const ed = bpEditRef.current;
    setBpEdit(null);
    if (!ed || !ed.url) return;
    const text = ed.text.trim();
    if (!text) return;
    const url = ed.url;
    void (async () => {
      const existing = session.debug.breakpointAt(url, ed.line);
      if (existing) await session.removeBreakpoint(existing.id);
      try {
        return await session.setBreakpointByUrl(url, ed.line, { kind: ed.kind, text });
      } catch (err) {
        if (existing) {
          const spec = existing.kind !== 'line' && existing.condition !== undefined
            ? { kind: existing.kind, text: existing.condition }
            : undefined;
          await session.setBreakpointByUrl(existing.url, existing.line, spec).catch(() => {});
          guard.current(() => persist(session));
        }
        throw err;
      }
    })().then(
      bp => guard.current(() => {
        persist(session);
        notifyRef.current(
          t(ed.kind === 'logpoint' ? 'sources.toast.logpointSet' : 'sources.toast.bpCondSet', { line: (bp.resolved?.line ?? bp.line) + 1 }),
          'success',
        );
      }),
      () => notifyRef.current(t('sources.toast.bpFailed'), 'error'),
    );
  }, [persist]);

  const toggleBlackbox = useCallback((session: DebugSession, script: ScriptInfo) => {
    if (!script.url) {
      notifyRef.current(t('sources.toast.blackboxNeedsUrl'));
      return;
    }
    const url = script.url;
    const name = url.split('/').pop() || url;
    void session.toggleBlackbox(url).then(
      on => guard.current(() => {
        persist(session);
        notifyRef.current(t(on ? 'sources.toast.blackboxOn' : 'sources.toast.blackboxOff', { name }), on ? 'success' : 'info');
      }),
      () => notifyRef.current(t('sources.toast.blackboxFailed'), 'error'),
    );
  }, [persist]);

  const addXhr = useCallback((session: DebugSession, url: string) => {
    void session.addXhrBreakpoint(url).then(
      () => guard.current(() => {
        persist(session);
        notifyRef.current(t('sources.toast.xhrBpAdded', { url }), 'success');
      }),
      () => notifyRef.current(t('sources.toast.xhrBpFailed'), 'error'),
    );
  }, [persist]);

  const removeXhr = useCallback((session: DebugSession, url: string) => {
    void session.removeXhrBreakpoint(url).then(
      () => guard.current(() => {
        persist(session);
        notifyRef.current(t('sources.toast.xhrBpRemoved', { url }));
      }),
      () => notifyRef.current(t('sources.toast.xhrBpFailed'), 'error'),
    );
  }, [persist]);

  const toggleEvent = useCallback((session: DebugSession, name: string) => {
    const on = !session.debug.eventBreakpoints().includes(name);
    void session.setEventBreakpoint(name, on).then(
      () => guard.current(() => {
        persist(session);
        notifyRef.current(t(on ? 'sources.toast.eventBpOn' : 'sources.toast.eventBpOff', { name }), on ? 'success' : 'info');
      }),
      () => notifyRef.current(t('sources.toast.eventBpFailed'), 'error'),
    );
  }, [persist]);

  const openWatchInput = useCallback((canFit: boolean) => {
    if (!canFit) {
      notifyRef.current(t('sources.toast.watchNoRoom'));
      return;
    }
    setWatchInput('');
  }, []);

  const addWatch = useCallback((expr: string) => {
    setWatchSel(watchesRef.current.length);
    setWatches(prev => [...prev, expr]);
    setPausedFocus('watch');
  }, []);

  const removeWatch = useCallback((idx: number) => {
    if (watchesRef.current.length <= 1) setPausedFocus('stack');
    setWatches(prev => prev.filter((_, i) => i !== idx));
    setWatchVals(prev => prev.filter((_, i) => i !== idx));
    setWatchSel(s => Math.max(0, Math.min(s, watchesRef.current.length - 2)));
  }, []);

  const cyclePauseOnExceptions = useCallback((session: DebugSession) => {
    const next = PAUSE_CYCLE[session.debug.pauseOnExceptions];
    void session.setPauseOnExceptions(next).then(
      () => guard.current(() => {
        persist(session);
        notifyRef.current(t('sources.toast.pauseOnExceptions', { state: next }));
      }),
      () => notifyRef.current(t('sources.toast.pauseOnExceptionsFailed'), 'error'),
    );
  }, [persist]);

  const stepOver = useCallback((session: DebugSession) => {
    void session.stepOver().catch(() => notifyRef.current(t('sources.toast.stepFailed'), 'error'));
  }, []);
  const stepInto = useCallback((session: DebugSession) => {
    void session.stepInto().catch(() => notifyRef.current(t('sources.toast.stepFailed'), 'error'));
  }, []);
  const stepOut = useCallback((session: DebugSession) => {
    void session.stepOut().catch(() => notifyRef.current(t('sources.toast.stepFailed'), 'error'));
  }, []);
  const resumeNow = useCallback((session: DebugSession) => {
    void session.resumeDebugger().catch(() => notifyRef.current(t('sources.toast.resumeFailed'), 'error'));
  }, []);
  const pauseNow = useCallback((session: DebugSession) => {
    void session.pauseDebugger().catch(() => notifyRef.current(t('sources.toast.pauseFailed'), 'error'));
  }, []);

  const fetchScopeChildren = useCallback((session: DebugSession, objectId: string) => {
    void session.getProperties(objectId).then(
      props => guard.current(() => setScopeChildren(prev => new Map(prev).set(objectId, props))),
      () => guard.current(() => setScopeChildren(prev => new Map(prev).set(objectId, 'stale'))),
    );
  }, []);

  useEffect(() => {
    if (activeTool !== 'sources' || !attached) return;
    void attached.session.enableDebugger().catch(() => notifyRef.current(t('sources.toast.enableFailed'), 'error'));
  }, [activeTool, attached?.session]);

  useEffect(() => {
    setSrcSel(0);
    setSrcFilter('');
    setSrcFilterEditing(false);
    setViewScript(null);
    setSrcCursor(0);
    setSrcScroll(0);
    setSources(new Map());
    setPausedDismissed(false);
    setFrameSel(0);
    setPausedFocus('stack');
    setBpEdit(null);
    setWatches([]);
    setWatchVals([]);
    setWatchSel(0);
    setWatchInput(null);
    setXhrMode(false);
    setXhrSel(0);
    setXhrInput(null);
    setEventMode(false);
    setEventSel(0);
    setPrettyOn(new Set());
    setPrettyMaps(new Map());
    setMaps(new Map());
    setMapScript(null);
    setMapSel(0);
    setOrigin(null);
    setOriginCursor(0);
    setOriginScroll(0);
    setLiveEdited(new Set());
    watchGroupRef.current = null;
    resetScope();
  }, [attached?.session, resetScope]);

  useEffect(() => {
    const session = attached?.session;
    if (!session) return;
    const store = session.debug;
    const onPaused = (p: PausedView) => guard.current(() => {
      setPausedDismissed(false);
      setFrameSel(0);
      setPausedFocus('stack');
      setXhrMode(false);
      setEventMode(false);
      setXhrInput(null);
      setMapScript(null);
      setOrigin(null);
      resetScope();
      const top = p.frames[0];
      const vs = viewScriptRef.current;
      if (top && vs) {
        if (vs.scriptId !== top.scriptId) {
          const script = store.scriptById(top.scriptId) ?? { scriptId: top.scriptId, url: top.url, endLine: 0 };
          setViewScript(script);
          ensureSource(session, top.scriptId);
        }
        const res = prettyOnRef.current.has(top.scriptId) ? prettyMapsRef.current.get(top.scriptId) : undefined;
        const line = res ? displayLineFor(res, top.line) : top.line;
        setSrcCursor(line);
        setSrcScroll(Math.max(0, line - 5));
      }
    });
    const onResumed = () => guard.current(() => resetScope());
    store.on('paused', onPaused);
    store.on('resumed', onResumed);
    return () => {
      store.off('paused', onPaused);
      store.off('resumed', onResumed);
    };
  }, [attached?.session, ensureSource, resetScope]);

  const paused = attached?.session.debug.paused ?? null;
  const pausedFrameId = paused && !pausedDismissed
    ? paused.frames[Math.min(frameSel, Math.max(0, paused.frames.length - 1))]?.callFrameId
    : undefined;
  useEffect(() => {
    const session = attached?.session;
    if (!session || !pausedFrameId || !watches.length) return;
    let cancelled = false;
    const group = `watch-${++watchGroupSeq.current}`;
    void (async () => {
      const vals: (string | null)[] = [];
      for (const expr of watches) {
        try {
          const { result, exceptionDetails } = await session.evaluateOnCallFrame(pausedFrameId, expr, group);
          vals.push(exceptionDetails || !result ? WATCH_ERROR : inlineArg(result));
        } catch {
          vals.push(WATCH_ERROR);
        }
      }
      if (cancelled) {
        void session.releaseObjectGroup(group);
        return;
      }
      guard.current(() => setWatchVals(vals));
      const superseded = watchGroupRef.current;
      watchGroupRef.current = group;
      if (superseded) void session.releaseObjectGroup(superseded);
    })();
    return () => {
      cancelled = true;
    };
  }, [attached?.session, pausedFrameId, watches]);

  useEffect(() => {
    const session = attached?.session;
    if (!session || !paused || pausedDismissed) return;
    const frame = paused.frames[Math.min(frameSel, Math.max(0, paused.frames.length - 1))];
    if (!frame) return;
    ensureSource(session, frame.scriptId);
    const info = session.debug.scriptById(frame.scriptId);
    if (info?.sourceMapURL) ensureMap(info);
    setScopeCursor(0);
    setScopeScroll(0);
    const first = frame.scopes[0];
    if (first?.objectId) {
      setScopeExpanded(prev => (prev.has('s0') ? prev : new Set(prev).add('s0')));
      if (!scopeChildrenRef.current.has(first.objectId)) fetchScopeChildren(session, first.objectId);
    }
  }, [attached?.session, paused, frameSel, pausedDismissed, ensureSource, ensureMap, fetchScopeChildren]);

  return {
    srcSel,
    setSrcSel,
    srcFilter,
    setSrcFilter,
    srcFilterEditing,
    setSrcFilterEditing,
    viewScript,
    srcCursor,
    setSrcCursor,
    srcScroll,
    setSrcScroll,
    sources,
    pausedDismissed,
    setPausedDismissed,
    frameSel,
    setFrameSel,
    pausedFocus,
    setPausedFocus,
    scopeCursor,
    setScopeCursor,
    scopeScroll,
    setScopeScroll,
    scopeExpanded,
    setScopeExpanded,
    scopeChildren,
    setScopeChildren,
    bpEdit,
    setBpEdit,
    openBpEdit,
    applyBpEdit,
    watches,
    watchVals,
    watchSel,
    setWatchSel,
    watchInput,
    setWatchInput,
    openWatchInput,
    addWatch,
    removeWatch,
    xhrMode,
    setXhrMode,
    xhrSel,
    setXhrSel,
    xhrInput,
    setXhrInput,
    addXhr,
    removeXhr,
    eventMode,
    setEventMode,
    eventSel,
    setEventSel,
    toggleEvent,
    toggleBlackbox,
    ensureSource,
    openScript,
    closeViewer,
    prettyOn,
    prettyMaps,
    togglePretty,
    maps,
    ensureMap,
    mapScript,
    setMapScript,
    mapSel,
    setMapSel,
    openMapList,
    origin,
    setOrigin,
    originCursor,
    setOriginCursor,
    originScroll,
    setOriginScroll,
    openOrigin,
    liveEdited,
    liveEdit,
    toggleBreakpoint,
    cyclePauseOnExceptions,
    stepOver,
    stepInto,
    stepOut,
    resumeNow,
    pauseNow,
    fetchScopeChildren,
  };
}

export type SourcesTool = ReturnType<typeof useSourcesTool>;
