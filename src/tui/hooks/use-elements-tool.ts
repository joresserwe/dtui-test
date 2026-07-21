import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';
import type { StyleRange } from '../../cdp/css.js';
import { stripHideClass, type EventListenerView } from '../../cdp/dom.js';
import { applyChildNodes, descendantIds, elementPath, expandTargets, mapDepth, resolveElementPath, type NodeMap } from '../../cdp/domtree.js';
import type { DomNodeView } from '../overlays/DomOverlay.js';
import { visibleNodes } from '../panels/ElementsPanel.js';
import type { Tool } from '../panels/ToolTabs.js';
import { replaceDeclText, type DeclSpan } from '../lib/style-edit.js';
import { composeClassAttr, createSerialQueue, isClassToken, parseClassEntries, type ClassEntry } from '../lib/class-edit.js';
import { buildClearHintsScript, buildFilterHintsScript, buildPickHintScript, buildShowHintsScript } from '../lib/hint-script.js';
import { buildCssOverviewScript, normalizeOverview, type CssOverviewData } from '../lib/css-overview.js';
import { ANIMATION_CAP, PLAYBACK_RATES, animationFromStarted, markAnimationCanceled, upsertAnimation, type AnimationInfo } from '../../cdp/animation.js';
import { buildSelectorPath } from '../lib/selector-path.js';
import { t } from '../lib/i18n.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import type { DebugPersistState, DomBreakpointType } from '../../store/debugger.js';
import type { Attached } from './use-session-manager.js';

export const PSEUDO_CLASSES = ['hover', 'focus', 'active'] as const;

export const INITIAL_TREE_DEPTH = 3;
export const Z_EXPAND_DEPTH = 8;
export const Z_EXPAND_NODES = 500;
const CURSOR_HIGHLIGHT_MS = 80;

export interface DeclEdit {
  text: string;
  prefix: string | null;
  matchIdx: number;
  styleSheetId: string;
  range: StyleRange;
  cssText: string;
  replaceSpan?: DeclSpan;
}

export interface ElSearchHits {
  id: string;
  query: string;
  total: number;
  index: number;
}

export interface HintInput {
  labels: string[];
  typed: string;
}

export interface ElementsToolOpts {
  attached: Attached | null;
  activeTool: Tool;
  editingRef: React.MutableRefObject<boolean>;
  notify?: (msg: string, level?: ToastLevel) => void;
  persistDebug?: (session: DebugSession, state: DebugPersistState) => void;
}

function elementTarget(map: NodeMap, nodeId: number): number {
  let cur = map.get(nodeId);
  while (cur && !cur.isElement && cur.parentId !== undefined) cur = map.get(cur.parentId);
  return cur?.isElement ? cur.nodeId : nodeId;
}

export function useElementsTool({ attached, activeTool, editingRef, notify, persistDebug }: ElementsToolOpts) {
  const [domNode, setDomNode] = useState<DomNodeView | null>(null);
  const [elMap, setElMap] = useState<NodeMap | null>(null);
  const elMapRef = useRef<NodeMap | null>(null);
  elMapRef.current = elMap;
  const [elExpanded, setElExpanded] = useState<Set<number>>(new Set());
  const [elSelId, setElSelId] = useState<number | null>(null);
  const [elSearching, setElSearching] = useState(false);
  const [elQuery, setElQuery] = useState('');
  const [elSubview, setElSubview] = useState(false);
  const elSubviewRef = useRef(false);
  elSubviewRef.current = elSubview;
  const [highlighting, setHighlighting] = useState(false);
  const highlightingRef = useRef(false);
  highlightingRef.current = highlighting;
  const [watching, setWatching] = useState(false);
  const [mutationCount, setMutationCount] = useState(0);
  const pendingMutationsRef = useRef(0);
  const [domErr, setDomErr] = useState<string | undefined>();
  const [ruleSelected, setRuleSelected] = useState(-1);
  const [declSel, setDeclSel] = useState(-1);
  const [declEdit, setDeclEdit] = useState<DeclEdit | null>(null);
  const [computedMode, setComputedMode] = useState(false);
  const [computedFilter, setComputedFilter] = useState('');
  const [computedFilterEditing, setComputedFilterEditing] = useState(false);
  const [computedScroll, setComputedScroll] = useState(0);
  const [forcedPseudo, setForcedPseudo] = useState(0);
  const forcedRef = useRef<{ session: DebugSession; nodeId: number } | null>(null);
  const yPendingRef = useRef(false);
  const zPendingRef = useRef(false);
  const [elSearchHits, setElSearchHits] = useState<ElSearchHits | null>(null);
  const elSearchHitsRef = useRef<ElSearchHits | null>(null);
  elSearchHitsRef.current = elSearchHits;
  const [inspecting, setInspecting] = useState(false);
  const [hintInput, setHintInput] = useState<HintInput | null>(null);
  const hintInputRef = useRef<HintInput | null>(null);
  hintInputRef.current = hintInput;
  const [pendingReveal, setPendingReveal] = useState<number | null>(null);
  const [autoExpandRoot, setAutoExpandRoot] = useState<number | null>(null);
  const autoExpandRequestedRef = useRef<Set<number>>(new Set());
  const [overlayNodes, setOverlayNodes] = useState<Map<number, 'grid' | 'flex'>>(new Map());
  const overlayRef = useRef(overlayNodes);
  overlayRef.current = overlayNodes;
  const [centerSeq, setCenterSeq] = useState(0);
  const [listenersMode, setListenersMode] = useState(false);
  const [listenersData, setListenersData] = useState<EventListenerView[]>([]);
  const [listenersScroll, setListenersScroll] = useState(0);
  const [classesMode, setClassesMode] = useState(false);
  const [classEntries, setClassEntries] = useState<ClassEntry[]>([]);
  const classEntriesRef = useRef(classEntries);
  classEntriesRef.current = classEntries;
  const [classesSel, setClassesSel] = useState(0);
  const [classesInput, setClassesInput] = useState<string | null>(null);
  const domBpPendingRef = useRef(false);
  const [overviewMode, setOverviewMode] = useState(false);
  const [overviewData, setOverviewData] = useState<CssOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewScroll, setOverviewScroll] = useState(0);
  const [animMode, setAnimMode] = useState(false);
  const [animations, setAnimations] = useState<AnimationInfo[]>([]);
  const animationsRef = useRef(animations);
  animationsRef.current = animations;
  const [animSel, setAnimSel] = useState(0);
  const [animPaused, setAnimPaused] = useState(false);
  const animPausedRef = useRef(animPaused);
  animPausedRef.current = animPaused;
  const [animRate, setAnimRate] = useState(1);
  const animRateRef = useRef(animRate);
  animRateRef.current = animRate;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const persistDebugRef = useRef(persistDebug);
  persistDebugRef.current = persistDebug;

  const toggleDomBp = useCallback((session: DebugSession, nodeId: number, type: DomBreakpointType) => {
    const map = elMapRef.current;
    const selector = map?.has(nodeId) ? buildSelectorPath(map, nodeId) : '';
    void (async () => {
      try {
        await session.enableDebugger();
        const existing = session.debug.domBreakpointsFor(nodeId).includes(type);
        if (existing) await session.removeDomBreakpoint(nodeId, type);
        else if (!selector) {
          setDomErr('cannot set DOM breakpoint: no selector path');
          return;
        } else await session.setDomBreakpoint(nodeId, type, selector);
        persistDebugRef.current?.(session, session.debug.persistState(true));
        setDomErr(undefined);
        notifyRef.current?.(t(existing ? 'toast.domBpRemoved' : 'toast.domBpSet', { type }), existing ? 'info' : 'success');
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const gatherNode = useCallback(async (session: DebugSession, nodeId: number, shownSelector: string): Promise<void> => {
    const map = elMapRef.current;
    const ancestors: string[] = [];
    let p = map?.get(nodeId)?.parentId;
    while (p !== undefined) {
      const info = map?.get(p);
      if (!info) break;
      if (info.isElement) ancestors.push(stripHideClass(info.label));
      p = info.parentId;
    }
    const [outerHTML, computed, matched, box, fonts] = await Promise.all([
      session.outerHTML(nodeId),
      session.computedStyles(nodeId),
      session.matchedRules(nodeId, ancestors),
      session.boxModel(nodeId),
      session.platformFonts(nodeId).catch(() => []),
    ]);
    setDomNode({ selector: shownSelector, nodeId, outerHTML, computed, matched, box, fonts });
  }, []);

  const refreshTreePreserving = useCallback(async (session: DebugSession): Promise<void> => {
    const prevMap = elMapRef.current;
    const depth = prevMap ? Math.max(INITIAL_TREE_DEPTH, mapDepth(prevMap)) : INITIAL_TREE_DEPTH;
    const map = await session.domTree(depth);
    const remap = (id: number): number | null => {
      if (map.has(id)) return id;
      if (!prevMap) return null;
      const path = elementPath(prevMap, id);
      return path ? resolveElementPath(map, path) : null;
    };
    setElExpanded(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        const nid = remap(id);
        if (nid !== null) next.add(nid);
      }
      return next;
    });
    setElSelId(sel => {
      const nid = sel !== null ? remap(sel) : null;
      return nid ?? (visibleNodes(map, new Set())[0] ?? null);
    });
    setElMap(map);
  }, []);

  const revealNode = useCallback((map: NodeMap, nodeId: number) => {
    setElExpanded(prev => {
      const next = new Set(prev);
      let p = map.get(nodeId)?.parentId;
      while (p !== undefined) {
        next.add(p);
        p = map.get(p)?.parentId;
      }
      return next;
    });
    setElSelId(nodeId);
  }, []);

  const reveal = useCallback((nodeId: number) => {
    const map = elMapRef.current;
    if (map?.has(nodeId)) revealNode(map, elementTarget(map, nodeId));
    else setPendingReveal(nodeId);
  }, [revealNode]);

  useEffect(() => {
    if (pendingReveal === null || !elMap?.has(pendingReveal)) return;
    revealNode(elMap, elementTarget(elMap, pendingReveal));
    setPendingReveal(null);
  }, [pendingReveal, elMap, revealNode]);

  const runElSearch = useCallback((session: DebugSession, query: string) => {
    void (async () => {
      try {
        const prev = elSearchHitsRef.current;
        if (prev) void session.discardSearch(prev.id).catch(() => {});
        const { searchId, resultCount } = await session.performSearch(query);
        if (!resultCount) {
          setElSearchHits(null);
          setDomErr(`no match: ${query}`);
          return;
        }
        setElSearchHits({ id: searchId, query, total: resultCount, index: 0 });
        setDomErr(undefined);
        const [nodeId] = await session.searchResults(searchId, 0, 1);
        if (nodeId) reveal(nodeId);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [reveal]);

  const stepSearch = useCallback((session: DebugSession, delta: number) => {
    const s = elSearchHitsRef.current;
    if (!s) return;
    const index = ((s.index + delta) % s.total + s.total) % s.total;
    setElSearchHits({ ...s, index });
    void session.searchResults(s.id, index, index + 1).then(
      ([nodeId]) => {
        if (nodeId) reveal(nodeId);
      },
      e => setDomErr(e instanceof Error ? e.message : String(e)),
    );
  }, [reveal]);

  const clearSearch = useCallback((session?: DebugSession) => {
    const s = elSearchHitsRef.current;
    if (s && session) void session.discardSearch(s.id).catch(() => {});
    setElSearchHits(null);
    setElQuery('');
  }, []);

  const startHints = useCallback((session: DebugSession) => {
    void (async () => {
      try {
        const labels = await session.evalValue(buildShowHintsScript());
        if (!Array.isArray(labels) || labels.length === 0) {
          setDomErr('no clickable elements in view');
          return;
        }
        setHintInput({ labels: labels.map(String), typed: '' });
        setDomErr(undefined);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const typeHint = useCallback((session: DebugSession, ch: string) => {
    const cur = hintInputRef.current;
    if (!cur) return;
    const typed = cur.typed + ch;
    const matching = cur.labels.filter(l => l.startsWith(typed));
    if (!matching.length) return;
    if (matching.length === 1 && matching[0] === typed) {
      setHintInput(null);
      void (async () => {
        try {
          const nodeId = await session.evalNodeId(buildPickHintScript(typed));
          if (nodeId === null) setDomErr('hint target vanished');
          else reveal(nodeId);
        } catch (e) {
          setDomErr(e instanceof Error ? e.message : String(e));
        }
      })();
      return;
    }
    setHintInput({ ...cur, typed });
    void session.evalValue(buildFilterHintsScript(typed)).catch(() => {});
  }, [reveal]);

  const cancelHints = useCallback((session: DebugSession) => {
    setHintInput(null);
    void session.evalValue(buildClearHintsScript()).catch(() => {});
  }, []);

  const loadChildren = useCallback((session: DebugSession, nodeId: number) => {
    void session.requestChildNodes(nodeId, 1).catch(e => setDomErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const expandRecursive = useCallback((rootId: number) => {
    autoExpandRequestedRef.current = new Set();
    setAutoExpandRoot(rootId);
  }, []);

  const collapseRecursive = useCallback((rootId: number) => {
    const map = elMapRef.current;
    if (!map) return;
    setElExpanded(prev => {
      const next = new Set(prev);
      next.delete(rootId);
      for (const id of descendantIds(map, rootId)) next.delete(id);
      return next;
    });
  }, []);

  const centerSelected = useCallback(() => {
    setCenterSeq(s => s + 1);
  }, []);

  const toggleLayoutOverlay = useCallback((session: DebugSession, nodeId: number) => {
    void (async () => {
      try {
        const apply = async (next: Map<number, 'grid' | 'flex'>) => {
          const grid: number[] = [];
          const flex: number[] = [];
          for (const [id, kind] of next) (kind === 'grid' ? grid : flex).push(id);
          await Promise.all([session.setGridOverlays(grid), session.setFlexOverlays(flex)]);
          setOverlayNodes(next);
        };
        const cur = overlayRef.current;
        if (cur.has(nodeId)) {
          const next = new Map(cur);
          next.delete(nodeId);
          await apply(next);
          notifyRef.current?.(t('toast.overlayOff'), 'info');
          return;
        }
        const computed = await session.computedStyles(nodeId);
        const display = computed.find(([k]) => k === 'display')?.[1] ?? '';
        const kind = display.includes('grid') ? ('grid' as const) : display.includes('flex') ? ('flex' as const) : null;
        if (!kind) {
          setDomErr(`not a grid/flex container (display: ${display || 'unknown'})`);
          return;
        }
        const next = new Map(cur);
        next.set(nodeId, kind);
        await apply(next);
        setDomErr(undefined);
        notifyRef.current?.(t('toast.overlayOn', { kind }), 'success');
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const openListeners = useCallback((session: DebugSession, nodeId: number) => {
    void (async () => {
      try {
        const listeners = await session.eventListeners(nodeId);
        setListenersData(listeners);
        setListenersScroll(0);
        setListenersMode(true);
        setDomErr(undefined);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const openClasses = useCallback((session: DebugSession, nodeId: number) => {
    void (async () => {
      try {
        const attrs = await session.getAttributes(nodeId);
        setClassEntries(parseClassEntries(attrs.class));
        setClassesSel(0);
        setClassesInput(null);
        setClassesMode(true);
        setDomErr(undefined);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const classQueueRef = useRef(createSerialQueue());
  const applyClassEntries = useCallback((session: DebugSession, nodeId: number, selector: string, entries: ClassEntry[]) =>
    classQueueRef.current(async () => {
      const attrs = await session.getAttributes(nodeId);
      await session.setClassAttr(nodeId, composeClassAttr(entries, attrs.class));
      setClassEntries(entries);
      setDomErr(undefined);
      await gatherNode(session, nodeId, selector);
    }), [gatherNode]);

  const toggleClassEntry = useCallback((session: DebugSession, nodeId: number, selector: string, index: number) => {
    const cur = classEntriesRef.current;
    if (index < 0 || index >= cur.length) return;
    const next = cur.map((e, i) => (i === index ? { ...e, on: !e.on } : e));
    void applyClassEntries(session, nodeId, selector, next).catch(e => setDomErr(e instanceof Error ? e.message : String(e)));
  }, [applyClassEntries]);

  const addClassEntry = useCallback((session: DebugSession, nodeId: number, selector: string, name: string) => {
    if (!isClassToken(name)) {
      setDomErr(`invalid class name: ${name}`);
      return;
    }
    const cur = classEntriesRef.current;
    const idx = cur.findIndex(e => e.name === name);
    const next = idx >= 0 ? cur.map((e, i) => (i === idx ? { ...e, on: true } : e)) : [...cur, { name, on: true }];
    setClassesSel(idx >= 0 ? idx : next.length - 1);
    void applyClassEntries(session, nodeId, selector, next).catch(e => setDomErr(e instanceof Error ? e.message : String(e)));
  }, [applyClassEntries]);

  const duplicateNode = useCallback((session: DebugSession, nodeId: number) => {
    const map = elMapRef.current;
    const parentId = map?.get(nodeId)?.parentId;
    if (!map || parentId === undefined) {
      setDomErr('cannot duplicate: no parent');
      return;
    }
    const siblings = map.get(parentId)?.childIds ?? [];
    const after = siblings[siblings.indexOf(nodeId) + 1];
    void (async () => {
      try {
        await session.duplicateNode(nodeId, parentId, after);
        await refreshTreePreserving(session);
        setDomErr(undefined);
        notifyRef.current?.(t('toast.nodeDuplicated'), 'success');
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshTreePreserving]);

  const collectOverview = useCallback((session: DebugSession) => {
    setOverviewLoading(true);
    void (async () => {
      try {
        const [agg, medias] = await Promise.all([
          session.evalValue(buildCssOverviewScript()),
          session.mediaQueries().catch(() => []),
        ]);
        setOverviewData(normalizeOverview(agg, medias));
        setDomErr(undefined);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      } finally {
        setOverviewLoading(false);
      }
    })();
  }, []);

  const openCssOverview = useCallback((session: DebugSession) => {
    setOverviewMode(true);
    setOverviewScroll(0);
    collectOverview(session);
  }, [collectOverview]);

  const openAnimations = useCallback(() => {
    setAnimSel(0);
    setAnimMode(true);
  }, []);

  const toggleAnimationsPaused = useCallback((session: DebugSession) => {
    const ids = animationsRef.current.filter(a => a.state !== 'canceled').map(a => a.id);
    const next = !animPausedRef.current;
    void session.setAnimationsPaused(ids, next).then(
      () => {
        setAnimPaused(next);
        setDomErr(undefined);
      },
      e => setDomErr(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const cycleAnimationRate = useCallback((session: DebugSession) => {
    const rates: readonly number[] = PLAYBACK_RATES;
    const next = rates[(rates.indexOf(animRateRef.current) + 1) % rates.length];
    void session.setAnimationPlaybackRate(next).then(
      () => {
        setAnimRate(next);
        setDomErr(undefined);
      },
      e => setDomErr(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const seekAnimation = useCallback((session: DebugSession, a: AnimationInfo, fraction: number) => {
    const time = (a.delay ?? 0) + (a.duration ?? 0) * fraction;
    void session.seekAnimations([a.id], time).then(
      () => setDomErr(undefined),
      e => setDomErr(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    if (!animMode || !attached) return;
    const session = attached.session;
    const onAnim = (method: string, params: any) => {
      if (method === 'Animation.animationStarted') {
        const info = animationFromStarted(params);
        setAnimations(list => upsertAnimation(list, info, ANIMATION_CAP));
        if (info.backendNodeId !== undefined) {
          void session.nodeLabelByBackendId(info.backendNodeId).then(label => {
            if (label) setAnimations(list => list.map(a => (a.id === info.id ? { ...a, nodeLabel: label } : a)));
          });
        }
      } else if (method === 'Animation.animationCreated') {
        const id = String(params?.id ?? '');
        if (id) setAnimations(list => upsertAnimation(list, { id, name: id, type: 'WebAnimation', state: 'created' }, ANIMATION_CAP));
      } else if (method === 'Animation.animationCanceled') {
        setAnimations(list => markAnimationCanceled(list, String(params?.id ?? '')));
      }
    };
    session.on('animation-event', onAnim);
    void session.enableAnimations().catch(e => setDomErr(e instanceof Error ? e.message : String(e)));
    return () => {
      session.off('animation-event', onAnim);
      void session.disableAnimations().catch(() => {});
    };
  }, [animMode, attached?.session]);

  const releaseForcedPseudo = useCallback(() => {
    const f = forcedRef.current;
    if (!f) return;
    forcedRef.current = null;
    setForcedPseudo(0);
    void f.session.forcePseudoState(f.nodeId, []).catch(() => {});
  }, []);

  useEffect(() => {
    setDomNode(null);
    setRuleSelected(-1);
    setDeclSel(-1);
    setDeclEdit(null);
    setComputedMode(false);
    setComputedFilter('');
    setComputedFilterEditing(false);
    setComputedScroll(0);
    releaseForcedPseudo();
    yPendingRef.current = false;
    zPendingRef.current = false;
    domBpPendingRef.current = false;
    setHighlighting(false);
    setWatching(false);
    setElMap(null);
    setElExpanded(new Set());
    setElSelId(null);
    setElSearching(false);
    setElQuery('');
    setElSubview(false);
    setDomErr(undefined);
    setElSearchHits(null);
    setInspecting(false);
    setHintInput(null);
    setPendingReveal(null);
    setAutoExpandRoot(null);
    setOverlayNodes(new Map());
    setListenersMode(false);
    setListenersData([]);
    setListenersScroll(0);
    setClassesMode(false);
    setClassEntries([]);
    setClassesSel(0);
    setClassesInput(null);
    setOverviewMode(false);
    setOverviewData(null);
    setOverviewLoading(false);
    setOverviewScroll(0);
    setAnimMode(false);
    setAnimations([]);
    setAnimSel(0);
    setAnimPaused(false);
    setAnimRate(1);
  }, [attached?.session, releaseForcedPseudo]);

  useEffect(() => {
    if (activeTool === 'elements') return;
    setInspecting(false);
    setHintInput(null);
  }, [activeTool]);

  useEffect(() => {
    const f = forcedRef.current;
    if (!f) return;
    if (activeTool === 'elements' && elSubview && elSelId === f.nodeId) return;
    releaseForcedPseudo();
  }, [activeTool, elSubview, elSelId, releaseForcedPseudo]);

  const applyPseudo = useCallback((session: DebugSession, nodeId: number, selector: string, idx: number) => {
    const classes = idx === 0 ? [] : [PSEUDO_CLASSES[idx - 1]];
    void (async () => {
      try {
        await session.forcePseudoState(nodeId, classes);
        forcedRef.current = idx === 0 ? null : { session, nodeId };
        setForcedPseudo(idx);
        setDomErr(undefined);
        await gatherNode(session, nodeId, selector);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [gatherNode]);

  useEffect(() => {
    if (!watching || !attached) return;
    const session = attached.session;
    const onMutation = () => {
      if (editingRef.current) {
        pendingMutationsRef.current += 1;
        return;
      }
      const buffered = pendingMutationsRef.current;
      pendingMutationsRef.current = 0;
      setMutationCount(c => c + 1 + buffered);
    };
    session.on('dom-mutation', onMutation);
    return () => {
      session.off('dom-mutation', onMutation);
    };
  }, [watching, attached]);

  useEffect(() => {
    if (!attached) return;
    const session = attached.session;
    const onChildNodes = ({ parentId, nodes }: { parentId: number; nodes: unknown[] }) => {
      setElMap(m => (m?.has(parentId) ? applyChildNodes(m, parentId, nodes as any[]) : m));
    };
    session.on('dom-child-nodes', onChildNodes);
    return () => {
      session.off('dom-child-nodes', onChildNodes);
    };
  }, [attached?.session]);

  useEffect(() => {
    if (!attached) return;
    const session = attached.session;
    const onDocumentUpdated = () => {
      setElMap(null);
      setElExpanded(new Set());
      setElSelId(null);
      setDomNode(null);
      setElSubview(false);
      setElSearchHits(null);
      setPendingReveal(null);
      setAutoExpandRoot(null);
      setOverlayNodes(new Map());
      setListenersMode(false);
      setListenersData([]);
      setListenersScroll(0);
      setClassesMode(false);
      setClassEntries([]);
      setClassesSel(0);
      setClassesInput(null);
      setOverviewData(null);
      setOverviewScroll(0);
    };
    session.on('document-updated', onDocumentUpdated);
    return () => {
      session.off('document-updated', onDocumentUpdated);
      const s = elSearchHitsRef.current;
      if (s) void session.discardSearch(s.id).catch(() => {});
    };
  }, [attached?.session]);

  useEffect(() => {
    if (!attached) return;
    const session = attached.session;
    const onInspect = (backendNodeId: number) => {
      setInspecting(false);
      void session.pushNodeByBackendId(backendNodeId).then(
        nodeId => {
          if (nodeId !== null) reveal(nodeId);
        },
        () => {},
      );
    };
    session.on('inspect-node', onInspect);
    return () => {
      session.off('inspect-node', onInspect);
    };
  }, [attached?.session, reveal]);

  useEffect(() => {
    if (!inspecting || !attached) return;
    const session = attached.session;
    void session.setInspectMode(true).catch(e => setDomErr(e instanceof Error ? e.message : String(e)));
    return () => {
      void session.setInspectMode(false).catch(() => {});
    };
  }, [inspecting, attached?.session]);

  const hintActive = hintInput !== null;
  useEffect(() => {
    if (!hintActive || !attached) return;
    const session = attached.session;
    return () => {
      void session.evalValue(buildClearHintsScript()).catch(() => {});
    };
  }, [hintActive, attached?.session]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached || elSelId === null || highlighting) return;
    const session = attached.session;
    const timer = setTimeout(() => {
      void session.highlight(elSelId).catch(() => {});
    }, CURSOR_HIGHLIGHT_MS);
    timer.unref?.();
    return () => clearTimeout(timer);
  }, [activeTool, attached?.session, elSelId, highlighting]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached) return;
    const session = attached.session;
    return () => {
      if (!highlightingRef.current) void session.hideHighlight().catch(() => {});
    };
  }, [activeTool, attached?.session]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached) return;
    const session = attached.session;
    return () => {
      if (!overlayRef.current.size) return;
      void session.setGridOverlays([]).catch(() => {});
      void session.setFlexOverlays([]).catch(() => {});
      setOverlayNodes(new Map());
    };
  }, [activeTool, attached?.session]);

  useEffect(() => {
    if (autoExpandRoot === null || !elMap || !attached) return;
    const session = attached.session;
    const plan = expandTargets(elMap, autoExpandRoot, Z_EXPAND_DEPTH, Z_EXPAND_NODES);
    setElExpanded(prev => {
      const next = new Set(prev);
      for (const id of plan.expandIds) next.add(id);
      return next;
    });
    if (plan.truncated || !plan.loadIds.length) {
      setAutoExpandRoot(null);
      autoExpandRequestedRef.current = new Set();
      if (plan.truncated) notifyRef.current?.(t('toast.expandTruncated', { depth: Z_EXPAND_DEPTH, n: Z_EXPAND_NODES }), 'info');
      return;
    }
    for (const id of plan.loadIds) {
      if (autoExpandRequestedRef.current.has(id)) continue;
      autoExpandRequestedRef.current.add(id);
      void session.requestChildNodes(id, 1).catch(() => {});
    }
  }, [autoExpandRoot, elMap, attached?.session]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached || elMap) return;
    const session = attached.session;
    let cancelled = false;
    void (async () => {
      try {
        const map = await session.domTree(INITIAL_TREE_DEPTH);
        if (cancelled) return;
        const roots = visibleNodes(map, new Set());
        const exp = new Set<number>();
        for (const r of roots) {
          exp.add(r);
          for (const c of map.get(r)?.childIds ?? []) if (map.get(c)?.isElement) exp.add(c);
        }
        setElMap(map);
        setElExpanded(exp);
        setElSelId(roots[0] ?? null);
        setDomErr(undefined);
        void session.watchDomMutations().catch(() => {});
      } catch (e) {
        if (!cancelled) setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [activeTool, attached?.session, elMap]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached || elSelId === null) return;
    void attached.session.setInspectedNode(elSelId).catch(() => {});
  }, [activeTool, attached?.session, elSelId]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached || elSelId === null) return;
    const session = attached.session;
    const timer = setTimeout(() => {
      const label = stripHideClass(elMapRef.current?.get(elSelId)?.label ?? String(elSelId));
      void gatherNode(session, elSelId, label).catch(() => {});
    }, 120);
    timer.unref?.();
    return () => clearTimeout(timer);
  }, [activeTool, attached?.session, elSelId, gatherNode]);

  useEffect(() => {
    if (activeTool !== 'elements' || !attached) return;
    const session = attached.session;
    let timer: NodeJS.Timeout | undefined;
    const onMutation = () => {
      if (editingRef.current || elSubviewRef.current || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refreshTreePreserving(session).catch(() => {});
      }, 1000);
      timer.unref?.();
    };
    session.on('dom-mutation', onMutation);
    return () => {
      session.off('dom-mutation', onMutation);
      if (timer) clearTimeout(timer);
    };
  }, [activeTool, attached?.session, refreshTreePreserving]);

  const applyDecl = () => {
    const ed = declEdit;
    setDeclEdit(null);
    const session = attached?.session;
    if (!ed || !session || !domNode) return;
    const colon = ed.text.indexOf(':');
    const prop = colon >= 0 ? ed.text.slice(0, colon).trim() : '';
    const value = colon >= 0 ? ed.text.slice(colon + 1).trim() : '';
    if (!prop || !value) {
      setDomErr('use prop: value');
      return;
    }
    const nodeId = domNode.nodeId;
    const selector = domNode.selector;
    void (async () => {
      try {
        if (ed.replaceSpan) {
          await session.editRuleStyle(ed.styleSheetId, ed.range, replaceDeclText(ed.cssText, ed.replaceSpan, prop, value));
        } else {
          const base = ed.cssText.trim();
          await session.editRuleStyle(ed.styleSheetId, ed.range, base ? `${base}; ${prop}: ${value}` : `${prop}: ${value}`);
          setRuleSelected(-1);
          setDeclSel(-1);
        }
        setDomErr(undefined);
        await gatherNode(session, nodeId, selector);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  return {
    domNode,
    elMap,
    elExpanded,
    setElExpanded,
    elSelId,
    setElSelId,
    elSearching,
    setElSearching,
    elQuery,
    setElQuery,
    elSubview,
    setElSubview,
    highlighting,
    setHighlighting,
    watching,
    setWatching,
    mutationCount,
    domErr,
    setDomErr,
    ruleSelected,
    setRuleSelected,
    declSel,
    setDeclSel,
    declEdit,
    setDeclEdit,
    computedMode,
    setComputedMode,
    computedFilter,
    setComputedFilter,
    computedFilterEditing,
    setComputedFilterEditing,
    computedScroll,
    setComputedScroll,
    forcedPseudo,
    applyPseudo,
    yPendingRef,
    zPendingRef,
    domBpPendingRef,
    toggleDomBp,
    elSearchHits,
    stepSearch,
    clearSearch,
    inspecting,
    setInspecting,
    hintInput,
    startHints,
    typeHint,
    cancelHints,
    loadChildren,
    expandRecursive,
    collapseRecursive,
    centerSeq,
    centerSelected,
    overlayNodes,
    toggleLayoutOverlay,
    listenersMode,
    setListenersMode,
    openListeners,
    listenersData,
    listenersScroll,
    setListenersScroll,
    classesMode,
    setClassesMode,
    classEntries,
    classesSel,
    setClassesSel,
    classesInput,
    setClassesInput,
    openClasses,
    toggleClassEntry,
    addClassEntry,
    duplicateNode,
    overviewMode,
    setOverviewMode,
    overviewData,
    overviewLoading,
    overviewScroll,
    setOverviewScroll,
    collectOverview,
    openCssOverview,
    animMode,
    setAnimMode,
    animations,
    animSel,
    setAnimSel,
    animPaused,
    animRate,
    openAnimations,
    toggleAnimationsPaused,
    cycleAnimationRate,
    seekAnimation,
    gatherNode,
    refreshTreePreserving,
    runElSearch,
    applyDecl,
  };
}

export type ElementsTool = ReturnType<typeof useElementsTool>;
