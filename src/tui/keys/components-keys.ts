import type { Key } from 'ink';
import type { DebugSession } from '../../engine.js';
import type { ListNav } from '../lib/keys.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import type { Attached } from '../hooks/use-session-manager.js';
import type { ComponentsTool } from '../hooks/use-components-tool.js';
import { COMPONENTS_CHROME, componentInspectRoots, componentParentIds, componentVisibleRows } from '../panels/ComponentsPanel.js';
import { objectTreeLines, objectTreeSubtreeText } from '../overlays/ConsoleDetailOverlay.js';
import { t } from '../lib/i18n.js';

export interface ComponentsKeyCtx {
  comp: ComponentsTool;
  attached: Attached | null;
  bodyH: number;
  listNav: ListNav;
  setToast: (msg: string, level?: ToastLevel) => void;
  copyFn: (text: string) => Promise<void>;
  whenNotEditing: (fn: () => void) => void;
}

function handleInspectKey(ctx: ComponentsKeyCtx, input: string, key: Key, session: DebugSession): boolean {
  const { comp, bodyH, listNav, setToast, copyFn, whenNotEditing } = ctx;
  const inspect = comp.compInspect!;
  const tree = { expanded: comp.compInspectExpanded, children: comp.compInspectChildren };
  const roots = componentInspectRoots(inspect.sections);
  const lines = objectTreeLines(roots, tree);
  const cursor = Math.min(comp.compInspectCursor, Math.max(0, lines.length - 1));
  const node = lines[cursor]?.node;

  if (key.escape) {
    comp.closeInspect(session);
    return true;
  }
  if (input === 'r') {
    comp.rescan(session);
    return true;
  }
  const collapseNode = () => {
    if (!node || !comp.compInspectExpanded.has(node.path)) return;
    comp.setCompInspectExpanded(prev => {
      const next = new Set(prev);
      next.delete(node.path);
      return next;
    });
  };
  const expandNode = () => {
    if (!node || comp.compInspectExpanded.has(node.path)) return;
    const open = () => comp.setCompInspectExpanded(prev => new Set(prev).add(node.path));
    if (comp.compInspectChildren.has(node.objectId)) {
      open();
      return;
    }
    void session.getProperties(node.objectId).then(
      props => whenNotEditing(() => {
        comp.setCompInspectChildren(prev => new Map(prev).set(node.objectId, props));
        open();
      }),
      () => whenNotEditing(() => {
        comp.setCompInspectChildren(prev => new Map(prev).set(node.objectId, 'stale'));
        open();
      }),
    );
  };
  if (key.return || input === ' ') {
    if (node) {
      if (comp.compInspectExpanded.has(node.path)) collapseNode();
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
  if (input === 's' && node) {
    void session.storeAsGlobal(node.objectId).then(
      name => whenNotEditing(() => setToast(t('toast.storedAsGlobal', { name }), 'success')),
      () => whenNotEditing(() => setToast(t('toast.storeGlobalFailed'), 'error')),
    );
    return true;
  }
  if (input === 'y' && node) {
    const text = objectTreeSubtreeText(roots, tree, node.path);
    if (text !== undefined) {
      void copyFn(text).then(
        () => setToast(t('toast.copied'), 'success'),
        () => setToast(t('toast.copyFailed'), 'error'),
      );
    }
    return true;
  }
  const page = Math.max(1, Math.floor((bodyH - COMPONENTS_CHROME) / 2));
  listNav(input, key, lines.length, comp.setCompInspectCursor, page);
  return true;
}

export function handleComponentsKey(ctx: ComponentsKeyCtx, input: string, key: Key): boolean {
  const { comp, attached, bodyH, listNav } = ctx;
  if (!attached) return false;
  const session = attached.session;

  if (comp.compInspect) return handleInspectKey(ctx, input, key, session);

  if (input === 'r') {
    comp.rescan(session);
    return true;
  }

  const tree = comp.compTree;
  if (!tree) {
    if (key.escape && comp.compErr) {
      comp.setCompErr(undefined);
      return true;
    }
    return false;
  }

  if (input === '/') {
    comp.setCompFilterEditing(true);
    return true;
  }
  if (key.escape) {
    if (comp.compFilter) {
      comp.setCompFilter('');
      comp.setCompSel(0);
      return true;
    }
    return false;
  }

  const rows = componentVisibleRows(tree, comp.compFilter, comp.compCollapsed);
  if (!rows.length) return false;
  const selIdx = Math.min(comp.compSel, rows.length - 1);
  const sel = rows[selIdx];
  const filtering = comp.compFilter !== '';

  if ((input === 'l' || key.rightArrow) && !filtering) {
    const parents = componentParentIds(tree.nodes);
    if (!parents.has(sel.id)) return true;
    if (comp.compCollapsed.has(sel.id)) {
      comp.setCompCollapsed(prev => {
        const next = new Set(prev);
        next.delete(sel.id);
        return next;
      });
    } else {
      const childIdx = rows.findIndex(r => r.parentId === sel.id);
      if (childIdx >= 0) comp.setCompSel(childIdx);
    }
    return true;
  }
  if ((input === 'h' || key.leftArrow) && !filtering) {
    const parents = componentParentIds(tree.nodes);
    if (parents.has(sel.id) && !comp.compCollapsed.has(sel.id)) {
      comp.setCompCollapsed(prev => new Set(prev).add(sel.id));
      return true;
    }
    if (sel.parentId !== null) {
      const parentIdx = rows.findIndex(r => r.id === sel.parentId);
      if (parentIdx >= 0) comp.setCompSel(parentIdx);
    }
    return true;
  }
  if (input === 'H') {
    if (!comp.compScanning) comp.highlightComponent(session, sel);
    return true;
  }
  if (input === 'i') {
    if (!comp.compScanning) comp.inspectComponent(session, sel, tree.framework);
    return true;
  }
  if (key.return) {
    if (!comp.compScanning) comp.revealComponent(session, sel);
    return true;
  }

  const page = Math.max(1, Math.floor((bodyH - COMPONENTS_CHROME) / 2));
  if (listNav(input, key, rows.length, comp.setCompSel, page)) return true;

  return false;
}
