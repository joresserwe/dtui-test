import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection, CdpError } from '../src/cdp/connection.js';

let mock: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(async () => { await mock.close(); });

test('send() resolves with the command result', async () => {
  mock.respond('Runtime.evaluate', params => ({ result: { value: `echo:${params.expression}` } }));
  const conn = await CdpConnection.open(mock.pageWsUrl('page1'));
  const res = await conn.send<{ result: { value: string } }>('Runtime.evaluate', { expression: 'hi' });
  expect(res.result.value).toBe('echo:hi');
  conn.close();
});

test('send() rejects with CdpError on protocol error', async () => {
  mock.respond('Bad.method', () => { throw { code: -32601, message: 'method not found' }; });
  const conn = await CdpConnection.open(mock.pageWsUrl('page1'));
  await expect(conn.send('Bad.method')).rejects.toThrowError(CdpError);
  conn.close();
});

test('events are emitted by method name and via generic event channel', async () => {
  const conn = await CdpConnection.open(mock.pageWsUrl('page1'));
  const byName = new Promise(r => conn.once('Network.requestWillBeSent', r));
  const generic = new Promise(r => conn.once('event', (m, p) => r([m, p])));
  mock.emitEvent('Network.requestWillBeSent', { requestId: 'r1' });
  expect(await byName).toEqual({ requestId: 'r1' });
  expect(await generic).toEqual(['Network.requestWillBeSent', { requestId: 'r1' }]);
  conn.close();
});

test('close is emitted exactly once even when error precedes close', async () => {
  const conn = await CdpConnection.open(mock.pageWsUrl('page1'));
  let closes = 0;
  conn.on('close', () => closes++);
  (conn as any).ws.emit('error', new Error('boom'));
  (conn as any).ws.emit('close');
  await new Promise(r => setTimeout(r, 20));
  expect(closes).toBe(1);
});

test('close rejects in-flight commands and emits close', async () => {
  mock.swallow('Slow.method');
  const conn = await CdpConnection.open(mock.pageWsUrl('page1'));
  const closed = new Promise(r => conn.once('close', r));
  const pending = conn.send('Slow.method');
  conn.close();
  await expect(pending).rejects.toThrow(/closed/);
  await closed;
});
