import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth, fmtBytes, fmtClockMs, fmtRel, truncate } from '../lib/format.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { parseConsoleFilter } from './ConsolePanel.js';
import { decodeJwt } from '../lib/jwt.js';
import type { IdbEntry, IdbKey, IdbStoreMeta } from '../../cdp/indexeddb.js';
import type { CacheEntry, CacheInfo } from '../../cdp/cache-storage.js';
import type { SwRegView } from '../../cdp/service-worker.js';
import type { CookieInfo, CookiePartition, StorageUsage } from '../../cdp/storage.js';
import type { FrameNodeView, OriginTrialView } from '../../cdp/page-app.js';
import type { BackgroundServiceEvent } from '../../cdp/background-service.js';
import type { PreloadAttempt, PreloadRuleSet } from '../../cdp/preload.js';
import type { ReportingEndpoint, ReportingReport } from '../../cdp/reporting.js';
import type { SharedStorageAccessEvent, SharedStorageEntry, SharedStorageMetadata, TrustTokenCount } from '../../cdp/storage.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export type StorageView = 'cookies' | 'local' | 'session' | 'idb' | 'cache' | 'sw' | 'app' | 'frames' | 'background' | 'shared' | 'pst';

export type BgSub = 'services' | 'preload' | 'reports';

export const BG_SUBS: BgSub[] = ['services', 'preload', 'reports'];

export const BASE_VIEWS: StorageView[] = ['cookies', 'local', 'session'];

export const isBaseView = (v: StorageView): boolean => BASE_VIEWS.includes(v);

export interface CookieAttrs {
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  partitionKey?: string;
  partitionKeyObj?: CookiePartition;
}

export interface AppViewState {
  manifestUrl: string;
  manifestRaw: string | null;
  manifestErrors: string[];
  installErrors: string[];
  originTrials: OriginTrialView[];
}

export interface CacheDetailMeta {
  url: string;
  status: number;
  statusText: string;
  responseType: string;
  headers: Array<[string, string]>;
}

export interface StorageRow {
  key: string;
  value: string;
  attrs?: CookieAttrs;
  meta?: string;
  note?: string;
  idbKey?: IdbKey | null;
  cacheMeta?: CacheDetailMeta;
  tone?: 'error' | 'ok' | 'muted';
}

export interface SwDispatch {
  kind: 'push' | 'sync' | 'periodicSync';
  reg: SwRegView;
  lastChance: boolean;
}

export interface StorageEditing { key: string; value: string; isNew?: boolean; attrs?: boolean; sw?: SwDispatch }

export interface IdbViewState {
  db: string | null;
  store: string | null;
  dbs: string[];
  stores: IdbStoreMeta[];
  entries: IdbEntry[];
  hasMore: boolean;
}

export interface CacheViewState {
  open: CacheInfo | null;
  caches: CacheInfo[];
  entries: CacheEntry[];
  hasMore: boolean;
}

export interface SwViewState {
  regs: SwRegView[];
  forceUpdate: boolean;
  bypass: boolean;
}

export interface BackgroundViewState {
  sub: BgSub;
  recording: boolean;
  events: BackgroundServiceEvent[];
  ruleSets: PreloadRuleSet[];
  attempts: PreloadAttempt[];
  reports: ReportingReport[];
  endpoints: ReportingEndpoint[];
}

export interface SharedStorageViewState {
  metadata: SharedStorageMetadata | null;
  entries: SharedStorageEntry[];
  events: SharedStorageAccessEvent[];
}

export type ConfirmClear = boolean | 'store' | 'cache';

export interface StorageOverlayProps {
  view: StorageView;
  cookies: StorageRow[];
  local: StorageRow[];
  session: StorageRow[];
  selected: number;
  filter?: string;
  editing?: StorageEditing;
  confirmClear?: ConfirmClear;
  error?: string;
  idb?: IdbViewState;
  cache?: CacheViewState;
  sw?: SwViewState;
  app?: AppViewState | null;
  frames?: FrameNodeView[];
  background?: BackgroundViewState | null;
  shared?: SharedStorageViewState | null;
  trustTokens?: TrustTokenCount[];
  quota?: StorageUsage | null;
  height?: number;
  width?: number;
}

const VIEWS: StorageView[] = ['cookies', 'local', 'session', 'idb', 'cache', 'sw', 'app', 'frames', 'background', 'shared', 'pst'];

export function windowViews(views: StorageView[], active: StorageView, avail: number): { shown: StorageView[]; left: boolean; right: boolean } {
  const cellW = (v: StorageView): number => displayWidth(v) + 2;
  const total = views.reduce((s, v) => s + cellW(v), 0);
  if (total <= avail) return { shown: views, left: false, right: false };
  const ai = Math.max(0, views.indexOf(active));
  let lo = ai;
  let hi = ai;
  let used = cellW(views[ai]);
  for (;;) {
    const canL = lo > 0;
    const canR = hi < views.length - 1;
    if (!canL && !canR) break;
    let grew = false;
    if (canR && used + cellW(views[hi + 1]) + ((lo > 0 ? 1 : 0) + (hi + 1 < views.length - 1 ? 1 : 0)) <= avail) {
      hi += 1;
      used += cellW(views[hi]);
      grew = true;
    }
    if (canL && used + cellW(views[lo - 1]) + ((lo - 1 > 0 ? 1 : 0) + (hi < views.length - 1 ? 1 : 0)) <= avail) {
      lo -= 1;
      used += cellW(views[lo]);
      grew = true;
    }
    if (!grew) break;
  }
  return { shown: views.slice(lo, hi + 1), left: lo > 0, right: hi < views.length - 1 };
}

const MANIFEST_FIELDS = ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color'];

export function appViewRows(app: AppViewState): StorageRow[] {
  const rows: StorageRow[] = [];
  if (app.manifestRaw) {
    rows.push({ key: app.manifestUrl || t('storage.app.manifest'), value: app.manifestRaw, meta: t('storage.app.enterJson') });
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(app.manifestRaw) as Record<string, unknown>; } catch {}
    if (parsed) {
      for (const field of MANIFEST_FIELDS) {
        if (parsed[field] != null && parsed[field] !== '') {
          const v = String(parsed[field]);
          rows.push({ key: `  ${field}`, value: v, meta: v });
        }
      }
      if (Array.isArray(parsed.icons)) {
        rows.push({ key: '  icons', value: JSON.stringify(parsed.icons, null, 2), meta: `${parsed.icons.length}` });
      }
    }
  } else {
    rows.push({ key: t('storage.app.noManifest'), value: '', tone: 'muted' });
  }
  for (const e of app.manifestErrors) rows.push({ key: `✗ ${e}`, value: e, tone: 'error' });

  rows.push({ key: `── ${t('storage.app.installability')} ──`, value: '', tone: 'muted' });
  if (app.installErrors.length === 0) rows.push({ key: `✓ ${t('storage.app.installable')}`, value: '', tone: 'ok' });
  else for (const e of app.installErrors) rows.push({ key: `✗ ${e}`, value: e, tone: 'error' });

  rows.push({ key: `── ${t('storage.app.originTrials')} ──`, value: '', tone: 'muted' });
  if (app.originTrials.length === 0) rows.push({ key: t('storage.app.noTrials'), value: '', tone: 'muted' });
  else for (const tr of app.originTrials) {
    const ok = tr.status === 'Enabled';
    rows.push({
      key: `${ok ? '✓' : '✗'} ${tr.name}`,
      value: JSON.stringify(tr, null, 2),
      meta: [tr.status, tr.tokens.map(tk => tk.status).join(',')].filter(Boolean).join(' · '),
      tone: ok ? 'ok' : 'error',
    });
  }
  return rows;
}

const isoValue = (v?: string): string => v || '-';

export function frameDetailText(f: FrameNodeView): string {
  return [
    `url: ${f.url || '-'}`,
    `origin: ${f.origin || '-'}`,
    `secureContext: ${isoValue(f.secureContext)}`,
    `crossOriginIsolated: ${isoValue(f.crossOriginIsolated)}`,
    `COEP: ${isoValue(f.coep)}${f.coepReportOnly ? ` (report-only: ${f.coepReportOnly})` : ''}`,
    `COOP: ${isoValue(f.coop)}${f.coopReportOnly ? ` (report-only: ${f.coopReportOnly})` : ''}`,
  ].join('\n');
}

export function framesViewRows(frames: FrameNodeView[]): StorageRow[] {
  return frames.map(f => {
    const label = f.url || f.origin || t('storage.frames.blank');
    const isolated = f.crossOriginIsolated === 'Isolated';
    return {
      key: `${'  '.repeat(f.depth)}${label}`,
      value: frameDetailText(f),
      meta: [
        isolated ? t('storage.frames.isolated') : t('storage.frames.notIsolated'),
        f.coop ? `COOP:${f.coop}` : '',
        f.coep ? `COEP:${f.coep}` : '',
      ].filter(Boolean).join(' · '),
      ...(isolated ? { tone: 'ok' as const } : {}),
    };
  });
}

const section = (label: string): StorageRow => ({ key: `── ${label} ──`, value: '', tone: 'muted' });

function bgServiceRows(bg: BackgroundViewState): StorageRow[] {
  if (bg.events.length === 0) return [{ key: t('storage.bg.noEvents'), value: '', tone: 'muted' }];
  return bg.events.map(e => ({
    key: `${fmtClockMs(e.timestamp * 1000)} ${e.service} · ${e.name}`,
    value: e.metadata.map(([k, v]) => `${k}: ${v}`).join('\n') || e.name,
    meta: e.origin,
  }));
}

function preloadRows(bg: BackgroundViewState): StorageRow[] {
  const rows: StorageRow[] = [section(t('storage.bg.ruleSets'))];
  if (bg.ruleSets.length === 0) rows.push({ key: t('storage.bg.noRuleSets'), value: '', tone: 'muted' });
  else for (const rs of bg.ruleSets) rows.push({
    key: rs.url || rs.id,
    value: rs.errorMessage ?? '',
    ...(rs.errorType ? { meta: rs.errorType, tone: 'error' as const } : {}),
  });
  rows.push(section(t('storage.bg.attempts')));
  if (bg.attempts.length === 0) rows.push({ key: t('storage.bg.noAttempts'), value: '', tone: 'muted' });
  else for (const a of bg.attempts) {
    const failed = !!a.failureReason;
    rows.push({
      key: `${a.action} ${a.url}`,
      value: a.failureReason ?? '',
      meta: [a.status, a.failureReason].filter(Boolean).join(' · '),
      ...(failed ? { tone: 'error' as const } : {}),
    });
  }
  return rows;
}

function reportsRows(bg: BackgroundViewState): StorageRow[] {
  const rows: StorageRow[] = [];
  if (bg.reports.length === 0) rows.push({ key: t('storage.bg.noReports'), value: '', tone: 'muted' });
  else for (const r of bg.reports) rows.push({
    key: r.url || r.type,
    value: r.body,
    meta: [r.type, r.status].filter(Boolean).join(' · '),
  });
  rows.push(section(t('storage.bg.endpoints')));
  if (bg.endpoints.length === 0) rows.push({ key: t('storage.bg.noEndpoints'), value: '', tone: 'muted' });
  else for (const e of bg.endpoints) rows.push({ key: e.url, value: '', meta: e.groupName });
  return rows;
}

export function backgroundViewRows(bg: BackgroundViewState): StorageRow[] {
  if (bg.sub === 'preload') return preloadRows(bg);
  if (bg.sub === 'reports') return reportsRows(bg);
  return bgServiceRows(bg);
}

export function sharedStorageRows(ss: SharedStorageViewState): StorageRow[] {
  const rows: StorageRow[] = [];
  if (ss.metadata) {
    rows.push(section(t('storage.shared.metadata')));
    rows.push({ key: `  creation`, value: '', meta: ss.metadata.creationTime ? fmtClockMs(ss.metadata.creationTime * 1000) : '-' });
    rows.push({ key: `  length`, value: '', meta: String(ss.metadata.length) });
    rows.push({ key: `  budget`, value: '', meta: String(ss.metadata.remainingBudget) });
    rows.push({ key: `  bytesUsed`, value: '', meta: String(ss.metadata.bytesUsed) });
  }
  rows.push(section(t('storage.shared.entries')));
  if (ss.entries.length === 0) rows.push({ key: t('panel.storage.empty').trim(), value: '', tone: 'muted' });
  else for (const e of ss.entries) rows.push({ key: `${e.key} = ${truncate(e.value, 60)}`, value: e.value });
  if (ss.events.length) {
    rows.push(section(t('storage.shared.access')));
    for (const ev of ss.events) rows.push({ key: `${ev.time ? fmtClockMs(ev.time * 1000) : '-'} ${ev.type} ${ev.method}${ev.key ? ` ${ev.key}` : ''}`, value: '', tone: 'muted' });
  }
  return rows;
}

export function trustTokenRows(tokens: TrustTokenCount[]): StorageRow[] {
  if (tokens.length === 0) return [{ key: t('storage.pst.empty'), value: '', tone: 'muted' }];
  return tokens.map(tk => ({ key: tk.issuerOrigin, value: '', meta: t('storage.pst.count', { n: tk.count }) }));
}

const storeMetaText = (s: IdbStoreMeta): string => {
  const parts: string[] = [];
  if (s.keyPath) parts.push(`key: ${s.keyPath}`);
  if (s.autoIncrement) parts.push('auto++');
  if (s.indexes.length) parts.push(`idx: ${s.indexes.join(',')}`);
  return parts.join(' · ');
};

const idbEntryRow = (e: IdbEntry): StorageRow => ({
  key: e.key,
  value: e.value,
  idbKey: e.rangeKey,
  ...(e.primaryKey && e.primaryKey !== e.key ? { meta: `pk: ${e.primaryKey}` } : {}),
  ...(e.shallow ? { note: t('storage.idb.previewNote') } : {}),
});

const cacheEntryRow = (e: CacheEntry): StorageRow => ({
  key: e.url,
  value: '',
  meta: [e.method, String(e.status || '?'), e.responseType].filter(Boolean).join(' · '),
  cacheMeta: { url: e.url, status: e.status, statusText: e.statusText, responseType: e.responseType, headers: e.headers },
});

const swRow = (r: SwRegView): StorageRow => ({
  key: r.scope,
  value: '',
  meta: [r.status, r.running, r.script.split('/').pop()].filter(Boolean).join(' · '),
});

export interface StorageViewSource {
  storageView: StorageView;
  cookieRows: StorageRow[];
  localRows: StorageRow[];
  sessionRows: StorageRow[];
  idbDb: string | null;
  idbStore: string | null;
  idbDbs: string[];
  idbStores: IdbStoreMeta[];
  idbEntries: IdbEntry[];
  cacheOpen: CacheInfo | null;
  caches: CacheInfo[];
  cacheEntries: CacheEntry[];
  swRegs: SwRegView[];
  appData: AppViewState | null;
  frames: FrameNodeView[];
  background: BackgroundViewState | null;
  shared: SharedStorageViewState | null;
  trustTokens: TrustTokenCount[];
}

export function storageViewRows(s: StorageViewSource): StorageRow[] {
  switch (s.storageView) {
    case 'cookies': return s.cookieRows;
    case 'local': return s.localRows;
    case 'session': return s.sessionRows;
    case 'idb':
      if (s.idbDb && s.idbStore) return s.idbEntries.map(idbEntryRow);
      if (s.idbDb) return s.idbStores.map(st => ({ key: st.name, value: '', meta: storeMetaText(st) }));
      return s.idbDbs.map(name => ({ key: name, value: '' }));
    case 'cache':
      if (s.cacheOpen) return s.cacheEntries.map(cacheEntryRow);
      return s.caches.map(c => ({ key: c.name, value: '' }));
    case 'sw': return s.swRegs.map(swRow);
    case 'app': return s.appData ? appViewRows(s.appData) : [];
    case 'frames': return framesViewRows(s.frames);
    case 'background': return s.background ? backgroundViewRows(s.background) : [];
    case 'shared': return s.shared ? sharedStorageRows(s.shared) : [];
    case 'pst': return trustTokenRows(s.trustTokens);
  }
}

export const cookieExportText = (cookies: CookieInfo[]): string => JSON.stringify(cookies, null, 2);

export function filterStorageRows(rows: StorageRow[], query: string): StorageRow[] {
  const tokens = parseConsoleFilter(query);
  if (!tokens.length) return rows;
  return rows.filter(r => {
    const hay = `${r.key}\n${r.value}`;
    return tokens.every(tok => (tok.negate ? !tok.test(hay) : tok.test(hay)));
  });
}

const normSameSite = (v: string): string => {
  const m = /^(strict|lax|none)$/i.exec(v);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : v;
};

export function cookieAttrParts(a: CookieAttrs, now: number): string[] {
  const parts = [`${a.domain}${a.path}`];
  if (a.sameSite) parts.push(`SameSite=${a.sameSite}`);
  if (a.httpOnly) parts.push('HttpOnly');
  if (a.secure) parts.push('Secure');
  if (a.partitionKey) parts.push(`⊞part:${a.partitionKey}`);
  parts.push(a.expires && a.expires > 0 ? `expires ${fmtRel(a.expires * 1000 - now)}` : 'session');
  return parts;
}

function fitCookieSuffix(parts: string[], avail: number): string {
  const render = (ps: string[]): string => (ps.length ? ` · ${ps.join(' · ')}` : '');
  const kept = [...parts];
  while (kept.length && displayWidth(render(kept)) > avail) kept.pop();
  return render(kept);
}

export function formatCookieAttrs(a: CookieAttrs): string {
  const parts = [`domain=${a.domain}`, `path=${a.path}`];
  if (a.sameSite) parts.push(`sameSite=${a.sameSite}`);
  if (a.secure) parts.push('secure');
  if (a.httpOnly) parts.push('httpOnly');
  if (a.partitionKey) parts.push(`partitionKey=${a.partitionKey}`);
  parts.push(`expires=${a.expires && a.expires > 0 ? a.expires : ''}`);
  return parts.join('; ');
}

export interface ParsedCookieAttrs {
  attrs: Partial<CookieAttrs>;
  unknown: string[];
  error?: string;
}

export function parseCookieAttrs(s: string): ParsedCookieAttrs {
  const attrs: Partial<CookieAttrs> = {};
  const unknown: string[] = [];
  for (const raw of s.split(';')) {
    const tok = raw.trim();
    if (!tok) continue;
    const eq = tok.indexOf('=');
    const key = (eq < 0 ? tok : tok.slice(0, eq)).trim().toLowerCase();
    const val = eq < 0 ? '' : tok.slice(eq + 1).trim();
    switch (key) {
      case 'domain': attrs.domain = val; break;
      case 'path': attrs.path = val; break;
      case 'samesite': attrs.sameSite = normSameSite(val); break;
      case 'secure': attrs.secure = eq < 0 || val.toLowerCase() !== 'false'; break;
      case 'httponly': attrs.httpOnly = eq < 0 || val.toLowerCase() !== 'false'; break;
      case 'partitionkey': attrs.partitionKey = val === '' ? undefined : val; if (val === '') attrs.partitionKeyObj = undefined; break;
      case 'partitioned': if (eq >= 0 && val.toLowerCase() === 'false') { attrs.partitionKey = undefined; attrs.partitionKeyObj = undefined; } break;
      case 'expires': {
        if (val === '') { attrs.expires = -1; break; }
        const n = Number(val);
        if (!Number.isFinite(n)) return { attrs: {}, unknown, error: t('storage.badAttr', { attr: `expires=${val}` }) };
        attrs.expires = n;
        break;
      }
      case 'max-age': {
        const n = Number(val);
        if (!Number.isFinite(n)) return { attrs: {}, unknown, error: t('storage.badAttr', { attr: `max-age=${val}` }) };
        attrs.expires = Math.floor(Date.now() / 1000) + n;
        break;
      }
      default: unknown.push(key);
    }
  }
  return { attrs, unknown };
}

const TONE_COLOR: Record<NonNullable<StorageRow['tone']>, string> = { error: 'red', ok: 'green', muted: theme.muted };

export function StorageOverlay({ view, cookies, local, session, selected, filter = '', editing, confirmClear, error, idb, cache, sw, app, frames, background, shared, trustTokens, quota, height = 14, width = 90 }: StorageOverlayProps) {
  const all = storageViewRows({
    storageView: view,
    cookieRows: cookies,
    localRows: local,
    sessionRows: session,
    idbDb: idb?.db ?? null,
    idbStore: idb?.store ?? null,
    idbDbs: idb?.dbs ?? [],
    idbStores: idb?.stores ?? [],
    idbEntries: idb?.entries ?? [],
    cacheOpen: cache?.open ?? null,
    caches: cache?.caches ?? [],
    cacheEntries: cache?.entries ?? [],
    swRegs: sw?.regs ?? [],
    appData: app ?? null,
    frames: frames ?? [],
    background: background ?? null,
    shared: shared ?? null,
    trustTokens: trustTokens ?? [],
  });
  const rows = filterStorageRows(all, filter);
  const budget = Math.max(0, height - 6);
  const start = useListWindow(rows.length, selected, budget);
  const rule = '─'.repeat(width);
  const now = Date.now();
  const kv = isBaseView(view) || (view === 'idb' && !!idb?.db && !!idb?.store);
  const hasMore = (view === 'idb' && !!idb?.store && !!idb?.hasMore) || (view === 'cache' && !!cache?.open && !!cache?.hasMore);
  const count = `${rows.length !== all.length ? `${rows.length}/` : ''}${all.length}${hasMore ? '+' : ''}`;
  const crumb =
    view === 'idb' && idb?.db ? `${idb.db}${idb.store ? ` › ${idb.store}` : ''} · `
    : view === 'cache' && cache?.open ? `${cache.open.name} · `
    : view === 'sw' && sw ? `update-on-reload:${sw.forceUpdate ? 'on' : 'off'} · bypass:${sw.bypass ? 'on' : 'off'} · `
    : view === 'background' && background ? `${background.sub}${background.sub === 'services' ? ` · rec:${background.recording ? 'on' : 'off'}` : ''} · `
    : '';
  const strip = windowViews(VIEWS, view, Math.max(0, width - displayWidth(crumb + count) - 1));

  const rowNodes: React.ReactNode[] = rows.length === 0
    ? [<Text key="empty" dimColor> {t('panel.storage.empty')}</Text>]
    : rows.slice(start, start + budget).map((r, i) => {
        const idx = start + i;
        const sel = idx === selected;
        const head = kv ? `${r.key} = ${truncate(r.value, 60)}` : r.key;
        const jwt = kv && decodeJwt(r.value) !== null;
        const avail = width - 1 - displayWidth(head) - (jwt ? 4 : 0);
        const suffix =
          r.attrs && avail > 6 ? fitCookieSuffix(cookieAttrParts(r.attrs, now), avail)
          : r.meta && avail > 6 ? fitCookieSuffix(r.meta.split(' · '), avail)
          : '';
        return (
          <Text key={r.key + idx} wrap="truncate" backgroundColor={sel ? '#223543' : undefined}>
            <Text color="cyan">{sel ? '▌' : ' '}</Text>{r.tone ? <Text color={TONE_COLOR[r.tone]}>{head}</Text> : head}
            {jwt ? <Text dimColor> JWT</Text> : null}
            {suffix ? <Text dimColor>{suffix}</Text> : null}
          </Text>
        );
      });
  const paddedRows = padRows(rowNodes, budget, 'pad');

  const editLabel = editing ? (editing.attrs ? t('storage.attrLabel') : editing.isNew ? t('storage.newLabel') : t('storage.editLabel')) : '';
  const confirmMsg =
    confirmClear === 'store' ? t('panel.storage.confirmClearStore')
    : confirmClear === 'cache' ? t('panel.storage.confirmClearCache')
    : t('panel.storage.confirmClear');

  return (
    <Box flexDirection="column" width={width}>
      <Box width={width} justifyContent="space-between">
        <Text dimColor>Storage</Text>
        {quota && quota.quota > 0 ? <Text color={theme.muted}>{`${fmtBytes(quota.usage)} / ${fmtBytes(quota.quota)}`}</Text> : null}
      </Box>
      <Box width={width} justifyContent="space-between">
        <Box width={Math.max(0, width - displayWidth(crumb + count) - 1)}>
          <Text wrap="truncate">
            {strip.left ? <Text dimColor>‹</Text> : null}
            {strip.shown.map((v) => (
              <Text key={v} color={v === view ? 'cyan' : undefined} inverse={v === view} dimColor={v !== view}>
                {` ${v} `}
              </Text>
            ))}
            {strip.right ? <Text dimColor>›</Text> : null}
          </Text>
        </Box>
        <Text wrap="truncate" color={theme.muted}>{crumb + count}</Text>
      </Box>
      <Text dimColor wrap="truncate">{rule}</Text>
      {paddedRows}
      {editing ? <Text wrap="truncate">{editLabel} {editing.key}: {editing.value}<Text color="cyan">▌</Text></Text> : <Text> </Text>}
      {confirmClear ? <Text color="yellow" wrap="truncate">{confirmMsg}</Text> : error ? <Text color="red" wrap="truncate">{error}</Text> : <Text> </Text>}
      <Text dimColor wrap="truncate">{rule}</Text>
    </Box>
  );
}
