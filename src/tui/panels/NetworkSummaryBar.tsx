import React from 'react';
import { Box, Text } from 'ink';
import { fmtBytes, fmtMs, truncate } from '../lib/format.js';
import type { NetSummary } from '../lib/net-summary.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export interface NetworkSummaryBarProps {
  summary: NetSummary;
  total: number;
  marked: number;
  domContentLoadedMs?: number;
  loadMs?: number;
  width: number;
}

export function NetworkSummaryBar({ summary, total, marked, domContentLoadedMs, loadMs, width }: NetworkSummaryBarProps): React.JSX.Element {
  const countStr = summary.count !== total ? `${summary.count}/${total}` : `${total}`;
  const parts = [
    t('status.count', { n: countStr }),
    `${fmtBytes(summary.transferred)} ${t('net.summary.transferred')}`,
    `${fmtBytes(summary.resources)} ${t('net.summary.resources')}`,
  ];
  if (marked > 0) parts.push(`◆${marked}`);
  if (domContentLoadedMs !== undefined) parts.push(`DCL ${fmtMs(domContentLoadedMs)}`);
  if (loadMs !== undefined) parts.push(`Load ${fmtMs(loadMs)}`);
  const text = truncate(`▸ ${parts.join(' · ')}`, Math.max(3, width - 2));
  return (
    <Box width={width} paddingX={1}>
      <Text color={theme.muted} wrap="truncate">{text}</Text>
    </Box>
  );
}
