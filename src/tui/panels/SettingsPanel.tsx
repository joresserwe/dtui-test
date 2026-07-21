import React from 'react';
import { Box, Text } from 'ink';
import type { SettingRow } from '../../settings.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { t } from '../lib/i18n.js';

export interface SettingsPanelProps {
  rows: SettingRow[];
  query: string;
  searching?: boolean;
  selected: number;
  editing?: { key: string; value: string };
  error?: string;
  height?: number;
  width?: number;
}

type DisplayRow =
  | { kind: 'header'; section: string }
  | { kind: 'row'; row: SettingRow; index: number };

export function SettingsPanel({ rows, query, searching, selected, editing, error, height = 14, width = 80 }: SettingsPanelProps) {
  const budget = Math.max(0, height - 6);
  const rule = '─'.repeat(width);
  const filtering = query.length > 0;

  const disp: DisplayRow[] = [];
  const rowDisp: number[] = [];
  let section = '';
  rows.forEach((row, index) => {
    if (!filtering && row.section !== section) {
      disp.push({ kind: 'header', section: row.section });
      section = row.section;
    }
    rowDisp[index] = disp.length;
    disp.push({ kind: 'row', row, index });
  });

  const start = useListWindow(disp.length, rowDisp[selected] ?? 0, budget);
  const listNodes: React.ReactNode[] = padRows(rows.length === 0
    ? [<Text key="none" dimColor> {t('panel.settings.noMatch')}</Text>]
    : disp.slice(start, start + budget).map((d, i) => renderDisplay(d, i, selected, editing, width)), budget, 'pad');

  const searchNode = searching
    ? <Text wrap="truncate">/{query}<Text color="cyan">▌</Text></Text>
    : query
      ? <Text wrap="truncate">/{query}</Text>
      : <Text dimColor wrap="truncate">{t('panel.settings.searchPlaceholder')}</Text>;

  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>Settings</Text>
      {searchNode}
      <Text dimColor wrap="truncate">{rule}</Text>
      {listNodes.slice(0, budget)}
      {editing
        ? <Text wrap="truncate">edit {editing.key}: {editing.value}<Text color="cyan">▌</Text></Text>
        : <Text> </Text>}
      {error ? <Text color="red" wrap="truncate">{error}</Text> : <Text> </Text>}
      <Text dimColor wrap="truncate">{rule}</Text>
    </Box>
  );
}

function renderDisplay(
  d: DisplayRow,
  key: number,
  selected: number,
  editing: { key: string; value: string } | undefined,
  width: number,
): React.ReactNode {
  if (d.kind === 'header') {
    const rest = Math.max(0, width - 4 - d.section.length);
    return <Text key={`h-${key}`} dimColor wrap="truncate">── {d.section} {'─'.repeat(rest)}</Text>;
  }
  const r = d.row;
  const sel = d.index === selected;
  const gutter = sel ? <Text color="cyan">▌</Text> : ' ';
  const keyText = r.key.padEnd(14);

  let valueNode: React.ReactNode;
  let valueLen: number;
  if (editing && editing.key === r.key) {
    valueNode = <>{editing.value}<Text color="cyan">▌</Text></>;
    valueLen = editing.value.length + 1;
  } else if (r.kind === 'enum' && r.options) {
    valueNode = r.options.map((opt, i) => (
      <React.Fragment key={opt}>
        {i > 0 ? <Text dimColor>│</Text> : null}
        {r.value === opt
          ? <Text inverse color="cyan"> {opt} </Text>
          : <Text dimColor> {opt} </Text>}
      </React.Fragment>
    ));
    valueLen = r.options.map(opt => ` ${opt} `).join('│').length;
  } else {
    valueNode = r.value;
    valueLen = r.value.length;
  }

  void valueLen;
  return (
    <Box key={r.key} width={width} justifyContent="space-between">
      <Text wrap="truncate" backgroundColor={sel ? '#223543' : undefined}>
        {gutter} {keyText}{valueNode}
      </Text>
      <Text dimColor wrap="truncate">  {r.description} </Text>
    </Box>
  );
}
