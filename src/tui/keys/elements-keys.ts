import type { Key } from 'ink';
import { visibleNodes } from '../panels/ElementsPanel.js';
import { computedRowBudget } from '../overlays/DomOverlay.js';
import { CSS_OVERVIEW_CHROME, overviewRows } from '../overlays/CssOverviewView.js';
import type { ListNav } from '../lib/keys.js';
import type { Attached } from '../hooks/use-session-manager.js';
import { PSEUDO_CLASSES, type ElementsTool } from '../hooks/use-elements-tool.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import type { NodeMap } from '../../cdp/domtree.js';
import { stripHideClass } from '../../cdp/dom.js';
import type { StyleRange } from '../../cdp/css.js';
import { flatDecls, incrementValue, rangeSpan, replaceDeclText, ruleDecls, toggleDeclText } from '../lib/style-edit.js';
import { buildSelectorPath } from '../lib/selector-path.js';
import { runAgentCmd, writeHandoffBundle } from '../lib/handoff.js';
import { loadConfig } from '../../config.js';
import { t } from '../lib/i18n.js';

export interface ElementsKeyCtx {
  el: ElementsTool;
  attached: Attached | null;
  bodyH: number;
  listNav: ListNav;
  quit: () => void;
  setToast: (msg: string, level?: ToastLevel) => void;
  withEditor: (initial: string, ext?: string) => Promise<string | null>;
  copyFn: (text: string) => Promise<void>;
}

const INCREMENTS: Record<string, number> = { ']': 1, '[': -1, '}': 10, '{': -10 };

function elementParentOf(map: NodeMap, id: number): number | undefined {
  let p = map.get(id)?.parentId;
  while (p !== undefined && !map.get(p)?.isElement) p = map.get(p)?.parentId;
  return p;
}

export function handleElementsKey(ctx: ElementsKeyCtx, input: string, key: Key): boolean {
  const { el, attached, bodyH, listNav, quit, setToast, withEditor, copyFn } = ctx;
  const {
    domNode,
    elMap,
    elExpanded,
    setElExpanded,
    elSelId,
    setElSelId,
    setElSearching,
    setElQuery,
    elSubview,
    setElSubview,
    highlighting,
    setHighlighting,
    watching,
    setWatching,
    setDomErr,
    ruleSelected,
    setRuleSelected,
    declSel,
    setDeclSel,
    setDeclEdit,
    computedMode,
    setComputedMode,
    computedFilter,
    setComputedFilter,
    setComputedFilterEditing,
    setComputedScroll,
    gatherNode,
    refreshTreePreserving,
  } = el;
  const session = attached?.session;
  if (!session) {
    if (input === 'q') quit();
    return true;
  }
  if (el.hintInput) {
    if (key.escape) {
      el.cancelHints(session);
      return true;
    }
    if (input && !key.ctrl && !key.meta) el.typeHint(session, input);
    return true;
  }
  if (el.overviewMode) {
    if (key.escape) {
      el.setOverviewMode(false);
      el.setOverviewScroll(0);
      return true;
    }
    if (input === 'r') {
      el.collectOverview(session);
      return true;
    }
    const budget = Math.max(1, bodyH - CSS_OVERVIEW_CHROME);
    const maxScroll = Math.max(0, overviewRows(el.overviewData).length - budget);
    const page = Math.max(1, Math.floor(budget / 2));
    if (input === 'j' || key.downArrow) {
      el.setOverviewScroll(s => Math.min(s + 1, maxScroll));
      return true;
    }
    if (input === 'k' || key.upArrow) {
      el.setOverviewScroll(s => Math.max(0, s - 1));
      return true;
    }
    if (key.ctrl && input === 'd') {
      el.setOverviewScroll(s => Math.min(s + page, maxScroll));
      return true;
    }
    if (key.ctrl && input === 'u') {
      el.setOverviewScroll(s => Math.max(0, s - page));
      return true;
    }
    if (input === 'q') quit();
    return true;
  }
  if (el.animMode) {
    if (key.escape) {
      el.setAnimMode(false);
      return true;
    }
    const len = el.animations.length;
    if (input === 'j' || key.downArrow) {
      el.setAnimSel(s => Math.min(s + 1, Math.max(0, len - 1)));
      return true;
    }
    if (input === 'k' || key.upArrow) {
      el.setAnimSel(s => Math.max(0, s - 1));
      return true;
    }
    if (input === ' ') {
      el.toggleAnimationsPaused(session);
      return true;
    }
    if (input === 'r') {
      el.cycleAnimationRate(session);
      return true;
    }
    if (input >= '0' && input <= '9') {
      const a = el.animations[Math.max(0, Math.min(el.animSel, len - 1))];
      if (a) el.seekAnimation(session, a, Number(input) / 10);
      return true;
    }
    if (input === 'q') quit();
    return true;
  }
  const synthesize = (nodeId: number, kind: 'click' | 'hover') => {
    const label = elMap?.get(nodeId)?.label ?? (domNode?.nodeId === nodeId ? domNode.selector : String(nodeId));
    const subviewSelector = elSubview && domNode?.nodeId === nodeId ? domNode.selector : null;
    void (async () => {
      try {
        if (kind === 'click') await session.clickNode(nodeId);
        else await session.hoverNode(nodeId);
        setDomErr(undefined);
        setToast(t(kind === 'click' ? 'toast.clickSynth' : 'toast.hoverSynth', { label }), 'success');
        if (kind === 'hover' && subviewSelector !== null) await gatherNode(session, nodeId, subviewSelector);
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  };
  const toggleHighlight = (nodeId: number) => {
    if (highlighting) {
      void session.hideHighlight().catch(() => {});
      setHighlighting(false);
    } else {
      void session.highlight(nodeId).catch(() => {});
      setHighlighting(true);
    }
  };
  const copyText = (text: string, msg: string) => {
    void copyFn(text).then(
      () => setToast(msg, 'success'),
      () => setToast(t('toast.copyFailed'), 'error'),
    );
  };
  const copySelector = (nodeId: number) => {
    if (elMap?.has(nodeId)) copyText(buildSelectorPath(elMap, nodeId), t('toast.selectorCopied'));
    else if (domNode && domNode.nodeId === nodeId) copyText(domNode.selector, t('toast.selectorCopied'));
  };
  const copyOuterHtml = (nodeId: number) => {
    void session.outerHTML(nodeId).then(
      html => copyText(html, t('toast.htmlCopied')),
      e => setDomErr(e instanceof Error ? e.message : String(e)),
    );
  };
  const handoffBundle = (nodeId: number) => {
    const selector = elMap?.has(nodeId)
      ? buildSelectorPath(elMap, nodeId)
      : domNode?.nodeId === nodeId
        ? domNode.selector
        : String(nodeId);
    void (async () => {
      try {
        const { dir, missing } = await writeHandoffBundle(session, nodeId, selector);
        const agentCmd = loadConfig().agentCmd;
        if (agentCmd) runAgentCmd(agentCmd, dir, msg => setToast(t('toast.agentCmdFailed', { error: msg }), 'error'));
        const copied = await copyFn(dir).then(() => true, () => false);
        setDomErr(undefined);
        setToast(
          missing.length
            ? t('toast.handoffPartial', { missing: missing.join(', '), dir })
            : copied
              ? t('toast.handoffSavedCopied', { dir })
              : t('toast.handoffSaved', { dir }),
          'success',
        );
      } catch (e) {
        setToast(t('toast.handoffFailed', { error: e instanceof Error ? e.message : String(e) }), 'error');
      }
    })();
  };
  const toggleHide = (nodeId: number) => {
    const inSubview = elSubview;
    const selector = domNode?.selector;
    void (async () => {
      try {
        const hidden = await session.toggleNodeVisibility(nodeId);
        await refreshTreePreserving(session);
        if (inSubview && domNode?.nodeId === nodeId) await gatherNode(session, nodeId, selector ?? String(nodeId));
        setDomErr(undefined);
        setToast(t(hidden ? 'toast.nodeHidden' : 'toast.nodeShown'), 'success');
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  };
  const editAttrs = (nodeId: number) => {
    const inSubview = elSubview;
    const selector = domNode?.selector;
    void (async () => {
      try {
        const attrs = await session.getAttributes(nodeId);
        const initial = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join('\n');
        const edited = await withEditor(initial, 'txt');
        if (edited === null) return;
        const text = edited.split('\n').map(l => l.trim()).filter(Boolean).join(' ');
        await session.setAttributesAsText(nodeId, text);
        await refreshTreePreserving(session);
        if (inSubview) await gatherNode(session, nodeId, selector ?? String(nodeId));
        setDomErr(undefined);
        setToast(t('toast.attrsEdited'), 'success');
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
  };
  if (elSubview && domNode) {
    if (el.classesMode) {
      if (el.classesInput !== null) return true;
      if (key.escape || input === ',') {
        el.setClassesMode(false);
        el.setClassesSel(0);
        return true;
      }
      const len = el.classEntries.length;
      if (input === 'j' || key.downArrow) {
        el.setClassesSel(s => Math.min(s + 1, Math.max(0, len - 1)));
        return true;
      }
      if (input === 'k' || key.upArrow) {
        el.setClassesSel(s => Math.max(0, s - 1));
        return true;
      }
      if (input === ' ') {
        el.toggleClassEntry(session, domNode.nodeId, domNode.selector, el.classesSel);
        return true;
      }
      if (input === 'a') {
        el.setClassesInput('');
        return true;
      }
      if (input === 'q') quit();
      return true;
    }
    if (el.yPendingRef.current) {
      el.yPendingRef.current = false;
      if (input === 's') {
        copySelector(domNode.nodeId);
        return true;
      }
      if (input === 'h' || input === 'y') {
        copyOuterHtml(domNode.nodeId);
        return true;
      }
      if (input === 'b') {
        handoffBundle(domNode.nodeId);
        return true;
      }
    } else if (input === 'y') {
      el.yPendingRef.current = true;
      return true;
    }
    if (computedMode) {
      if (key.escape || input === 'C') {
        setComputedMode(false);
        setComputedFilter('');
        setComputedScroll(0);
        return true;
      }
      if (input === '/') {
        setComputedFilterEditing(true);
        setComputedFilter('');
        setComputedScroll(0);
        return true;
      }
      const q = computedFilter.trim().toLowerCase();
      const len = domNode.computed.filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q)).length;
      const rows = computedRowBudget(bodyH);
      const maxScroll = Math.max(0, len - rows);
      const page = Math.max(1, Math.floor(rows / 2));
      if (input === 'j' || key.downArrow) {
        setComputedScroll(s => Math.min(s + 1, maxScroll));
        return true;
      }
      if (input === 'k' || key.upArrow) {
        setComputedScroll(s => Math.max(0, s - 1));
        return true;
      }
      if (key.ctrl && input === 'd') {
        setComputedScroll(s => Math.min(s + page, maxScroll));
        return true;
      }
      if (key.ctrl && input === 'u') {
        setComputedScroll(s => Math.max(0, s - page));
        return true;
      }
      if (input === 'q') quit();
      return true;
    }
    if (el.listenersMode) {
      if (key.escape || input === 'L') {
        el.setListenersMode(false);
        el.setListenersScroll(0);
        return true;
      }
      const rows = computedRowBudget(bodyH);
      const maxScroll = Math.max(0, el.listenersData.length - rows);
      const page = Math.max(1, Math.floor(rows / 2));
      if (input === 'j' || key.downArrow) {
        el.setListenersScroll(s => Math.min(s + 1, maxScroll));
        return true;
      }
      if (input === 'k' || key.upArrow) {
        el.setListenersScroll(s => Math.max(0, s - 1));
        return true;
      }
      if (key.ctrl && input === 'd') {
        el.setListenersScroll(s => Math.min(s + page, maxScroll));
        return true;
      }
      if (key.ctrl && input === 'u') {
        el.setListenersScroll(s => Math.max(0, s - page));
        return true;
      }
      if (input === 'q') quit();
      return true;
    }
    if (key.escape) {
      setElSubview(false);
      setRuleSelected(-1);
      setDeclSel(-1);
      return true;
    }
    if (input === 'L') {
      el.openListeners(session, domNode.nodeId);
      return true;
    }
    if (input === ',') {
      el.openClasses(session, domNode.nodeId);
      return true;
    }
    if (input === '.') {
      synthesize(domNode.nodeId, 'click');
      return true;
    }
    if (input === ';') {
      synthesize(domNode.nodeId, 'hover');
      return true;
    }
    if (input === 'o') {
      el.toggleLayoutOverlay(session, domNode.nodeId);
      return true;
    }
    const flat = flatDecls(domNode.matched);
    const declRef = declSel >= 0 && declSel < flat.length ? flat[declSel] : null;
    const moveDecl = (delta: number) => {
      if (!flat.length) return;
      const next = declSel < 0 ? 0 : Math.max(0, Math.min(declSel + delta, flat.length - 1));
      setDeclSel(next);
      setRuleSelected(flat[next].rule);
    };
    if (input === 'j' || key.downArrow) {
      moveDecl(1);
      return true;
    }
    if (input === 'k' || key.upArrow) {
      moveDecl(-1);
      return true;
    }
    if (input === 'r') {
      const n = domNode.matched.length;
      if (n > 0) {
        const next = ruleSelected < 0 ? 0 : (ruleSelected + 1) % n;
        setRuleSelected(next);
        setDeclSel(flat.findIndex(x => x.rule === next));
      }
      return true;
    }
    const declTarget = () => {
      if (!declRef) return null;
      const rule = domNode.matched[declRef.rule];
      const d = ruleDecls(rule)[declRef.decl];
      if (rule.styleSheetId === undefined || rule.ruleRange === undefined || !d.range) {
        setDomErr('rule is read-only');
        return null;
      }
      const span = rangeSpan(rule.cssText, rule.ruleRange, d.range);
      if (!span) {
        setDomErr('rule is read-only');
        return null;
      }
      return { rule, d, span, styleSheetId: rule.styleSheetId, ruleRange: rule.ruleRange };
    };
    const applyCssText = (styleSheetId: string, ruleRange: StyleRange, text: string) => {
      void (async () => {
        try {
          await session.editRuleStyle(styleSheetId, ruleRange, text);
          setDomErr(undefined);
          await gatherNode(session, domNode.nodeId, domNode.selector);
        } catch (e) {
          setDomErr(e instanceof Error ? e.message : String(e));
        }
      })();
    };
    if (input === ' ') {
      const tgt = declTarget();
      if (tgt) applyCssText(tgt.styleSheetId, tgt.ruleRange, toggleDeclText(tgt.rule.cssText, tgt.span, tgt.d.disabled));
      return true;
    }
    if (input === 'i') {
      const tgt = declTarget();
      if (tgt) {
        setDomErr(undefined);
        setDeclEdit({
          text: `${tgt.d.name}: ${tgt.d.value}`,
          prefix: null,
          matchIdx: -1,
          styleSheetId: tgt.styleSheetId,
          range: tgt.ruleRange,
          cssText: tgt.rule.cssText,
          replaceSpan: tgt.span,
        });
      }
      return true;
    }
    if (INCREMENTS[input] !== undefined) {
      if (declRef) {
        const tgt = declTarget();
        if (tgt) {
          const next = incrementValue(tgt.d.value, INCREMENTS[input]);
          if (next !== null) applyCssText(tgt.styleSheetId, tgt.ruleRange, replaceDeclText(tgt.rule.cssText, tgt.span, tgt.d.name, next));
        }
      }
      return true;
    }
    if (input === 'C') {
      setComputedMode(true);
      setComputedScroll(0);
      return true;
    }
    if (input === 'p') {
      el.applyPseudo(session, domNode.nodeId, domNode.selector, (el.forcedPseudo + 1) % (PSEUDO_CLASSES.length + 1));
      return true;
    }
    if (input === 'A') {
      editAttrs(domNode.nodeId);
      return true;
    }
    if (input === 'c') {
      const rule = domNode.matched[ruleSelected];
      if (rule) {
        if (rule.styleSheetId === undefined || rule.ruleRange === undefined) {
          setDomErr('rule is read-only');
        } else {
          const styleSheetId = rule.styleSheetId;
          const ruleRange = rule.ruleRange;
          void (async () => {
            try {
              const edited = await withEditor(rule.cssText, 'css');
              if (edited === null) return;
              await session.editRuleStyle(styleSheetId, ruleRange, edited);
              setDomErr(undefined);
              setRuleSelected(-1);
              setDeclSel(-1);
              await gatherNode(session, domNode.nodeId, domNode.selector);
            } catch (e) {
              setDomErr(e instanceof Error ? e.message : String(e));
            }
          })();
        }
      }
      return true;
    }
    if (input === 'a') {
      const rule = domNode.matched[ruleSelected];
      if (rule) {
        if (rule.styleSheetId === undefined || rule.ruleRange === undefined) {
          setDomErr('rule is read-only');
        } else {
          setDomErr(undefined);
          setDeclEdit({ text: '', prefix: null, matchIdx: -1, styleSheetId: rule.styleSheetId, range: rule.ruleRange, cssText: rule.cssText });
        }
      }
      return true;
    }
    if (input === '+') {
      void (async () => {
        try {
          const edited = await withEditor(`${domNode.selector} { \n}`, 'css');
          if (edited === null) return;
          const m = edited.match(/^([^{]*)\{([\s\S]*)\}\s*$/);
          if (!m) {
            setDomErr('could not parse rule: expected selector { declarations }');
            return;
          }
          const selector = m[1].trim() || domNode.selector;
          const body = m[2].trim();
          if (!body) return;
          await session.addCssRule(selector, body);
          setDomErr(undefined);
          setRuleSelected(-1);
          setDeclSel(-1);
          await gatherNode(session, domNode.nodeId, domNode.selector);
        } catch (e) {
          setDomErr(e instanceof Error ? e.message : String(e));
        }
      })();
      return true;
    }
    if (input === 'e') {
      void (async () => {
        try {
          const fresh = await session.outerHTML(domNode.nodeId);
          const edited = await withEditor(fresh);
          if (edited === null) return;
          await session.setOuterHTML(domNode.nodeId, edited);
          await refreshTreePreserving(session);
          setElSubview(false);
          setDomErr(undefined);
          setRuleSelected(-1);
          setDeclSel(-1);
          setToast(t('toast.htmlEdited'), 'success');
        } catch (e) {
          setDomErr(e instanceof Error ? e.message : String(e));
        }
      })();
      return true;
    }
    if (input === 'H') {
      toggleHide(domNode.nodeId);
      return true;
    }
    if (input === 'D') {
      el.duplicateNode(session, domNode.nodeId);
      return true;
    }
    if (input === 'P') {
      toggleHighlight(domNode.nodeId);
      return true;
    }
    if (input === 'q') quit();
    return true;
  }
  if (el.yPendingRef.current) {
    el.yPendingRef.current = false;
    if (elSelId !== null) {
      if (input === 's') {
        copySelector(elSelId);
        return true;
      }
      if (input === 'h' || input === 'y') {
        copyOuterHtml(elSelId);
        return true;
      }
      if (input === 'b') {
        handoffBundle(elSelId);
        return true;
      }
    }
  } else if (input === 'y' && elSelId !== null && elMap) {
    el.yPendingRef.current = true;
    return true;
  }
  if (key.escape) {
    if (el.inspecting) el.setInspecting(false);
    else if (el.elSearchHits) el.clearSearch(session);
    else setDomErr(undefined);
    return true;
  }
  if (input === 'q') {
    quit();
    return true;
  }
  if (input === '/') {
    setElSearching(true);
    setElQuery('');
    return true;
  }
  if (input === 'm') {
    if (!watching) void session.watchDomMutations().catch(() => {});
    setWatching(w => !w);
    return true;
  }
  if (input === 'I') {
    el.setInspecting(v => !v);
    return true;
  }
  if (input === 'f') {
    el.startHints(session);
    return true;
  }
  if (input === 'n' && el.elSearchHits) {
    el.stepSearch(session, 1);
    return true;
  }
  if (input === 'N' && el.elSearchHits) {
    el.stepSearch(session, -1);
    return true;
  }
  if (!elMap) return true;
  if (el.zPendingRef.current) {
    el.zPendingRef.current = false;
    if (input === 'R' && elSelId !== null) {
      el.expandRecursive(elSelId);
      return true;
    }
    if (input === 'M' && elSelId !== null) {
      el.collapseRecursive(elSelId);
      return true;
    }
    if (input === 'z') {
      el.centerSelected();
      return true;
    }
    return true;
  }
  if (input === 'z') {
    el.zPendingRef.current = true;
    return true;
  }
  if (el.domBpPendingRef.current) {
    el.domBpPendingRef.current = false;
    if (elSelId !== null) {
      if (input === 's') {
        el.toggleDomBp(session, elSelId, 'subtree-modified');
        return true;
      }
      if (input === 'a') {
        el.toggleDomBp(session, elSelId, 'attribute-modified');
        return true;
      }
      if (input === 'r') {
        el.toggleDomBp(session, elSelId, 'node-removed');
        return true;
      }
    }
    return true;
  }
  if (input === 'b' && elSelId !== null) {
    el.domBpPendingRef.current = true;
    return true;
  }
  if (input === '.' && elSelId !== null) {
    synthesize(elSelId, 'click');
    return true;
  }
  if (input === ';' && elSelId !== null) {
    synthesize(elSelId, 'hover');
    return true;
  }
  if (input === 'o' && elSelId !== null) {
    el.toggleLayoutOverlay(session, elSelId);
    return true;
  }
  if (input === 'A' && elSelId !== null) {
    editAttrs(elSelId);
    return true;
  }
  if (input === 'D' && elSelId !== null) {
    el.duplicateNode(session, elSelId);
    return true;
  }
  if (input === 'x' && elSelId !== null) {
    const target = elSelId;
    const parent = elementParentOf(elMap, target);
    void (async () => {
      try {
        await session.removeNode(target);
        if (parent !== undefined) setElSelId(parent);
        await refreshTreePreserving(session);
        setDomErr(undefined);
        setToast(t('toast.nodeDeleted'), 'success');
      } catch (e) {
        setDomErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return true;
  }
  const visible = visibleNodes(elMap, elExpanded);
  if (!visible.length) return true;
  const idx = elSelId !== null ? Math.max(0, visible.indexOf(elSelId)) : 0;
  const setByIndex = (fn: (i: number) => number) => {
    const next = Math.max(0, Math.min(fn(idx), visible.length - 1));
    setElSelId(visible[next]);
  };
  const page = Math.max(1, Math.floor((bodyH - 10) / 2));
  if (listNav(input, key, visible.length, setByIndex, page)) return true;
  if ((input === 'l' || key.rightArrow) && elSelId !== null) {
    const info = elMap.get(elSelId);
    if (info?.hasUnloadedChildren) {
      const id = elSelId;
      el.loadChildren(session, id);
      setElExpanded(prev => new Set(prev).add(id));
      return true;
    }
    const kids = (info?.childIds ?? []).filter(k => elMap.get(k)?.isElement);
    if (!kids.length) return true;
    if (!elExpanded.has(elSelId)) {
      const id = elSelId;
      setElExpanded(prev => new Set(prev).add(id));
    } else {
      setElSelId(kids[0]);
    }
    return true;
  }
  if ((input === 'h' || key.leftArrow) && elSelId !== null) {
    if (elExpanded.has(elSelId)) {
      const id = elSelId;
      setElExpanded(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      const p = elMap.get(elSelId)?.parentId;
      if (p !== undefined && elMap.get(p)?.isElement) setElSelId(p);
    }
    return true;
  }
  if (key.return && elSelId !== null) {
    if (domNode && domNode.nodeId === elSelId) {
      setElSubview(true);
    } else {
      void gatherNode(session, elSelId, stripHideClass(elMap.get(elSelId)?.label ?? String(elSelId)))
        .then(() => setElSubview(true))
        .catch(e => setDomErr(e instanceof Error ? e.message : String(e)));
    }
    return true;
  }
  if (input === 'H' && elSelId !== null) {
    toggleHide(elSelId);
    return true;
  }
  if (input === 'P' && elSelId !== null) {
    toggleHighlight(elSelId);
    return true;
  }
  return true;
}
