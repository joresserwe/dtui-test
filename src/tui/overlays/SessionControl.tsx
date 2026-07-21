import React from 'react';
import { Box, Text } from 'ink';
import type { ThrottleName } from '../../engine.js';
import { displayWidth, truncate } from '../lib/format.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export const SESSION_CONTROL_ROWS = 6;

export interface SessionControlProps {
  title: string;
  throttle: ThrottleName;
  cacheDisabled: boolean;
  overrideCount: number;
  blockCount: number;
  selected: number;
  width?: number;
}

interface Row {
  label: string;
  value: string;
  active: boolean;
  enumRow?: boolean;
  keyLabel: string;
}

export function SessionControl({ title, throttle, cacheDisabled, overrideCount, blockCount, selected, width = 60 }: SessionControlProps) {
  const rows: Row[] = [
    { label: t('sessionControl.throttle'), value: throttle, active: throttle !== 'off', enumRow: true, keyLabel: '(T)' },
    { label: t('sessionControl.cache'), value: cacheDisabled ? 'on' : 'off', active: cacheDisabled, keyLabel: '(u)' },
    { label: t('sessionControl.overrides'), value: t('sessionControl.count', { n: overrideCount }), active: overrideCount > 0, keyLabel: '(^O)' },
    { label: t('sessionControl.block'), value: t('sessionControl.count', { n: blockCount }), active: blockCount > 0, keyLabel: '(^B)' },
    { label: t('sessionControl.exportHar'), value: t('sessionControl.run'), active: false, keyLabel: '(H)' },
    { label: t('sessionControl.openFolder'), value: t('sessionControl.run'), active: false, keyLabel: '' },
  ];
  const inner = Math.max(20, width - 4);
  const labelW = Math.max(...rows.map(r => displayWidth(r.label))) + 2;
  const heading = `${t('sessionControl.title')} · ${truncate(title, Math.max(4, inner - displayWidth(t('sessionControl.title')) - 3))}`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} backgroundColor={theme.overlayBg}>
      <Text bold color="cyan" wrap="truncate">{heading}</Text>
      <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, inner))}</Text>
      {rows.map((r, i) => {
        const on = i === selected;
        const value = r.enumRow && on ? `◂ ${r.value} ▸` : r.value;
        const used = 2 + labelW + displayWidth(value) + displayWidth(r.keyLabel);
        const pad = ' '.repeat(Math.max(1, inner - used));
        return (
          <Text key={r.label} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
            {on ? <Text color="cyan" bold>❯ </Text> : '  '}
            <Text bold={on}>{r.label}</Text>
            {' '.repeat(Math.max(1, labelW - displayWidth(r.label)))}
            <Text color={r.active ? theme.warn : theme.muted} bold={on}>{value}</Text>
            {pad}
            <Text color={theme.faint}>{r.keyLabel}</Text>
          </Text>
        );
      })}
      <Text dimColor wrap="truncate">{t('sessionControl.footer')}</Text>
    </Box>
  );
}
