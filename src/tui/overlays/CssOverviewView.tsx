import React from 'react';
import { Box, Text } from 'ink';
import { rgbToHex, type CountEntry, type CssOverviewData } from '../lib/css-overview.js';
import { padRows } from '../lib/list-window.js';
import { t } from '../lib/i18n.js';

export const CSS_OVERVIEW_CHROME = 5;

export interface OverviewRow {
  kind: 'section' | 'entry' | 'empty';
  label: string;
  count?: number;
  swatch?: string;
}

function bucket(rows: OverviewRow[], title: string, entries: CountEntry[], swatches: boolean): void {
  rows.push({ kind: 'section', label: `${title} (${entries.length})` });
  if (!entries.length) {
    rows.push({ kind: 'empty', label: t('overview.none') });
    return;
  }
  for (const e of entries) {
    rows.push({
      kind: 'entry',
      label: e.value,
      count: e.count,
      ...(swatches ? { swatch: rgbToHex(e.value) ?? undefined } : {}),
    });
  }
}

export function overviewRows(data: CssOverviewData | null): OverviewRow[] {
  if (!data) return [];
  const rows: OverviewRow[] = [];
  bucket(rows, t('overview.textColors'), data.text, true);
  bucket(rows, t('overview.backgroundColors'), data.background, true);
  bucket(rows, t('overview.borderColors'), data.border, true);
  bucket(rows, t('overview.fonts'), data.fonts, false);
  rows.push({ kind: 'section', label: `${t('overview.mediaQueries')} (${data.medias.length})` });
  if (!data.medias.length) rows.push({ kind: 'empty', label: t('overview.none') });
  for (const m of data.medias) {
    rows.push({ kind: 'entry', label: `${m.text || '—'}  (${m.source})`, count: m.count });
  }
  return rows;
}

export interface CssOverviewViewProps {
  data: CssOverviewData | null;
  loading: boolean;
  scroll: number;
  error?: string;
  height?: number;
  width?: number;
}

export function CssOverviewView({ data, loading, scroll, error, height = 24, width = 100 }: CssOverviewViewProps): React.JSX.Element {
  const rule = '─'.repeat(width);
  const budget = Math.max(0, height - CSS_OVERVIEW_CHROME);
  const rows = overviewRows(data);
  const start = Math.max(0, Math.min(scroll, Math.max(0, rows.length - budget)));

  const title = data
    ? `${t('overview.title')} · ${t('overview.elements', { n: data.elements })}${data.truncated ? ` ${t('overview.truncated')}` : ''}`
    : t('overview.title');

  const body = loading && !data
    ? [<Text key="ov-loading" dimColor wrap="truncate">{t('overview.collecting')}</Text>]
    : !data
      ? [<Text key="ov-none" dimColor wrap="truncate">{t('overview.collectPrompt')}</Text>]
      : rows.slice(start, start + budget).map((row, i) => {
          const key = `ov-${start + i}`;
          if (row.kind === 'section') return <Text key={key} bold wrap="truncate">{row.label}</Text>;
          if (row.kind === 'empty') return <Text key={key} dimColor wrap="truncate">  {row.label}</Text>;
          return (
            <Text key={key} wrap="truncate">
              {'  '}
              {row.swatch ? <Text color={row.swatch}>██ </Text> : null}
              {row.label}
              <Text dimColor> ×{row.count}</Text>
            </Text>
          );
        });

  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>Elements</Text>
      <Text wrap="truncate">
        {title}
        {loading && data ? <Text dimColor> · {t('overview.collecting')}</Text> : null}
      </Text>
      <Text dimColor wrap="truncate">{rule}</Text>
      {padRows(body, budget, 'overview')}
      {error ? <Text color="red" wrap="truncate">{error}</Text> : <Text dimColor wrap="truncate">{t('overview.hint')}</Text>}
      <Text dimColor wrap="truncate">{rule}</Text>
    </Box>
  );
}
