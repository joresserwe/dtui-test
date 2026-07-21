import type { CdpConnection } from './connection.js';

export interface CacheInfo {
  id: string;
  name: string;
}

export interface CacheEntry {
  url: string;
  method: string;
  status: number;
  statusText: string;
  responseType: string;
  responseTime: number;
  headers: Array<[string, string]>;
  reqHeaders: Array<[string, string]>;
}

export interface CachePage {
  entries: CacheEntry[];
  total: number;
}

const toPairs = (hs?: Array<{ name: string; value: string }>): Array<[string, string]> =>
  (hs ?? []).map(h => [h.name, h.value]);

export async function getCacheNames(conn: CdpConnection, securityOrigin: string): Promise<CacheInfo[]> {
  const { caches } = await conn.send<{ caches?: Array<{ cacheId: string; cacheName: string }> }>(
    'CacheStorage.requestCacheNames', { securityOrigin });
  return (caches ?? []).map(c => ({ id: c.cacheId, name: c.cacheName }));
}

export async function getCacheEntries(conn: CdpConnection, cacheId: string, skipCount: number, pageSize: number): Promise<CachePage> {
  const { cacheDataEntries, returnCount } = await conn.send<{ cacheDataEntries?: any[]; returnCount?: number }>(
    'CacheStorage.requestEntries', { cacheId, skipCount, pageSize });
  return {
    entries: (cacheDataEntries ?? []).map(e => ({
      url: e.requestURL,
      method: e.requestMethod ?? '',
      status: e.responseStatus ?? 0,
      statusText: e.responseStatusText ?? '',
      responseType: e.responseType ?? '',
      responseTime: e.responseTime ?? 0,
      headers: toPairs(e.responseHeaders),
      reqHeaders: toPairs(e.requestHeaders),
    })),
    total: returnCount ?? 0,
  };
}

export async function getCachedResponseBody(
  conn: CdpConnection,
  cacheId: string,
  requestURL: string,
  requestHeaders: Array<[string, string]> = [],
): Promise<Buffer> {
  const { response } = await conn.send<{ response?: { body?: string } }>('CacheStorage.requestCachedResponse', {
    cacheId,
    requestURL,
    requestHeaders: requestHeaders.map(([name, value]) => ({ name, value })),
  });
  return Buffer.from(response?.body ?? '', 'base64');
}

export async function deleteCache(conn: CdpConnection, cacheId: string): Promise<void> {
  await conn.send('CacheStorage.deleteCache', { cacheId });
}

export async function deleteCacheEntry(conn: CdpConnection, cacheId: string, request: string): Promise<void> {
  await conn.send('CacheStorage.deleteEntry', { cacheId, request });
}

const TEXT_MIME = /json|xml|html|text|javascript|svg|x-www-form-urlencoded/i;

export function describeCacheBody(body: Buffer, contentType: string): { text: string | null; bytes: number } {
  if (body.length === 0) return { text: '', bytes: 0 };
  if (TEXT_MIME.test(contentType)) return { text: body.toString('utf8'), bytes: body.length };
  const decoded = body.toString('utf8');
  const printable = !decoded.includes('�') && !/[\0-\x08\x0e-\x1f]/.test(decoded);
  return { text: printable ? decoded : null, bytes: body.length };
}
