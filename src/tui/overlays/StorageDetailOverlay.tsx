import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth, fmtDateTime, fmtRel, prettyBody, truncateWidth } from '../lib/format.js';
import { highlightJson, segsToNodes, type Seg } from '../lib/highlight.js';
import { wrapSegs, jwtClaimPairs, type Line } from './DetailOverlay.js';
import { decodeJwt } from '../lib/jwt.js';
import type { StorageRow, StorageView } from '../panels/StorageOverlay.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export const STORAGE_DETAIL_CHROME = 3;

const sectionLine = (label: string): Line => ({
  text: `▍ ${label}`,
  segs: [{ text: '▍ ', color: theme.accent }, { text: label }],
  section: true,
});

const kvLine = (k: string, v: string, color?: string): Line => {
  const key = `  ${k.padEnd(9)} `;
  return { text: key + v, segs: [{ text: key, color: 'cyan' }, color ? { text: v, color } : { text: v }] };
};

function pushValue(out: Line[], value: string, width: number, wrap: boolean): void {
  const trimmed = value.trim();
  let json = false;
  if (/^[[{]/.test(trimmed)) {
    try { JSON.parse(value); json = true; } catch {}
  }
  const body = json ? prettyBody(value, 'application/json') : value;
  for (const raw of body.split('\n')) {
    const segs: Seg[] = json ? highlightJson(raw) : [{ text: raw }];
    if (!wrap) {
      out.push({ text: raw, segs, pre: true });
      continue;
    }
    for (const rowSegs of wrapSegs(segs, width)) {
      out.push({ text: rowSegs.map(s => s.text).join(''), segs: rowSegs, pre: true });
    }
  }
}

export function storageDetailLines(row: StorageRow, view: StorageView, width = 80, wrap = true): Line[] {
  const w = Math.max(1, width);
  const out: Line[] = [sectionLine(t('storage.detail.value'))];
  pushValue(out, row.value, w, wrap);
  if (row.note) out.push({ text: row.note, segs: [{ text: row.note, color: theme.muted }] });
  if (row.cacheMeta) {
    const m = row.cacheMeta;
    out.push(
      { text: '' },
      sectionLine(t('storage.detail.response')),
      kvLine('url', m.url),
      kvLine('status', `${m.status} ${m.statusText}`.trim()),
      kvLine('type', m.responseType || '-'),
    );
    if (m.headers.length) {
      out.push({ text: '' }, sectionLine(t('storage.detail.headers')));
      for (const [k, v] of m.headers) out.push(kvLine(k, v));
    }
  }
  if (view === 'cookies' && row.attrs) {
    const a = row.attrs;
    const expires = a.expires && a.expires > 0
      ? `${fmtDateTime(a.expires * 1000)} (${fmtRel(a.expires * 1000 - Date.now())})`
      : 'session';
    out.push(
      { text: '' },
      sectionLine(t('storage.detail.attrs')),
      kvLine('domain', a.domain),
      kvLine('path', a.path),
      kvLine('expires', expires),
      kvLine('httpOnly', String(a.httpOnly)),
      kvLine('secure', String(a.secure)),
      kvLine('sameSite', a.sameSite ?? '-'),
      ...(a.partitionKey ? [kvLine('partition', a.partitionKey)] : []),
      kvLine('size', String(row.key.length + row.value.length)),
    );
  }
  const jwt = decodeJwt(row.value);
  if (jwt) {
    out.push({ text: '' }, sectionLine(t('detail.jwt')));
    const { pairs, expired } = jwtClaimPairs(jwt);
    for (const [k, v] of pairs) out.push(kvLine(k, v, expired && k === 'exp' ? 'red' : undefined));
  }
  return out;
}

export function storageCopyText(row: StorageRow): string {
  return row.value;
}

export interface StorageDetailOverlayProps {
  row: StorageRow;
  view: StorageView;
  scroll: number;
  height?: number;
  width?: number;
  lines?: Line[];
  wrap?: boolean;
}

export function StorageDetailOverlay({ row, view, scroll, height = 18, width = 100, lines, wrap = true }: StorageDetailOverlayProps) {
  const rich = lines ?? storageDetailLines(row, view, width, wrap);
  const budget = Math.max(0, height - STORAGE_DETAIL_CHROME);
  const off = Math.min(Math.max(0, scroll), Math.max(0, rich.length - budget));
  const head = truncateWidth(`${view} · ${row.key}`, Math.max(1, width - 20));
  const pos = rich.length > budget ? `(${off + 1}-${Math.min(off + budget, rich.length)}/${rich.length})` : '';
  const gap = ' '.repeat(Math.max(1, width - displayWidth(head) - displayWidth(pos)));
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        <Text color={theme.accent} bold>{head}</Text>
        {gap}
        {pos ? <Text color={theme.muted}>{pos}</Text> : null}
      </Text>
      <Text color={theme.accent} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>
      {Array.from({ length: budget }, (_, i) => {
        const line = rich[off + i];
        if (!line?.text) return <Text key={i}> </Text>;
        return (
          <Text key={i} wrap="truncate">
            {line.segs ? segsToNodes(line.segs, `sd-${i}`) : line.text}
          </Text>
        );
      })}
      <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>
    </Box>
  );
}
