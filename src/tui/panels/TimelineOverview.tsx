import React from 'react';
import { Box, Text } from 'ink';
import type { NetworkEntry } from '../../store/types.js';
import { displayWidth, fmtBytes } from '../lib/format.js';
import { brailleRows, bucketToRange, buildBuckets, dotHeights, intersectsRange, rangeToBuckets, timelineSpan, type TimeRange } from '../lib/timeline.js';
import { t } from '../lib/i18n.js';

export const TIMELINE_HEIGHT = 3;

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

interface CellStyle { color?: string; backgroundColor?: string }

export interface TimelineOverviewProps {
  entries: NetworkEntry[];
  width?: number;
  active?: boolean;
  cursor?: number;
  anchor?: number | null;
  applied: TimeRange | null;
  now?: number;
}

export function TimelineOverview({ entries, width = 100, active = false, cursor = 0, anchor = null, applied, now = Date.now() }: TimelineOverviewProps) {
  const inner = Math.max(1, width - 2);
  const span = timelineSpan(entries, now);
  if (!span) {
    return (
      <Box flexDirection="column" width={width}>
        <Text> </Text>
        <Text dimColor wrap="truncate"> {t('panel.timeline.empty')}</Text>
        <Text> </Text>
      </Box>
    );
  }
  const buckets = buildBuckets(entries, inner, now);
  const [top, bottom] = brailleRows(dotHeights(buckets.map(b => b.concurrency)));
  const cur = active ? Math.max(0, Math.min(cursor, inner - 1)) : null;
  const anc = active && anchor !== null ? Math.max(0, Math.min(anchor, inner - 1)) : null;
  const sel: [number, number] | null =
    anc !== null && cur !== null ? [Math.min(anc, cur), Math.max(anc, cur)]
    : applied ? rangeToBuckets(span, inner, applied)
    : null;

  const cellChar = (row: string, c: number): string =>
    c === cur ? '│' : sel && (c === sel[0] || c === sel[1]) ? '┃' : row[c];
  const cellStyle = (c: number): CellStyle => {
    if (c === cur) return { color: 'black', backgroundColor: 'cyan' };
    const inSel = sel !== null && c >= sel[0] && c <= sel[1];
    return {
      color: buckets[c].failed && !(sel && (c === sel[0] || c === sel[1])) ? 'red' : 'cyan',
      ...(inSel ? { backgroundColor: '#223543' } : {}),
    };
  };
  const chartRow = (row: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let c = 0;
    while (c < inner) {
      const st = cellStyle(c);
      let s = '';
      let j = c;
      while (j < inner) {
        const st2 = cellStyle(j);
        if (st2.color !== st.color || st2.backgroundColor !== st.backgroundColor) break;
        s += cellChar(row, j);
        j++;
      }
      parts.push(<Text key={c} color={st.color} backgroundColor={st.backgroundColor}>{s}</Text>);
      c = j;
    }
    return parts;
  };

  const totalBytes = entries.reduce((s, e) => s + (e.encodedBytes ?? 0), 0);
  const selecting = anc !== null;
  const rangeLabel = (r: TimeRange): string => {
    const count = entries.filter(e => intersectsRange(e, r, now)).length;
    return `${fmtSec(Math.max(0, r.start - span.min))}–${fmtSec(Math.max(0, r.end - span.min))} · ${t('status.count', { n: count })}`;
  };
  const mid = selecting && cur !== null
    ? rangeLabel(bucketToRange(span, inner, anc, cur))
    : cur !== null
      ? fmtSec(cur * ((span.max - span.min) / inner))
      : applied
        ? rangeLabel(applied)
        : `${entries.length} req · ${fmtBytes(totalBytes)}`;
  const left = '0.0s';
  const right = fmtSec(span.max - span.min);
  const gap = inner - displayWidth(left) - displayWidth(mid) - displayWidth(right);
  const showMid = gap >= 2;
  const g1 = showMid ? Math.floor(gap / 2) : Math.max(1, inner - displayWidth(left) - displayWidth(right));
  const g2 = showMid ? gap - g1 : 0;

  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">{' '}{chartRow(top)}</Text>
      <Text wrap="truncate">{' '}{chartRow(bottom)}</Text>
      <Text wrap="truncate">
        {' '}
        <Text dimColor>{left}</Text>
        {' '.repeat(Math.max(0, g1))}
        {showMid ? (
          <Text color={active ? 'cyan' : applied ? 'yellow' : undefined} dimColor={!active && !applied}>{mid}</Text>
        ) : null}
        {showMid ? ' '.repeat(Math.max(0, g2)) : null}
        <Text dimColor>{right}</Text>
      </Text>
    </Box>
  );
}
