import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { candidateHosts, discoverEndpoint, probe, scanEndpoints, type DiscoveryEnv } from '../src/cdp/discovery.js';

let mock: MockCdp;
let mock2: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); mock2 = await MockCdp.start(); });
afterAll(async () => { await mock.close(); await mock2.close(); });

const env = (overrides: Partial<DiscoveryEnv>): DiscoveryEnv => ({
  isWsl: async () => false,
  defaultGateway: async () => null,
  fetchFn: fetch,
  ...overrides,
});

test('candidateHosts is localhost-only off WSL', async () => {
  expect(await candidateHosts(env({}))).toEqual(['127.0.0.1']);
});

test('candidateHosts appends gateway on WSL', async () => {
  const e = env({ isWsl: async () => true, defaultGateway: async () => '172.29.16.1' });
  expect(await candidateHosts(e)).toEqual(['127.0.0.1', '172.29.16.1']);
});

test('probe returns endpoint with browser name', async () => {
  const ep = await probe('127.0.0.1', mock.port, fetch);
  expect(ep).toEqual({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
});

test('probe returns null when nothing listens', async () => {
  expect(await probe('127.0.0.1', 1, fetch)).toBeNull();
});

test('discoverEndpoint walks candidates in order', async () => {
  const ep = await discoverEndpoint(mock.port, env({}));
  expect(ep?.browser).toBe('MockChrome/1.0');
  expect(await discoverEndpoint(1, env({}))).toBeNull();
});

test('scanEndpoints returns alive endpoints in port order and skips dead ports', async () => {
  const found = await scanEndpoints([mock.port, 1, mock2.port], env({}));
  expect(found).toEqual([
    { host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' },
    { host: '127.0.0.1', port: mock2.port, browser: 'MockChrome/1.0' },
  ]);
});

test('scanEndpoints scans host order then port order and dedupes', async () => {
  const e = env({ isWsl: async () => true, defaultGateway: async () => '127.0.0.1' });
  const found = await scanEndpoints([mock2.port, mock.port], e);
  expect(found).toEqual([
    { host: '127.0.0.1', port: mock2.port, browser: 'MockChrome/1.0' },
    { host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' },
  ]);
});

test('scanEndpoints returns empty when nothing is alive', async () => {
  expect(await scanEndpoints([1, 2], env({}))).toEqual([]);
});
