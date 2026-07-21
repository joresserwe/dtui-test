import type { ConsoleEntry, ConsolePreview, ConsolePreviewProp } from '../../store/types.js';
import { formatPreview } from '../../store/console-format.js';
import { displayWidth, truncateWidth } from './format.js';
import { t } from './i18n.js';

const MAX_COLS = 8;
const MAX_ROWS = 100;
const CELL_MAX = 32;
const VALUES = 'Values';
const INDEX = '(index)';

export interface ConsoleTable {
  indexHeader: string;
  columns: string[];
  rows: { index: string; cells: (string | undefined)[] }[];
  moreRows: number;
  moreCols: number;
  overflow: boolean;
}

const hasCols = (rp: ConsolePreviewProp): boolean =>
  rp.valuePreview?.type === 'object' && (rp.valuePreview.properties?.length ?? 0) > 0;

function cellText(cp: ConsolePreviewProp): string {
  if (cp.valuePreview) return formatPreview(cp.valuePreview);
  if (cp.type === 'string') return JSON.stringify(cp.value ?? '');
  if (cp.type === 'function') return 'ƒ';
  return cp.value ?? cp.type;
}

export function detectConsoleTable(entry: ConsoleEntry): ConsoleTable | null {
  const pre: ConsolePreview | undefined = entry.args?.[0]?.preview;
  const rowProps = pre?.properties;
  if (!pre || pre.type !== 'object' || !rowProps?.length) return null;
  if (!entry.table && !rowProps.some(hasCols)) return null;

  const colOrder: string[] = [];
  const seen = new Set<string>();
  let hasValues = false;
  for (const rp of rowProps) {
    if (hasCols(rp)) {
      for (const cp of rp.valuePreview!.properties!) {
        if (!seen.has(cp.name)) {
          seen.add(cp.name);
          colOrder.push(cp.name);
        }
      }
    } else {
      hasValues = true;
    }
  }
  if (hasValues) colOrder.push(VALUES);

  let columns = colOrder;
  let moreCols = 0;
  if (columns.length > MAX_COLS) {
    moreCols = columns.length - MAX_COLS;
    columns = columns.slice(0, MAX_COLS);
  }

  const shown = rowProps.slice(0, MAX_ROWS);
  const rows = shown.map(rp => ({
    index: rp.name,
    cells: columns.map(col => {
      if (col === VALUES) return hasCols(rp) ? undefined : cellText(rp);
      if (!hasCols(rp)) return undefined;
      const cp = rp.valuePreview!.properties!.find(c => c.name === col);
      return cp ? cellText(cp) : undefined;
    }),
  }));

  return {
    indexHeader: INDEX,
    columns,
    rows,
    moreRows: Math.max(0, rowProps.length - MAX_ROWS),
    moreCols,
    overflow: pre.overflow === true,
  };
}

export function renderConsoleTable(table: ConsoleTable, width = 100): string[] {
  const cap = Math.max(8, Math.min(CELL_MAX, width));
  const cols = [table.indexHeader, ...table.columns, ...(table.moreCols ? ['…'] : [])];
  const dataCount = table.columns.length;
  const widths = cols.map((c, ci) => {
    let w = displayWidth(c);
    if (ci === 0) {
      for (const r of table.rows) w = Math.max(w, displayWidth(r.index));
    } else if (ci <= dataCount) {
      for (const r of table.rows) w = Math.max(w, displayWidth(r.cells[ci - 1] ?? ''));
    }
    return Math.min(w, cap);
  });
  const cell = (text: string, ci: number): string => {
    const s = truncateWidth(text, widths[ci]);
    return s + ' '.repeat(Math.max(0, widths[ci] - displayWidth(s)));
  };
  const out: string[] = [];
  out.push(cols.map((c, ci) => cell(c, ci)).join(' │ '));
  out.push(widths.map(w => '─'.repeat(w)).join('─┼─'));
  for (const r of table.rows) {
    out.push(cols.map((_, ci) =>
      ci === 0 ? cell(r.index, 0)
      : ci <= dataCount ? cell(r.cells[ci - 1] ?? '', ci)
      : cell('', ci)).join(' │ '));
  }
  if (table.moreRows > 0 || table.overflow) {
    out.push(t('console.table.more', { n: table.moreRows }));
  }
  return out;
}
