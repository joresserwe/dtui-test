import React from 'react';
import { Box, Text } from 'ink';
import type { NetworkEntry } from '../../store/types.js';
import { WS_FRAME_CAP } from '../../store/network.js';
import { displayWidth, fmtBytes, fmtClockMs, fmtDateTime, fmtMs, fmtRel, prettyBody, statusColor, truncateWidth } from '../lib/format.js';
import { header } from '../../util/headers.js';
import { highlightCss, highlightHtml, highlightJson, segsToNodes, type Seg } from '../lib/highlight.js';
import { highlightSegs } from '../lib/search.js';
import { t } from '../lib/i18n.js';
import { theme, methodColor } from '../lib/theme.js';
import { requestJwts, setCookieJwts, type JwtToken } from '../lib/jwt.js';
import { tabSpan, tabUnderline } from '../lib/folder-tabs.js';

function highlighterFor(mime: string): ((line: string) => Seg[]) | null {
  if (/json/.test(mime)) return highlightJson;
  if (/css/.test(mime)) return highlightCss;
  if (/html|xml/.test(mime)) return highlightHtml;
  return null;
}

export type DetailTab = 'summary' | 'request' | 'response' | 'body' | 'messages';
export const DETAIL_TABS: readonly DetailTab[] = ['summary', 'request', 'response', 'body'];
const WS_TABS: readonly DetailTab[] = [...DETAIL_TABS, 'messages'];

export const detailTabsFor = (e: NetworkEntry): readonly DetailTab[] => (e.wsFrames ? WS_TABS : DETAIL_TABS);

const TAB_LABELS: Record<DetailTab, string> = {
  summary: 'Summary',
  request: 'Request',
  response: 'Response',
  body: 'Body',
  messages: 'Messages',
};

export const DETAIL_CHROME = 5;
const KV_LABEL = 10;
const TWO_COL_MIN = 96;

export interface Line {
  text: string;
  segs?: Seg[];
  section?: boolean;
  // segs are final (already syntax-highlighted, e.g. a wrapped body fragment);
  // the overlay must not re-run the tab-level highlighter on this line.
  pre?: boolean;
  // Expandable console-tree node this line represents (first wrapped row only).
  node?: { path: string; objectId: string };
}

const plain = (text: string): Line => ({ text });

const section = (label: string, meta?: string | number): Line => {
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
};

const kv = (label: string, value: string | Seg[]): Line => {
  const vsegs: Seg[] = typeof value === 'string' ? [{ text: value }] : value;
  const key = `  ${label.padEnd(KV_LABEL)}`;
  return { text: key + vsegs.map(s => s.text).join(''), segs: [{ text: key, color: 'cyan' }, ...vsegs] };
};

function failReason(e: NetworkEntry): string {
  const parts = [e.error!];
  if (e.corsError) parts.push(`CORS: ${e.corsError}${e.corsFailedParameter ? ` (${e.corsFailedParameter})` : ''}`);
  else if (e.blockedReason) parts.push(`blocked: ${e.blockedReason}`);
  return parts.join(' · ');
}

const statusSegs = (e: NetworkEntry): Seg[] =>
  e.error ? [{ text: `FAIL (${failReason(e)})`, color: 'red' }]
  : e.status === undefined ? [{ text: 'pending', dim: true }]
  : [{ text: `${e.status}${e.statusText ? ` ${e.statusText}` : ''}`, color: statusColor(e) }];

function wrapWidth(s: string, width: number): string[] {
  if (width <= 0 || displayWidth(s) <= width) return [s];
  const out: string[] = [];
  let cur = '';
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width && cur) {
      out.push(cur);
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  out.push(cur);
  return out;
}

export function wrapSegs(segs: Seg[], width: number): Seg[][] {
  if (width <= 0) return [segs];
  const rows: Seg[][] = [];
  let row: Seg[] = [];
  let w = 0;
  for (const seg of segs) {
    let text = '';
    for (const ch of seg.text) {
      const cw = displayWidth(ch);
      if (w + cw > width && w > 0) {
        if (text) row.push({ ...seg, text });
        rows.push(row);
        row = [];
        text = '';
        w = 0;
      }
      text += ch;
      w += cw;
    }
    if (text) row.push({ ...seg, text });
  }
  rows.push(row);
  return rows;
}

function wrapBodyContent(raw: string[], hl: ((line: string) => Seg[]) | null, width: number): Line[] {
  const out: Line[] = [];
  for (const l of raw) {
    for (const segs of wrapSegs(hl ? hl(l) : [{ text: l }], width)) {
      out.push({ text: segs.map(s => s.text).join(''), segs, pre: true });
    }
  }
  return out;
}

const PHASE_COLORS: Record<string, string> = {
  queueing: 'gray',
  stalled: 'white',
  dns: 'yellow',
  connect: 'magenta',
  ssl: 'blue',
  ttfb: 'cyan',
  download: 'green',
};

export function stackedCells(values: number[], width: number): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || width <= 0) return values.map(() => 0);
  const cells = values.map(v => (v > 0 ? Math.max(1, Math.round((v / total) * width)) : 0));
  let sum = cells.reduce((a, b) => a + b, 0);
  while (sum > width) {
    let idx = -1;
    for (let i = 0; i < cells.length; i++) if (cells[i] > 1 && (idx < 0 || cells[i] > cells[idx])) idx = i;
    if (idx < 0) break;
    cells[idx]--;
    sum--;
  }
  if (sum < width && sum > 0) {
    let idx = 0;
    for (let i = 1; i < cells.length; i++) if (cells[i] > cells[idx]) idx = i;
    cells[idx] += width - sum;
  }
  return cells;
}

function timingPhases(e: NetworkEntry): [string, number][] {
  if (!e.timing) return [];
  const t = e.timing;
  const span = (s: number, en: number): number | undefined => (s >= 0 && en >= s ? Math.round(en - s) : undefined);
  const download =
    e.durationMs !== undefined && t.receiveHeadersEnd >= 0 ? Math.max(0, Math.round(e.durationMs - t.receiveHeadersEnd)) : undefined;
  const starts = [t.dnsStart, t.connectStart, t.sendStart].filter(v => v >= 0);
  const stalled = starts.length ? Math.round(Math.min(...starts)) : undefined;
  const phases: [string, number | undefined][] = [
    ['queueing', e.queueingMs !== undefined ? Math.round(e.queueingMs) : undefined],
    ['stalled', stalled],
    ['dns', span(t.dnsStart, t.dnsEnd)],
    ['connect', span(t.connectStart, t.connectEnd)],
    ['ssl', span(t.sslStart, t.sslEnd)],
    ['ttfb', span(t.sendEnd, t.receiveHeadersEnd)],
    ['download', download],
  ];
  return phases.filter((p): p is [string, number] => p[1] !== undefined && p[1] > 0);
}

function timingSection(e: NetworkEntry, width: number): Line[] {
  const active = timingPhases(e);
  if (!active.length) return [];
  const total = e.durationMs ?? active.reduce((a, [, ms]) => a + ms, 0);
  const label = ` ${fmtMs(total)}`;
  const barW = Math.max(10, width - 2 - displayWidth(label));
  const cells = stackedCells(active.map(([, ms]) => ms), barW);
  const barSegs: Seg[] = active.map(([name], i) => ({ text: '█'.repeat(cells[i]), color: PHASE_COLORS[name] }));
  const lines: Line[] = [
    section('timing'),
    {
      text: `  ${barSegs.map(s => s.text).join('')}${label}`,
      segs: [{ text: '  ' }, ...barSegs, { text: label, dim: true }],
    },
  ];
  let segs: Seg[] = [{ text: '  ' }];
  let w = 2;
  const flush = () => {
    if (segs.length > 1) lines.push({ text: segs.map(s => s.text).join(''), segs });
    segs = [{ text: '  ' }];
    w = 2;
  };
  for (const [name, ms] of active) {
    const item = `■ ${name} ${fmtMs(ms)}`;
    const sep = segs.length > 1 ? '  ' : '';
    if (w + sep.length + item.length > width && segs.length > 1) flush();
    if (segs.length > 1) segs.push({ text: '  ' });
    segs.push({ text: '■ ', color: PHASE_COLORS[name] }, { text: `${name} `, dim: true }, { text: fmtMs(ms) });
    w += sep.length + item.length;
  }
  flush();
  return lines;
}

function securitySection(e: NetworkEntry): Line[] {
  const sd = e.securityDetails;
  if (!sd) return e.securityState ? [section('security', e.securityState)] : [];
  const lines = [section('security', e.securityState)];
  const proto = [sd.protocol, sd.keyExchange, sd.keyExchangeGroup, sd.cipher].filter(Boolean).join(' · ');
  if (proto) lines.push(kv('protocol', proto));
  if (sd.subjectName || sd.issuer) {
    lines.push(kv('cert', [{ text: sd.subjectName }, ...(sd.issuer ? [{ text: ` · issuer ${sd.issuer}`, dim: true } as Seg] : [])]));
  }
  if (sd.validTo) {
    const now = Date.now();
    const toMs = sd.validTo * 1000;
    const expired = toMs <= now;
    const rel = t(expired ? 'detail.jwt.expired' : 'detail.jwt.expiresIn', { t: fmtRel(toMs - now) });
    const text = `${fmtDateTime(sd.validFrom * 1000)} → ${fmtDateTime(toMs)} (${rel})`;
    lines.push(kv('valid', [expired ? { text, color: 'red' } : { text }]));
  }
  if (sd.sanList.length) lines.push(kv('SAN', sd.sanList.join(', ')));
  return lines;
}

function serverTimingSection(e: NetworkEntry): Line[] {
  const raw = header(e.responseHeaders, 'server-timing');
  if (!raw) return [];
  const rows: Line[] = [];
  for (const part of raw.split(',')) {
    const pieces = part.split(';').map(s => s.trim()).filter(Boolean);
    if (!pieces.length) continue;
    let dur: string | undefined;
    let desc: string | undefined;
    for (const p of pieces.slice(1)) {
      const m = /^(dur|desc)=(.*)$/i.exec(p);
      if (!m) continue;
      const v = m[2].replace(/^"|"$/g, '');
      if (m[1].toLowerCase() === 'dur') dur = v;
      else desc = v;
    }
    rows.push(kv(pieces[0], [{ text: dur !== undefined ? `${dur}ms` : '-' }, ...(desc ? [{ text: ` ${desc}`, dim: true }] : [])]));
  }
  return rows.length ? [section('server-timing'), ...rows] : [];
}

function bodySection(e: NetworkEntry): Line[] {
  const lines = [section('body')];
  if (e.postData !== undefined) {
    lines.push(kv('request', [{ text: fmtBytes(e.postData.length) }, { text: ' → tab 2', dim: true }]));
  }
  lines.push(
    kv('response', e.body !== undefined
      ? [{ text: fmtBytes(e.body.length) }, { text: ' → tab 4', dim: true }]
      : [{ text: t('detail.none'), dim: true }]),
  );
  return lines;
}

function kvRows(pairs: [string, string][], width: number, colorOf?: (key: string) => string | undefined): Line[] {
  const cap = Math.max(8, Math.floor(width * 0.4));
  const fitting = pairs.filter(([k]) => displayWidth(k) <= cap);
  const pad = Math.max(0, ...fitting.map(([k]) => displayWidth(k)));
  const out: Line[] = [];
  const valueLine = (text: string, color: string | undefined): Line =>
    color ? { text, segs: [{ text, color }] } : plain(text);
  for (const [k, v] of pairs) {
    const color = colorOf?.(k);
    if (displayWidth(k) > cap) {
      out.push({ text: `  ${k}`, segs: [{ text: `  ${k}`, color: 'cyan' }] });
      for (const part of wrapWidth(v, Math.max(1, width - 4))) {
        out.push(valueLine(`    ${part}`, color));
      }
      continue;
    }
    const gap = ' '.repeat(pad - displayWidth(k) + 1);
    const indent = 2 + pad + 1;
    const [first, ...rest] = wrapWidth(v, Math.max(1, width - indent));
    out.push({ text: `  ${k}${gap}${first}`, segs: [{ text: `  ${k}${gap}`, color: 'cyan' }, color ? { text: first, color } : { text: first }] });
    for (const cont of rest) out.push(valueLine(`${' '.repeat(indent)}${cont}`, color));
  }
  return out;
}

function headerSection(headers: Record<string, string>, width: number): Line[] {
  const pairs = Object.entries(headers);
  return [section('headers', pairs.length), ...kvRows(pairs, width)];
}

const CACHE_NOTE = { disk: 'disk cache', memory: 'memory cache', sw: 'service worker' } as const;

const scriptName = (url: string): string => url.split('?')[0].split('/').filter(Boolean).pop() || url;

function initiatorLines(e: NetworkEntry): Line[] {
  const init = e.initiator;
  if (!init) return [];
  const loc = init.url ? ` · ${scriptName(init.url)}${init.lineNumber !== undefined ? `:${init.lineNumber + 1}` : ''}` : '';
  const lines = [kv('initiator', [{ text: init.type }, ...(loc ? [{ text: loc, dim: true }] : [])])];
  for (const f of init.stack ?? []) {
    const text = `  ${''.padEnd(KV_LABEL)}↳ ${f.functionName || '(anonymous)'} @ ${scriptName(f.url)}:${f.lineNumber + 1}`;
    lines.push({ text, segs: [{ text, dim: true }] });
  }
  return lines;
}

export function detailChips(e: NetworkEntry): Seg[] {
  const note = e.fromCache ? CACHE_NOTE[e.fromCache] : undefined;
  const chips: Seg[][] = [];
  if (e.durationMs !== undefined) chips.push([{ text: fmtMs(e.durationMs) }]);
  if (e.encodedBytes !== undefined) chips.push([{ text: fmtBytes(e.encodedBytes) }]);
  if (e.protocol) chips.push([{ text: e.protocol }]);
  if (e.remoteAddress) chips.push([{ text: e.remoteAddress }]);
  if (note) chips.push([{ text: note, color: theme.muted }]);
  const segs: Seg[] = [];
  chips.forEach((c, i) => {
    if (i) segs.push({ text: ' · ', color: theme.faint });
    segs.push(...c);
  });
  return segs;
}

function twoColumn(rows: [string, Seg[]][], width: number): Line[] {
  const colW = Math.floor(width / 2);
  const out: Line[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const a = kv(rows[i][0], rows[i][1]);
    const b = i + 1 < rows.length ? kv(rows[i + 1][0], rows[i + 1][1]) : undefined;
    if (!b || displayWidth(a.text) >= colW || displayWidth(b.text) > width - colW) {
      out.push(a);
      if (b) out.push(b);
      continue;
    }
    const gap = ' '.repeat(colW - displayWidth(a.text));
    out.push({ text: a.text + gap + b.text, segs: [...a.segs!, { text: gap }, ...b.segs!] });
  }
  return out;
}

const compressionPct = (e: NetworkEntry): number =>
  Math.round((1 - e.encodedBytes! / e.decodedBytes!) * 100);

const sizesDiffer = (e: NetworkEntry): boolean =>
  e.encodedBytes !== undefined && e.decodedBytes !== undefined &&
  e.decodedBytes > e.encodedBytes && compressionPct(e) >= 1;

function summarySizeSegs(e: NetworkEntry): Seg[] {
  const note = e.fromCache ? CACHE_NOTE[e.fromCache] : undefined;
  const noteSeg: Seg[] = note ? [{ text: ` (${note})`, dim: true }] : [];
  if (!sizesDiffer(e)) return [{ text: fmtBytes(e.encodedBytes) }, ...noteSeg];
  return [
    { text: fmtBytes(e.encodedBytes) },
    { text: ' transferred', dim: true },
    ...noteSeg,
    { text: ` · ${fmtBytes(e.decodedBytes)} resource (${t('detail.compressed', { pct: compressionPct(e) })})`, dim: true },
  ];
}

function summaryLines(e: NetworkEntry, width: number): Line[] {
  const rows: [string, Seg[]][] = [
    ['status', [...statusSegs(e), ...(e.overridden ? [{ text: ' (override)', dim: true } as Seg] : [])]],
    ['type', [{ text: e.type }, ...(e.mimeType ? [{ text: ` · ${e.mimeType}`, dim: true }] : [])]],
    ['size', summarySizeSegs(e)],
    ['time', [{ text: fmtMs(e.durationMs) }]],
    ...(e.gqlOperation ? [['operation', [{ text: e.gqlOperation }, ...(e.gqlType ? [{ text: ` · ${e.gqlType}`, dim: true }] : [])]] as [string, Seg[]]] : []),
    ...(e.remoteAddress ? [['remote', [{ text: e.remoteAddress }]] as [string, Seg[]]] : []),
    ...(e.protocol ? [['protocol', [{ text: e.protocol }]] as [string, Seg[]]] : []),
    ...(e.priority ? [['priority', [{ text: e.priority }]] as [string, Seg[]]] : []),
    ...(e.referrerPolicy ? [['referrer', [{ text: e.referrerPolicy }]] as [string, Seg[]]] : []),
    ...(e.remappedTo ? [['mapped', [{ text: `↪ ${e.remappedTo}` }]] as [string, Seg[]]] : []),
  ];
  const lines = [
    section('overview'),
    ...(width >= TWO_COL_MIN ? twoColumn(rows, width) : rows.map(([k, v]) => kv(k, v))),
    ...initiatorLines(e),
  ];
  const timing = timingSection(e, width);
  if (timing.length) lines.push(plain(''), ...timing);
  const serverTiming = serverTimingSection(e);
  if (serverTiming.length) lines.push(plain(''), ...serverTiming);
  const security = securitySection(e);
  if (security.length) lines.push(plain(''), ...security);
  lines.push(plain(''), ...bodySection(e));
  return lines;
}

function querySection(e: NetworkEntry, width: number): Line[] {
  let pairs: [string, string][];
  try {
    pairs = [...new URL(e.url).searchParams];
  } catch {
    return [];
  }
  if (!pairs.length) return [];
  return [section('query params', pairs.length), ...kvRows(pairs, width)];
}

function requestCookieSection(e: NetworkEntry, width: number): Line[] {
  const raw = header(e.requestHeaders, 'cookie');
  const pairs: [string, string][] = raw
    ? raw.split(';').map(c => c.trim()).filter(Boolean).map(c => {
        const i = c.indexOf('=');
        return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)];
      })
    : [];
  const blocked = e.blockedRequestCookies ?? [];
  if (!pairs.length && !blocked.length) return [];
  const rows = kvRows(pairs, width);
  for (const b of blocked) {
    const reason = b.reasons.join(', ');
    rows.push({ text: `  ⚠ ${b.name} ${reason}`, segs: [{ text: `  ⚠ ${b.name} `, color: 'yellow' }, { text: reason, color: 'yellow', dim: true }] });
  }
  return [section('cookies', pairs.length + blocked.length), ...rows];
}

const JWT_TIME_CLAIMS = new Set(['exp', 'iat', 'nbf']);

const claimText = (v: unknown): string =>
  typeof v === 'string' ? v : v === null || typeof v !== 'object' ? String(v) : JSON.stringify(v);

function jwtTimeValue(claim: string, epochSec: number, now: number): string {
  const ms = epochSec * 1000;
  const rel = fmtRel(ms - now);
  const relText = claim === 'exp'
    ? (ms <= now ? t('detail.jwt.expired', { t: rel }) : t('detail.jwt.expiresIn', { t: rel }))
    : (ms <= now ? t('detail.jwt.ago', { t: rel }) : t('detail.jwt.in', { t: rel }));
  return `${fmtDateTime(ms)} (${relText})`;
}

export function jwtClaimPairs(
  tok: { header: Record<string, unknown>; payload: Record<string, unknown> },
  now = Date.now(),
): { pairs: [string, string][]; expired: boolean } {
  const pairs: [string, string][] = [];
  for (const k of ['alg', 'typ']) {
    if (tok.header[k] !== undefined) pairs.push([k, claimText(tok.header[k])]);
  }
  let expired = false;
  for (const [k, v] of Object.entries(tok.payload)) {
    if (JWT_TIME_CLAIMS.has(k) && typeof v === 'number') {
      pairs.push([k, jwtTimeValue(k, v, now)]);
      if (k === 'exp' && v * 1000 <= now) expired = true;
    } else {
      pairs.push([k, claimText(v)]);
    }
  }
  return { pairs, expired };
}

function jwtSections(tokens: JwtToken[], width: number): Line[] {
  const now = Date.now();
  const lines: Line[] = [];
  for (const tok of tokens) {
    lines.push(plain(''), section(t('detail.jwt'), tok.source));
    const { pairs, expired } = jwtClaimPairs(tok, now);
    lines.push(...kvRows(pairs, width, k => (expired && k === 'exp' ? 'red' : undefined)));
  }
  return lines;
}

function requestLines(e: NetworkEntry, width: number, wrap = false): Line[] {
  const wrapped = wrapWidth(`${e.method} ${e.url}`, width);
  const lines = wrapped.map((l, i): Line =>
    i === 0 && l.startsWith(`${e.method} `)
      ? { text: l, segs: [{ text: e.method, bold: true }, { text: l.slice(e.method.length) }] }
      : plain(l));
  const query = querySection(e, width);
  if (query.length) lines.push(plain(''), ...query);
  lines.push(plain(''), ...headerSection(e.requestHeaders, width));
  const cookies = requestCookieSection(e, width);
  if (cookies.length) lines.push(plain(''), ...cookies);
  lines.push(...jwtSections(requestJwts(e.requestHeaders), width));
  if (e.postData !== undefined) {
    const ct = header(e.requestHeaders, 'content-type');
    if (/x-www-form-urlencoded/i.test(ct)) {
      const pairs = [...new URLSearchParams(e.postData)];
      lines.push(plain(''), section('form data', pairs.length), ...kvRows(pairs, width));
    } else {
      const raw = prettyBody(e.postData, ct).split('\n');
      lines.push(
        plain(''),
        section('body', ct || undefined),
        ...(wrap ? wrapBodyContent(raw, highlighterFor(ct), width) : raw.map(plain)),
      );
    }
  }
  return lines;
}

function setCookieRow(line: string, reasons?: string[]): Line {
  const semi = line.indexOf(';');
  const nv = (semi < 0 ? line : line.slice(0, semi)).trim();
  const attrs = semi < 0 ? '' : line.slice(semi + 1).trim();
  const eq = nv.indexOf('=');
  const name = eq < 0 ? nv : nv.slice(0, eq);
  const value = eq < 0 ? '' : nv.slice(eq + 1);
  const segs: Seg[] = reasons
    ? [{ text: `  ⚠ ${name}`, color: 'yellow' }, { text: `=${value}` }]
    : [{ text: `  ${name}`, color: 'cyan' }, { text: `=${value}` }];
  if (attrs) segs.push({ text: `  ${attrs}`, dim: true });
  if (reasons) segs.push({ text: `  ${reasons.join(', ')}`, color: 'yellow' });
  return { text: segs.map(s => s.text).join(''), segs };
}

function setCookieSection(e: NetworkEntry): Line[] {
  const cookies = e.setCookies ?? [];
  const blocked = e.blockedResponseCookies ?? [];
  const reasonsFor = (line: string) => blocked.find(b => b.cookieLine === line)?.reasons;
  const extra = blocked.filter(b => b.cookieLine && !cookies.includes(b.cookieLine));
  if (!cookies.length && !extra.length) return [];
  return [
    section('set-cookie', cookies.length + extra.length),
    ...cookies.map(c => setCookieRow(c, reasonsFor(c))),
    ...extra.map(b => setCookieRow(b.cookieLine, b.reasons)),
  ];
}

function responseLines(e: NetworkEntry, width: number): Line[] {
  const lines = [
    section('status'),
    kv('status', statusSegs(e)),
    kv('size', fmtBytes(e.encodedBytes)),
    ...(sizesDiffer(e) ? [kv('resource', fmtBytes(e.decodedBytes))] : []),
    kv('mime', e.mimeType ?? '-'),
    plain(''),
    ...headerSection(e.responseHeaders, width),
  ];
  const setCookies = setCookieSection(e);
  if (setCookies.length) lines.push(plain(''), ...setCookies);
  lines.push(...jwtSections(setCookieJwts(e.setCookies ?? []), width));
  return lines;
}

function bodyLines(e: NetworkEntry, width: number, wrap: boolean): Line[] {
  if (e.body === undefined) return [plain(t('detail.noResponseBody'))];
  const meta = `${e.mimeType ?? '-'} · ${fmtBytes(e.body.length)}${e.bodyTruncated ? ' · truncated' : ''}`;
  const head = section('response body', meta);
  if (e.bodyBase64) return [head, plain(`<base64 body, ${e.body.length} chars>`)];
  const raw = prettyBody(e.body, e.mimeType).split('\n');
  if (!wrap) return [head, ...raw.map(plain)];
  return [head, ...wrapBodyContent(raw, highlighterFor(e.mimeType ?? ''), width)];
}

const frameTs = fmtClockMs;

function messageLines(e: NetworkEntry, width: number, filter = ''): Line[] {
  const all = e.wsFrames ?? [];
  if (!all.length) return [plain('no messages')];
  const needle = filter.trim().toLowerCase();
  const frames = needle ? all.filter(f => f.payload.toLowerCase().includes(needle)) : all;
  const lines = [section('messages', needle ? `${frames.length}/${all.length}` : all.length)];
  if (e.wsFramesDropped) {
    const note = `  … ${e.wsFramesDropped} older frames dropped (cap ${WS_FRAME_CAP})`;
    lines.push({ text: note, segs: [{ text: note, dim: true }] });
  }
  if (!frames.length) {
    lines.push(plain('  no matching frames'));
    return lines;
  }
  for (const f of frames) {
    const glyph = f.dir === 'sent' ? '↑' : f.dir === 'error' ? '✖' : '↓';
    const color = f.dir === 'sent' ? 'cyan' : f.dir === 'error' ? 'red' : 'green';
    const head = `  ${frameTs(f.ts)} ${glyph} `;
    const tag = f.opcode === 2 ? '[binary] ' : '';
    const payload = truncateWidth(`${tag}${f.payload.replace(/[\r\n\t]+/g, ' ')}`, Math.max(1, width - displayWidth(head)));
    lines.push({
      text: `${head}${payload}`,
      segs: [
        { text: `  ${frameTs(f.ts)} `, dim: true },
        { text: `${glyph} `, color },
        f.dir === 'error' ? { text: payload, color: 'red' } : { text: payload },
      ],
    });
  }
  return lines;
}

export function detailTabRich(e: NetworkEntry, tab: DetailTab, width = 80, wrap = false, msgFilter = ''): Line[] {
  switch (tab) {
    case 'summary':
      return summaryLines(e, width);
    case 'request':
      return requestLines(e, width, wrap);
    case 'response':
      return responseLines(e, width);
    case 'body':
      return bodyLines(e, width, wrap);
    case 'messages':
      return messageLines(e, width, msgFilter);
  }
}

export function detailTabLines(e: NetworkEntry, tab: DetailTab, width = 80, msgFilter = ''): string[] {
  return detailTabRich(e, tab, width, false, msgFilter).map(l => l.text);
}

export function statusBadge(e: NetworkEntry, width: number): { text: string; bg?: string; color: string } {
  if (e.error) {
    const cap = Math.floor(width / 2);
    const text = cap <= 7 ? ' FAIL ' : ` FAIL ${truncateWidth(e.error, cap - 7)} `;
    return { text, bg: theme.err, color: theme.badgeFg };
  }
  if (e.status === undefined) return { text: ' pending ', color: theme.muted };
  const bg = e.status >= 400 ? theme.err : e.status >= 300 ? theme.warn : theme.ok;
  return { text: ` ${e.status}${e.statusText ? ` ${e.statusText}` : ''} `, bg, color: theme.badgeFg };
}

export interface DetailOverlayProps {
  entry: NetworkEntry;
  tab: DetailTab;
  scroll: number;
  height?: number;
  width?: number;
  lines?: Line[];
  highlight?: string;
  wrap?: boolean;
  msgFilter?: string;
}

export function DetailOverlay({ entry, tab, scroll, height = 18, width = 100, lines, highlight, wrap = false, msgFilter = '' }: DetailOverlayProps) {
  const rich = lines ?? detailTabRich(entry, tab, width, wrap, msgFilter);
  const budget = Math.max(0, height - DETAIL_CHROME);
  const off = Math.min(Math.max(0, scroll), Math.max(0, rich.length - budget));
  const bodyHeaderIdx = tab === 'request' ? rich.findIndex(l => l.text.startsWith('▍ body')) : -1;
  const reqCt = tab === 'request' ? header(entry.requestHeaders, 'content-type') : '';
  const highlighterAt = (absIdx: number, line: Line): ((line: string) => Seg[]) | null => {
    if (line.section || line.pre) return null;
    if (tab === 'body') return entry.bodyBase64 ? null : highlighterFor(entry.mimeType ?? '');
    if (tab === 'request' && bodyHeaderIdx >= 0 && absIdx > bodyHeaderIdx) return highlighterFor(reqCt);
    return null;
  };
  const badge = statusBadge(entry, width);
  const badgeW = displayWidth(badge.text);
  const methodBadge = ` ${entry.method} `;
  const methodW = displayWidth(methodBadge);
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(entry.url)?.[0] ?? '';
  const schemeShown = /^(https|wss):\/\/$/i.test(scheme) ? '' : scheme;
  const rest = entry.url.slice(scheme.length);
  const hostEnd = rest.search(/[/?#]/);
  const host = hostEnd < 0 ? rest : rest.slice(0, hostEnd);
  const path = hostEnd < 0 ? '' : rest.slice(hostEnd);
  const urlAvail = Math.max(0, width - methodW - 1 - badgeW - 1);
  const shownUrl = truncateWidth(schemeShown + host + path, urlAvail);
  const shownScheme = shownUrl.slice(0, schemeShown.length);
  const shownHost = shownUrl.slice(schemeShown.length, schemeShown.length + host.length);
  const shownPath = shownUrl.slice(schemeShown.length + host.length);
  const pad = ' '.repeat(Math.max(1, width - methodW - 1 - displayWidth(shownUrl) - badgeW));
  const chips = detailChips(entry);
  const tabs = detailTabsFor(entry);
  const labels = tabs.map((t, i) => `${i + 1} ${TAB_LABELS[t]}`);
  const activeIdx = Math.max(0, tabs.indexOf(tab));
  const { preCols, activeCols } = tabSpan(labels, activeIdx, 2, ' │ ');
  const underline = tabUnderline(preCols, activeCols, width);
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        <Text backgroundColor={methodColor(entry.method)} color={theme.badgeFg} bold>{methodBadge}</Text>
        {' '}
        {shownScheme ? <Text color={theme.warn}>{shownScheme}</Text> : null}
        {shownHost}
        {shownPath ? <Text color={theme.muted}>{shownPath}</Text> : null}
        {pad}
        <Text backgroundColor={badge.bg} color={badge.color} bold={badge.bg !== undefined}>{badge.text}</Text>
      </Text>
      <Text wrap="truncate">{chips.length ? <>{' '.repeat(methodW + 1)}{segsToNodes(chips, 'chips')}</> : ' '}</Text>
      <Box justifyContent="space-between">
        <Text wrap="truncate">
          {'  '}
          {tabs.map((t, i) => {
            const active = t === tab;
            return (
              <Text key={t}>
                {i > 0 ? <Text color={theme.faint}>{' │ '}</Text> : null}
                <Text color={active ? theme.accent : theme.key} bold={active}>{`${i + 1} `}</Text>
                <Text color={active ? theme.accent : theme.muted} bold={active}>{TAB_LABELS[t]}</Text>
              </Text>
            );
          })}
        </Text>
        {rich.length > budget ? <Text color={theme.muted}>{`(${off + 1}-${Math.min(off + budget, rich.length)}/${rich.length})`}</Text> : null}
      </Box>
      <Text color={theme.accent} wrap="truncate">{underline}</Text>
      {Array.from({ length: budget }, (_, i) => {
        const line = rich[off + i];
        const hl = line?.text ? highlighterAt(off + i, line) : null;
        const base = line?.text ? (hl ? hl(line.text) : line.segs) : undefined;
        const segs = line?.text && highlight ? highlightSegs(base ?? [{ text: line.text }], highlight) : base;
        return (
          <Text key={i} wrap="truncate">
            {line?.text ? (segs ? segsToNodes(segs, `d-${i}`) : line.text) : ' '}
          </Text>
        );
      })}
      <Text color={theme.faint} wrap="truncate">{'─'.repeat(width)}</Text>
    </Box>
  );
}
