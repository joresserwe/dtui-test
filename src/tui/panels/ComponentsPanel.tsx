import React from 'react';
import { Box, Text } from 'ink';
import type { FrameworkInfo, FrameworkNode } from '../lib/framework-script.js';
import { reactNamesMinified } from '../lib/framework-script.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { truncate } from '../lib/format.js';
import { segsToNodes } from '../lib/highlight.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';
import { objectTreeLines, type ObjectTreeRoot } from '../overlays/ConsoleDetailOverlay.js';
import type { ConsoleObjectProp } from '../../store/console-format.js';
import type { ComponentsTool } from '../hooks/use-components-tool.js';

export const COMPONENTS_CHROME = 4;

const SEL_BG = '#223543';

const KIND_BADGES: Record<string, string> = {
  class: 'class',
  forwardref: 'fwd',
  memo: 'memo',
  lazy: 'lazy',
  suspense: 'susp',
};

export function componentRows(nodes: FrameworkNode[], collapsed: Set<number>): FrameworkNode[] {
  const suppressed = new Set<number>();
  const out: FrameworkNode[] = [];
  for (const n of nodes) {
    if (n.parentId !== null && (collapsed.has(n.parentId) || suppressed.has(n.parentId))) {
      suppressed.add(n.id);
      continue;
    }
    out.push(n);
  }
  return out;
}

export function componentParentIds(nodes: FrameworkNode[]): Set<number> {
  const parents = new Set<number>();
  for (const n of nodes) if (n.parentId !== null) parents.add(n.parentId);
  return parents;
}

export function filterComponents(nodes: FrameworkNode[], filter: string): FrameworkNode[] {
  const q = filter.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.filter(n => n.name.toLowerCase().includes(q));
}

export function componentVisibleRows(tree: FrameworkInfo | null, filter: string, collapsed: Set<number>): FrameworkNode[] {
  if (!tree) return [];
  return filter ? filterComponents(tree.nodes, filter) : componentRows(tree.nodes, collapsed);
}

const INSPECT_SECTION_LABELS: Record<string, string> = { hooks: 'hooks (raw)' };

export function componentInspectRoots(sections: ConsoleObjectProp[]): ObjectTreeRoot[] {
  return sections
    .filter(s => s.value !== undefined)
    .map(s => ({ name: INSPECT_SECTION_LABELS[s.name] ?? s.name, arg: s.value! }));
}

export interface ComponentsPanelProps {
  comp: ComponentsTool;
  height?: number;
  width?: number;
}

export function ComponentsPanel({ comp, height = 14, width = 80 }: ComponentsPanelProps) {
  const rule = <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>;
  const budget = Math.max(1, height - COMPONENTS_CHROME);
  const tree = comp.compTree;
  const rows = componentVisibleRows(tree, comp.compFilter, comp.compCollapsed);
  const sel = Math.min(comp.compSel, Math.max(0, rows.length - 1));
  const inspect = comp.compInspect;
  const inspectLines = inspect
    ? objectTreeLines(componentInspectRoots(inspect.sections), { expanded: comp.compInspectExpanded, children: comp.compInspectChildren }, Math.max(1, width))
    : [];
  const inspectCursor = Math.min(comp.compInspectCursor, Math.max(0, inspectLines.length - 1));
  const start = useListWindow(inspect ? inspectLines.length : rows.length, inspect ? inspectCursor : sel, budget);
  const parents = tree ? componentParentIds(tree.nodes) : new Set<number>();
  const filtering = comp.compFilter !== '' || comp.compFilterEditing;

  const headerTail = inspect
    ? t('components.inspect.header', { name: inspect.node.name })
    : tree
      ? `${tree.framework}${tree.version ? ` ${tree.version}` : ''} · ${t('components.header.count', { n: tree.nodes.length })}` +
        `${reactNamesMinified(tree) ? ` · ${t('components.header.minified')}` : ''}${tree.truncated ? ' · truncated' : ''}` +
        `${comp.compExtraFrameworks > 0 ? ` · +${comp.compExtraFrameworks}` : ''}`
      : comp.compScanning
        ? t('components.header.scanning')
        : '';

  let body: React.ReactNode[];
  if (inspect) {
    body = inspectLines.length
      ? inspectLines.slice(start, start + budget).map((line, i) => {
          const idx = start + i;
          const isCursor = idx === inspectCursor;
          const segs = line.segs ?? [{ text: line.text }];
          return (
            <Text key={`ci-${i}`} wrap="truncate">
              {segsToNodes(isCursor ? segs.map(s => ({ ...s, inverse: true })) : segs, `ci-${i}`)}
            </Text>
          );
        })
      : [<Text key="ie" dimColor wrap="truncate">{` ${t('components.inspect.empty')}`}</Text>];
  } else if (comp.compErr) {
    body = [<Text key="ce" color={theme.err} wrap="truncate">{` ${truncate(comp.compErr, Math.max(8, width - 2))}`}</Text>];
  } else if (comp.compScan === null) {
    body = [<Text key="cl" dimColor wrap="truncate">{` ${t('components.scanning')}`}</Text>];
  } else if (!tree) {
    body = [
      <Text key="n0" wrap="truncate">{` ${t('components.none.title')}`}</Text>,
      <Text key="n1"> </Text>,
      <Text key="n2" dimColor wrap="truncate">{` ${t('components.none.line1')}`}</Text>,
      <Text key="n3" dimColor wrap="truncate">{` ${t('components.none.line2')}`}</Text>,
      <Text key="n4" dimColor wrap="truncate">{` ${t('components.none.line3')}`}</Text>,
    ];
  } else if (!rows.length) {
    body = [
      <Text key="cf" dimColor wrap="truncate">
        {` ${t(comp.compFilter ? 'components.filter.noMatch' : 'components.tree.empty')}`}
      </Text>,
    ];
  } else {
    body = rows.slice(start, start + budget).map((n, i) => {
      const idx = start + i;
      const selected = idx === sel;
      const badge = KIND_BADGES[n.kind];
      const indent = filtering ? '' : '  '.repeat(n.depth);
      const glyph = filtering ? '' : parents.has(n.id) ? (comp.compCollapsed.has(n.id) ? '▸ ' : '▾ ') : '  ';
      return (
        <Text key={`cr-${i}`} wrap="truncate" backgroundColor={selected ? SEL_BG : undefined}>
          {selected ? <Text color="cyan">▌</Text> : ' '}
          <Text color={theme.faint}>{indent}</Text>
          <Text color={theme.key}>{glyph}</Text>
          <Text>{truncate(n.name, Math.max(8, width - indent.length - 8))}</Text>
          {badge ? <Text color={theme.muted}>{` ⟨${badge}⟩`}</Text> : null}
          {n.hostIdx === undefined ? <Text color={theme.faint}>{` ${t('components.row.noElement')}`}</Text> : null}
        </Text>
      );
    });
  }

  const footer = inspect
    ? t('components.footer.inspect')
    : comp.compFilterEditing
      ? `/${comp.compFilter}▌`
      : comp.compFilter
        ? `/${comp.compFilter} (${rows.length})`
        : tree
          ? t('components.footer')
          : t('components.footer.empty');

  return (
    <Box flexDirection="column" height={height} width={width}>
      <Text wrap="truncate">
        {' '}
        <Text dimColor>Components</Text>
        {headerTail ? <Text color={theme.muted}>{`  ${headerTail}`}</Text> : null}
      </Text>
      {rule}
      {padRows(body, budget, 'cp')}
      <Text color={comp.compFilterEditing ? 'cyan' : undefined} dimColor={!comp.compFilterEditing} wrap="truncate">{` ${footer}`}</Text>
      {rule}
    </Box>
  );
}
