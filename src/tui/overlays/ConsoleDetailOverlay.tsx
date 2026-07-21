import React from 'react';
import { Box, Text } from 'ink';
import type { ConsoleArg, ConsoleEntry, ConsoleKind } from '../../store/types.js';
import { formatArg, inlineArg, type ConsoleObjectProp } from '../../store/console-format.js';
import { displayWidth, fmtClockMs } from '../lib/format.js';
import { segsToNodes, type Seg } from '../lib/highlight.js';
import { detectConsoleTable, renderConsoleTable } from '../lib/console-table.js';
import { wrapSegs, type Line } from './DetailOverlay.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export const CONSOLE_DETAIL_CHROME = 3;

// A tree path is the arg index plus the property-name trail, joined by an
// unprintable separator so property names containing '.' stay unambiguous.
const PATH_SEP = '\u0001';

export type ConsoleChildren = ConsoleObjectProp[] | 'stale';

export interface ConsoleDetailTree {
  expanded: Set<string>;
  // Keyed by objectId, so re-collapsing and re-expanding never refetches.
  children: Map<string, ConsoleChildren>;
}

const LEVEL_BG: Partial<Record<ConsoleKind, string>> = {
  error: theme.err,
  exception: theme.err,
  warn: theme.warn,
};

export function consoleLevelBadge(kind: ConsoleKind): { text: string; bg?: string; color: string } {
  const bg = LEVEL_BG[kind];
  return { text: ` ${kind.toUpperCase()} `, bg, color: bg ? theme.badgeFg : theme.muted };
}

function pushWrapped(out: Line[], segs: Seg[], width: number, wrap: boolean, node?: Line['node']): void {
  if (!wrap) {
    out.push({ text: segs.map(s => s.text).join(''), segs, pre: true, ...(node ? { node } : {}) });
    return;
  }
  let first = true;
  for (const row of wrapSegs(segs, width)) {
    out.push({ text: row.map(s => s.text).join(''), segs: row, pre: true, ...(first && node ? { node } : {}) });
    first = false;
  }
}

function pushArgNode(
  out: Line[],
  name: string | undefined,
  arg: ConsoleArg,
  path: string,
  depth: number,
  tree: ConsoleDetailTree,
  width: number,
  wrap: boolean,
): void {
  const indent = '  '.repeat(depth);
  const expandable = arg.objectId !== undefined;
  const open = expandable && tree.expanded.has(path);
  const marker = expandable ? (open ? '▾' : '▸') : ' ';
  const segs: Seg[] = [
    { text: `${indent}${marker} `, color: theme.key },
    ...(name !== undefined ? [{ text: `${name}: `, color: 'cyan' }] : []),
    { text: name !== undefined ? inlineArg(arg) : formatArg(arg) },
  ];
  pushWrapped(out, segs, width, wrap, expandable ? { path, objectId: arg.objectId! } : undefined);
  if (!open) return;
  const kids = tree.children.get(arg.objectId!);
  if (kids === 'stale') {
    pushWrapped(out, [{ text: `${indent}    ${t('console.staleObject')}`, dim: true }], width, wrap);
    return;
  }
  if (!Array.isArray(kids)) {
    pushWrapped(out, [{ text: `${indent}    …`, dim: true }], width, wrap);
    return;
  }
  for (const kid of kids) {
    if (!kid.value) continue;
    pushArgNode(out, kid.name, kid.value, `${path}${PATH_SEP}${kid.name}`, depth + 1, tree, width, wrap);
  }
}

export function consoleDetailLines(e: ConsoleEntry, width = 80, wrap = true, tree?: ConsoleDetailTree): Line[] {
  const w = Math.max(1, width);
  const out: Line[] = [];
  for (const raw of e.text.split('\n')) pushWrapped(out, [{ text: raw }], w, wrap);
  const table = detectConsoleTable(e);
  if (table) {
    out.push({ text: '' });
    for (const row of renderConsoleTable(table, w)) pushWrapped(out, [{ text: row }], w, false);
  }
  if (tree) {
    const roots = (e.args ?? [])
      .map((arg, i) => ({ arg, i }))
      .filter(r => r.arg.objectId !== undefined);
    if (roots.length) {
      out.push({ text: '' });
      for (const { arg, i } of roots) pushArgNode(out, undefined, arg, `a${i}`, 0, tree, w, wrap);
    }
  }
  if (e.url) {
    out.push({ text: '' });
    pushWrapped(out, [{ text: e.line !== undefined ? `${e.url}:${e.line}` : e.url, dim: true }], w, wrap);
  }
  if (e.stack) {
    out.push({ text: '' });
    for (const raw of e.stack.split('\n')) pushWrapped(out, [{ text: `  ${raw.trim()}`, dim: true }], w, wrap);
  }
  return out;
}

function descendPath(root: ConsoleArg | undefined, tree: ConsoleDetailTree, parts: string[]): ConsoleArg | undefined {
  let cur = root;
  for (let i = 1; cur && i < parts.length; i++) {
    const kids = cur.objectId !== undefined ? tree.children.get(cur.objectId) : undefined;
    cur = Array.isArray(kids) ? kids.find(k => k.name === parts[i])?.value : undefined;
  }
  return cur;
}

export function consoleArgAtPath(e: ConsoleEntry, tree: ConsoleDetailTree, path: string): ConsoleArg | undefined {
  const parts = path.split(PATH_SEP);
  return descendPath(e.args?.[Number(parts[0].slice(1))], tree, parts);
}

export interface ObjectTreeRoot { name: string; arg: ConsoleArg }

export function objectTreeLines(roots: ObjectTreeRoot[], tree: ConsoleDetailTree, width = 80, wrap = false): Line[] {
  const out: Line[] = [];
  roots.forEach((r, i) => pushArgNode(out, r.name, r.arg, `s${i}`, 0, tree, Math.max(1, width), wrap));
  return out;
}

export function objectTreeArgAtPath(roots: ObjectTreeRoot[], tree: ConsoleDetailTree, path: string): ConsoleArg | undefined {
  const parts = path.split(PATH_SEP);
  return descendPath(roots[Number(parts[0].slice(1))]?.arg, tree, parts);
}

export function objectTreeSubtreeText(roots: ObjectTreeRoot[], tree: ConsoleDetailTree, path: string): string | undefined {
  const arg = objectTreeArgAtPath(roots, tree, path);
  return arg ? subtreeText(arg, tree, '', new Set()) : undefined;
}

function subtreeText(arg: ConsoleArg, tree: ConsoleDetailTree, indent: string, seen: Set<string>): string {
  const kids = arg.objectId !== undefined && !seen.has(arg.objectId) ? tree.children.get(arg.objectId) : undefined;
  if (!Array.isArray(kids)) return inlineArg(arg);
  seen.add(arg.objectId!);
  const inner = `${indent}  `;
  const isArray = arg.subtype === 'array';
  const rows = kids
    .filter(k => k.value)
    .map(k => `${inner}${isArray && /^\d+$/.test(k.name) ? '' : `${k.name}: `}${subtreeText(k.value!, tree, inner, seen)}`);
  seen.delete(arg.objectId!);
  const [openCh, closeCh] = isArray ? ['[', ']'] : ['{', '}'];
  return rows.length ? `${openCh}\n${rows.join(',\n')}\n${indent}${closeCh}` : `${openCh}${closeCh}`;
}

export function consoleSubtreeText(e: ConsoleEntry, tree: ConsoleDetailTree, path: string): string | undefined {
  const arg = consoleArgAtPath(e, tree, path);
  return arg ? subtreeText(arg, tree, '', new Set()) : undefined;
}

export function consoleCopyText(e: ConsoleEntry): string {
  return e.stack ? `${e.text}\n${e.stack}` : e.text;
}

const LEVEL_TAG: Partial<Record<ConsoleKind, string>> = {
  error: '[error] ', exception: '[error] ', warn: '[warn] ',
};

export function consoleEntriesText(entries: readonly ConsoleEntry[]): string {
  return entries
    .map(e => {
      const count = e.count !== undefined && e.count > 1 ? ` (×${e.count})` : '';
      const head = `${LEVEL_TAG[e.kind] ?? ''}${e.text}${count}`;
      return e.stack ? `${head}\n${e.stack}` : head;
    })
    .join('\n');
}

export interface ConsoleDetailOverlayProps {
  entry: ConsoleEntry;
  scroll: number;
  height?: number;
  width?: number;
  lines?: Line[];
  wrap?: boolean;
  cursor?: number;
}

export function ConsoleDetailOverlay({ entry, scroll, height = 18, width = 100, lines, wrap = true, cursor }: ConsoleDetailOverlayProps) {
  const rich = lines ?? consoleDetailLines(entry, width, wrap);
  const budget = Math.max(0, height - CONSOLE_DETAIL_CHROME);
  const off = Math.min(Math.max(0, scroll), Math.max(0, rich.length - budget));
  const badge = consoleLevelBadge(entry.kind);
  const ts = fmtClockMs(entry.ts);
  const count = entry.count !== undefined && entry.count > 1 ? ` ×${entry.count}` : '';
  const pos = rich.length > budget ? `(${off + 1}-${Math.min(off + budget, rich.length)}/${rich.length})` : '';
  const headLeft = displayWidth(badge.text) + 1 + displayWidth(ts) + displayWidth(count);
  const gap = ' '.repeat(Math.max(1, width - headLeft - displayWidth(pos)));
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        <Text backgroundColor={badge.bg} color={badge.color} bold={badge.bg !== undefined}>{badge.text}</Text>
        {' '}
        <Text color={theme.muted}>{ts}</Text>
        {count ? <Text dimColor>{count}</Text> : null}
        {gap}
        {pos ? <Text color={theme.muted}>{pos}</Text> : null}
      </Text>
      <Text color={theme.accent} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>
      {Array.from({ length: budget }, (_, i) => {
        const idx = off + i;
        const line = rich[idx];
        const isCursor = cursor !== undefined && idx === cursor && line !== undefined;
        if (!line?.text) {
          return <Text key={i}>{isCursor ? <Text inverse> </Text> : ' '}</Text>;
        }
        const segs = line.segs;
        return (
          <Text key={i} wrap="truncate">
            {segs
              ? segsToNodes(isCursor ? segs.map(s => ({ ...s, inverse: true })) : segs, `cd-${i}`)
              : isCursor ? <Text inverse>{line.text}</Text> : line.text}
          </Text>
        );
      })}
      <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>
    </Box>
  );
}
