import type { CdpConnection } from './connection.js';

export type IdbKey =
  | { type: 'number'; number: number }
  | { type: 'string'; string: string }
  | { type: 'date'; date: number };

export interface IdbStoreMeta {
  name: string;
  keyPath: string;
  autoIncrement: boolean;
  indexes: string[];
}

export interface IdbEntry {
  key: string;
  primaryKey: string;
  value: string;
  shallow: boolean;
  rangeKey: IdbKey | null;
}

export interface IdbPage {
  entries: IdbEntry[];
  hasMore: boolean;
}

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
  preview?: ObjectPreview;
}

interface ObjectPreview {
  subtype?: string;
  overflow?: boolean;
  properties?: Array<{ name: string; type?: string; subtype?: string; value?: string }>;
}

const previewProp = (p: { type?: string; value?: string }): string =>
  p.type === 'string' ? JSON.stringify(p.value ?? '') : p.value ?? p.type ?? '?';

function previewDisplay(p: ObjectPreview): string {
  const props = p.properties ?? [];
  const tail = p.overflow ? ', …' : '';
  if (p.subtype === 'array') return `[${props.map(previewProp).join(', ')}${tail}]`;
  return `{${props.map(x => `${x.name}: ${previewProp(x)}`).join(', ')}${tail}}`;
}

export function remoteDisplay(o: RemoteObject | undefined): string {
  if (!o) return '';
  if (o.type === 'string') return String(o.value ?? '');
  if (o.value !== undefined) return JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  if (o.preview) return previewDisplay(o.preview);
  return o.description ?? '';
}

export function toIdbKey(o: RemoteObject | undefined): IdbKey | null {
  if (!o) return null;
  if (o.type === 'number' && typeof o.value === 'number') return { type: 'number', number: o.value };
  if (o.type === 'string' && typeof o.value === 'string') return { type: 'string', string: o.value };
  if (o.subtype === 'date' && o.description) {
    const ms = Date.parse(o.description);
    return Number.isNaN(ms) ? null : { type: 'date', date: ms };
  }
  return null;
}

const keyPathText = (kp?: { type?: string; string?: string; array?: string[] }): string =>
  !kp ? '' : kp.type === 'string' ? kp.string ?? '' : kp.type === 'array' ? (kp.array ?? []).join(', ') : '';

export async function getDatabaseNames(conn: CdpConnection, securityOrigin: string): Promise<string[]> {
  await conn.send('IndexedDB.enable');
  const { databaseNames } = await conn.send<{ databaseNames?: string[] }>(
    'IndexedDB.requestDatabaseNames', { securityOrigin });
  return databaseNames ?? [];
}

export async function getDatabase(conn: CdpConnection, securityOrigin: string, databaseName: string): Promise<IdbStoreMeta[]> {
  await conn.send('IndexedDB.enable');
  const { databaseWithObjectStores } = await conn.send<{ databaseWithObjectStores?: { objectStores?: any[] } }>(
    'IndexedDB.requestDatabase', { securityOrigin, databaseName });
  return (databaseWithObjectStores?.objectStores ?? []).map(s => ({
    name: s.name,
    keyPath: keyPathText(s.keyPath),
    autoIncrement: !!s.autoIncrement,
    indexes: (s.indexes ?? []).map((i: { name: string }) => i.name),
  }));
}

async function stringifyRemote(conn: CdpConnection, objectId: string): Promise<string | null> {
  try {
    const { result } = await conn.send<{ result?: { value?: unknown } }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { try { return JSON.stringify(this); } catch { return String(this); } }',
      returnByValue: true,
    });
    return typeof result?.value === 'string' ? result.value : null;
  } catch {
    return null;
  }
}

const releaseRemote = (conn: CdpConnection, o?: RemoteObject): void => {
  if (o?.objectId) void conn.send('Runtime.releaseObject', { objectId: o.objectId }).catch(() => {});
};

export async function getStoreData(
  conn: CdpConnection,
  securityOrigin: string,
  databaseName: string,
  objectStoreName: string,
  skipCount: number,
  pageSize: number,
): Promise<IdbPage> {
  await conn.send('IndexedDB.enable');
  const { objectStoreDataEntries, hasMore } = await conn.send<{
    objectStoreDataEntries?: Array<{ key?: RemoteObject; primaryKey?: RemoteObject; value?: RemoteObject }>;
    hasMore?: boolean;
  }>('IndexedDB.requestData', { securityOrigin, databaseName, objectStoreName, indexName: '', skipCount, pageSize });
  const entries = await Promise.all((objectStoreDataEntries ?? []).map(async e => {
    const full = e.value?.objectId ? await stringifyRemote(conn, e.value.objectId) : null;
    releaseRemote(conn, e.key);
    releaseRemote(conn, e.value);
    if (e.primaryKey?.objectId !== e.key?.objectId) releaseRemote(conn, e.primaryKey);
    return {
      key: remoteDisplay(e.key),
      primaryKey: remoteDisplay(e.primaryKey),
      value: full ?? remoteDisplay(e.value),
      shallow: full === null && !!e.value?.objectId,
      rangeKey: toIdbKey(e.key),
    };
  }));
  return { entries, hasMore: !!hasMore };
}

export async function deleteEntry(
  conn: CdpConnection,
  securityOrigin: string,
  databaseName: string,
  objectStoreName: string,
  key: IdbKey,
): Promise<void> {
  await conn.send('IndexedDB.deleteObjectStoreEntries', {
    securityOrigin,
    databaseName,
    objectStoreName,
    keyRange: { lower: key, upper: key, lowerOpen: false, upperOpen: false },
  });
}

export async function clearStore(
  conn: CdpConnection,
  securityOrigin: string,
  databaseName: string,
  objectStoreName: string,
): Promise<void> {
  await conn.send('IndexedDB.clearObjectStore', { securityOrigin, databaseName, objectStoreName });
}

const keyLiteral = (k: IdbKey | null): string =>
  !k ? 'undefined'
  : k.type === 'number' ? String(k.number)
  : k.type === 'string' ? JSON.stringify(k.string)
  : `new Date(${k.date})`;

export async function putEntry(
  conn: CdpConnection,
  databaseName: string,
  objectStoreName: string,
  key: IdbKey | null,
  valueJson: string,
): Promise<void> {
  const expression = `(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(${JSON.stringify(databaseName)});
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      const value = JSON.parse(${JSON.stringify(valueJson)});
      const key = ${keyLiteral(key)};
      await new Promise((res, rej) => {
        const tx = db.transaction(${JSON.stringify(objectStoreName)}, 'readwrite');
        const store = tx.objectStore(${JSON.stringify(objectStoreName)});
        const req = store.keyPath === null && key !== undefined ? store.put(value, key) : store.put(value);
        req.onsuccess = () => res(undefined);
        req.onerror = () => rej(req.error);
      });
    } finally {
      db.close();
    }
  })()`;
  const { exceptionDetails } = await conn.send<{ exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
    'Runtime.evaluate', { expression, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'put failed');
}
