import React from 'react';
import { Box, Text } from 'ink';
import type { TabGroup } from '../lib/tabs-model.js';
import type { PageTarget } from '../../cdp/targets.js';
import { displayWidth, isSubseq, truncateWidth } from '../lib/format.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export interface PickerSection {
  browser: string;
  groups: TabGroup[];
}

export interface PickerSessionRow {
  key: string;
  targetId: string;
  title: string;
  url: string;
  count: number;
  status: 'live' | 'reconnecting';
  viewed: boolean;
}

export type PickerItem =
  | { kind: 'session'; session: PickerSessionRow }
  | { kind: 'tab'; tab: PageTarget; section: number; otherWindow: boolean }
  | { kind: 'new-tab' };

export function pickerItems(sections: PickerSection[], q: string, attachedId?: string, sessions: PickerSessionRow[] = []): PickerItem[] {
  const needle = q.toLowerCase();
  const items: PickerItem[] = [];
  for (const session of sessions) {
    if (needle && !isSubseq(`${session.title} ${session.url}`, needle)) continue;
    items.push({ kind: 'session', session });
  }
  const owned = new Set(sessions.map(s => s.targetId));
  sections.forEach((section, si) => {
    const attachedGroup = attachedId === undefined
      ? undefined
      : section.groups.find(g => g.tabs.some(t => t.id === attachedId));
    for (const group of section.groups) {
      for (const tab of group.tabs) {
        if (owned.has(tab.id)) continue;
        if (needle && !isSubseq(`${tab.title} ${tab.url}`, needle)) continue;
        const otherWindow = attachedGroup !== undefined && group !== attachedGroup;
        items.push({ kind: 'tab', tab, section: si, otherWindow });
      }
    }
  });
  items.push({ kind: 'new-tab' });
  return items;
}

export interface TabPickerProps {
  sections: PickerSection[];
  query: string;
  selected: number;
  attachedId?: string;
  sessions?: PickerSessionRow[];
  confirmClose?: boolean;
  height: number;
  width?: number;
}

type DisplayRow =
  | { kind: 'header'; label: string }
  | { kind: 'empty' }
  | { kind: 'item'; item: PickerItem; index: number };

export function TabPicker({ sections, query, selected, attachedId, sessions = [], confirmClose = false, height, width = 80 }: TabPickerProps): React.JSX.Element {
  const items = pickerItems(sections, query, attachedId, sessions);
  const matches = items.reduce((n, it) => (it.kind !== 'new-tab' ? n + 1 : n), 0);
  const total = pickerItems(sections, '', attachedId, sessions).length - 1;
  const multi = sections.length > 1;
  const inner = width - 4;
  const budget = Math.max(0, height - 5);

  const rows: DisplayRow[] = [];
  const itemRow: number[] = [];
  const grouped = items.some(it => it.kind === 'session');
  let sessionHeaded = false;
  let tabHeaded = false;
  let headedSection = -1;
  items.forEach((item, idx) => {
    if (item.kind === 'session' && !sessionHeaded) {
      rows.push({ kind: 'header', label: t('picker.tab.sessions') });
      sessionHeaded = true;
    }
    if (item.kind === 'tab') {
      if (grouped && !tabHeaded) {
        rows.push({ kind: 'header', label: t('picker.tab.tabs') });
        tabHeaded = true;
      }
      if (multi && item.section !== headedSection) {
        rows.push({ kind: 'header', label: sections[item.section].browser });
        headedSection = item.section;
      }
    } else if (item.kind === 'new-tab' && matches === 0) {
      rows.push({ kind: 'empty' });
    }
    itemRow[idx] = rows.length;
    rows.push({ kind: 'item', item, index: idx });
  });

  const start = useListWindow(rows.length, itemRow[selected] ?? 0, budget);
  const visible = padRows(rows.slice(start, start + budget).map((row, i) => renderRow(row, i, selected, attachedId, inner)), budget, 'pad');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} backgroundColor={theme.overlayBg}>
      <Box justifyContent="space-between">
        <Text wrap="truncate"><Text bold color="cyan">❯ </Text>{query}<Text color="cyan">▌</Text></Text>
        <Text dimColor> {matches}/{total}</Text>
      </Box>
      <Text dimColor wrap="truncate">── {t('picker.tab.title')} {'─'.repeat(Math.max(0, inner - displayWidth(t('picker.tab.title')) - 4))}</Text>
      {visible.slice(0, budget)}
      {confirmClose ? (
        <Text color={theme.warn} wrap="truncate">{t('picker.tab.footerConfirm')}</Text>
      ) : (
        <Text dimColor wrap="truncate">{t('picker.tab.footer')}</Text>
      )}
    </Box>
  );
}

function renderRow(row: DisplayRow, key: number, selected: number, attachedId: string | undefined, inner: number): React.ReactNode {
  if (row.kind === 'header') {
    const rest = Math.max(0, inner - displayWidth(row.label) - 4);
    return <Text key={`h-${key}`} dimColor wrap="truncate">── {row.label} {'─'.repeat(rest)}</Text>;
  }
  if (row.kind === 'empty') {
    return <Text key={`e-${key}`} dimColor wrap="truncate">  {t('picker.tab.noMatch')}</Text>;
  }
  const on = row.index === selected;
  const gutter = on ? <Text color="cyan" bold>❯ </Text> : '  ';
  if (row.item.kind === 'new-tab') {
    const body = t('picker.tab.newTab');
    const pad = ' '.repeat(Math.max(0, inner - 2 - displayWidth(body)));
    return (
      <Text key="new-tab" backgroundColor={on ? '#223543' : undefined} wrap="truncate">
        {gutter}<Text dimColor={!on}>{body}</Text>{pad}
      </Text>
    );
  }
  if (row.item.kind === 'session') {
    const s = row.item.session;
    const mark = s.viewed ? (
      <Text color={theme.key}>▸ </Text>
    ) : s.status === 'reconnecting' ? (
      <Text color={theme.warn}>↻ </Text>
    ) : (
      <Text color={theme.key}>● </Text>
    );
    const avail = Math.max(0, inner - 4);
    const title = truncateWidth(s.title || s.url, Math.min(avail, 48));
    const titleW = displayWidth(title);
    const sfxBudget = avail - titleW - 2;
    const sfxRaw = `${t('status.count', { n: s.count })} · ${s.url.replace(/^https?:\/\//, '')}`;
    const sfx = sfxBudget > 3 ? truncateWidth(sfxRaw, sfxBudget) : '';
    const used = 4 + titleW + (sfx ? displayWidth(sfx) + 2 : 0);
    const pad = ' '.repeat(Math.max(0, inner - used));
    return (
      <Text key={`s-${s.key}`} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
        {gutter}{mark}<Text bold={on || s.viewed}>{title}</Text>
        {sfx ? <Text dimColor>  {sfx}</Text> : null}
        {pad}
      </Text>
    );
  }
  const tab = row.item.tab;
  const attached = tab.id === attachedId;
  const gutter2 = attached ? <Text color="cyan">▸ </Text> : <Text dimColor>○ </Text>;
  const suffix = row.item.otherWindow ? t('picker.tab.otherWindow') : '';
  const suffixW = displayWidth(suffix);
  const avail = Math.max(0, inner - 4 - suffixW);
  const title = truncateWidth(tab.title || tab.url, Math.min(avail, 48));
  const titleW = displayWidth(title);
  const urlBudget = avail - titleW - 2;
  const url = urlBudget > 3 ? truncateWidth(tab.url.replace(/^https?:\/\//, ''), urlBudget) : '';
  const used = 4 + titleW + suffixW + (url ? displayWidth(url) + 2 : 0);
  const pad = ' '.repeat(Math.max(0, inner - used));
  return (
    <Text key={tab.id} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
      {gutter}{gutter2}<Text bold={on}>{title}</Text>
      {suffix ? <Text dimColor>{suffix}</Text> : null}
      {url ? <Text dimColor>  {url}</Text> : null}
      {pad}
    </Text>
  );
}
