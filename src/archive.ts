import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsoleEntry, NetworkEntry, NetworkTiming } from './store/types.js';

export interface ArchiveData {
  network: NetworkEntry[];
  console: ConsoleEntry[];
  meta?: { url?: string; capturedAt?: string };
}

function readJsonl<T>(file: string): T[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      continue;
    }
  }
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function headerRecord(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(list)) return out;
  for (const h of list as Array<Record<string, unknown>>) {
    const name = str(h?.name);
    const value = str(h?.value);
    if (name !== undefined && value !== undefined) out[name] = value;
  }
  return out;
}

// Chrome exports its resource type as the non-standard `_resourceType` (lowercase).
const RESOURCE_TYPES: Record<string, string> = {
  xhr: 'XHR', fetch: 'Fetch', document: 'Document', stylesheet: 'Stylesheet', script: 'Script',
  image: 'Image', font: 'Font', websocket: 'WebSocket', media: 'Media', manifest: 'Manifest',
  ping: 'Ping', preflight: 'Preflight', other: 'Other',
};

function resourceType(declared: string | undefined, mime: string | undefined): string {
  if (declared) return RESOURCE_TYPES[declared.toLowerCase()] ?? declared;
  const m = (mime ?? '').toLowerCase();
  if (m.includes('html')) return 'Document';
  if (m.includes('javascript')) return 'Script';
  if (m.includes('css')) return 'Stylesheet';
  if (m.startsWith('image/')) return 'Image';
  if (m.startsWith('font/') || m.includes('font')) return 'Font';
  if (m.includes('json') || m.includes('xml')) return 'XHR';
  return 'Other';
}

// HAR carries per-phase durations; NetworkTiming carries cumulative offsets from
// the request start, so the phases are laid end to end in HAR's defined order.
function timingFromHar(raw: unknown, startTs: number): NetworkTiming | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const phase = (v: unknown) => {
    const n = num(v);
    return n !== undefined && n >= 0 ? n : undefined;
  };
  const dns = phase(t.dns);
  const connect = phase(t.connect);
  const ssl = phase(t.ssl);
  const send = phase(t.send);
  const wait = phase(t.wait);
  if (dns === undefined && connect === undefined && send === undefined && wait === undefined) return undefined;
  const out: NetworkTiming = {
    requestTime: startTs / 1000,
    dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1,
    sslStart: -1, sslEnd: -1, sendStart: -1, sendEnd: -1, receiveHeadersEnd: 0,
  };
  let cur = phase(t.blocked) ?? 0;
  if (dns !== undefined) {
    out.dnsStart = cur;
    cur += dns;
    out.dnsEnd = cur;
  }
  if (connect !== undefined) {
    out.connectStart = cur;
    cur += connect;
    out.connectEnd = cur;
    if (ssl !== undefined && ssl <= connect) {
      out.sslStart = cur - ssl;
      out.sslEnd = cur;
    }
  }
  out.sendStart = cur;
  cur += send ?? 0;
  out.sendEnd = cur;
  out.receiveHeadersEnd = cur + (wait ?? 0);
  return out;
}

export function harToEntries(har: unknown): NetworkEntry[] {
  const entries = (har as { log?: { entries?: unknown } } | undefined)?.log?.entries;
  if (!Array.isArray(entries)) return [];
  const out: NetworkEntry[] = [];
  entries.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const entry = raw as Record<string, any>;
    const req = entry.request;
    const url = str(req?.url);
    if (url === undefined) return;
    const res = entry.response ?? {};
    const content = res?.content ?? {};
    const startTs = Date.parse(str(entry.startedDateTime) ?? '');

    const e: NetworkEntry = {
      id: `har-${i}`,
      url,
      method: str(req?.method) ?? 'GET',
      type: resourceType(str(entry._resourceType), str(content?.mimeType)),
      requestHeaders: headerRecord(req?.headers),
      responseHeaders: headerRecord(res?.headers),
      startTs: Number.isFinite(startTs) ? startTs : 0,
    };
    const status = num(res?.status);
    if (status !== undefined && status > 0) {
      e.status = status;
      const statusText = str(res?.statusText);
      if (statusText !== undefined) e.statusText = statusText;
    }
    const mime = str(content?.mimeType);
    if (mime) e.mimeType = mime;
    const postData = str(req?.postData?.text);
    if (postData !== undefined) e.postData = postData;
    const time = num(entry.time);
    if (time !== undefined && time >= 0) e.durationMs = time;
    const bodySize = num(res?.bodySize);
    if (bodySize !== undefined && bodySize >= 0) e.encodedBytes = bodySize;
    const size = num(content?.size);
    if (size !== undefined && size >= 0) e.decodedBytes = size;
    const body = str(content?.text);
    if (body !== undefined) {
      e.body = body;
      if (content?.encoding === 'base64') e.bodyBase64 = true;
    }
    const httpVersion = str(res?.httpVersion) || str(req?.httpVersion);
    if (httpVersion) e.protocol = httpVersion;
    const timing = timingFromHar(entry.timings, e.startTs);
    if (timing) e.timing = timing;
    const setCookies: string[] = Array.isArray(res?.headers)
      ? (res.headers as Array<Record<string, unknown>>)
          .filter(h => str(h?.name)?.toLowerCase() === 'set-cookie' && str(h?.value) !== undefined)
          .map(h => h.value as string)
      : [];
    if (!setCookies.length && Array.isArray(res?.cookies)) {
      for (const c of res.cookies as Array<Record<string, unknown>>) {
        const name = str(c?.name);
        if (name !== undefined) setCookies.push(`${name}=${str(c?.value) ?? ''}`);
      }
    }
    if (setCookies.length) e.setCookies = setCookies;
    const comment = str(entry.comment);
    if (comment?.startsWith('failed: ')) e.error = comment.slice('failed: '.length);
    out.push(e);
  });
  return out;
}

function loadHarArchive(file: string): ArchiveData {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`invalid HAR file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { network: harToEntries(raw), console: [], meta: undefined };
}

export function loadArchive(path: string): ArchiveData {
  if (/\.har$/i.test(path)) return loadHarArchive(path);
  let meta: ArchiveData['meta'];
  try {
    meta = JSON.parse(readFileSync(join(path, 'meta.json'), 'utf8'));
  } catch {
    meta = undefined;
  }
  return {
    network: readJsonl<NetworkEntry>(join(path, 'network.jsonl')),
    console: readJsonl<ConsoleEntry>(join(path, 'console.jsonl')),
    meta,
  };
}
