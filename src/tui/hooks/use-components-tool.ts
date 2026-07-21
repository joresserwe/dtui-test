import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';
import {
  buildFrameworkHostScript,
  buildFrameworkInspectScript,
  buildFrameworkScanScript,
  parseFrameworkScan,
  type FrameworkNode,
  type FrameworkScanResult,
} from '../lib/framework-script.js';
import type { ConsoleObjectProp } from '../../store/console-format.js';
import type { ConsoleChildren } from '../overlays/ConsoleDetailOverlay.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';
import type { Attached } from './use-session-manager.js';
import type { Tool } from '../panels/ToolTabs.js';

export interface ComponentsToolOpts {
  attached: Attached | null;
  activeTool: Tool;
  notify: (msg: string, level?: ToastLevel) => void;
  whenNotEditing?: (fn: () => void) => void;
  revealObject: (objectId: string) => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ComponentInspect {
  node: FrameworkNode;
  sections: ConsoleObjectProp[];
}

export function useComponentsTool({ attached, activeTool, notify, whenNotEditing = fn => fn(), revealObject }: ComponentsToolOpts) {
  const [compScan, setCompScan] = useState<FrameworkScanResult | null>(null);
  const [compScanning, setCompScanning] = useState(false);
  const [compErr, setCompErr] = useState<string | undefined>();
  const [compSel, setCompSel] = useState(0);
  const [compCollapsed, setCompCollapsed] = useState<Set<number>>(new Set());
  const [compFilter, setCompFilter] = useState('');
  const [compFilterEditing, setCompFilterEditing] = useState(false);
  const [compInspect, setCompInspect] = useState<ComponentInspect | null>(null);
  const [compInspectExpanded, setCompInspectExpanded] = useState<Set<string>>(new Set());
  const [compInspectChildren, setCompInspectChildren] = useState<Map<string, ConsoleChildren>>(new Map());
  const [compInspectCursor, setCompInspectCursor] = useState(0);

  const guard = useRef(whenNotEditing);
  guard.current = whenNotEditing;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const revealRef = useRef(revealObject);
  revealRef.current = revealObject;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const scanningRef = useRef<DebugSession | null>(null);
  const inspectSeqRef = useRef(0);

  const resetInspect = useCallback(() => {
    inspectSeqRef.current++;
    setCompInspect(null);
    setCompInspectExpanded(new Set());
    setCompInspectChildren(new Map());
    setCompInspectCursor(0);
  }, []);

  const closeInspect = useCallback((session?: DebugSession) => {
    resetInspect();
    void session?.releaseFrameworkObjects().catch(() => {});
  }, [resetInspect]);

  const inspectComponent = useCallback((session: DebugSession, node: FrameworkNode, framework: 'react' | 'vue') => {
    if (node.instIdx === undefined) {
      notifyRef.current(t('components.toast.noInstance'));
      return;
    }
    const instIdx = node.instIdx;
    const seq = ++inspectSeqRef.current;
    void (async () => {
      await session.releaseFrameworkObjects().catch(() => {});
      try {
        const sections = await session.frameworkInspect(buildFrameworkInspectScript(framework, instIdx));
        guard.current(() => {
          if (inspectSeqRef.current !== seq) return;
          if (sections === null) {
            notifyRef.current(t('components.toast.staleInstance'), 'error');
            return;
          }
          setCompInspect({ node, sections });
          setCompInspectExpanded(new Set());
          setCompInspectChildren(new Map());
          setCompInspectCursor(0);
        });
      } catch {
        guard.current(() => notifyRef.current(t('components.toast.inspectFailed'), 'error'));
      }
    })();
  }, []);

  const runScan = useCallback((session: DebugSession) => {
    if (scanningRef.current) return;
    scanningRef.current = session;
    resetInspect();
    setCompScanning(true);
    void session.releaseFrameworkObjects().catch(() => {});
    void session.evalValue(buildFrameworkScanScript()).then(
      raw => guard.current(() => {
        setCompScan(parseFrameworkScan(raw));
        setCompErr(undefined);
      }),
      e => guard.current(() => {
        setCompScan({ frameworks: [], errors: [] });
        setCompErr(errText(e));
      }),
    ).finally(() => {
      scanningRef.current = null;
      guard.current(() => setCompScanning(false));
    });
  }, [resetInspect]);

  const rescan = useCallback((session: DebugSession) => {
    setCompCollapsed(new Set());
    setCompSel(0);
    runScan(session);
  }, [runScan]);

  const highlightComponent = useCallback((session: DebugSession, node: FrameworkNode) => {
    if (node.hostIdx === undefined) {
      notifyRef.current(t('components.toast.noElement'));
      return;
    }
    const hostIdx = node.hostIdx;
    void (async () => {
      try {
        const objectId = await session.frameworkHostObjectId(buildFrameworkHostScript(hostIdx));
        if (!objectId) throw new Error('stale host');
        const nodeId = await session.requestNodeEnsured(objectId);
        if (nodeId === null) throw new Error('no node');
        await session.highlight(nodeId);
        guard.current(() => notifyRef.current(t('components.toast.highlighted', { name: node.name }), 'success'));
      } catch {
        guard.current(() => notifyRef.current(t('components.toast.highlightFailed'), 'error'));
      }
    })();
  }, []);

  const revealComponent = useCallback((session: DebugSession, node: FrameworkNode) => {
    if (node.hostIdx === undefined) {
      notifyRef.current(t('components.toast.noElement'));
      return;
    }
    void session.frameworkHostObjectId(buildFrameworkHostScript(node.hostIdx)).then(
      objectId => guard.current(() => {
        if (objectId) revealRef.current(objectId);
        else notifyRef.current(t('components.toast.revealFailed'), 'error');
      }),
      () => guard.current(() => notifyRef.current(t('components.toast.revealFailed'), 'error')),
    );
  }, []);

  useEffect(() => {
    setCompScan(null);
    setCompScanning(false);
    setCompErr(undefined);
    setCompSel(0);
    setCompCollapsed(new Set());
    setCompFilter('');
    setCompFilterEditing(false);
    resetInspect();
    scanningRef.current = null;
  }, [attached?.session, resetInspect]);

  useEffect(() => {
    if (activeTool !== 'components' || !attached || compScan !== null) return;
    runScan(attached.session);
  }, [activeTool, attached?.session, compScan, runScan]);

  useEffect(() => {
    if (activeTool !== 'components' || !attached) return;
    const session = attached.session;
    return () => {
      void session.hideHighlight().catch(() => {});
      closeInspect(session);
    };
  }, [activeTool, attached?.session, closeInspect]);

  useEffect(() => {
    const session = attached?.session;
    if (!session) return;
    const onNav = () => {
      void session.releaseFrameworkObjects().catch(() => {});
      guard.current(() => {
        setCompScan(null);
        setCompErr(undefined);
        setCompSel(0);
        setCompCollapsed(new Set());
        resetInspect();
      });
    };
    const onTiming = () => {
      if (session.pageTiming.loadMs === undefined || activeToolRef.current !== 'components') return;
      runScan(session);
    };
    session.on('document-updated', onNav);
    session.on('frame-navigated', onNav);
    session.on('page-timing', onTiming);
    return () => {
      session.off('document-updated', onNav);
      session.off('frame-navigated', onNav);
      session.off('page-timing', onTiming);
    };
  }, [attached?.session, runScan, resetInspect]);

  const compTree = compScan?.frameworks[0] ?? null;
  const compExtraFrameworks = Math.max(0, (compScan?.frameworks.length ?? 0) - 1);

  return {
    compScan,
    compTree,
    compExtraFrameworks,
    compScanning,
    compErr,
    setCompErr,
    compSel,
    setCompSel,
    compCollapsed,
    setCompCollapsed,
    compFilter,
    setCompFilter,
    compFilterEditing,
    setCompFilterEditing,
    runScan,
    rescan,
    highlightComponent,
    revealComponent,
    compInspect,
    compInspectExpanded,
    setCompInspectExpanded,
    compInspectChildren,
    setCompInspectChildren,
    compInspectCursor,
    setCompInspectCursor,
    inspectComponent,
    closeInspect,
  };
}

export type ComponentsTool = ReturnType<typeof useComponentsTool>;
