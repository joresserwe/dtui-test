import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth, truncateWidth } from '../lib/format.js';
import { tabSpan } from '../lib/folder-tabs.js';
import { theme } from '../lib/theme.js';

export interface StripSession {
  key: string;
  title: string;
  count: number;
  status: 'live' | 'reconnecting';
}

const SEP = '   ';
const TITLE_W = 16;

export const stripLabel = (s: StripSession, viewed: boolean): string =>
  `${s.status === 'reconnecting' ? '↻' : viewed ? '◉' : '●'} ${truncateWidth(s.title, TITLE_W)} ${s.count}`;

// Ellipses for hidden neighbors are not budgeted here; the enclosing truncating
// <Text> absorbs the few columns of overflow they can cause.
export function stripWindow(widths: number[], activeIdx: number, budget: number): { start: number; end: number } {
  const sepW = displayWidth(SEP);
  let start = activeIdx;
  let end = activeIdx;
  let used = widths[activeIdx] ?? 0;
  while (end + 1 < widths.length && used + sepW + widths[end + 1] <= budget) {
    end += 1;
    used += sepW + widths[end];
  }
  while (start > 0 && used + sepW + widths[start - 1] <= budget) {
    start -= 1;
    used += sepW + widths[start];
  }
  return { start, end };
}

export interface SessionTabsProps {
  sessions: StripSession[];
  activeKey: string | null;
  width: number;
}

// ToolTabs (the row below) marks its active item with an accent background pill,
// so the strip's active affordance is dot + bold + a ━ segment on the header
// rule — the two stacked tab rows must not read as the same widget.
export function SessionTabs({ sessions, activeKey, width }: SessionTabsProps): React.JSX.Element {
  const activeIdx = Math.max(0, sessions.findIndex(s => s.key === activeKey));
  const labels = sessions.map((s, i) => stripLabel(s, i === activeIdx));
  const budget = Math.max(8, width - 2);
  const { start, end } = stripWindow(labels.map(displayWidth), activeIdx, budget);
  const visible = labels.slice(start, end + 1);
  const lead = start > 0 ? '… ' : '';
  const trail = end < sessions.length - 1 ? ' …' : '';
  const indent = 1 + displayWidth(lead);
  const span = tabSpan(visible, activeIdx - start, indent, SEP);
  const pre = Math.max(0, Math.min(span.preCols, width));
  const bar = Math.max(0, Math.min(span.activeCols, width - pre));
  const rest = Math.max(0, width - pre - bar);
  return (
    <Box flexDirection="column" width={width}>
      <Box paddingX={1} width={width}>
        <Text wrap="truncate">
          {lead ? <Text color={theme.faint}>{lead}</Text> : null}
          {visible.map((label, i) => {
            const s = sessions[start + i];
            const viewed = start + i === activeIdx;
            return (
              <Text key={s.key}>
                {i > 0 ? SEP : ''}
                <Text color={s.status === 'reconnecting' ? theme.warn : theme.key}>{label.slice(0, 1)}</Text>
                <Text bold={viewed} color={viewed ? undefined : theme.muted}>{label.slice(1, label.length - `${s.count}`.length)}</Text>
                <Text color={viewed ? theme.muted : theme.faint}>{`${s.count}`}</Text>
              </Text>
            );
          })}
          {trail ? <Text color={theme.faint}>{trail}</Text> : null}
        </Text>
      </Box>
      <Text wrap="truncate">
        <Text color={theme.faint}>{'─'.repeat(pre)}</Text>
        <Text color={theme.key}>{'━'.repeat(bar)}</Text>
        <Text color={theme.faint}>{'─'.repeat(rest)}</Text>
      </Text>
    </Box>
  );
}
