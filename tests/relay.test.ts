import { test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { connect } from 'node:net';
import { get } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { MockCdp } from './helpers/mock-cdp.js';
import { closeWslRelays, ensureWslRelay, realWslRelayHooks, setWslRelayEnabled, startWslRelay, type RelayEnv } from '../src/cdp/relay.js';

let mock: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(() => mock.close());
afterEach(async () => { setWslRelayEnabled(true); await closeWslRelays(); });

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  constructor(host: string, port: number) {
    super();
    const upstream = connect(port, host);
    upstream.on('error', () => {});
    this.stdin.pipe(upstream);
    upstream.pipe(this.stdout);
    upstream.on('close', () => this.emit('exit', 0));
  }
}

function fakeEnv(): { env: RelayEnv; children: FakeChild[] } {
  const children: FakeChild[] = [];
  return {
    children,
    env: {
      spawnRelay(host, port) {
        const child = new FakeChild(host, port);
        children.push(child);
        return child as unknown as ChildProcess;
      },
    },
  };
}

const httpGet = (port: number, path: string) =>
  new Promise<string>((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, agent: false }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });

// Judged by data round-trip, not connect: mirrored-mode WSL accepts TCP
// connects to closed loopback ports and only resets on I/O.
const tryConnect = (port: number) =>
  new Promise<boolean>(resolve => {
    const c = connect(port, '127.0.0.1');
    const done = (v: boolean) => { c.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), 1500);
    timer.unref?.();
    c.on('error', () => done(false));
    c.on('close', () => done(false));
    c.on('connect', () => c.write('GET /json/version HTTP/1.0\r\n\r\n'));
    c.on('data', () => done(true));
  });

test('HTTP through the relay port reaches the backend', async () => {
  const { env } = fakeEnv();
  const relay = await startWslRelay(mock.port, env);
  const body = await httpGet(relay.port, '/json/version');
  expect(JSON.parse(body).Browser).toBe('MockChrome/1.0');
  await relay.close();
});

test('client disconnect ends the relay child', async () => {
  const { env, children } = fakeEnv();
  const relay = await startWslRelay(mock.port, env);
  const client = connect(relay.port, '127.0.0.1');
  await once(client, 'connect');
  while (children.length === 0) await new Promise(r => setImmediate(r));
  const exited = once(children[0], 'exit');
  client.end();
  await exited;
  expect(children[0].stdin.writableEnded).toBe(true);
  await relay.close();
});

test('ensureWslRelay reuses one relay per target port', async () => {
  const { env } = fakeEnv();
  const a = await ensureWslRelay(mock.port, env);
  const b = await ensureWslRelay(mock.port, env);
  expect(b).toBe(a);
});

test('closeWslRelays closes listeners and a later ensure starts fresh', async () => {
  const { env } = fakeEnv();
  const first = await ensureWslRelay(mock.port, env);
  await closeWslRelays();
  expect(await tryConnect(first.port)).toBe(false);
  const second = await ensureWslRelay(mock.port, env);
  expect(second).not.toBe(first);
  const body = await httpGet(second.port, '/json/version');
  expect(JSON.parse(body).Browser).toBe('MockChrome/1.0');
});

test('available() is gated by setWslRelayEnabled', () => {
  const hooks = realWslRelayHooks();
  const initial = hooks.available();
  setWslRelayEnabled(false);
  expect(hooks.available()).toBe(false);
  setWslRelayEnabled(true);
  expect(hooks.available()).toBe(initial);
});
