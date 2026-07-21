import type { NetworkEntry } from '../../store/types.js';
import { fmtBytes, fmtMs } from './format.js';
import { theme } from './theme.js';
import type { Seg } from './highlight.js';
import type { Line } from '../overlays/DetailOverlay.js';

const LABEL_W = 9;

type Marker = '-' | '+' | ' ';

function row(marker: Marker, label: string, value: string): Line {
  const head = `  ${marker} ${label.padEnd(LABEL_W)}`;
  const text = head + value;
  const segs: Seg[] =
    marker === '-' ? [{ text, color: 'red' }]
    : marker === '+' ? [{ text, color: 'green' }]
    : [{ text: head, color: 'cyan' }, { text: value }];
  return { text, segs };
}

function section(label: string, meta?: string | number): Line {
  const metaText = meta === undefined ? '' : ` · ${meta}`;
  return {
    text: `▍ ${label}${metaText}`,
    segs: [
      { text: '▍ ', color: theme.accent },
      { text: label },
      ...(metaText ? [{ text: metaText, color: theme.muted }] : []),
    ],
    section: true,
  };
}

function fieldRows(label: string, a: string | undefined, b: string | undefined): Line[] {
  if (a === b) return a === undefined || a === '' ? [] : [row(' ', label, a)];
  const out: Line[] = [];
  if (a !== undefined && a !== '') out.push(row('-', label, a));
  if (b !== undefined && b !== '') out.push(row('+', label, b));
  return out;
}

function headerRows(a: Record<string, string>, b: Record<string, string>): Line[] {
  const lower = (h: Record<string, string>): Map<string, [string, string]> => {
    const m = new Map<string, [string, string]>();
    for (const [k, v] of Object.entries(h)) m.set(k.toLowerCase(), [k, v]);
    return m;
  };
  const ma = lower(a);
  const mb = lower(b);
  const keys = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  const out: Line[] = [];
  for (const key of keys) {
    const va = ma.get(key);
    const vb = mb.get(key);
    if (va && vb && va[1] === vb[1]) out.push(row(' ', key, va[1]));
    else {
      if (va) out.push(row('-', key, va[1]));
      if (vb) out.push(row('+', key, vb[1]));
    }
  }
  return out;
}

const statusText = (e: NetworkEntry): string =>
  e.error ? `FAIL (${e.error})` : e.status === undefined ? 'pending' : `${e.status}${e.statusText ? ` ${e.statusText}` : ''}`;

const span = (s: number, en: number): number | undefined => (s >= 0 && en >= s ? Math.round(en - s) : undefined);

function timingValues(e: NetworkEntry): Array<[string, string | undefined]> {
  const t = e.timing;
  const ms = (v: number | undefined): string | undefined => (v === undefined ? undefined : fmtMs(v));
  return [
    ['time', e.durationMs === undefined ? undefined : fmtMs(e.durationMs)],
    ['queueing', ms(e.queueingMs === undefined ? undefined : Math.round(e.queueingMs))],
    ['dns', ms(t ? span(t.dnsStart, t.dnsEnd) : undefined)],
    ['connect', ms(t ? span(t.connectStart, t.connectEnd) : undefined)],
    ['ssl', ms(t ? span(t.sslStart, t.sslEnd) : undefined)],
    ['ttfb', ms(t ? span(t.sendEnd, t.receiveHeadersEnd) : undefined)],
  ];
}

export function netDiffLines(a: NetworkEntry, b: NetworkEntry, _width = 80): Line[] {
  const lines: Line[] = [
    section('overview'),
    ...fieldRows('url', a.url, b.url),
    ...fieldRows('method', a.method, b.method),
    ...fieldRows('status', statusText(a), statusText(b)),
    ...fieldRows('type', a.type, b.type),
    ...fieldRows('mime', a.mimeType, b.mimeType),
    ...fieldRows('size', a.encodedBytes === undefined ? undefined : fmtBytes(a.encodedBytes), b.encodedBytes === undefined ? undefined : fmtBytes(b.encodedBytes)),
  ];
  const reqHeaders = headerRows(a.requestHeaders, b.requestHeaders);
  lines.push({ text: '' }, section('request headers', reqHeaders.length), ...reqHeaders);
  const resHeaders = headerRows(a.responseHeaders, b.responseHeaders);
  lines.push({ text: '' }, section('response headers', resHeaders.length), ...resHeaders);
  const ta = timingValues(a);
  const tb = timingValues(b);
  const timing: Line[] = [];
  for (let i = 0; i < ta.length; i++) timing.push(...fieldRows(ta[i][0], ta[i][1], tb[i][1]));
  if (timing.length) lines.push({ text: '' }, section('timing'), ...timing);
  return lines;
}
