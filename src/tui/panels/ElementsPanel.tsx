import React, { useRef } from 'react';
import { Box, Text } from 'ink';
import type { NodeMap } from '../../cdp/domtree.js';
import { HIDE_CLASS, stripHideClass } from '../../cdp/dom.js';
import { boxLine, type DomNodeView } from '../overlays/DomOverlay.js';
import { truncate } from '../lib/format.js';
import { clampWindowStart, padRows } from '../lib/list-window.js';
import { highlightLabel, segsToNodes } from '../lib/highlight.js';
import { INTERESTING_STYLES } from '../lib/session-context.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export function visibleNodes(map: NodeMap, expanded: Set<number>): number[] {
  const hasElementAncestor = (id: number): boolean => {
    let pid = map.get(id)?.parentId;
    while (pid !== undefined) {
      const p = map.get(pid);
      if (!p) return false;
      if (p.isElement) return true;
      pid = p.parentId;
    }
    return false;
  };
  const out: number[] = [];
  const visit = (id: number): void => {
    const info = map.get(id);
    if (!info) return;
    out.push(id);
    if (expanded.has(id)) {
      for (const cid of info.childIds) if (map.get(cid)?.isElement) visit(cid);
    }
  };
  for (const info of map.values()) {
    if (info.isElement && !hasElementAncestor(info.nodeId)) visit(info.nodeId);
  }
  return out;
}

export interface ElementsPanelProps {
  map: NodeMap | null;
  expanded: Set<number>;
  selectedId: number | null;
  detail: DomNodeView | null;
  searching?: boolean;
  query?: string;
  searchHits?: { query: string; index: number; total: number } | null;
  inspecting?: boolean;
  hintTyped?: string | null;
  domBpNodes?: ReadonlySet<number>;
  overlayCount?: number;
  centerSeq?: number;
  highlighting?: boolean;
  watching?: boolean;
  mutationCount?: number;
  error?: string;
  height: number;
  width?: number;
}

export function centeredStart(selected: number, len: number, budget: number): number {
  if (budget <= 0 || len <= budget) return 0;
  return Math.max(0, Math.min(selected - Math.floor((budget - 1) / 2), len - budget));
}

function depthOf(map: NodeMap, id: number): number {
  let depth = 0;
  let pid = map.get(id)?.parentId;
  while (pid !== undefined) {
    const p = map.get(pid);
    if (!p) break;
    if (p.isElement) depth++;
    pid = p.parentId;
  }
  return depth;
}

export function ElementsPanel({ map, expanded, selectedId, detail, searching = false, query = '', searchHits = null, inspecting = false, hintTyped = null, domBpNodes, overlayCount = 0, centerSeq, highlighting = false, watching = false, mutationCount = 0, error, height, width = 100 }: ElementsPanelProps): React.JSX.Element {
  const rule = '─'.repeat(width);
  const budget = Math.max(0, height - 10);

  const status = [
    inspecting ? t('panel.elements.inspecting') : '',
    hintTyped !== null ? `${t('panel.elements.hint')}: ${hintTyped}▌` : '',
    overlayCount > 0 ? `overlay:${overlayCount}` : '',
    highlighting ? 'highlight:on' : '',
    watching ? `watching (${mutationCount})` : '',
  ].filter(Boolean).join(' · ');

  const searchRow = searching
    ? <Text wrap="truncate">/{query}<Text color="cyan">▌</Text></Text>
    : searchHits
      ? <Text wrap="truncate">/{searchHits.query} <Text color="cyan">[{searchHits.index + 1}/{searchHits.total}]</Text><Text dimColor> n/N</Text></Text>
      : query
        ? <Text wrap="truncate">/{query}</Text>
        : <Text dimColor wrap="truncate">{t('panel.elements.searchPlaceholder')}</Text>;

  const visible = map === null ? [] : visibleNodes(map, expanded);
  const selIndex = selectedId === null ? -1 : visible.indexOf(selectedId);
  const prevStart = useRef(0);
  const lastCenterRef = useRef(centerSeq);
  let start = clampWindowStart(prevStart.current, visible.length, selIndex, budget);
  if (centerSeq !== undefined && centerSeq !== lastCenterRef.current) {
    lastCenterRef.current = centerSeq;
    start = centeredStart(Math.max(0, selIndex), visible.length, budget);
  }
  prevStart.current = start;

  let treeRows: React.ReactNode[];
  if (map === null) {
    treeRows = [<Text key="loading" dimColor wrap="truncate">{t('panel.elements.loading')}</Text>];
  } else if (visible.length === 0) {
    treeRows = [<Text key="empty" dimColor wrap="truncate">{t('panel.elements.emptyDoc')}</Text>];
  } else {
    treeRows = visible.slice(start, start + budget).map(id => {
      const info = map.get(id)!;
      const depth = depthOf(map, id);
      const hasKids = info.childIds.some(c => map.get(c)?.isElement);
      const unloaded = !!info.hasUnloadedChildren;
      const sel = id === selectedId;
      const indent = ' '.repeat(depth * 2);
      const glyph = hasKids || unloaded
        ? (expanded.has(id) && !unloaded ? '▾ ' : '▸ ')
        : null;
      const hidden = (info.attributes.class ?? '').split(/\s+/).includes(HIDE_CLASS);
      const domBp = !!domBpNodes?.has(id);
      const avail = Math.max(0, width - 1 - indent.length - 2 - (unloaded ? 2 : 0) - (hidden ? 7 : 0) - (domBp ? 2 : 0));
      const label = truncate(stripHideClass(info.label), avail);
      return (
        <Text key={id} backgroundColor={sel ? '#223543' : undefined} wrap="truncate">
          {sel ? <Text color="cyan">▌</Text> : ' '}{indent}{glyph ?? <Text dimColor>· </Text>}
          {domBp ? <Text color={theme.err}>◉ </Text> : null}
          <Text dimColor={hidden}>{segsToNodes(highlightLabel(label), `lbl-${id}`)}</Text>
          {hidden ? <Text dimColor> hidden</Text> : null}
          {unloaded ? <Text dimColor> …</Text> : null}
        </Text>
      );
    });
  }
  treeRows = padRows(treeRows, budget, 'tree');

  const computed = detail ? detail.computed.filter(([k]) => INTERESTING_STYLES.includes(k)).slice(0, 4) : [];
  const colw = Math.floor(width / 2);
  const pair = ([k, v]: [string, string]) => `${k} ${v}`;
  const styleRow = (a?: [string, string], b?: [string, string]) =>
    (a ? pair(a).padEnd(colw) : '') + (b ? pair(b) : '');

  const rulesLine = error
    ? <Text color="red" wrap="truncate">{error}</Text>
    : detail
      ? <Text dimColor wrap="truncate">{t('panel.elements.rules', { n: detail.matched.length })}</Text>
      : <Text> </Text>;

  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between">
        <Text dimColor>Elements</Text>
        <Text dimColor>{status}</Text>
      </Box>
      {searchRow}
      <Text dimColor wrap="truncate">{rule}</Text>
      {treeRows}
      <Text dimColor wrap="truncate">{rule}</Text>
      {detail ? <Text dimColor wrap="truncate">{truncate(`── ${detail.selector} `.padEnd(width, '─'), width)}</Text> : <Text> </Text>}
      {detail ? <Text dimColor wrap="truncate">{boxLine(detail.box)}</Text> : <Text> </Text>}
      {computed.length > 0 ? <Text dimColor wrap="truncate">{styleRow(computed[0], computed[1])}</Text> : <Text> </Text>}
      {computed.length > 2 ? <Text dimColor wrap="truncate">{styleRow(computed[2], computed[3])}</Text> : <Text> </Text>}
      {rulesLine}
      <Text dimColor wrap="truncate">{rule}</Text>
    </Box>
  );
}
