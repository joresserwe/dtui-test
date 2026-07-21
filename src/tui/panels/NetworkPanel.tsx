import React from 'react';
import { Box, Text } from 'ink';
import type { NetworkEntry } from '../../store/types.js';
import { DEFAULT_NET_COLUMNS, type NetColumnId } from '../../config.js';
import { fmtBytes, fmtMs, statusColor, truncate } from '../lib/format.js';
import { methodColor, theme } from '../lib/theme.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { header } from '../../util/headers.js';
import { parseRegexLiteral } from '../lib/search.js';
import type { NetGroupRow } from '../lib/net-group.js';
import { t } from '../lib/i18n.js';

export type TypeFilter = 'all' | 'xhr' | 'js' | 'css' | 'img' | 'ws' | 'doc' | 'font' | 'other';
export type NetSortKey = 'arrival' | 'time' | 'size' | 'status' | 'name';
export type NetSortDir = 'asc' | 'desc';

export interface NetToken {
  negate: boolean;
  kind: 'status' | 'method' | 'type' | 'mime' | 'gql' | 'domain' | 'dur' | 'size' | 'text'
    | 'regex' | 'cache' | 'header' | 'priority' | 'scheme';
  test: (e: NetworkEntry) => boolean;
}

const NET_TYPES = ['XHR', 'Fetch', 'Image', 'Script', 'Stylesheet', 'Document', 'Font', 'WebSocket'];

const typeMatch = (key: string, t: string): boolean => {
  switch (key) {
    case 'xhr': return t === 'XHR' || t === 'Fetch';
    case 'img': return t === 'Image';
    case 'js': return t === 'Script';
    case 'css': return t === 'Stylesheet';
    case 'doc': return t === 'Document';
    case 'font': return t === 'Font';
    case 'ws': return t === 'WebSocket';
    case 'other': return !NET_TYPES.includes(t);
    default: return false;
  }
};

const domainTest = (pattern: string): ((e: NetworkEntry) => boolean) => {
  // A leading "*." also matches the bare domain, mirroring DevTools' domain filter.
  const sub = pattern.startsWith('*.');
  const body = sub ? pattern.slice(2) : pattern;
  const source = body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${sub ? '(?:.*\\.)?' : ''}${source}$`, 'i');
  return e => {
    try {
      return re.test(new URL(e.url).hostname);
    } catch {
      return false;
    }
  };
};

const textTest = (s: string): ((e: NetworkEntry) => boolean) => {
  const needle = s.toLowerCase();
  return e => e.url.toLowerCase().includes(needle);
};

const schemeOf = (url: string): string => {
  try {
    return new URL(url).protocol.replace(/:$/, '').toLowerCase();
  } catch {
    return '';
  }
};

const PRIORITY_MATCH: Record<string, string> = { veryhigh: 'vh', high: 'hi', medium: 'med', low: 'lo', verylow: 'vl' };

const priorityTest = (val: string): ((e: NetworkEntry) => boolean) => {
  const v = val.toLowerCase();
  return e => {
    if (!e.priority) return false;
    const name = e.priority.toLowerCase();
    return name === v || name.startsWith(v) || PRIORITY_MATCH[name] === v;
  };
};

function parseToken(raw: string): NetToken {
  let negate = false;
  let body = raw;
  if (body.startsWith('-') && body.length > 1) {
    negate = true;
    body = body.slice(1);
  }
  const bare = (): NetToken => ({ negate, kind: 'text', test: textTest(body) });

  const lit = parseRegexLiteral(body);
  if (lit) {
    if ('re' in lit) {
      const re = lit.re;
      return { negate, kind: 'regex', test: e => re.test(e.url) };
    }
    return bare();
  }

  const cmp = /^([<>])(\d+(?:\.\d+)?)(ms|s|kb|mb|b)$/i.exec(body);
  if (cmp) {
    const op = cmp[1];
    const n = parseFloat(cmp[2]);
    const unit = cmp[3].toLowerCase();
    if (unit === 'ms' || unit === 's') {
      const ms = unit === 's' ? n * 1000 : n;
      return { negate, kind: 'dur', test: e => e.durationMs !== undefined && (op === '>' ? e.durationMs > ms : e.durationMs < ms) };
    }
    const mult = unit === 'kb' ? 1024 : unit === 'mb' ? 1_048_576 : 1;
    const bytes = n * mult;
    return { negate, kind: 'size', test: e => e.encodedBytes !== undefined && (op === '>' ? e.encodedBytes > bytes : e.encodedBytes < bytes) };
  }

  const colon = body.indexOf(':');
  if (colon > 0) {
    const key = body.slice(0, colon).toLowerCase();
    const val = body.slice(colon + 1);
    if (key === 'status') {
      if (val.toLowerCase() === 'fail') return { negate, kind: 'status', test: e => e.error != null || (e.status ?? 0) >= 400 };
      if (/^[0-9x]+$/i.test(val)) {
        const re = new RegExp('^' + val.toLowerCase().split('').map(c => (c === 'x' ? '\\d' : c)).join('') + '$');
        return { negate, kind: 'status', test: e => e.status !== undefined && re.test(String(e.status)) };
      }
      return bare();
    }
    if (key === 'method') {
      const m = val.toLowerCase();
      return { negate, kind: 'method', test: e => e.method.toLowerCase() === m };
    }
    if (key === 'type') {
      const k = val.toLowerCase();
      return { negate, kind: 'type', test: e => typeMatch(k, e.type) };
    }
    if (key === 'domain') {
      return { negate, kind: 'domain', test: domainTest(val) };
    }
    if (key === 'mime') {
      const m = val.toLowerCase();
      return { negate, kind: 'mime', test: e => (e.mimeType ?? '').toLowerCase().includes(m) };
    }
    if (key === 'gql') {
      const m = val.toLowerCase();
      return { negate, kind: 'gql', test: e => e.gqlOperation !== undefined && e.gqlOperation.toLowerCase().includes(m) };
    }
    if (key === 'is') {
      const m = val.toLowerCase();
      if (m === 'from-cache' || m === 'cached') return { negate, kind: 'cache', test: e => e.fromCache !== undefined };
      return bare();
    }
    if (key === 'has-response-header') {
      const name = val.toLowerCase();
      return { negate, kind: 'header', test: e => Object.keys(e.responseHeaders).some(k => k.toLowerCase() === name) };
    }
    if (key === 'priority') {
      return { negate, kind: 'priority', test: priorityTest(val) };
    }
    if (key === 'scheme') {
      const m = val.toLowerCase();
      return { negate, kind: 'scheme', test: e => schemeOf(e.url) === m };
    }
    return bare();
  }
  return bare();
}

export function parseNetFilter(q: string): NetToken[] {
  return q.trim().split(/\s+/).filter(Boolean).map(parseToken);
}

export function filterEntries(entries: NetworkEntry[], type: TypeFilter | readonly TypeFilter[], q: string, sinceTs?: number): NetworkEntry[] {
  const list: readonly TypeFilter[] = Array.isArray(type) ? type : [type];
  const types = list.includes('all') ? [] : list.filter((t): t is Exclude<TypeFilter, 'all'> => t !== 'all');
  let out = entries;
  if (types.length) out = out.filter(e => types.some(t => typeMatch(t, e.type)));
  if (sinceTs) out = out.filter(e => e.startTs >= sinceTs);
  const tokens = parseNetFilter(q);
  if (tokens.length) out = out.filter(e => tokens.every(t => (t.negate ? !t.test(e) : t.test(e))));
  return out;
}

export function sortNetEntries(entries: NetworkEntry[], key: NetSortKey, dir: NetSortDir): NetworkEntry[] {
  if (key === 'arrival') return entries;
  const val = (e: NetworkEntry): number | string =>
    key === 'time' ? e.durationMs ?? -1
    : key === 'size' ? e.encodedBytes ?? -1
    : key === 'status' ? e.status ?? (e.error ? 599 : -1)
    : nameOf(e.url).name.toLowerCase();
  const sign = dir === 'desc' ? -1 : 1;
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const va = val(a.e);
      const vb = val(b.e);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map(x => x.e);
}

export function cookieCount(e: NetworkEntry): number {
  const cookie = header(e.requestHeaders, 'cookie');
  if (!cookie) return 0;
  return cookie.split(';').map(s => s.trim()).filter(Boolean).length;
}

const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export function waterfallCells(startFrac: number, endFrac: number, width: number): string {
  const w = Math.max(0, Math.floor(width));
  if (w === 0) return '';
  const s = Math.min(1, Math.max(0, startFrac));
  const e = Math.min(1, Math.max(0, Math.max(startFrac, endFrac)));
  const startPos = s * w;
  const endPos = Math.max(e * w, startPos);
  const cells: string[] = [];
  let any = false;
  for (let i = 0; i < w; i++) {
    const overlap = Math.min(endPos, i + 1) - Math.max(startPos, i);
    if (overlap <= 0) {
      cells.push(' ');
      continue;
    }
    // A cell's covered fraction f maps to round(f*8) eighths: 1..7 pick ▏▎▍▌▋▊▉, 8 picks █; a leading edge fills from the left, approximating the true right-offset start.
    const eighths = Math.min(8, Math.max(1, Math.round(Math.min(1, overlap) * 8)));
    cells.push(eighths === 8 ? '█' : EIGHTHS[eighths - 1]);
    any = true;
  }
  if (!any) cells[Math.min(w - 1, Math.floor(startPos))] = '█';
  return cells.join('');
}

export function waterfall(e: NetworkEntry, minTs: number, span: number, width = 12): string {
  if (e.durationMs === undefined) {
    const pos = span > 0 ? Math.min(width - 1, Math.max(0, Math.round(((e.startTs - minTs) / span) * (width - 1)))) : 0;
    return (' '.repeat(pos) + '·').padEnd(width).slice(0, width);
  }
  const startFrac = span > 0 ? (e.startTs - minTs) / span : 0;
  const endFrac = span > 0 ? (e.startTs + e.durationMs - minTs) / span : 0;
  return waterfallCells(startFrac, endFrac, width);
}

export interface NetworkPanelProps {
  entries: NetworkEntry[];
  selected: number;
  focused: boolean;
  height?: number;
  width?: number;
  columns?: readonly NetColumnId[];
  sortKey?: NetSortKey;
  sortDir?: NetSortDir;
  groups?: NetGroupRow[];
  marked?: ReadonlySet<string>;
}

type DispItem = { header: Extract<NetGroupRow, { kind: 'header' }> } | { entry: NetworkEntry; ord: number };

const statusCell = (e: NetworkEntry): string =>
  e.error ? (e.corsError ? 'CORS' : 'FAIL') : e.status !== undefined ? String(e.status) : '…';

export function nameOf(url: string): { name: string; context: string } {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs.pop();
    const name = (last ?? u.host) + u.search;
    const context = u.host + (segs.length ? `/${segs.join('/')}` : '');
    return { name: name || u.host, context };
  } catch {
    return { name: url, context: '' };
  }
}

const COL_WIDTH: Record<Exclude<NetColumnId, 'name' | 'url'>, number> = {
  status: 5,
  method: 8,
  type: 10,
  time: 8,
  size: 9,
  cookies: 4,
  host: 18,
  protocol: 8,
  priority: 4,
  initiator: 18,
  'set-cookies': 4,
  remote: 22,
  waterfall: 14,
};

const KEEP_ORDER: Array<Exclude<NetColumnId, 'status' | 'name' | 'url'>> = ['time', 'type', 'method', 'size', 'cookies', 'host', 'waterfall', 'protocol', 'priority', 'initiator', 'set-cookies', 'remote'];

const WATERFALL_MIN = 12;
const WATERFALL_MAX = 40;
const NAME_TARGET = 56;

const PRIORITY_ABBR: Record<string, string> = { VeryHigh: 'VH', High: 'Hi', Medium: 'Med', Low: 'Lo', VeryLow: 'VL' };

const priorityCell = (e: NetworkEntry): string => (e.priority ? (PRIORITY_ABBR[e.priority] ?? e.priority) : '');

function initiatorCell(e: NetworkEntry): string {
  const init = e.initiator;
  if (!init) return '';
  const frame = init.stack?.[0];
  const url = init.url ?? frame?.url;
  const line = init.url !== undefined ? init.lineNumber : frame?.lineNumber;
  if (init.type === 'script' && url) {
    const clean = url.split(/[?#]/)[0];
    const base = clean.split('/').filter(Boolean).pop() ?? clean;
    return line !== undefined ? `${base}:${line}` : base;
  }
  return init.type;
}

const SORT_COLUMN: Partial<Record<NetSortKey, NetColumnId>> = { time: 'time', size: 'size', status: 'status', name: 'name' };

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export function NetworkPanel({ entries, selected, focused, height = 15, width, columns = DEFAULT_NET_COLUMNS, sortKey = 'arrival', sortDir = 'asc', groups, marked }: NetworkPanelProps) {
  const rowBudget = Math.max(0, height - 1);
  const items: DispItem[] = [];
  if (groups) {
    let ord = 0;
    for (const r of groups) {
      if (r.kind === 'header') items.push({ header: r });
      else items.push({ entry: r.entry, ord: ord++ });
    }
  } else {
    for (let i = 0; i < entries.length; i++) items.push({ entry: entries[i], ord: i });
  }
  let selRow = items.findIndex(it => 'ord' in it && it.ord === selected);
  if (selRow < 0) selRow = Math.max(0, Math.min(selected, items.length - 1));
  const start = useListWindow(items.length, selRow, rowBudget);
  const visible = items.slice(start, start + rowBudget);

  const W = width ?? 100;
  const enabled = new Set(columns);
  const shown = new Set<NetColumnId>();
  let fixed = 0;
  if (enabled.has('status')) {
    shown.add('status');
    fixed += COL_WIDTH.status;
  }
  for (const col of KEEP_ORDER) {
    if (!enabled.has(col)) continue;
    if (W - 1 - (fixed + COL_WIDTH[col]) < 32) break;
    shown.add(col);
    fixed += COL_WIDTH[col];
  }
  const urlMode = enabled.has('url');
  let wfWidth = WATERFALL_MIN;
  if (shown.has('waterfall')) {
    const surplus = W - 1 - fixed - NAME_TARGET;
    if (surplus > 0) {
      const extra = Math.min(surplus, WATERFALL_MAX - WATERFALL_MIN);
      wfWidth += extra;
      fixed += extra;
    }
  }
  const urlBudget = Math.max(3, W - 1 - fixed);

  const minTs = entries.length ? Math.min(...entries.map(e => e.startTs)) : 0;
  const maxEnd = entries.length ? Math.max(...entries.map(e => e.startTs + (e.durationMs ?? 0))) : 0;
  const span = maxEnd - minTs;

  const arrow = (col: NetColumnId): string => (SORT_COLUMN[sortKey] === col ? (sortDir === 'desc' ? '↓' : '↑') : '');
  let header = shown.has('status') ? ('St' + arrow('status')).padEnd(5) : '';
  if (shown.has('method')) header += 'Meth'.padEnd(7) + ' ';
  if (shown.has('type')) header += 'Type'.padEnd(9) + ' ';
  if (shown.has('time')) header += ('Time' + arrow('time')).padStart(7) + ' ';
  if (shown.has('size')) header += ('Size' + arrow('size')).padStart(7) + '  ';
  if (shown.has('cookies')) header += 'Ck'.padStart(3) + ' ';
  if (shown.has('host')) header += 'Host'.padEnd(16) + '  ';
  if (shown.has('protocol')) header += 'Proto'.padEnd(7) + ' ';
  if (shown.has('priority')) header += 'Pri'.padEnd(3) + ' ';
  if (shown.has('initiator')) header += 'Initiator'.padEnd(17) + ' ';
  if (shown.has('set-cookies')) header += 'SC'.padStart(3) + ' ';
  if (shown.has('remote')) header += 'Remote'.padEnd(21) + ' ';
  if (shown.has('waterfall')) header += ' ' + 'Waterfall'.padEnd(wfWidth) + ' ';
  header += (urlMode ? 'URL' : 'Name') + arrow('name');

  const entryNode = (e: NetworkEntry, ord: number): React.ReactNode => {
    const sel = ord === selected;
    const methodCell = shown.has('method') ? e.method.padEnd(7).slice(0, 7) + ' ' : '';
    let mid = '';
    if (shown.has('type')) mid += e.type.padEnd(9).slice(0, 9) + ' ';
    if (shown.has('time')) mid += fmtMs(e.durationMs).padStart(7) + ' ';
    if (shown.has('size')) mid += fmtBytes(e.encodedBytes).padStart(7) + '  ';
    if (shown.has('cookies')) {
      const n = cookieCount(e);
      mid += (n > 0 ? String(n) : '').padStart(3) + ' ';
    }
    if (shown.has('host')) mid += truncate(hostOf(e.url), 16).padEnd(16) + '  ';
    if (shown.has('protocol')) mid += (e.protocol ?? '').padEnd(7).slice(0, 7) + ' ';
    if (shown.has('priority')) mid += priorityCell(e).padEnd(3).slice(0, 3) + ' ';
    if (shown.has('initiator')) mid += truncate(initiatorCell(e), 17).padEnd(17).slice(0, 17) + ' ';
    if (shown.has('set-cookies')) {
      const n = e.setCookies?.length ?? 0;
      mid += (n > 0 ? String(n) : '').padStart(3) + ' ';
    }
    if (shown.has('remote')) mid += truncate(e.remoteAddress ?? '', 21).padEnd(21).slice(0, 21) + ' ';
    const mapPrefix = e.remappedTo ? '↪ ' : '';
    const gqlPrefix = !urlMode && e.gqlOperation ? 'gql·' : '';
    const { name, context } = urlMode ? { name: e.url, context: '' }
      : e.gqlOperation ? { name: e.gqlOperation, context: nameOf(e.url).context }
      : nameOf(e.url);
    const shownName = truncate(name, (urlMode ? urlBudget : Math.min(urlBudget, 44) - gqlPrefix.length) - mapPrefix.length);
    const ctxBudget = urlBudget - mapPrefix.length - gqlPrefix.length - shownName.length - 2;
    const shownCtx = ctxBudget >= 4 && context ? truncate(context, ctxBudget) : '';
    const pad = sel && width !== undefined
      ? Math.max(0, W - 1 - fixed - mapPrefix.length - gqlPrefix.length - shownName.length - (shownCtx ? shownCtx.length + 2 : 0))
      : 0;
    return (
      <Text key={`${e.id}-${ord}`} backgroundColor={sel ? '#223543' : undefined} wrap="truncate">
        {sel && focused ? <Text color="cyan">▌</Text> : marked?.has(e.id) ? <Text color={theme.accent}>◆</Text> : <Text> </Text>}
        {shown.has('status') ? <Text color={statusColor(e)}>{statusCell(e).padEnd(5)}</Text> : null}
        {methodCell ? <Text color={methodColor(e.method)}>{methodCell}</Text> : null}
        {mid}
        {shown.has('waterfall') ? <Text dimColor={!sel}>{' ' + waterfall(e, minTs, span, wfWidth) + ' '}</Text> : null}
        {mapPrefix ? <Text color="yellow">{mapPrefix}</Text> : null}
        {gqlPrefix ? <Text dimColor>{gqlPrefix}</Text> : null}
        {shownName}
        {shownCtx ? <Text dimColor>{'  ' + shownCtx}</Text> : null}
        {pad > 0 ? ' '.repeat(pad) : ''}
      </Text>
    );
  };

  const content: React.ReactNode[] = [];
  if (items.length === 0) {
    if (rowBudget > 0) content.push(<Text key="empty" dimColor> {t('panel.network.empty')}</Text>);
  } else {
    visible.forEach(it => {
      if ('header' in it) {
        const h = it.header;
        content.push(
          <Text key={`grp-${h.key}`} wrap="truncate">
            <Text color={theme.accent}>{h.collapsed ? '▸ ' : '▾ '}</Text>
            <Text bold color="cyan">{truncate(h.label, Math.max(3, W - 10))}</Text>
            <Text dimColor>{` (${h.count})`}</Text>
          </Text>,
        );
      } else {
        content.push(entryNode(it.entry, it.ord));
      }
    });
  }
  return (
    <Box flexDirection="column" {...(width !== undefined ? { width } : { flexGrow: 1 })}>
      <Text dimColor wrap="truncate">{' ' + header}</Text>
      {padRows(content, rowBudget, 'pad')}
    </Box>
  );
}
