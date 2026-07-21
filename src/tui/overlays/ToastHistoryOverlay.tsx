import React from 'react';
import { Box, Text } from 'ink';
import { displayToast, TOAST_COLORS, TOAST_ICONS, type ToastEntry } from '../lib/toast-manager.js';
import { useListWindow } from '../lib/list-window.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export const TOAST_HISTORY_CHROME = 5;

export interface ToastHistoryOverlayProps {
  entries: ToastEntry[];
  selected: number;
  height?: number;
  width?: number;
}

const two = (n: number): string => String(n).padStart(2, '0');
const clock = (ts: number): string => {
  const d = new Date(ts);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

export function ToastHistoryOverlay({ entries, selected, height = 16, width = 72 }: ToastHistoryOverlayProps) {
  const inner = Math.max(20, width - 4);
  const budget = Math.max(1, height - TOAST_HISTORY_CHROME);
  const sel = Math.min(selected, Math.max(0, entries.length - 1));
  const start = useListWindow(entries.length, sel, budget);
  const visible = entries.slice(start, start + budget);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} backgroundColor={theme.overlayBg}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">{t('toastHistory.title')}</Text>
        {entries.length > budget ? <Text dimColor>{`${start + visible.length}/${entries.length}`}</Text> : null}
      </Box>
      <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, inner))}</Text>
      {entries.length === 0 ? (
        <Text dimColor>{t('toastHistory.empty')}</Text>
      ) : (
        visible.map((e, i) => {
          const on = start + i === sel;
          const icon = TOAST_ICONS[e.level];
          return (
            <Text key={e.id} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
              {on ? <Text color="cyan" bold>❯ </Text> : '  '}
              <Text color={theme.muted}>{clock(e.ts)}</Text>
              {'  '}
              {icon ? <Text color={TOAST_COLORS[e.level]}>{icon} </Text> : null}
              <Text bold={on}>{displayToast(e)}</Text>
            </Text>
          );
        })
      )}
      <Text dimColor wrap="truncate">{t('toastHistory.footer')}</Text>
    </Box>
  );
}
