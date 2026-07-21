import React from 'react';
import { Box, Text } from 'ink';
import type { BoxModel, EventListenerView } from '../../cdp/dom.js';
import type { MatchedRule, PlatformFont } from '../../cdp/css.js';
import { truncate } from '../lib/format.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { highlightHtml, segsToNodes } from '../lib/highlight.js';
import { computeOverridden, flatDecls, ruleDecls, type DeclRef } from '../lib/style-edit.js';
import { resolveVars } from '../lib/css-vars.js';
import type { ClassEntry } from '../lib/class-edit.js';
import { INTERESTING_STYLES } from '../lib/session-context.js';
import { t } from '../lib/i18n.js';

export const DOM_OVERLAY_CHROME = 11;

export function computedRowBudget(height: number): number {
  return Math.max(0, height - DOM_OVERLAY_CHROME) + 1;
}

export interface DomNodeView {
  selector: string;
  nodeId: number;
  outerHTML: string;
  computed: Array<[string, string]>;
  matched: MatchedRule[];
  box: BoxModel | null;
  fonts?: PlatformFont[];
}

export function fontsLine(fonts: PlatformFont[] | undefined): string {
  const list = (fonts ?? []).map(f => `${f.family}${f.custom ? '*' : ''} (glyphs ${f.glyphs})`).join(' · ');
  return `${t('domOverlay.fonts')}: ${list || '—'}`;
}

export interface DomOverlayProps {
  query: string;
  node: DomNodeView | null;
  highlighting: boolean;
  watching: boolean;
  mutationCount: number;
  ruleSelected: number;
  declSel?: number;
  decl?: string;
  declReplace?: boolean;
  computedMode?: boolean;
  computedFilter?: string;
  computedFilterEditing?: boolean;
  computedScroll?: number;
  listenersMode?: boolean;
  listeners?: EventListenerView[];
  listenersScroll?: number;
  classesMode?: boolean;
  classes?: ClassEntry[];
  classesSel?: number;
  classesInput?: string | null;
  pseudo?: string;
  error?: string;
  height?: number;
  width?: number;
}

export function boxLine(box: BoxModel | null): string {
  if (!box) return '— no box —';
  const top = (outer: number[], inner: number[]) => inner.length && outer.length ? Math.round(inner[1] - outer[1]) : 0;
  const left = (outer: number[], inner: number[]) => inner.length && outer.length ? Math.round(inner[0] - outer[0]) : 0;
  const m = box.margin, b = box.border, p = box.padding, c = box.content;
  const margin = `${top(m, b)}/${left(m, b)}`;
  const border = `${top(b, p)}/${left(b, p)}`;
  const padding = `${top(p, c)}/${left(p, c)}`;
  return `box: ${box.width}×${box.height}  margin ${margin} · border ${border} · padding ${padding} (top/left px)`;
}

export interface MatchedLine {
  kind: 'joined' | 'header' | 'decl' | 'close' | 'inherited';
  rule: number;
  decl?: number;
}

export function matchedLines(matched: Array<Pick<MatchedRule, 'properties' | 'declarations' | 'inheritedIndex'>>, expanded: number): MatchedLine[] {
  const out: MatchedLine[] = [];
  let lastGroup: number | undefined;
  matched.forEach((r, i) => {
    if (r.inheritedIndex !== undefined && r.inheritedIndex !== lastGroup) out.push({ kind: 'inherited', rule: i });
    lastGroup = r.inheritedIndex;
    if (i === expanded) {
      out.push({ kind: 'header', rule: i });
      ruleDecls(r).forEach((_, d) => out.push({ kind: 'decl', rule: i, decl: d }));
      out.push({ kind: 'close', rule: i });
    } else {
      out.push({ kind: 'joined', rule: i });
    }
  });
  return out;
}

export function matchedCursorLine(lines: MatchedLine[], ruleSelected: number, declRef: DeclRef | null): number {
  if (declRef) return lines.findIndex(l => l.kind === 'decl' && l.rule === declRef.rule && l.decl === declRef.decl);
  if (ruleSelected >= 0) return lines.findIndex(l => (l.kind === 'header' || l.kind === 'joined') && l.rule === ruleSelected);
  return -1;
}

export function DomOverlay({
  query,
  node,
  highlighting,
  watching,
  mutationCount,
  ruleSelected,
  declSel = -1,
  decl,
  declReplace = false,
  computedMode = false,
  computedFilter = '',
  computedFilterEditing = false,
  computedScroll = 0,
  listenersMode = false,
  listeners = [],
  listenersScroll = 0,
  classesMode = false,
  classes = [],
  classesSel = 0,
  classesInput = null,
  pseudo,
  error,
  height = 24,
  width = 100,
}: DomOverlayProps) {
  const contentBudget = Math.max(0, height - DOM_OVERLAY_CHROME);
  const computedBudget = Math.max(0, Math.min(6, Math.floor(contentBudget / 2)));
  const matchedBudget = Math.max(0, contentBudget - computedBudget);
  const rule = '─'.repeat(width);

  const computed = node ? node.computed : [];
  const matched = node ? node.matched : [];
  const overridden = computeOverridden(matched);
  const flat = flatDecls(matched);
  const declRef = declSel >= 0 && declSel < flat.length ? flat[declSel] : null;
  const lines = matchedLines(matched, ruleSelected);
  const cursorLine = matchedCursorLine(lines, ruleSelected, declRef);
  const mStart = useListWindow(lines.length, Math.max(0, cursorLine), matchedBudget);

  const renderMatchedLine = (line: MatchedLine, key: string): React.ReactNode => {
    const r = matched[line.rule];
    const decls = ruleDecls(r);
    const readOnly = r.styleSheetId === undefined ? <Text dimColor> (read-only)</Text> : null;
    const contexts = r.contexts?.length ? <Text color="magenta" dimColor>{r.contexts.join(' ')} </Text> : null;
    if (line.kind === 'inherited') {
      return <Text key={key} dimColor wrap="truncate">{t('domOverlay.inheritedFrom', { label: r.inheritedFrom ?? '' })}</Text>;
    }
    if (line.kind === 'joined') {
      return (
        <Text key={key} wrap="truncate">
          {contexts}
          <Text color="cyan">{r.selector}</Text>
          <Text dimColor>{' { '}</Text>
          {decls.map((d, di) => (
            <React.Fragment key={`${key}-${di}`}>
              {di > 0 ? <Text dimColor>; </Text> : null}
              {d.parsedOk === false ? <Text color="red">⚠ </Text> : null}
              <Text dimColor={d.disabled || overridden[line.rule][di]} strikethrough={overridden[line.rule][di]}>
                {d.name}: {d.value}
              </Text>
            </React.Fragment>
          ))}
          <Text dimColor>{' }'}</Text>
          {readOnly}
        </Text>
      );
    }
    if (line.kind === 'header') {
      const isCursor = cursorLine >= 0 && lines[cursorLine] === line;
      return (
        <Text key={key} wrap="truncate" inverse={isCursor}>
          {contexts}
          <Text color="cyan">{r.selector}</Text>
          <Text dimColor> {'{'}</Text>
          {readOnly}
        </Text>
      );
    }
    if (line.kind === 'close') {
      return <Text key={key} dimColor wrap="truncate">{'}'}</Text>;
    }
    const d = decls[line.decl!];
    const ov = overridden[line.rule][line.decl!];
    const editable = r.styleSheetId !== undefined && r.ruleRange !== undefined && d.range !== undefined;
    const isCursor = declRef !== null && declRef.rule === line.rule && declRef.decl === line.decl;
    const vars = d.value.includes('var(') ? resolveVars(d.value, computed) : [];
    return (
      <Text key={key} wrap="truncate" inverse={isCursor}>
        {'  '}
        <Text dimColor={!editable}>{editable ? (d.disabled ? '[ ] ' : '[x] ') : '  · '}</Text>
        {d.parsedOk === false ? <Text color="red">⚠ </Text> : null}
        <Text dimColor={d.disabled || ov} strikethrough={ov}>
          <Text color="yellow">{d.name}</Text>: {d.value}
        </Text>
        {vars.length ? <Text dimColor> → {vars.map(v => v.value ?? '?').join(', ')}</Text> : null}
      </Text>
    );
  };

  const filterQ = computedFilter.trim().toLowerCase();
  const computedItems = filterQ
    ? computed.filter(([k, v]) => k.toLowerCase().includes(filterQ) || v.toLowerCase().includes(filterQ))
    : computed;
  const computedRows = computedRowBudget(height);
  const maxComputedScroll = Math.max(0, computedItems.length - computedRows);
  const computedAt = Math.max(0, Math.min(computedScroll, maxComputedScroll));

  const cursorDecl = declRef ? ruleDecls(matched[declRef.rule])[declRef.decl] : null;
  const cursorVars = cursorDecl && cursorDecl.value.includes('var(') ? resolveVars(cursorDecl.value, computed) : [];
  const status = [
    highlighting ? 'highlight:on' : '',
    watching ? `watching (${mutationCount} mutations)` : '',
    pseudo ? `forced ${pseudo}` : '',
    cursorVars.map(v => `${v.name} = ${v.value ?? '?'}`).join(' · '),
  ].filter(Boolean).join('  ') || ' ';

  const inputRow = classesMode
    ? classesInput !== null
      ? <Text wrap="truncate">{t('domOverlay.classPrompt')}: {classesInput}▌</Text>
      : <Text> </Text>
    : computedMode
    ? computedFilterEditing
      ? <Text wrap="truncate">/{computedFilter}▌</Text>
      : computedFilter
        ? <Text wrap="truncate">/{computedFilter}</Text>
        : <Text> </Text>
    : decl !== undefined
      ? <Text wrap="truncate">{declReplace ? 'edit' : 'append'}: {decl}▌</Text>
      : <Text> </Text>;

  const listenerRows = computedRowBudget(height);
  const listenersAt = Math.max(0, Math.min(listenersScroll, Math.max(0, listeners.length - listenerRows)));

  const classRows = computedRowBudget(height);
  const clStart = useListWindow(classes.length, Math.max(0, Math.min(classesSel, classes.length - 1)), classRows);

  const content = classesMode ? (
    <>
      <Text bold>
        classes <Text dimColor>({classes.length})</Text>
      </Text>
      {padRows(
        classes.length === 0
          ? [<Text key="cl-empty" dimColor wrap="truncate">{t('domOverlay.noClasses')}</Text>]
          : classes.slice(clStart, clStart + classRows).map((c, i) => (
              <Text key={`cl-${clStart + i}`} wrap="truncate" inverse={clStart + i === classesSel}>
                {c.on ? '[x] ' : '[ ] '}
                <Text color="yellow">.{c.name}</Text>
              </Text>
            )),
        classRows,
        'classes',
      )}
    </>
  ) : listenersMode ? (
    <>
      <Text bold>
        event listeners <Text dimColor>({listeners.length})</Text>
      </Text>
      {padRows(
        listeners.length === 0
          ? [<Text key="ln-empty" dimColor wrap="truncate">{t('domOverlay.noListeners')}</Text>]
          : listeners.slice(listenersAt, listenersAt + listenerRows).map((l, i) => (
              <Text key={`ln-${listenersAt + i}`} wrap="truncate">
                <Text color="yellow">{l.type}</Text>
                <Text dimColor>{`${l.useCapture ? ' capture' : ''}${l.once ? ' once' : ''}${l.passive ? ' passive' : ''}`}</Text>
                {l.handler ? ` ${l.handler}` : ''}
                {l.scriptId !== undefined ? <Text dimColor> @{l.scriptId}:{(l.lineNumber ?? 0) + 1}:{(l.columnNumber ?? 0) + 1}</Text> : null}
              </Text>
            )),
        listenerRows,
        'listeners',
      )}
    </>
  ) : computedMode ? (
    <>
      <Text bold>
        computed <Text dimColor>({computedItems.length}/{computed.length})</Text>
      </Text>
      {padRows(
        computedItems.slice(computedAt, computedAt + computedRows).map(([k, v], i) => (
          <Text key={`cm-${computedAt + i}-${k}`} wrap="truncate">
            <Text color="yellow">{k}</Text>: {v}
          </Text>
        )),
        computedRows,
        'computed-full',
      )}
    </>
  ) : (
    <>
      <Text bold>computed</Text>
      {padRows(
        node
          ? [
              <Text key="c-fonts" dimColor wrap="truncate">{fontsLine(node.fonts)}</Text>,
              ...computed
                .filter(([k]) => INTERESTING_STYLES.includes(k))
                .slice(0, Math.max(0, computedBudget - 1))
                .map(([k, v]) => <Text key={`c-${k}`} wrap="truncate">{k}: {v}</Text>),
            ].slice(0, computedBudget)
          : [],
        computedBudget,
        'computed',
      )}
      <Text bold>matched rules</Text>
      {padRows(
        lines.slice(mStart, mStart + matchedBudget).map((line, i) => renderMatchedLine(line, `m-${mStart + i}`)),
        matchedBudget,
        'matched',
      )}
    </>
  );

  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>Elements</Text>
      <Text wrap="truncate">selector: {query}</Text>
      <Text dimColor wrap="truncate">{rule}</Text>
      {node ? (
        <Text wrap="truncate">
          <Text color="cyan">#{node.nodeId}</Text> {segsToNodes(highlightHtml(truncate(node.outerHTML.split('\n')[0], 80)), 'outer')}
        </Text>
      ) : <Text> </Text>}
      {node ? <Text dimColor wrap="truncate">{boxLine(node.box)}</Text> : <Text> </Text>}
      {content}
      {inputRow}
      <Text dimColor wrap="truncate">{status}</Text>
      {error ? <Text color="red" wrap="truncate">{error}</Text> : <Text> </Text>}
      <Text dimColor wrap="truncate">{rule}</Text>
    </Box>
  );
}
