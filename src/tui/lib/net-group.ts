import type { NetworkEntry } from '../../store/types.js';

export type NetGroupMode = 'none' | 'domain';

export interface NetGroupHeader {
  kind: 'header';
  key: string;
  label: string;
  count: number;
  collapsed: boolean;
}
export interface NetGroupEntryRow {
  kind: 'entry';
  entry: NetworkEntry;
  groupKey: string;
}
export type NetGroupRow = NetGroupHeader | NetGroupEntryRow;

const NO_HOST = '(no host)';

export function groupKeyOf(entry: NetworkEntry, mode: NetGroupMode): string {
  if (mode !== 'domain') return '';
  try {
    return new URL(entry.url).host || NO_HOST;
  } catch {
    return NO_HOST;
  }
}

export function buildNetGroups(entries: NetworkEntry[], mode: NetGroupMode, collapsed: ReadonlySet<string>): NetGroupRow[] {
  if (mode === 'none') return entries.map(entry => ({ kind: 'entry', entry, groupKey: '' }));
  const order: string[] = [];
  const groups = new Map<string, NetworkEntry[]>();
  for (const entry of entries) {
    const key = groupKeyOf(entry, mode);
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
      order.push(key);
    }
    arr.push(entry);
  }
  const rows: NetGroupRow[] = [];
  for (const key of order) {
    const arr = groups.get(key)!;
    const isCollapsed = collapsed.has(key);
    rows.push({ kind: 'header', key, label: key, count: arr.length, collapsed: isCollapsed });
    if (!isCollapsed) for (const entry of arr) rows.push({ kind: 'entry', entry, groupKey: key });
  }
  return rows;
}

export function groupSelectable(rows: NetGroupRow[]): NetworkEntry[] {
  const out: NetworkEntry[] = [];
  for (const r of rows) if (r.kind === 'entry') out.push(r.entry);
  return out;
}
