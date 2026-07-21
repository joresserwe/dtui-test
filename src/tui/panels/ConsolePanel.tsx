import React from 'react';
import { Box, Text } from 'ink';
import type { ConsoleEntry, ConsoleKind } from '../../store/types.js';
import { displayWidth, fmtClockMs, truncateWidth } from '../lib/format.js';
import { highlightJs, segsToNodes } from '../lib/highlight.js';
import { useListWindow } from '../lib/list-window.js';
import { parseRegexLiteral } from '../lib/search.js';
import type { ReplCandidate } from '../lib/repl-complete.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export interface ConsoleToken {
  negate: boolean;
  test: (text: string) => boolean;
}

export function parseConsoleFilter(q: string): ConsoleToken[] {
  return q.trim().split(/\s+/).filter(Boolean).map(raw => {
    const negate = raw.startsWith('-') && raw.length > 1;
    const body = negate ? raw.slice(1) : raw;
    const lit = parseRegexLiteral(body);
    if (lit && 're' in lit) {
      const re = lit.re;
      return { negate, test: (text: string) => re.test(text) };
    }
    const needle = body.toLowerCase();
    return { negate, test: (text: string) => text.toLowerCase().includes(needle) };
  });
}

// The level picker offers error and exception as a single 'error' choice.
export function levelMatches(levels: readonly ConsoleKind[], kind: ConsoleKind): boolean {
  if (!levels.length) return true;
  return levels.some(l => l === kind || (l === 'error' && kind === 'exception'));
}

export function filterConsoleEntries(entries: ConsoleEntry[], levels: readonly ConsoleKind[], q: string): ConsoleEntry[] {
  let out = entries;
  // The input/result exemption is DevTools parity.
  if (levels.length) out = out.filter(e => e.kind === 'input' || e.kind === 'result' || levelMatches(levels, e.kind));
  const tokens = parseConsoleFilter(q);
  if (tokens.length) {
    out = out.filter(e => tokens.every(tok => (tok.negate ? !tok.test(e.text) : tok.test(e.text))));
  }
  return out;
}

export const consoleSourceLabel = (e: ConsoleEntry): string => {
  if (!e.url) return '';
  const base = e.url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || e.url;
  return e.line !== undefined ? `${base}:${e.line}` : base;
};

export const normalizeTimerText = (text: string): string =>
  text.replace(/(\d+(?:\.\d+)?)\s*ms\s*$/, (_m, n) => {
    const ms = Number(n);
    return ms >= 1000 ? `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')}s` : `${n}ms`;
  });

export interface ConsolePanelProps {
  entries: ConsoleEntry[];
  selected: number;
  expanded: Set<number>;
  focused: boolean;
  height?: number;
  width?: number;
  // REPL draft; when set, the bottom row becomes a ❯ prompt line.
  input?: string;
  eager?: string;
  showTimestamps?: boolean;
  ctxLabels?: Map<number, string>;
  ctxLabel?: string;
}

const MARKERS: Record<string, { icon: string; color?: string }> = {
  error: { icon: '✖', color: 'red' },
  exception: { icon: '✖', color: 'red' },
  warn: { icon: '⚠', color: 'yellow' },
  info: { icon: 'i' },
  browser: { icon: '»' },
  log: { icon: '·' },
  debug: { icon: '·' },
  input: { icon: '❯', color: theme.key },
  result: { icon: '◂' },
  timer: { icon: '⧗', color: theme.accent },
  trace: { icon: '↳' },
};

export function ConsolePanel({ entries, selected, expanded, focused, height = 12, width, input, eager, showTimestamps, ctxLabels, ctxLabel }: ConsolePanelProps) {
  const budget = Math.max(0, height);
  const hasEager = input !== undefined && eager !== undefined && eager !== '' && budget >= 2;
  const promptRows = input !== undefined ? (hasEager ? 2 : 1) : 0;
  const listBudget = Math.max(0, budget - promptRows);
  const W = width ?? 100;
  const lines: { entryIdx: number; node: React.ReactNode }[] = [];
  entries.forEach((e, i) => {
    const m = MARKERS[e.kind] ?? MARKERS.log;
    const sel = i === selected;
    const raw = e.text.split('\n')[0];
    const first = e.kind === 'timer' ? normalizeTimerText(raw) : raw;
    const badge = e.count !== undefined && e.count > 1 ? ` ×${e.count}` : '';
    const ts = showTimestamps ? fmtClockMs(e.ts) : '';
    const tsWidth = ts ? displayWidth(ts) + 1 : 0;
    const ctxTag = e.ctxLabel ?? (e.ctxId !== undefined ? ctxLabels?.get(e.ctxId) : undefined);
    const ctxStr = ctxTag ? `⟨${ctxTag}⟩ ` : '';
    const used = 3 + tsWidth + displayWidth(ctxStr) + displayWidth(first) + displayWidth(badge);
    const src = consoleSourceLabel(e);
    const srcShown = src && W - used - displayWidth(src) - 2 >= 0 ? src : '';
    const gap = Math.max(0, W - used - displayWidth(srcShown));
    const pad = srcShown ? gap : sel && width !== undefined ? gap : 0;
    lines.push({
      entryIdx: i,
      node: (
        <Text key={`e${i}`} backgroundColor={sel ? '#223543' : undefined} wrap="truncate">
          <Text color="cyan">{sel && focused ? '▌' : ' '}</Text>
          <Text color={m.color} dimColor={!m.color}>{m.icon}</Text>{' '}
          {ts ? <Text dimColor>{ts} </Text> : null}
          {ctxStr ? <Text color={theme.muted}>{ctxStr}</Text> : null}
          {e.kind === 'result' && first === 'undefined' ? <Text dimColor>{first}</Text> : first}
          {badge ? <Text dimColor>{badge}</Text> : null}
          {pad > 0 ? ' '.repeat(pad) : null}
          {srcShown ? <Text dimColor>{srcShown}</Text> : null}
        </Text>
      ),
    });
    if (expanded.has(e.id ?? i) && e.stack) {
      e.stack.split('\n').forEach((s, si) => {
        lines.push({ entryIdx: i, node: <Text key={`e${i}s${si}`} dimColor wrap="truncate">   {s.trim()}</Text> });
      });
    }
  });
  const selFirst = Math.max(0, lines.findIndex(l => l.entryIdx === selected));
  const start = useListWindow(lines.length, selFirst, listBudget);
  const content: React.ReactNode[] = [];
  if (entries.length === 0) {
    if (listBudget > 0) content.push(<Text key="empty" dimColor> {t('panel.console.empty')}</Text>);
  } else {
    lines.slice(start, start + listBudget).forEach(l => content.push(l.node));
  }
  while (content.length < listBudget) content.push(<Text key={`pad${content.length}`}> </Text>);
  if (input !== undefined && budget > 0) {
    const tagStr = ctxLabel ? `⟨${ctxLabel}⟩` : '';
    const tagPad = tagStr ? W - (2 + displayWidth(input) + 1) - displayWidth(tagStr) - 1 : -1;
    content.push(
      <Text key="repl" wrap="truncate">
        <Text color={theme.key}>{'❯ '}</Text>
        {segsToNodes(highlightJs(input), 'repl')}
        <Text inverse> </Text>
        {tagStr && tagPad >= 0 ? <Text color={theme.muted}>{' '.repeat(tagPad) + tagStr}</Text> : null}
      </Text>,
    );
    if (hasEager) {
      content.push(
        <Text key="eager" dimColor wrap="truncate">{`  ${truncateWidth(eager!, Math.max(1, W - 2))}`}</Text>,
      );
    }
  }
  return (
    <Box flexDirection="column" {...(width !== undefined ? { width } : { flexGrow: 1 })}>
      {content}
    </Box>
  );
}

export const REPL_POPUP_MAX_ROWS = 8;
const REPL_POPUP_MAX_WIDTH = 44;

const tagFor = (kind?: ReplCandidate['kind']): string => (kind === 'function' ? 'fn' : kind === 'property' ? 'prop' : '');

export function replPopupSize(items: ReplCandidate[]): { rows: number; width: number } {
  const rows = Math.min(items.length, REPL_POPUP_MAX_ROWS);
  let inner = 8;
  for (const it of items) {
    const tag = tagFor(it.kind);
    inner = Math.max(inner, displayWidth(it.name) + (tag ? 1 + tag.length : 0));
  }
  return { rows, width: Math.min(REPL_POPUP_MAX_WIDTH, inner + 2) };
}

export interface ReplCompletionPopupProps {
  items: ReplCandidate[];
  selected: number | null;
}

export function ReplCompletionPopup({ items, selected }: ReplCompletionPopupProps) {
  const { rows, width } = replPopupSize(items);
  const start = selected === null || selected < rows ? 0 : Math.min(selected - rows + 1, items.length - rows);
  return (
    <Box flexDirection="column" width={width}>
      {items.slice(start, start + rows).map((it, i) => {
        const idx = start + i;
        const isSel = idx === selected;
        const tag = tagFor(it.kind);
        const name = truncateWidth(it.name, width - 2 - (tag ? 1 + tag.length : 0));
        const pad = Math.max(0, width - 2 - displayWidth(name) - (tag ? tag.length : 0));
        return (
          <Text key={idx} backgroundColor={isSel ? '#223543' : theme.overlayBg} wrap="truncate">
            {' '}
            <Text color={isSel ? theme.key : undefined}>{name}</Text>
            {pad > 0 ? ' '.repeat(pad) : null}
            {tag ? <Text color={theme.muted}>{tag}</Text> : null}
            {' '}
          </Text>
        );
      })}
    </Box>
  );
}
