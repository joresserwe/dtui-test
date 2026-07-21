import type { CdpConnection } from './connection.js';
import { RingBuffer } from '../store/ring.js';

export interface CookiePartition {
  topLevelSite: string;
  hasCrossSiteAncestor: boolean;
}

export interface CookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  partitionKey?: string;
  partitionKeyObj?: CookiePartition;
}

function normalizePartition(pk: unknown): CookiePartition | undefined {
  if (!pk) return undefined;
  if (typeof pk === 'string') return { topLevelSite: pk, hasCrossSiteAncestor: false };
  if (typeof pk === 'object' && typeof (pk as { topLevelSite?: unknown }).topLevelSite === 'string') {
    return { topLevelSite: (pk as { topLevelSite: string }).topLevelSite, hasCrossSiteAncestor: !!(pk as { hasCrossSiteAncestor?: unknown }).hasCrossSiteAncestor };
  }
  return undefined;
}

function resolvePartition(attrs: { partitionKey?: string; partitionKeyObj?: CookiePartition }): CookiePartition | undefined {
  if (attrs.partitionKeyObj && attrs.partitionKey === attrs.partitionKeyObj.topLevelSite) return attrs.partitionKeyObj;
  if (attrs.partitionKey) return { topLevelSite: attrs.partitionKey, hasCrossSiteAncestor: false };
  return undefined;
}

export async function getCookies(conn: CdpConnection): Promise<CookieInfo[]> {
  const { cookies } = await conn.send<{ cookies: any[] }>('Network.getCookies');
  return cookies.map(c => {
    const partitionKeyObj = normalizePartition(c.partitionKey);
    return {
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      ...(partitionKeyObj ? { partitionKey: partitionKeyObj.topLevelSite, partitionKeyObj } : {}),
    };
  });
}

export async function setCookie(
  conn: CdpConnection,
  url: string,
  name: string,
  value: string,
  attrs: Partial<Pick<CookieInfo, 'domain' | 'path' | 'expires' | 'httpOnly' | 'secure' | 'sameSite' | 'partitionKey' | 'partitionKeyObj'>> = {},
): Promise<boolean> {
  const partitionKey = resolvePartition(attrs);
  const { success } = await conn.send<{ success: boolean }>('Network.setCookie', {
    url, name, value,
    ...(attrs.domain ? { domain: attrs.domain } : {}),
    ...(attrs.path ? { path: attrs.path } : {}),
    ...(attrs.expires !== undefined && attrs.expires >= 0 ? { expires: attrs.expires } : {}),
    ...(typeof attrs.httpOnly === 'boolean' ? { httpOnly: attrs.httpOnly } : {}),
    ...(typeof attrs.secure === 'boolean' ? { secure: attrs.secure } : {}),
    ...(attrs.sameSite ? { sameSite: attrs.sameSite } : {}),
    ...(partitionKey ? { partitionKey } : {}),
  });
  return success;
}

export async function deleteCookie(conn: CdpConnection, c: { name: string; domain: string; path: string; partitionKey?: CookiePartition }): Promise<void> {
  await conn.send('Network.deleteCookies', {
    name: c.name, domain: c.domain, path: c.path,
    ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
  });
}

const storageId = (origin: string, local: boolean) => ({ securityOrigin: origin, isLocalStorage: local });

export async function getStorageItems(conn: CdpConnection, origin: string, local: boolean): Promise<Array<[string, string]>> {
  await conn.send('DOMStorage.enable');
  const { entries } = await conn.send<{ entries: Array<[string, string]> }>('DOMStorage.getDOMStorageItems', { storageId: storageId(origin, local) });
  return entries;
}

export async function setStorageItem(conn: CdpConnection, origin: string, local: boolean, key: string, value: string): Promise<void> {
  await conn.send('DOMStorage.enable');
  await conn.send('DOMStorage.setDOMStorageItem', { storageId: storageId(origin, local), key, value });
}

export async function removeStorageItem(conn: CdpConnection, origin: string, local: boolean, key: string): Promise<void> {
  await conn.send('DOMStorage.enable');
  await conn.send('DOMStorage.removeDOMStorageItem', { storageId: storageId(origin, local), key });
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export async function getUsageAndQuota(conn: CdpConnection, origin: string): Promise<StorageUsage> {
  const { usage, quota } = await conn.send<{ usage?: number; quota?: number }>('Storage.getUsageAndQuota', { origin });
  return { usage: usage ?? 0, quota: quota ?? 0 };
}

export async function clearOrigin(conn: CdpConnection, origin: string): Promise<void> {
  await conn.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'cookies,local_storage,session_storage,indexeddb,cache_storage',
  });
}

export interface SharedStorageEntry {
  key: string;
  value: string;
}

export interface SharedStorageMetadata {
  creationTime: number;
  length: number;
  remainingBudget: number;
  bytesUsed: number;
}

export interface SharedStorageAccessEvent {
  time: number;
  type: string;
  method: string;
  key: string;
}

const SHARED_ACCESS_CAP = 200;

export class SharedStorageStore {
  private events = new RingBuffer<SharedStorageAccessEvent>(SHARED_ACCESS_CAP);

  handleEvent(method: string, params: any): boolean {
    if (method === 'Storage.sharedStorageAccessed') {
      this.events.push({
        time: typeof params?.accessTime === 'number' ? params.accessTime : 0,
        type: params?.scope ?? params?.type ?? '',
        method: params?.method ?? '',
        key: params?.params?.key ?? '',
      });
      return true;
    }
    return false;
  }

  list(): SharedStorageAccessEvent[] {
    return this.events.items();
  }

  clear(): void {
    this.events.clear();
  }
}

export async function setSharedStorageTracking(conn: CdpConnection, enable: boolean): Promise<void> {
  await conn.send('Storage.setSharedStorageTracking', { enable });
}

export async function getSharedStorageMetadata(conn: CdpConnection, ownerOrigin: string): Promise<SharedStorageMetadata> {
  const { metadata } = await conn.send<{ metadata?: { creationTime?: number; length?: number; remainingBudget?: number; bytesUsed?: number } }>(
    'Storage.getSharedStorageMetadata', { ownerOrigin });
  return {
    creationTime: metadata?.creationTime ?? 0,
    length: metadata?.length ?? 0,
    remainingBudget: metadata?.remainingBudget ?? 0,
    bytesUsed: metadata?.bytesUsed ?? 0,
  };
}

export async function getSharedStorageEntries(conn: CdpConnection, ownerOrigin: string): Promise<SharedStorageEntry[]> {
  const { entries } = await conn.send<{ entries?: Array<{ key?: string; value?: string }> }>(
    'Storage.getSharedStorageEntries', { ownerOrigin });
  return (entries ?? []).map(e => ({ key: e.key ?? '', value: e.value ?? '' }));
}

export interface TrustTokenCount {
  issuerOrigin: string;
  count: number;
}

export async function getTrustTokens(conn: CdpConnection): Promise<TrustTokenCount[]> {
  const { tokens } = await conn.send<{ tokens?: Array<{ issuerOrigin?: string; count?: number }> }>('Storage.getTrustTokens');
  return (tokens ?? []).map(t => ({ issuerOrigin: t.issuerOrigin ?? '', count: t.count ?? 0 }));
}

export async function clearTrustTokens(conn: CdpConnection, issuerOrigin: string): Promise<void> {
  await conn.send('Storage.clearTrustTokens', { issuerOrigin });
}
