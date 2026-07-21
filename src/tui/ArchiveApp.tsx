import React, { useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, type Key } from 'ink';
import type { ArchiveData } from '../archive.js';
import { useTerminalSize } from './hooks/use-terminal-size.js';
import { NetworkPanel, filterEntries, type TypeFilter } from './panels/NetworkPanel.js';
import { ConsolePanel, filterConsoleEntries } from './panels/ConsolePanel.js';
import { CONSOLE_DETAIL_CHROME, ConsoleDetailOverlay, consoleDetailLines } from './overlays/ConsoleDetailOverlay.js';
import type { ConsoleEntry, ConsoleKind } from '../store/types.js';
import { DetailOverlay, DETAIL_CHROME, detailTabsFor, detailTabRich, type DetailTab } from './overlays/DetailOverlay.js';
import { ToolTabs } from './panels/ToolTabs.js';
import { theme } from './lib/theme.js';
import { WINDOWS } from './lib/windows.js';
import { dispatchInput, makeListNav } from './lib/keys.js';
import { wrapApplies } from './lib/hints.js';
import { t, useLang } from './lib/i18n.js';

export interface ArchiveAppProps {
  data: ArchiveData;
  limitation?: string;
}

const TOOLS = [
  { key: 'network', label: 'Network' },
  { key: 'console', label: 'Console' },
] as const;

const TYPE_ORDER: TypeFilter[] = ['all', 'xhr', 'js', 'css', 'img', 'ws', 'doc', 'font', 'other'];

const LEVEL_ORDER: Array<'all' | ConsoleKind> = ['all', 'error', 'warn', 'info', 'log', 'debug', 'browser'];

export function ArchiveApp({ data, limitation }: ArchiveAppProps) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  useLang();
  const [focus, setFocus] = useState<'network' | 'console'>('network');
  const [netSel, setNetSel] = useState(0);
  const [conSel, setConSel] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [urlFilter, setUrlFilter] = useState('');
  const [filterEditing, setFilterEditing] = useState(false);
  const [conLevel, setConLevel] = useState<'all' | ConsoleKind>('all');
  const [conFilter, setConFilter] = useState('');
  const [conDetail, setConDetail] = useState<ConsoleEntry | null>(null);
  const [conDetailScroll, setConDetailScroll] = useState(0);
  const [conDetailWrap, setConDetailWrap] = useState(true);
  const [win, setWin] = useState(0);
  const [detail, setDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('summary');
  const [detailScroll, setDetailScroll] = useState(0);
  const [detailWrap, setDetailWrap] = useState(false);
  const gPending = useRef(false);

  const frameH = Math.max(14, rows - 1);
  const chrome = limitation ? 7 : 6;
  const bodyH = Math.max(8, frameH - chrome);
  const detailH = Math.max(1, bodyH - DETAIL_CHROME);

  const maxTs = data.network.reduce((m, e) => Math.max(m, e.startTs), 0);
  const sinceTs = WINDOWS[win].ms ? maxTs - WINDOWS[win].ms : undefined;
  const netEntries = filterEntries(data.network, typeFilter, urlFilter, sinceTs);
  const conEntries = filterConsoleEntries(data.console, conLevel === 'all' ? [] : [conLevel], conFilter);
  const clampedNet = Math.min(netSel, Math.max(0, netEntries.length - 1));
  const clampedCon = Math.min(conSel, Math.max(0, conEntries.length - 1));
  const selEntry = netEntries[clampedNet];
  const detailRich = useMemo(
    () => (detail && selEntry ? detailTabRich(selEntry, detailTab, columns, detailWrap) : []),
    [detail, selEntry, detailTab, columns, detailWrap],
  );
  const detailMaxScroll = Math.max(0, detailRich.length - detailH);
  const conDetailRich = useMemo(
    () => (conDetail ? consoleDetailLines(conDetail, columns, conDetailWrap) : []),
    [conDetail, columns, conDetailWrap],
  );
  const conDetailBudget = Math.max(1, bodyH - CONSOLE_DETAIL_CHROME);
  const conDetailMaxScroll = Math.max(0, conDetailRich.length - conDetailBudget);

  const listNav = makeListNav(gPending);

  const handleKey = (input: string, key: Key) => {
    if (input !== 'g') gPending.current = false;
    if (filterEditing) {
      const setFilter = focus === 'network' ? setUrlFilter : setConFilter;
      if (key.return || key.escape) setFilterEditing(false);
      else if (key.backspace || key.delete) setFilter(f => f.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setFilter(f => f + input);
      return;
    }
    if (conDetail) {
      if (key.escape || input === 'q') {
        setConDetail(null);
        setConDetailScroll(0);
        return;
      }
      if (input === 'w') {
        setConDetailWrap(w => !w);
        return;
      }
      const page = Math.max(1, Math.floor(conDetailBudget / 2));
      if (key.downArrow || input === 'j') setConDetailScroll(s => Math.min(s + 1, conDetailMaxScroll));
      else if (key.upArrow || input === 'k') setConDetailScroll(s => Math.max(0, s - 1));
      else if (key.ctrl && input === 'd') setConDetailScroll(s => Math.min(s + page, conDetailMaxScroll));
      else if (key.ctrl && input === 'u') setConDetailScroll(s => Math.max(0, s - page));
      else if (input === 'G') setConDetailScroll(conDetailMaxScroll);
      else if (input === 'g') {
        if (gPending.current) {
          gPending.current = false;
          setConDetailScroll(0);
        } else {
          gPending.current = true;
        }
      }
      return;
    }
    if (detail && selEntry) {
      const tabs = detailTabsFor(selEntry);
      if (key.escape || input === 'q') {
        setDetail(false);
        setDetailScroll(0);
        return;
      }
      if (input >= '1' && input <= String(tabs.length)) {
        setDetailTab(tabs[Number(input) - 1]);
        setDetailScroll(0);
        return;
      }
      if (input === 'l' || key.rightArrow) {
        setDetailTab(t => tabs[(tabs.indexOf(t) + 1) % tabs.length]);
        setDetailScroll(0);
        return;
      }
      if (input === 'h' || key.leftArrow) {
        setDetailTab(t => tabs[(tabs.indexOf(t) + tabs.length - 1) % tabs.length]);
        setDetailScroll(0);
        return;
      }
      if (input === 'w') {
        setDetailWrap(w => !w);
        return;
      }
      const page = Math.max(1, Math.floor(detailH / 2));
      if (key.downArrow || input === 'j') setDetailScroll(s => Math.min(s + 1, detailMaxScroll));
      else if (key.upArrow || input === 'k') setDetailScroll(s => Math.max(0, s - 1));
      else if (key.ctrl && input === 'd') setDetailScroll(s => Math.min(s + page, detailMaxScroll));
      else if (key.ctrl && input === 'u') setDetailScroll(s => Math.max(0, s - page));
      else if (input === 'G') setDetailScroll(detailMaxScroll);
      else if (input === 'g') {
        if (gPending.current) {
          gPending.current = false;
          setDetailScroll(0);
        } else {
          gPending.current = true;
        }
      }
      return;
    }
    if (input === 'q' || (key.ctrl && input === 'c')) { exit(); return; }
    if (input === '1') { setFocus('network'); return; }
    if (input === '2') { setFocus('console'); return; }
    if (input === 'w') { setWin(w => (w + 1) % WINDOWS.length); setNetSel(0); return; }
    if (focus === 'network') {
      const page = Math.max(1, Math.floor((bodyH - 3) / 2));
      if (listNav(input, key, netEntries.length, setNetSel, page)) return;
      if (input === 'x') { setTypeFilter(t => TYPE_ORDER[(TYPE_ORDER.indexOf(t) + 1) % TYPE_ORDER.length]); setNetSel(0); }
      else if (input === '/') setFilterEditing(true);
      else if (key.return && selEntry) {
        setDetailTab('summary');
        setDetailScroll(0);
        setDetail(true);
      }
    } else {
      const page = Math.max(1, Math.floor((bodyH - 2) / 2));
      if (listNav(input, key, conEntries.length, setConSel, page)) return;
      if (input === 'x') { setConLevel(l => LEVEL_ORDER[(LEVEL_ORDER.indexOf(l) + 1) % LEVEL_ORDER.length]); setConSel(0); }
      else if (input === '/') setFilterEditing(true);
      else if (key.return && conEntries.length) {
        setConDetailScroll(0);
        setConDetail(conEntries[clampedCon]);
      } else if (input === ' ' && conEntries.length) {
        setExpanded(prev => {
          const next = new Set(prev);
          if (next.has(clampedCon)) next.delete(clampedCon);
          else next.add(clampedCon);
          return next;
        });
      }
    }
  };

  useInput((input, key) => dispatchInput(input, key, handleKey, !filterEditing));

  const rule = () => <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, columns))}</Text>;

  const content = detail && selEntry ? (
    <DetailOverlay entry={selEntry} tab={detailTab} scroll={detailScroll} height={bodyH} width={columns} lines={detailRich} />
  ) : conDetail ? (
    <ConsoleDetailOverlay entry={conDetail} scroll={conDetailScroll} height={bodyH} width={columns} lines={conDetailRich} wrap={conDetailWrap} />
  ) : (
    <Box flexDirection="column" height={bodyH} width={columns}>
      {focus === 'network' ? (
        <NetworkPanel entries={netEntries} selected={clampedNet} focused height={bodyH - 1} width={columns} />
      ) : (
        <ConsolePanel entries={conEntries} selected={clampedCon} expanded={expanded} focused height={bodyH - 1} width={columns} />
      )}
      {rule()}
    </Box>
  );

  const count = focus === 'network'
    ? `${netEntries.length !== data.network.length ? `${netEntries.length}/` : ''}${t('status.count', { n: data.network.length })}${WINDOWS[win].label !== 'all' ? ` · window:${WINDOWS[win].label}` : ''}${typeFilter !== 'all' ? ` · [${typeFilter}]` : ''}`
    : `${conEntries.length !== data.console.length ? `${conEntries.length}/` : ''}${t('status.count', { n: data.console.length })}${conLevel !== 'all' ? ` · [${conLevel}]` : ''}`;

  return (
    <Box flexDirection="column" width={columns} height={frameH}>
      <Box paddingX={1} width={columns} justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={theme.key}>▸ </Text>
          <Text bold>archive: {data.meta?.url ?? '(session)'}</Text>
        </Text>
        <Text color={theme.muted} wrap="truncate">  {t('archive.offline')}</Text>
      </Box>
      {limitation ? <Text color={theme.muted} wrap="truncate"> {limitation}</Text> : null}
      {rule()}
      <ToolTabs active={focus} tools={TOOLS} width={columns} />
      {content}
      <Box paddingX={1} width={columns}>
        <Text wrap="truncate">
          {(detail
            ? ([
                ['1-4 h/l', t('hint.tab')],
                ['j/k', t('hint.scroll')],
                ...(wrapApplies(detailTab, !!selEntry?.postData) ? [['w', t('hint.wrap')]] : []),
                ['Esc', t('hint.close')],
              ] as Array<[string, string]>)
            : conDetail
              ? ([
                  ['j/k', t('hint.scroll')],
                  ['w', t('hint.wrap')],
                  ['Esc', t('hint.close')],
                ] as Array<[string, string]>)
              : focus === 'console'
                ? ([['1/2', t('archive.tools')], ['Enter', t('hint.detail')], ['␣', t('hint.stack')], ['/', t('hint.filter')], ['x', t('hint.level')], ['q', t('hint.quit')]] as Array<[string, string]>)
                : ([['1/2', t('archive.tools')], ['Enter', t('hint.detail')], ['/', t('hint.filter')], ['w', t('archive.window')], ['q', t('hint.quit')]] as Array<[string, string]>)
          ).map(([k, l], i, arr) => (
            <Text key={`${k}-${i}`}>
              <Text color={theme.key}>{k}</Text>
              <Text color={theme.muted}> {l}{i < arr.length - 1 ? '   ' : ''}</Text>
            </Text>
          ))}
        </Text>
      </Box>
      <Box paddingX={1} width={columns}>
        <Text wrap="truncate">
          <Text dimColor>{count}</Text>
          {(() => {
            const f = focus === 'network' ? urlFilter : conFilter;
            return f || filterEditing ? <Text color="cyan"> · /{f}{filterEditing ? '▌' : ''}</Text> : null;
          })()}
        </Text>
      </Box>
    </Box>
  );
}
