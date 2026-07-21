import React from 'react';
import { Box, Text } from 'ink';
import type { BreakpointKind, BreakpointView, PausedView, PauseState, ScopeView, ScriptInfo } from '../../store/debugger.js';
import { inlineArg, type ConsoleObjectProp } from '../../store/console-format.js';
import type { ConsoleArg } from '../../store/types.js';
import type { ConsoleChildren } from '../overlays/ConsoleDetailOverlay.js';
import type { Line } from '../overlays/DetailOverlay.js';
import type { Seg } from '../lib/highlight.js';
import { segsToNodes } from '../lib/highlight.js';
import { clampWindowStart, padRows, useListWindow } from '../lib/list-window.js';
import { displayWidth, truncate } from '../lib/format.js';
import { theme } from '../lib/theme.js';
import { displayLineFor } from '../lib/pretty-print.js';
import { originalPositionFor } from '../../util/source-map.js';
import { t, type MessageKey } from '../lib/i18n.js';
import { EVENT_BP_CATEGORIES, WATCH_ERROR, type SourcesTool } from '../hooks/use-sources-tool.js';

export const SOURCES_LIST_CHROME = 4;
export const SOURCES_VIEWER_CHROME = 4;

export const BP_GLYPHS: Record<BreakpointKind, string> = { line: '●', condition: '◆', logpoint: '◎' };

const REASON_KEYS: Record<string, MessageKey> = {
  XHR: 'sources.reason.xhr',
  DOM: 'sources.reason.dom',
  EventListener: 'sources.reason.event',
  exception: 'sources.reason.exception',
  promiseRejection: 'sources.reason.promiseRejection',
  instrumentation: 'sources.reason.instrumentation',
  ambiguous: 'sources.reason.other',
  other: 'sources.reason.other',
};

export function pauseReasonLabel(p: PausedView): string {
  const key = p.reason === 'other' && p.hitBreakpoints.length ? 'sources.reason.breakpoint' : REASON_KEYS[p.reason];
  const label = key ? t(key) : p.reason;
  return p.detail ? `${label} · ${p.detail}` : label;
}

const SEL_BG = '#223543';
const PATH_SEP = '\u0001';

export interface ScopeTree {
  expanded: Set<string>;
  children: Map<string, ConsoleChildren>;
}

export interface SourcesViewData {
  scripts: ScriptInfo[];
  totalScripts: number;
  breakpoints: BreakpointView[];
  pauseState: PauseState;
  paused: PausedView | null;
  scopeLines: Line[];
  blackboxed: string[];
  xhrBreakpoints: string[];
  eventBreakpoints: string[];
}

export function scriptLabel(s: ScriptInfo): string {
  return s.url || `VM${s.scriptId}`;
}

export function filterScripts(scripts: ScriptInfo[], filter: string): ScriptInfo[] {
  const q = filter.trim().toLowerCase();
  if (!q) return scripts;
  return scripts.filter(s => scriptLabel(s).toLowerCase().includes(q));
}

export function shortLoc(url: string, scriptId: string, line: number): string {
  let name = url;
  try {
    const u = new URL(url);
    name = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
  } catch {
    name = url.split('/').pop() ?? url;
  }
  return `${name || `VM${scriptId}`}:${line + 1}`;
}

export function scopeLabel(scope: ScopeView): string {
  const type = scope.type.charAt(0).toUpperCase() + scope.type.slice(1);
  return scope.name ? `${type} (${scope.name})` : type;
}

function pushKids(out: Line[], objectId: string, path: string, depth: number, tree: ScopeTree): void {
  const indent = '  '.repeat(depth);
  const kids = tree.children.get(objectId);
  if (kids === 'stale') {
    out.push({ text: `${indent}  ${t('console.staleObject')}`, segs: [{ text: `${indent}  ${t('console.staleObject')}`, dim: true }] });
    return;
  }
  if (!Array.isArray(kids)) {
    out.push({ text: `${indent}  …`, segs: [{ text: `${indent}  …`, dim: true }] });
    return;
  }
  for (const kid of kids) {
    if (!kid.value) continue;
    pushProp(out, kid.name, kid.value, `${path}${PATH_SEP}${kid.name}`, depth, tree);
  }
}

function pushProp(out: Line[], name: string, arg: ConsoleArg, path: string, depth: number, tree: ScopeTree): void {
  const indent = '  '.repeat(depth);
  const expandable = arg.objectId !== undefined;
  const open = expandable && tree.expanded.has(path);
  const marker = expandable ? (open ? '▾' : '▸') : ' ';
  const segs: Seg[] = [
    { text: `${indent}${marker} `, color: theme.key },
    { text: `${name}: `, color: 'cyan' },
    { text: inlineArg(arg) },
  ];
  out.push({
    text: segs.map(s => s.text).join(''),
    segs,
    ...(expandable ? { node: { path, objectId: arg.objectId! } } : {}),
  });
  if (open) pushKids(out, arg.objectId!, path, depth + 1, tree);
}

export function scopeTreeLines(scopes: ScopeView[], tree: ScopeTree): Line[] {
  const out: Line[] = [];
  scopes.forEach((scope, i) => {
    const path = `s${i}`;
    const expandable = scope.objectId !== undefined;
    const open = expandable && tree.expanded.has(path);
    const marker = expandable ? (open ? '▾' : '▸') : ' ';
    const label = scopeLabel(scope);
    const segs: Seg[] = [
      { text: `${marker} `, color: theme.key },
      { text: label, color: theme.accent, bold: true },
    ];
    out.push({
      text: `${marker} ${label}`,
      segs,
      ...(expandable ? { node: { path, objectId: scope.objectId! } } : {}),
    });
    if (open && scope.objectId) pushKids(out, scope.objectId, path, 1, tree);
  });
  return out;
}

export function pausedPaneHeights(
  height: number,
  frameCount: number,
  watchCount = 0,
): { excerptH: number; stackH: number; scopeH: number; watchH: number } {
  const three = (avail: number) => {
    const stackH = Math.max(1, Math.min(Math.max(1, frameCount), Math.min(5, Math.floor(avail / 3))));
    const excerptH = Math.max(1, Math.min(9, Math.floor((avail - stackH) / 2)));
    const scopeH = Math.max(1, avail - stackH - excerptH);
    return { excerptH, stackH, scopeH };
  };
  if (watchCount > 0) {
    const avail = height - 5;
    if (avail >= 4) {
      const b = three(avail);
      const watchH = Math.min(watchCount, 4, Math.max(1, Math.floor(b.scopeH / 2)));
      if (b.scopeH - watchH >= 1) return { excerptH: b.excerptH, stackH: b.stackH, scopeH: b.scopeH - watchH, watchH };
    }
  }
  return { ...three(Math.max(3, height - 4)), watchH: 0 };
}

interface GutterOpts {
  bpMarks: Map<number, BreakpointKind>;
  pauseLine: number | null;
  gutterW: number;
  width: number;
  cursor?: number;
}

export function bpMarksFor(breakpoints: BreakpointView[], url: string): Map<number, BreakpointKind> {
  const marks = new Map<number, BreakpointKind>();
  if (!url) return marks;
  for (const bp of breakpoints) {
    if (bp.url === url) marks.set(bp.resolved?.line ?? bp.line, bp.kind);
  }
  return marks;
}

function sourceRow(lines: string[], idx: number, opts: GutterOpts, key: string): React.ReactNode {
  const { bpMarks, pauseLine, gutterW, width, cursor } = opts;
  const raw = lines[idx] ?? '';
  const isCursor = cursor !== undefined && idx === cursor;
  const bp = bpMarks.get(idx);
  const isPause = pauseLine === idx;
  const codeW = Math.max(4, width - gutterW - 6);
  return (
    <Text key={key} wrap="truncate" backgroundColor={isCursor ? SEL_BG : undefined}>
      <Text color={bp === 'logpoint' ? theme.warn : theme.err}>{bp ? BP_GLYPHS[bp] : ' '}</Text>
      <Text color={theme.warn} bold={isPause}>{isPause ? '▶' : ' '}</Text>
      <Text color={theme.muted}>{String(idx + 1).padStart(gutterW)}</Text>
      <Text color={theme.faint}>{' │ '}</Text>
      <Text>{truncate(raw.replace(/\t/g, '  '), codeW)}</Text>
    </Text>
  );
}

function richRow(line: Line | undefined, isCursor: boolean, key: string): React.ReactNode {
  if (!line?.text) return <Text key={key}>{isCursor ? <Text inverse> </Text> : ' '}</Text>;
  const segs = line.segs ?? [{ text: line.text }];
  return (
    <Text key={key} wrap="truncate">
      {segsToNodes(isCursor ? segs.map(s => ({ ...s, inverse: true })) : segs, key)}
    </Text>
  );
}

export interface SourcesPanelProps {
  src: SourcesTool;
  data: SourcesViewData;
  height?: number;
  width?: number;
}

export function SourcesPanel({ src, data, height = 14, width = 80 }: SourcesPanelProps) {
  const rule = <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>;
  const paused = data.paused;
  const statusTail = ` · X:${data.pauseState}${paused ? ' · ⏸ paused' : ''}`;
  const listBudget = Math.max(1, height - SOURCES_LIST_CHROME);
  const listSel = Math.min(src.srcSel, Math.max(0, data.scripts.length - 1));
  const listStart = useListWindow(data.scripts.length, listSel, listBudget);

  if (src.origin) {
    const origin = src.origin;
    const lines = Array.isArray(origin.text) ? origin.text : [];
    const budget = Math.max(1, height - SOURCES_VIEWER_CHROME);
    const off = Math.max(0, Math.min(src.originScroll, Math.max(0, lines.length - budget)));
    const cursor = Math.min(src.originCursor, Math.max(0, lines.length - 1));
    const gutterW = Math.max(3, String(lines.length).length);
    const pos = lines.length > budget ? `(${off + 1}-${Math.min(off + budget, lines.length)}/${lines.length})` : `(${lines.length}L)`;
    const footer = origin.text === 'error' ? t('sources.viewer.loadFailed')
      : origin.text === undefined ? t('sources.viewer.loading')
      : t('sources.origin.readonly');
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Text wrap="truncate">
          {' '}
          <Text bold color="cyan">{truncate(origin.title, Math.max(10, width - displayWidth(pos) - displayWidth(statusTail) - 4))}</Text>
          <Text color={theme.muted}>{` ${pos}${statusTail}`}</Text>
        </Text>
        {rule}
        {padRows(
          Array.isArray(origin.text)
            ? Array.from({ length: Math.min(budget, Math.max(0, lines.length - off)) }, (_, i) =>
                sourceRow(lines, off + i, { bpMarks: new Map(), pauseLine: null, gutterW, width, cursor }, `ov-${i}`))
            : [],
          budget,
          'ov',
        )}
        <Text dimColor wrap="truncate">{` ${footer}`}</Text>
        {rule}
      </Box>
    );
  }

  if (src.viewScript) {
    const script = src.viewScript;
    const text = src.sources.get(script.scriptId);
    const rawLines = Array.isArray(text) ? text : [];
    const prettyRes = src.prettyOn.has(script.scriptId) ? src.prettyMaps.get(script.scriptId) : undefined;
    const lines = prettyRes ? prettyRes.lines : rawLines;
    const budget = Math.max(1, height - SOURCES_VIEWER_CHROME);
    const off = Math.max(0, Math.min(src.srcScroll, Math.max(0, lines.length - budget)));
    const cursor = Math.min(src.srcCursor, Math.max(0, lines.length - 1));
    const gutterW = Math.max(3, String(lines.length).length);
    const bpMarksOrig = bpMarksFor(data.breakpoints, script.url);
    const bpMarks = prettyRes
      ? new Map([...bpMarksOrig].map(([line, kind]) => [displayLineFor(prettyRes, line), kind] as const))
      : bpMarksOrig;
    const frame = paused ? paused.frames[Math.min(src.frameSel, Math.max(0, paused.frames.length - 1))] : undefined;
    const pauseLineOrig = frame && frame.scriptId === script.scriptId ? frame.line : null;
    const pauseLine = prettyRes && pauseLineOrig !== null ? displayLineFor(prettyRes, pauseLineOrig) : pauseLineOrig;
    const cursorOrig = prettyRes ? (prettyRes.displayToOriginal[cursor] ?? 0) : cursor;
    const viewerTags = `${prettyRes ? ' · pretty' : ''}${src.liveEdited.has(script.scriptId) ? ` · ${t('sources.viewer.edited')}` : ''}`;
    const pos = lines.length > budget ? `(${off + 1}-${Math.min(off + budget, lines.length)}/${lines.length})` : `(${lines.length}L)`;
    const cursorBp = script.url
      ? data.breakpoints.find(bp => bp.url === script.url && (bp.resolved?.line ?? bp.line) === cursorOrig)
      : undefined;
    const footer = src.bpEdit
      ? `${BP_GLYPHS[src.bpEdit.kind]} ${t(src.bpEdit.kind === 'logpoint' ? 'sources.viewer.logPrompt' : 'sources.viewer.condPrompt', { line: src.bpEdit.line + 1 })}: ${src.bpEdit.text}▌`
      : text === 'error' ? t('sources.viewer.loadFailed')
      : text === undefined ? t('sources.viewer.loading')
      : cursorBp && cursorBp.kind !== 'line' && cursorBp.condition
        ? `${BP_GLYPHS[cursorBp.kind]} ${cursorBp.condition}`
        : t('sources.viewer.footer');
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Text wrap="truncate">
          {' '}
          <Text bold color="cyan">{truncate(scriptLabel(script), Math.max(10, width - displayWidth(pos) - displayWidth(statusTail) - displayWidth(viewerTags) - 4))}</Text>
          <Text color={theme.muted}>{` ${pos}${viewerTags}${statusTail}`}</Text>
        </Text>
        {rule}
        {padRows(
          text === undefined || text === 'error'
            ? []
            : Array.from({ length: Math.min(budget, Math.max(0, lines.length - off)) }, (_, i) =>
                sourceRow(lines, off + i, { bpMarks, pauseLine, gutterW, width, cursor }, `sv-${i}`)),
          budget,
          'sv',
        )}
        <Text color={src.bpEdit ? 'cyan' : undefined} dimColor={!src.bpEdit} wrap="truncate">{` ${footer}`}</Text>
        {rule}
      </Box>
    );
  }

  if (src.mapScript) {
    const script = src.mapScript;
    const map = src.maps.get(script.scriptId);
    const items = map && map !== 'error' ? map.sources : [];
    const budget = Math.max(1, height - SOURCES_LIST_CHROME);
    const sel = Math.min(src.mapSel, Math.max(0, items.length - 1));
    const start = clampWindowStart(0, items.length, sel, budget);
    const placeholder = map === 'error' ? t('sources.map.loadFailed')
      : map === undefined ? t('sources.map.loading')
      : t('sources.map.empty');
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Text wrap="truncate">
          {' '}
          <Text bold color="cyan">{t('sources.map.title')}</Text>
          <Text color={theme.muted}>{`  ${truncate(scriptLabel(script), Math.max(10, width - 30))} · ${items.length}${statusTail}`}</Text>
        </Text>
        {rule}
        {padRows(
          items.length === 0
            ? [<Text key="me" dimColor wrap="truncate">{` ${placeholder}`}</Text>]
            : items.slice(start, start + budget).map((item, i) => {
                const idx = start + i;
                const selected = idx === sel;
                return (
                  <Text key={`ms-${i}`} wrap="truncate" backgroundColor={selected ? SEL_BG : undefined}>
                    {selected ? <Text color="cyan">▌</Text> : ' '}
                    <Text> {truncate(item, Math.max(10, width - 4))}</Text>
                  </Text>
                );
              }),
          budget,
          'ms',
        )}
        <Text dimColor wrap="truncate">{` ${t('sources.map.footer')}`}</Text>
        {rule}
      </Box>
    );
  }

  if (src.xhrMode || src.eventMode) {
    const budget = Math.max(1, height - SOURCES_LIST_CHROME);
    const items = src.xhrMode ? data.xhrBreakpoints : [...EVENT_BP_CATEGORIES];
    const sel = Math.min(src.xhrMode ? src.xhrSel : src.eventSel, Math.max(0, items.length - 1));
    const start = clampWindowStart(0, items.length, sel, budget);
    const active = new Set(data.eventBreakpoints);
    const footer = src.xhrMode
      ? src.xhrInput !== null
        ? `${t('sources.xhr.prompt')}: ${src.xhrInput}▌`
        : t('sources.xhr.footer')
      : t('sources.event.footer');
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Text wrap="truncate">
          {' '}
          <Text bold color="cyan">{t(src.xhrMode ? 'sources.xhr.title' : 'sources.event.title')}</Text>
          <Text color={theme.muted}>{`  ${src.xhrMode ? items.length : `${active.size}/${items.length}`}${statusTail}`}</Text>
        </Text>
        {rule}
        {padRows(
          items.length === 0
            ? [<Text key="xe" dimColor wrap="truncate">{` ${t('sources.xhr.empty')}`}</Text>]
            : items.slice(start, start + budget).map((item, i) => {
                const idx = start + i;
                const selected = idx === sel;
                return (
                  <Text key={`xb-${i}`} wrap="truncate" backgroundColor={selected ? SEL_BG : undefined}>
                    {selected ? <Text color="cyan">▌</Text> : ' '}
                    {src.eventMode ? <Text color={active.has(item) ? theme.err : theme.faint}>{active.has(item) ? '● ' : '○ '}</Text> : null}
                    <Text>{truncate(item, Math.max(10, width - 6))}</Text>
                  </Text>
                );
              }),
          budget,
          'xb',
        )}
        <Text color={src.xhrInput !== null ? 'cyan' : undefined} dimColor={src.xhrInput === null} wrap="truncate">{` ${footer}`}</Text>
        {rule}
      </Box>
    );
  }

  if (paused && !src.pausedDismissed) {
    const frames = paused.frames;
    const frameSel = Math.min(src.frameSel, Math.max(0, frames.length - 1));
    const frame = frames[frameSel];
    const watchCount = src.watches.length + (src.watchInput !== null ? 1 : 0);
    const { excerptH, stackH, scopeH, watchH } = pausedPaneHeights(height, frames.length, watchCount);
    const text = frame ? src.sources.get(frame.scriptId) : undefined;
    const lines = Array.isArray(text) ? text : [];
    const gutterW = Math.max(3, String(lines.length).length);
    const bpMarks = frame ? bpMarksFor(data.breakpoints, frame.url) : new Map<number, BreakpointKind>();
    const excerptStart = frame
      ? Math.max(0, Math.min(frame.line - Math.floor(excerptH / 2), Math.max(0, lines.length - excerptH)))
      : 0;
    const stackStart = Math.max(0, Math.min(frameSel - stackH + 1, Math.max(0, frames.length - stackH)));
    const scopeLines = data.scopeLines;
    const scopeCursor = Math.min(src.scopeCursor, Math.max(0, scopeLines.length - 1));
    const scopeOff = Math.max(0, Math.min(src.scopeScroll, Math.max(0, scopeLines.length - scopeH)));
    const loc = frame ? shortLoc(frame.url, frame.scriptId, frame.line) : '';
    const frameMap = frame ? src.maps.get(frame.scriptId) : undefined;
    const originLoc = frame && frameMap && frameMap !== 'error' ? originalPositionFor(frameMap, frame.line, frame.column) : null;
    const watchSel = Math.min(src.watchSel, Math.max(0, src.watches.length - 1));
    const watchCursorAt = src.watchInput !== null ? watchCount - 1 : watchSel;
    const watchStart = clampWindowStart(0, watchCount, watchCursorAt, Math.max(1, watchH));
    const watchRows = Array.from({ length: Math.min(watchH, Math.max(0, watchCount - watchStart)) }, (_, i) => {
      const idx = watchStart + i;
      if (idx >= src.watches.length) {
        return (
          <Text key={`pw-${i}`} wrap="truncate" color="cyan">{` + ${src.watchInput ?? ''}▌`}</Text>
        );
      }
      const focused = src.pausedFocus === 'watch' && idx === watchSel;
      const val = src.watchVals[idx];
      return (
        <Text key={`pw-${i}`} wrap="truncate" backgroundColor={focused ? SEL_BG : undefined}>
          {focused ? <Text color="cyan">▌</Text> : ' '}
          <Text color="cyan">{truncate(src.watches[idx], Math.max(6, Math.floor(width / 3)))}</Text>
          <Text color={theme.muted}>{': '}</Text>
          {val === null || val === undefined
            ? <Text dimColor>…</Text>
            : <Text dimColor={val === WATCH_ERROR}>{truncate(val, Math.max(6, width - 8 - Math.min(displayWidth(src.watches[idx]), Math.floor(width / 3))))}</Text>}
        </Text>
      );
    });
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Text wrap="truncate">
          {' '}
          <Text color={theme.warn} bold>{`⏸ ${pauseReasonLabel(paused)}`}</Text>
          {frame ? <Text color={theme.muted}>{`  ${frame.functionName || '(anonymous)'} @ ${loc}`}</Text> : null}
          {originLoc ? <Text color="cyan">{`  ⇐ ${originLoc.source}:${originLoc.line + 1}`}</Text> : null}
          {paused.exceptionText ? <Text color={theme.err}>{`  ${truncate(paused.exceptionText, Math.max(8, width - 30))}`}</Text> : null}
        </Text>
        {rule}
        {padRows(
          Array.isArray(text)
            ? Array.from({ length: Math.min(excerptH, Math.max(0, lines.length - excerptStart)) }, (_, i) =>
                sourceRow(lines, excerptStart + i, { bpMarks, pauseLine: frame?.line ?? null, gutterW, width }, `px-${i}`))
            : [<Text key="px-load" dimColor wrap="truncate">{` ${text === 'error' ? t('sources.viewer.loadFailed') : t('sources.viewer.loading')}`}</Text>],
          excerptH,
          'px',
        )}
        {rule}
        {padRows(
          frames.slice(stackStart, stackStart + stackH).map((f, i) => {
            const idx = stackStart + i;
            const sel = idx === frameSel;
            const focused = sel && src.pausedFocus === 'stack';
            return (
              <Text key={`pf-${i}`} wrap="truncate" backgroundColor={focused ? SEL_BG : undefined}>
                {sel ? <Text color="cyan">▌</Text> : ' '}
                <Text color={theme.muted}>{`${idx} `}</Text>
                <Text>{truncate(f.functionName || '(anonymous)', Math.max(8, width - 30))}</Text>
                <Text color={theme.muted}>{`  ${shortLoc(f.url, f.scriptId, f.line)}`}</Text>
              </Text>
            );
          }),
          stackH,
          'pf',
        )}
        {rule}
        {padRows(
          scopeLines.slice(scopeOff, scopeOff + scopeH).map((line, i) => {
            const idx = scopeOff + i;
            return richRow(line, src.pausedFocus === 'scope' && idx === scopeCursor, `ps-${i}`);
          }),
          scopeH,
          'ps',
        )}
        {watchH > 0 ? rule : null}
        {watchH > 0 ? padRows(watchRows, watchH, 'pw') : null}
      </Box>
    );
  }

  const bpUrls = new Set(data.breakpoints.map(bp => bp.url));
  const bboxUrls = new Set(data.blackboxed);
  const countLabel = data.scripts.length !== data.totalScripts ? `${data.scripts.length}/${data.totalScripts}` : `${data.totalScripts}`;
  const footer = src.srcFilterEditing
    ? `/${src.srcFilter}▌`
    : src.srcFilter
      ? `/${src.srcFilter}`
      : data.totalScripts
        ? t('sources.list.footer')
        : '';
  return (
    <Box flexDirection="column" height={height} width={width}>
      <Text wrap="truncate">
        {' '}
        <Text dimColor>Sources</Text>
        <Text color={theme.muted}>{`  ${t('sources.list.count', { n: countLabel })}${statusTail}`}</Text>
      </Text>
      {rule}
      {padRows(
        data.totalScripts === 0
          ? [<Text key="se" dimColor wrap="truncate">{` ${t('sources.list.empty')}`}</Text>]
          : data.scripts.slice(listStart, listStart + listBudget).map((s, i) => {
              const idx = listStart + i;
              const selected = idx === listSel;
              const bboxed = !!s.url && bboxUrls.has(s.url);
              return (
                <Text key={`sl-${i}`} wrap="truncate" backgroundColor={selected ? SEL_BG : undefined}>
                  {selected ? <Text color="cyan">▌</Text> : ' '}
                  {bpUrls.has(s.url) && s.url
                    ? <Text color={theme.err}>●</Text>
                    : bboxed
                      ? <Text dimColor>⊘</Text>
                      : <Text> </Text>}
                  {s.sourceMapURL ? <Text color="cyan">»</Text> : <Text> </Text>}
                  <Text dimColor={bboxed}> {truncate(scriptLabel(s), Math.max(10, width - 13))}</Text>
                  <Text color={theme.faint}>{`  #${s.scriptId}`}</Text>
                </Text>
              );
            }),
        listBudget,
        'sl',
      )}
      <Text color={src.srcFilterEditing ? 'cyan' : undefined} dimColor={!src.srcFilterEditing} wrap="truncate">{` ${footer}`}</Text>
      {rule}
    </Box>
  );
}
