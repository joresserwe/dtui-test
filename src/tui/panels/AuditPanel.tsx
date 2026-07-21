import React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'node:path';
import { CATEGORY_SHORT, type AuditCategoryId, type FailingAudit, type Lhr } from '../../audit/types.js';
import { formatMetricMs, formatScore, plainDescription, scoreLevel, type ScoreLevel } from '../../audit/transform.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { displayWidth, truncate } from '../lib/format.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';
import type { AuditTool } from '../hooks/use-audit-tool.js';

export const AUDIT_CHROME = 7;
export const AUDIT_DETAIL_CHROME = 4;
const DETAIL_ITEM_CAP = 15;

const LEVEL_COLOR: Record<ScoreLevel, string> = { good: 'green', avg: 'yellow', poor: 'red' };

export function wrapPlain(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) continue;
    let line = '';
    for (const word of para.split(/\s+/)) {
      const cand = line ? `${line} ${word}` : word;
      if (line && displayWidth(cand) > width) {
        out.push(line);
        line = word;
      } else {
        line = cand;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n)} B`;
}

function itemCell(value: unknown, valueType: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    const node = value as { selector?: string; snippet?: string };
    return node.selector ?? node.snippet ?? null;
  }
  if (typeof value === 'number') {
    if (valueType === 'bytes') return formatBytes(value);
    if (valueType === 'timespanMs' || valueType === 'ms') return formatMetricMs(value);
    return String(Math.round(value * 100) / 100);
  }
  return String(value);
}

export function auditDetailLines(fail: FailingAudit, lhr: Lhr | undefined, width: number): string[] {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  const desc = plainDescription(fail.description);
  if (desc) lines.push(...wrapPlain(desc, inner));
  if (fail.displayValue) {
    lines.push('');
    lines.push(fail.displayValue);
  }
  const savings: string[] = [];
  if (fail.savingsMs !== undefined) savings.push(`~${formatMetricMs(fail.savingsMs)}`);
  if (fail.savingsBytes !== undefined) savings.push(`~${formatBytes(fail.savingsBytes)}`);
  if (savings.length) lines.push(t('audit.detail.savings', { value: savings.join(' · ') }));
  const details = lhr?.audits[fail.id]?.details;
  const items = details?.items ?? [];
  if (items.length) {
    const headings = (details?.headings ?? []).filter(h => typeof h.key === 'string' && h.key);
    lines.push('');
    lines.push(t('audit.detail.items', { n: items.length }));
    for (const item of items.slice(0, DETAIL_ITEM_CAP)) {
      const cells = headings
        .map(h => itemCell((item as Record<string, unknown>)[h.key as string], h.valueType))
        .filter((c): c is string => c !== null);
      const row = cells.length ? cells.join(' · ') : JSON.stringify(item);
      lines.push(`· ${truncate(row, inner - 2)}`);
    }
    if (items.length > DETAIL_ITEM_CAP) lines.push(t('audit.detail.more', { n: items.length - DETAIL_ITEM_CAP }));
  }
  return lines;
}

export interface AuditPanelProps {
  audit: AuditTool;
  height?: number;
  width?: number;
}

function scoreText(id: string, title: string, score: number | null): React.ReactNode {
  const short = (CATEGORY_SHORT as Record<string, string>)[id] ?? title;
  return (
    <Text key={id}>
      <Text color={theme.muted}>{short} </Text>
      <Text color={LEVEL_COLOR[scoreLevel(score)]} bold>
        {formatScore(score)}
      </Text>
    </Text>
  );
}

function failingRow(fail: FailingAudit, selected: boolean, width: number): React.ReactNode {
  const score = formatScore(fail.score).padStart(3);
  const extra = fail.savingsMs !== undefined
    ? ` ~${formatMetricMs(fail.savingsMs)}`
    : fail.savingsBytes !== undefined
      ? ` ~${formatBytes(fail.savingsBytes)}`
      : fail.displayValue
        ? ` ${fail.displayValue}`
        : '';
  const cats = fail.categories.map(c => (CATEGORY_SHORT as Record<string, string>)[c] ?? c).join(',');
  return (
    <Text key={fail.id} wrap="truncate" backgroundColor={selected ? '#223543' : undefined}>
      {selected ? <Text color="cyan">▌</Text> : ' '}
      <Text color={LEVEL_COLOR[scoreLevel(fail.score)]}>{` ${score} `}</Text>
      <Text>{truncate(fail.title, Math.max(10, width - 30))}</Text>
      <Text color={theme.muted}>{extra}</Text>
      <Text color={theme.faint}>{`  ${cats}`}</Text>
    </Text>
  );
}

export function AuditPanel({ audit, height = 14, width = 80 }: AuditPanelProps) {
  const rule = <Text dimColor wrap="truncate">{'─'.repeat(Math.max(1, width))}</Text>;
  const { auditResult: res, auditRunning: running, auditDetail } = audit;

  const budget = Math.max(1, height - AUDIT_CHROME);
  const failing = res?.failing ?? [];
  const sel = Math.min(audit.auditSel, Math.max(0, failing.length - 1));
  const start = useListWindow(failing.length, sel, budget);

  if (auditDetail) {
    const lines = auditDetailLines(auditDetail, res?.lhr, width);
    const budget = Math.max(1, height - AUDIT_DETAIL_CHROME);
    const max = Math.max(0, lines.length - budget);
    const at = Math.max(0, Math.min(audit.auditDetailScroll, max));
    const visible = lines.slice(at, at + budget);
    return (
      <Box flexDirection="column" height={height} width={width} paddingX={1}>
        <Text wrap="truncate">
          <Text bold color="cyan">{auditDetail.title}</Text>
        </Text>
        <Text wrap="truncate" color={theme.muted}>
          {auditDetail.id} · {auditDetail.categories.join(', ')} · {t('audit.detail.score')} {formatScore(auditDetail.score)}
          {lines.length > budget ? `  ${at + visible.length}/${lines.length}` : ''}
        </Text>
        {rule}
        {padRows(visible.map((l, i) => (
          <Text key={`d-${i}`} wrap="truncate">{l || ' '}</Text>
        )), budget, 'ad')}
        {rule}
      </Box>
    );
  }

  const catsLabel = audit.auditCats.map(c => CATEGORY_SHORT[c as AuditCategoryId]).join(',');
  const runsLabel = audit.auditRuns.length > 1
    ? (() => {
        const cur = res?.file ? audit.auditRuns.indexOf(basename(res.file)) : -1;
        return ` · runs ${cur >= 0 ? `${cur + 1}/${audit.auditRuns.length}` : audit.auditRuns.length}`;
      })()
    : '';

  const statusLine = running ? (
    <Text wrap="truncate">
      <Text color="cyan">◐ </Text>
      <Text>{running.status}</Text>
      <Text color={theme.muted}>{`  ${t('audit.panel.cancelHint')}`}</Text>
    </Text>
  ) : audit.auditErr ? (
    <Text color="red" wrap="truncate">{audit.auditErr}</Text>
  ) : res ? (
    <Text wrap="truncate">
      {res.board.categories.map((c, i) => (
        <Text key={c.id}>
          {i > 0 ? <Text color={theme.faint}>{' · '}</Text> : null}
          {scoreText(c.id, c.title, c.score)}
        </Text>
      ))}
      <Text color={theme.muted}>{`   ${res.board.preset} · ${res.board.fetchTime.slice(0, 19).replace('T', ' ')}`}</Text>
    </Text>
  ) : (
    <Text dimColor wrap="truncate">{t('audit.panel.ready')}</Text>
  );

  const m = res?.board.metrics;
  const metricsLine = res && m ? (
    <Text wrap="truncate" color={theme.muted}>
      {`LCP ${formatMetricMs(m.lcpMs)} · CLS ${m.cls !== undefined ? m.cls.toFixed(3) : '--'} · TBT ${formatMetricMs(m.tbtMs)} · FCP ${formatMetricMs(m.fcpMs)} · SI ${formatMetricMs(m.siMs)}`}
    </Text>
  ) : (
    <Text> </Text>
  );

  const warn = res?.board.runWarnings[0];
  const listHeader = res
    ? failing.length
      ? t('audit.panel.failing', { n: failing.length })
      : t('audit.panel.allPassed')
    : '';

  const footer = res?.file
    ? t('audit.panel.json', { file: res.file })
    : res
      ? t('audit.panel.jsonMemory')
      : '';

  return (
    <Box flexDirection="column" height={height} width={width} paddingX={1}>
      <Text wrap="truncate">
        <Text dimColor>Audit</Text>
        <Text color={theme.muted}>{`  preset:${audit.auditPreset} · cats:${catsLabel}${runsLabel}`}</Text>
      </Text>
      {statusLine}
      {metricsLine}
      {warn ? <Text color="yellow" wrap="truncate">⚠ {warn}</Text> : <Text dimColor wrap="truncate">{listHeader}</Text>}
      {rule}
      {padRows(
        failing.slice(start, start + budget).map((f, i) => failingRow(f, start + i === sel, width)),
        budget,
        'af',
      )}
      <Text dimColor wrap="truncate">{footer || ' '}</Text>
      {rule}
    </Box>
  );
}
