import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NetworkEntry, NetworkTiming } from '../store/types.js';
import { header } from '../util/headers.js';
import { isSensitiveHeader, REDACTED } from '../util/redact.js';
import { slug } from './snapshot.js';

const version = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;

export interface HarMeta {
  browser?: string;
  bodyCap?: number;
  sanitize?: boolean;
}

interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

const kv = (headers: Record<string, string>, sanitize: boolean) =>
  Object.entries(headers).map(([name, value]) => ({ name, value: sanitize && isSensitiveHeader(name) ? REDACTED : value }));

function requestCookies(headers: Record<string, string>): HarCookie[] {
  const raw = header(headers, 'cookie');
  if (!raw) return [];
  return raw.split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const eq = part.indexOf('=');
    return eq < 0 ? { name: part, value: '' } : { name: part.slice(0, eq), value: part.slice(eq + 1) };
  });
}

function parseSetCookie(line: string): HarCookie {
  const [first = '', ...attrs] = line.split(';');
  const eq = first.indexOf('=');
  const cookie: HarCookie = eq < 0
    ? { name: first.trim(), value: '' }
    : { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
  for (const attr of attrs) {
    const eqa = attr.indexOf('=');
    const key = (eqa < 0 ? attr : attr.slice(0, eqa)).trim().toLowerCase();
    const val = eqa < 0 ? '' : attr.slice(eqa + 1).trim();
    if (key === 'path') cookie.path = val;
    else if (key === 'domain') cookie.domain = val;
    else if (key === 'expires') {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) cookie.expires = d.toISOString();
    } else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
  }
  return cookie;
}

function queryString(url: string): Array<{ name: string; value: string }> {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

const span = (start: number, end: number) => (start >= 0 && end >= 0 && end >= start ? end - start : -1);

function harTimings(t: NetworkTiming | undefined, durationMs: number | undefined) {
  if (!t) return { blocked: -1, dns: -1, connect: -1, ssl: -1, send: -1, wait: durationMs ?? -1, receive: -1 };
  const receive = durationMs !== undefined ? Math.max(durationMs - t.receiveHeadersEnd, 0) : -1;
  return {
    blocked: -1,
    dns: span(t.dnsStart, t.dnsEnd),
    connect: span(t.connectStart, t.connectEnd),
    ssl: span(t.sslStart, t.sslEnd),
    send: span(t.sendStart, t.sendEnd),
    wait: span(t.sendEnd, t.receiveHeadersEnd),
    receive,
  };
}

export function toHarEntry(e: NetworkEntry, bodyCap?: number, sanitize = true): object {
  const httpVersion = e.protocol ?? 'HTTP/1.1';
  const maskCookie = (c: HarCookie): HarCookie => (sanitize ? { ...c, value: REDACTED } : c);
  return {
    startedDateTime: new Date(e.startTs).toISOString(),
    time: e.durationMs ?? -1,
    request: {
      method: e.method,
      url: e.url,
      httpVersion,
      headers: kv(e.requestHeaders, sanitize),
      queryString: queryString(e.url),
      cookies: requestCookies(e.requestHeaders).map(maskCookie),
      headersSize: -1,
      bodySize: e.postData !== undefined ? Buffer.byteLength(e.postData) : -1,
      ...(e.postData !== undefined
        ? { postData: { mimeType: header(e.requestHeaders, 'content-type'), text: e.postData } }
        : {}),
    },
    response: {
      status: e.status ?? 0,
      statusText: e.statusText ?? '',
      httpVersion,
      headers: kv(e.responseHeaders, sanitize),
      cookies: (e.setCookies ?? []).map(parseSetCookie).map(maskCookie),
      redirectURL: '',
      headersSize: -1,
      bodySize: e.encodedBytes ?? -1,
      content: {
        size: e.body !== undefined ? Buffer.byteLength(e.body, e.bodyBase64 ? 'base64' : 'utf8') : 0,
        mimeType: e.mimeType ?? '',
        ...(e.body !== undefined ? { text: e.body } : {}),
        ...(e.bodyBase64 ? { encoding: 'base64' } : {}),
        ...(e.bodyTruncated
          ? { comment: bodyCap !== undefined ? `body truncated at ${bodyCap} bytes` : 'body truncated' }
          : {}),
      },
    },
    cache: {},
    timings: harTimings(e.timing, e.durationMs),
    ...(e.error ? { comment: `failed: ${e.error}` } : {}),
  };
}

export function buildHar(entries: NetworkEntry[], meta: HarMeta): object {
  return {
    log: {
      version: '1.2',
      creator: { name: 'devtools-tui', version },
      browser: { name: meta.browser ?? 'unknown', version: '' },
      entries: entries.map(e => toHarEntry(e, meta.bodyCap, meta.sanitize ?? true)),
    },
  };
}

export async function writeHar(file: string, entries: NetworkEntry[], meta: HarMeta): Promise<void> {
  await writeFile(file, JSON.stringify(buildHar(entries, meta), null, 2));
}

export function harRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? homedir(), 'devtools-tui', 'har');
  const base = env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share');
  return join(base, 'devtools-tui', 'har');
}

export async function exportHar(root: string, url: string, entries: NetworkEntry[], meta: HarMeta, now = new Date()): Promise<string> {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const s = slug(url);
  const file = join(root, `${s ? `${stamp}-${s}` : stamp}.har`);
  await mkdir(root, { recursive: true });
  await writeHar(file, entries, meta);
  return file;
}
