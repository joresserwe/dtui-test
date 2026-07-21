import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  clearStore,
  deleteEntry,
  getDatabase,
  getDatabaseNames,
  getStoreData,
  putEntry,
  remoteDisplay,
  toIdbKey,
} from '../src/cdp/indexeddb.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => {
  mock = await MockCdp.start();
  conn = await CdpConnection.open(mock.pageWsUrl('page1'));
});
afterAll(async () => { conn.close(); await mock.close(); });

test('getDatabaseNames enables IndexedDB and passes the origin', async () => {
  const calls: string[] = [];
  mock.respond('IndexedDB.enable', () => { calls.push('enable'); return {}; });
  mock.respond('IndexedDB.requestDatabaseNames', p => {
    expect(p).toEqual({ securityOrigin: 'https://a.test' });
    return { databaseNames: ['appdb', 'cachedb'] };
  });
  expect(await getDatabaseNames(conn, 'https://a.test')).toEqual(['appdb', 'cachedb']);
  expect(calls).toContain('enable');
});

test('getDatabase maps object store metadata including keyPath variants', async () => {
  mock.respond('IndexedDB.requestDatabase', p => {
    expect(p).toEqual({ securityOrigin: 'https://a.test', databaseName: 'appdb' });
    return {
      databaseWithObjectStores: {
        name: 'appdb',
        version: 3,
        objectStores: [
          { name: 'items', keyPath: { type: 'string', string: 'id' }, autoIncrement: true, indexes: [{ name: 'byName' }] },
          { name: 'blobs', keyPath: { type: 'null' }, autoIncrement: false, indexes: [] },
          { name: 'pairs', keyPath: { type: 'array', array: ['a', 'b'] }, autoIncrement: false, indexes: [] },
        ],
      },
    };
  });
  expect(await getDatabase(conn, 'https://a.test', 'appdb')).toEqual([
    { name: 'items', keyPath: 'id', autoIncrement: true, indexes: ['byName'] },
    { name: 'blobs', keyPath: '', autoIncrement: false, indexes: [] },
    { name: 'pairs', keyPath: 'a, b', autoIncrement: false, indexes: [] },
  ]);
});

test('getStoreData pages entries and stringifies object values through the runtime', async () => {
  const released: string[] = [];
  mock.respond('IndexedDB.requestData', p => {
    expect(p).toEqual({
      securityOrigin: 'https://a.test', databaseName: 'appdb', objectStoreName: 'items',
      indexName: '', skipCount: 0, pageSize: 50,
    });
    return {
      objectStoreDataEntries: [
        {
          key: { type: 'number', value: 1 },
          primaryKey: { type: 'number', value: 1 },
          value: { type: 'object', objectId: 'obj-1', preview: { properties: [{ name: 'a', type: 'number', value: '1' }] } },
        },
        {
          key: { type: 'string', value: 'k2' },
          primaryKey: { type: 'string', value: 'k2' },
          value: { type: 'string', value: 'plain' },
        },
      ],
      hasMore: true,
    };
  });
  mock.respond('Runtime.callFunctionOn', p => {
    expect(p.objectId).toBe('obj-1');
    expect(p.returnByValue).toBe(true);
    return { result: { value: '{"a":1,"deep":{"b":2}}' } };
  });
  mock.respond('Runtime.releaseObject', p => { released.push(p.objectId); return {}; });

  const page = await getStoreData(conn, 'https://a.test', 'appdb', 'items', 0, 50);
  expect(page.hasMore).toBe(true);
  expect(page.entries).toEqual([
    { key: '1', primaryKey: '1', value: '{"a":1,"deep":{"b":2}}', shallow: false, rangeKey: { type: 'number', number: 1 } },
    { key: 'k2', primaryKey: 'k2', value: 'plain', shallow: false, rangeKey: { type: 'string', string: 'k2' } },
  ]);
  await new Promise(r => setTimeout(r, 30));
  expect(released).toContain('obj-1');
});

test('getStoreData falls back to the shallow preview when stringify fails', async () => {
  mock.respond('IndexedDB.requestData', () => ({
    objectStoreDataEntries: [{
      key: { type: 'number', value: 7 },
      primaryKey: { type: 'number', value: 7 },
      value: {
        type: 'object', objectId: 'obj-x',
        preview: { overflow: true, properties: [{ name: 'a', type: 'string', value: 'x' }, { name: 'n', type: 'number', value: '3' }] },
      },
    }],
    hasMore: false,
  }));
  mock.respond('Runtime.callFunctionOn', () => { throw new Error('gone'); });
  const page = await getStoreData(conn, 'https://a.test', 'appdb', 'items', 0, 50);
  expect(page.entries[0].value).toBe('{a: "x", n: 3, …}');
  expect(page.entries[0].shallow).toBe(true);
});

test('deleteEntry sends an exact key range and clearStore clears', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('IndexedDB.deleteObjectStoreEntries', p => { calls.push(['del', p]); return {}; });
  mock.respond('IndexedDB.clearObjectStore', p => { calls.push(['clear', p]); return {}; });

  await deleteEntry(conn, 'https://a.test', 'appdb', 'items', { type: 'string', string: 'k2' });
  expect(calls[0][1]).toEqual({
    securityOrigin: 'https://a.test', databaseName: 'appdb', objectStoreName: 'items',
    keyRange: {
      lower: { type: 'string', string: 'k2' },
      upper: { type: 'string', string: 'k2' },
      lowerOpen: false,
      upperOpen: false,
    },
  });
  await clearStore(conn, 'https://a.test', 'appdb', 'items');
  expect(calls[1][1]).toEqual({ securityOrigin: 'https://a.test', databaseName: 'appdb', objectStoreName: 'items' });
});

test('putEntry evaluates an awaited IDB put and surfaces page exceptions', async () => {
  let seen: any;
  mock.respond('Runtime.evaluate', p => { seen = p; return {}; });
  await putEntry(conn, 'appdb', 'items', { type: 'number', number: 5 }, '{"a":2}');
  expect(seen.awaitPromise).toBe(true);
  expect(seen.expression).toContain('"appdb"');
  expect(seen.expression).toContain('"items"');
  expect(seen.expression).toContain('store.put');
  expect(seen.expression).toContain('JSON.parse');

  mock.respond('Runtime.evaluate', () => ({ exceptionDetails: { exception: { description: 'DataError: bad key' } } }));
  await expect(putEntry(conn, 'appdb', 'items', null, '{}')).rejects.toThrow('DataError: bad key');
});

test('remoteDisplay and toIdbKey cover primitives, dates, and unsupported keys', () => {
  expect(remoteDisplay({ type: 'string', value: 'abc' })).toBe('abc');
  expect(remoteDisplay({ type: 'number', value: 3 })).toBe('3');
  expect(remoteDisplay({ type: 'boolean', value: true })).toBe('true');
  expect(remoteDisplay({ type: 'number', unserializableValue: 'Infinity' })).toBe('Infinity');
  expect(remoteDisplay({ type: 'object', subtype: 'array', preview: { subtype: 'array', properties: [{ name: '0', type: 'number', value: '1' }] } })).toBe('[1]');
  expect(remoteDisplay({ type: 'object', subtype: 'date', description: 'Tue Jan 01 2030 00:00:00 GMT+0000' })).toBe('Tue Jan 01 2030 00:00:00 GMT+0000');
  expect(toIdbKey({ type: 'number', value: 4 })).toEqual({ type: 'number', number: 4 });
  expect(toIdbKey({ type: 'string', value: 's' })).toEqual({ type: 'string', string: 's' });
  const d = toIdbKey({ type: 'object', subtype: 'date', description: '2030-01-01T00:00:00.000Z' });
  expect(d).toEqual({ type: 'date', date: Date.parse('2030-01-01T00:00:00.000Z') });
  expect(toIdbKey({ type: 'object', subtype: 'array', description: 'Array(2)' })).toBeNull();
});
