import { CdpConnection } from './connection.js';
import type { Endpoint } from './discovery.js';

export interface PageTarget {
  id: string;
  title: string;
  url: string;
  wsUrl: string;
}

const ENABLE_DOMAINS = ['Network.enable', 'Page.enable', 'Runtime.enable', 'Log.enable'];

const ATTACHABLE_SCHEMES = ['http:', 'https:', 'file:'];

function isAttachableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url === 'about:blank') return true;
  return ATTACHABLE_SCHEMES.some(scheme => url.startsWith(scheme));
}

export async function listPages(ep: Endpoint, fetchFn: typeof fetch = fetch): Promise<PageTarget[]> {
  const res = await fetchFn(`http://${ep.host}:${ep.port}/json/list`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`Target list failed: HTTP ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, string>>;
  return raw
    .filter(t => t.type === 'page' && t.webSocketDebuggerUrl && isAttachableUrl(t.url))
    .map(t => ({
      id: t.id,
      title: t.title,
      url: t.url,
      wsUrl: t.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://${ep.host}:${ep.port}`),
    }));
}

export async function activatePage(ep: Endpoint, targetId: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`http://${ep.host}:${ep.port}/json/activate/${targetId}`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`Activate failed: HTTP ${res.status}`);
}

export async function closePage(ep: Endpoint, targetId: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`http://${ep.host}:${ep.port}/json/close/${targetId}`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`Close failed: HTTP ${res.status}`);
}

export async function attachPage(t: PageTarget): Promise<CdpConnection> {
  const conn = await CdpConnection.open(t.wsUrl);
  for (const method of ENABLE_DOMAINS) await conn.send(method);
  return conn;
}
