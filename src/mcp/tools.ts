import { redactHeaders } from '../util/redact.js';
import { sliceUtf8 } from '../engine.js';
import { listRecordings, recordingsDir } from '../store/recording.js';
import { parseSessionId, type RecorderReplayResult, type RecordingInfo, type ScreenshotResult, type SessionInfo, type SessionSource, type TabInfo } from './source.js';
import type { SelectedElementData } from '../tui/lib/handoff.js';
import type { NetworkEntry, NetworkTiming, SecurityDetails, WsFrame } from '../store/types.js';
import type { AuditCategoryId, AuditPreset, FailingAudit, Scoreboard } from '../audit/types.js';
import { lhrFailing, lhrScoreboard } from '../audit/transform.js';

export interface ListSessionsArgs {
  limit?: number;
}

export interface NetworkSearchArgs {
  session?: string;
  url_pattern?: string;
  method?: string;
  status?: number;
  status_class?: string;
  mime?: string;
  since?: number;
  limit?: number;
}

export type IncludePart = 'headers' | 'request_body' | 'response_body' | 'timing' | 'security' | 'ws_frames';

export interface GetRequestArgs {
  session?: string;
  id: string;
  include?: IncludePart[];
  body_max_bytes?: number;
}

export interface ConsoleMessagesArgs {
  session?: string;
  level?: string;
  contains?: string;
  since?: number;
  limit?: number;
}

export interface SessionSummaryArgs {
  session?: string;
}

export type ElementPart = 'html' | 'rules' | 'computed' | 'box';

export interface SelectedElementArgs {
  include?: ElementPart[];
}

export interface TakeScreenshotArgs {
  target: 'viewport' | 'element';
  session?: string;
}

export interface NetworkRow {
  id: string;
  method: string;
  status?: number;
  mimeType?: string;
  url: string;
  size?: number;
  timeMs?: number;
  startedAt: string;
  error?: string;
}

export interface NetworkSearchResult {
  cursor: number;
  rows: NetworkRow[];
}

export interface BodyDetail {
  body: string;
  bytes: number;
  truncated: boolean;
  base64?: boolean;
}

export interface WsFrameDetail extends WsFrame {
  payloadBytes?: number;
  payloadTruncated?: boolean;
}

export interface RequestDetail extends NetworkRow {
  statusText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: BodyDetail;
  responseBody?: BodyDetail;
  timing?: Partial<NetworkTiming> & { queueingMs?: number };
  securityState?: string;
  securityDetails?: SecurityDetails;
  wsFrames?: WsFrameDetail[];
  wsFramesDropped?: number;
}

export interface ConsoleRow {
  ts: string;
  kind: string;
  text: string;
  url?: string;
  line?: number;
  count?: number;
  stack?: string;
}

export interface ConsoleMessagesResult {
  cursor: number;
  rows: ConsoleRow[];
}

export interface SessionSummary {
  id: string;
  source: 'files' | 'live';
  urlSlug: string;
  startedAt?: string;
  requests: { total: number; byStatusClass: Record<string, number> };
  failures: number;
  consoleErrors: number;
  topSlow: { url: string; timeMs: number; status?: number }[];
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

async function resolveSession(src: SessionSource, session?: string): Promise<string> {
  if (session !== undefined) return session;
  const latest = (await src.listSessions(1))[0];
  if (!latest) throw new Error('no sessions found — record one with `devtools-tui --tab <substr> <url>` or open the TUI, or check --session-root');
  return latest.id;
}

function requireLive(src: SessionSource): NonNullable<SessionSource['live']> {
  if (!src.live) {
    throw new Error('this tool needs a running devtools-tui TUI (no live socket found) — start the TUI, then restart the MCP server');
  }
  return src.live;
}

function matchesUrlPattern(pattern: string, url: string): boolean {
  if (/[*?]/.test(pattern)) {
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${source}$`, 'i').test(url);
  }
  return url.toLowerCase().includes(pattern.toLowerCase());
}

function parseStatusClass(statusClass: string): number {
  const m = /^([1-5])(?:xx)?$/i.exec(statusClass);
  if (!m) throw new Error(`invalid status_class: ${statusClass} (expected 1xx-5xx)`);
  return Number(m[1]);
}

function toRow(e: NetworkEntry): NetworkRow {
  return compact({
    id: e.id,
    method: e.method,
    status: e.status,
    mimeType: e.mimeType,
    url: e.url,
    size: e.encodedBytes ?? e.decodedBytes,
    timeMs: e.durationMs !== undefined ? Math.round(e.durationMs) : undefined,
    startedAt: new Date(e.startTs).toISOString(),
    error: e.error,
  });
}

function truncateBody(body: string, maxBytes: number, alreadyTruncated: boolean): BodyDetail {
  const byteLength = Buffer.byteLength(body, 'utf8');
  if (byteLength <= maxBytes) return { body, bytes: byteLength, truncated: alreadyTruncated };
  return { body: sliceUtf8(body, maxBytes), bytes: byteLength, truncated: true };
}

function capFrame(frame: WsFrame, maxBytes: number): WsFrameDetail {
  const bytes = Buffer.byteLength(frame.payload, 'utf8');
  if (bytes <= maxBytes) return frame;
  return { ...frame, payload: sliceUtf8(frame.payload, maxBytes), payloadBytes: bytes, payloadTruncated: true };
}

export async function listSessions(src: SessionSource, args: ListSessionsArgs = {}): Promise<SessionInfo[]> {
  return src.listSessions(args.limit ?? 10);
}

function completionTs(e: NetworkEntry): number {
  return e.startTs + (e.durationMs ?? 0);
}

export async function networkSearch(src: SessionSource, args: NetworkSearchArgs = {}): Promise<NetworkSearchResult> {
  const session = await resolveSession(src, args.session);
  const classDigit = args.status_class !== undefined ? parseStatusClass(args.status_class) : undefined;
  const entries = await src.readNetwork(session);
  const cursor = entries.reduce((m, e) => Math.max(m, completionTs(e)), args.since ?? 0);
  const rows = entries
    .filter(e =>
      (args.since === undefined || completionTs(e) > args.since) &&
      (args.url_pattern === undefined || matchesUrlPattern(args.url_pattern, e.url)) &&
      (args.method === undefined || e.method.toUpperCase() === args.method.toUpperCase()) &&
      (args.status === undefined || e.status === args.status) &&
      (classDigit === undefined || (e.status !== undefined && Math.floor(e.status / 100) === classDigit)) &&
      (args.mime === undefined || (e.mimeType ?? '').toLowerCase().includes(args.mime.toLowerCase())))
    .slice(-(args.limit ?? 20))
    .reverse()
    .map(toRow);
  return { cursor, rows };
}

export async function getRequest(src: SessionSource, args: GetRequestArgs): Promise<RequestDetail> {
  const session = await resolveSession(src, args.session);
  const entry = src.readRequest
    ? await src.readRequest(session, args.id)
    : (await src.readNetwork(session)).find(e => e.id === args.id);
  if (!entry) throw new Error(`request not found: ${args.id} in session ${session}; ids come from network_search`);
  const include = new Set<IncludePart>(args.include ?? ['headers']);
  const maxBytes = args.body_max_bytes ?? 2048;
  const detail: RequestDetail = { ...toRow(entry), statusText: entry.statusText };
  if (include.has('headers')) {
    detail.requestHeaders = redactHeaders(entry.requestHeaders);
    detail.responseHeaders = redactHeaders(entry.responseHeaders);
  }
  if (include.has('request_body') && entry.postData !== undefined) {
    detail.requestBody = truncateBody(entry.postData, maxBytes, false);
  }
  if (include.has('response_body') && entry.body !== undefined) {
    detail.responseBody = compact({
      ...truncateBody(entry.body, maxBytes, entry.bodyTruncated ?? false),
      base64: entry.bodyBase64 ? true : undefined,
    });
  }
  if (include.has('timing') && (entry.timing !== undefined || entry.queueingMs !== undefined)) {
    detail.timing = compact({ ...entry.timing, queueingMs: entry.queueingMs });
  }
  if (include.has('security')) {
    detail.securityState = entry.securityState;
    detail.securityDetails = entry.securityDetails;
  }
  if (include.has('ws_frames') && entry.wsFrames) {
    detail.wsFrames = entry.wsFrames.map(f => capFrame(f, maxBytes));
    detail.wsFramesDropped = entry.wsFramesDropped;
  }
  return compact(detail);
}

export async function consoleMessages(src: SessionSource, args: ConsoleMessagesArgs = {}): Promise<ConsoleMessagesResult> {
  const session = await resolveSession(src, args.session);
  const level = args.level?.toLowerCase();
  const entries = await src.readConsole(session);
  const cursor = entries.reduce((m, e) => Math.max(m, e.ts), args.since ?? 0);
  const rows = entries
    .filter(e =>
      (args.since === undefined || e.ts > args.since) &&
      (level === undefined || (level === 'error' ? e.kind === 'error' || e.kind === 'exception' : e.kind === level)) &&
      (args.contains === undefined || e.text.toLowerCase().includes(args.contains.toLowerCase())))
    .slice(-(args.limit ?? 20))
    .reverse()
    .map(e => compact({
      ts: new Date(e.ts).toISOString(),
      kind: e.kind,
      text: e.text,
      url: e.url,
      line: e.line,
      count: e.count,
      stack: e.stack,
    }));
  return { cursor, rows };
}

export async function sessionSummary(src: SessionSource, args: SessionSummaryArgs = {}): Promise<SessionSummary> {
  const session = await resolveSession(src, args.session);
  const network = await src.readNetwork(session);
  const consoleEntries = await src.readConsole(session);
  const byStatusClass: Record<string, number> = {};
  for (const e of network) {
    if (e.status === undefined) continue;
    const key = `${Math.floor(e.status / 100)}xx`;
    byStatusClass[key] = (byStatusClass[key] ?? 0) + 1;
  }
  const topSlow = network
    .filter(e => e.durationMs !== undefined)
    .sort((a, b) => b.durationMs! - a.durationMs!)
    .slice(0, 5)
    .map(e => compact({ url: e.url, timeMs: Math.round(e.durationMs!), status: e.status }));
  const parsed = parseSessionId(session);
  return compact({
    id: session,
    source: src.kind,
    urlSlug: parsed.urlSlug,
    startedAt: parsed.startedAt,
    requests: { total: network.length, byStatusClass },
    failures: network.filter(e => e.error !== undefined).length,
    consoleErrors: consoleEntries.filter(e => e.kind === 'error' || e.kind === 'exception').length,
    topSlow,
  });
}

export async function listTabs(src: SessionSource): Promise<TabInfo[]> {
  return requireLive(src).listTabs();
}

const ELEMENT_FIELDS: Record<ElementPart, Array<keyof SelectedElementData>> = {
  html: ['outerHTML', 'outerHTMLTruncated'],
  rules: ['rules'],
  computed: ['computed'],
  box: ['box'],
};

export async function selectedElement(src: SessionSource, args: SelectedElementArgs = {}): Promise<SelectedElementData> {
  const data = await requireLive(src).selectedElement();
  if (!args.include) return data;
  const keep = new Set<keyof SelectedElementData>(['url', 'capturedAt', 'selectorPath', 'missing']);
  for (const part of args.include) for (const field of ELEMENT_FIELDS[part]) keep.add(field);
  return Object.fromEntries(Object.entries(data).filter(([k]) => keep.has(k as keyof SelectedElementData))) as SelectedElementData;
}

export async function takeScreenshot(src: SessionSource, args: TakeScreenshotArgs): Promise<ScreenshotResult> {
  return requireLive(src).screenshot(args.target, args.session);
}

export interface AuditSummaryArgs {
  session?: string;
}

export interface AuditFailingArgs {
  session?: string;
  category?: AuditCategoryId;
  limit?: number;
}

export interface AuditRunArgs {
  session?: string;
  preset?: AuditPreset;
  categories?: AuditCategoryId[];
}

export interface AuditSummaryResult extends Scoreboard {
  session: string;
}

export interface AuditFailingResult {
  session: string;
  fetchTime: string;
  rows: FailingAudit[];
}

async function readSessionAudit(src: SessionSource, session?: string) {
  const id = await resolveSession(src, session);
  if (!src.readAudit) throw new Error('this source does not expose stored audits');
  const lhr = await src.readAudit(id);
  if (!lhr) throw new Error(`no audit recorded for session ${id} — run audit_run or press r in the TUI Audit tab`);
  return { id, lhr };
}

export async function auditSummary(src: SessionSource, args: AuditSummaryArgs = {}): Promise<AuditSummaryResult> {
  const { id, lhr } = await readSessionAudit(src, args.session);
  return { session: id, ...lhrScoreboard(lhr) };
}

export async function auditFailing(src: SessionSource, args: AuditFailingArgs = {}): Promise<AuditFailingResult> {
  const { id, lhr } = await readSessionAudit(src, args.session);
  return { session: id, fetchTime: lhr.fetchTime, rows: lhrFailing(lhr, { category: args.category, limit: args.limit ?? 20 }) };
}

export interface RecorderReplayArgs {
  name: string;
  timeout_ms?: number;
}

export function recorderList(dir: string = recordingsDir()): RecordingInfo[] {
  return listRecordings(dir).map(m => ({ name: m.name, steps: m.stepCount, createdAt: m.createdAt }));
}

export async function recorderReplay(src: SessionSource, args: RecorderReplayArgs): Promise<RecorderReplayResult> {
  const live = requireLive(src);
  if (!live.recorderReplay) {
    throw new Error('recorder_replay needs a running devtools-tui TUI with recorder support — start the TUI, then restart the MCP server');
  }
  if (!args.name) throw new Error('name is required (from recorder_list)');
  return live.recorderReplay({ name: args.name, timeoutMs: args.timeout_ms });
}

export async function auditRun(src: SessionSource, args: AuditRunArgs = {}): Promise<Scoreboard> {
  const live = requireLive(src);
  if (!live.auditRun) {
    throw new Error('audit_run needs a running devtools-tui TUI with audit support — start the TUI, then restart the MCP server');
  }
  const lhr = await live.auditRun({ session: args.session, preset: args.preset, categories: args.categories });
  return lhrScoreboard(lhr);
}
