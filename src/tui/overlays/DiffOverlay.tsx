import React from 'react';
import { Box, Text } from 'ink';
import type { NetworkEntry } from '../../store/types.js';
import { displayWidth, truncateWidth } from '../lib/format.js';
import { segsToNodes } from '../lib/highlight.js';
import { methodColor, theme } from '../lib/theme.js';
import type { Line } from './DetailOverlay.js';

export const DIFF_CHROME = 4;

export interface DiffOverlayProps {
  a: NetworkEntry;
  b: NetworkEntry;
  scroll: number;
  height?: number;
  width?: number;
  lines: Line[];
}

function sideRow(tag: string, e: NetworkEntry, width: number): React.ReactNode {
  const badge = ` ${tag} `;
  const method = ` ${e.method} `;
  const url = truncateWidth(e.url, Math.max(1, width - displayWidth(badge) - displayWidth(method) - 2));
  return (
    <Text wrap="truncate">
      <Text backgroundColor={theme.accent} color={theme.badgeFg} bold>{badge}</Text>
      {' '}
      <Text backgroundColor={methodColor(e.method)} color={theme.badgeFg} bold>{method}</Text>
      {' '}
      {url}
    </Text>
  );
}

export function DiffOverlay({ a, b, scroll, height = 18, width = 100, lines }: DiffOverlayProps) {
  const budget = Math.max(0, height - DIFF_CHROME);
  const off = Math.min(Math.max(0, scroll), Math.max(0, lines.length - budget));
  return (
    <Box flexDirection="column" width={width}>
      {sideRow('A', a, width)}
      {sideRow('B', b, width)}
      <Box justifyContent="space-between">
        <Text color={theme.muted} wrap="truncate">{'  -/+ = A/B'}</Text>
        {lines.length > budget ? <Text color={theme.muted}>{`(${off + 1}-${Math.min(off + budget, lines.length)}/${lines.length})`}</Text> : null}
      </Box>
      {Array.from({ length: budget }, (_, i) => {
        const line = lines[off + i];
        return (
          <Text key={i} wrap="truncate">
            {line?.text ? (line.segs ? segsToNodes(line.segs, `df-${i}`) : line.text) : ' '}
          </Text>
        );
      })}
      <Text color={theme.faint} wrap="truncate">{'─'.repeat(width)}</Text>
    </Box>
  );
}
