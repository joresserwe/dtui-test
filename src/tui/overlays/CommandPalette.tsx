import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth, truncateWidth } from '../lib/format.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { filterCommands, type Command } from '../lib/commands.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export interface CommandPaletteProps {
  commands: Command[];
  query: string;
  selected: number;
  height: number;
  width?: number;
}

export function CommandPalette({ commands, query, selected, height, width = 64 }: CommandPaletteProps): React.JSX.Element {
  const items = filterCommands(commands, query);
  const inner = width - 4;
  const budget = Math.max(1, height - 5);
  const sel = Math.min(selected, Math.max(0, items.length - 1));
  const start = useListWindow(items.length, sel, budget);

  const rows = items.slice(start, start + budget).map((cmd, i) => {
    const idx = start + i;
    const on = idx === sel;
    const gutter = on ? <Text color="cyan" bold>❯ </Text> : '  ';
    const keyW = displayWidth(cmd.keyLabel);
    const label = truncateWidth(t(cmd.label), Math.max(0, inner - 2 - keyW - 2));
    const pad = ' '.repeat(Math.max(2, inner - 2 - displayWidth(label) - keyW));
    return (
      <Text key={cmd.id} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
        {gutter}<Text bold={on}>{label}</Text>{pad}<Text dimColor>{cmd.keyLabel}</Text>
      </Text>
    );
  });
  if (!items.length) rows.push(<Text key="empty" dimColor wrap="truncate">  {t('palette.noMatch')}</Text>);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} backgroundColor={theme.overlayBg}>
      <Box justifyContent="space-between">
        <Text wrap="truncate"><Text bold color="cyan">❯ </Text>{query}<Text color="cyan">▌</Text></Text>
        <Text dimColor> {items.length}/{commands.length}</Text>
      </Box>
      <Text dimColor wrap="truncate">── {t('palette.title')} {'─'.repeat(Math.max(0, inner - displayWidth(t('palette.title')) - 4))}</Text>
      {padRows(rows, budget, 'cp')}
      <Text dimColor wrap="truncate">{t('palette.footer')}</Text>
    </Box>
  );
}
