import { test, expect, afterEach } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { probe } from '../src/cdp/discovery.js';
import { launchBrowser, ProfileRestrictedError, WslLoopbackError, realLaunchEnv, type LaunchEnv } from '../src/browser/launch.js';
import type { WslRelayHooks } from '../src/cdp/relay.js';

const FAKE = fileURLToPath(new URL('./helpers/fake-browser.js', import.meta.url));
const children: ChildProcess[] = [];
afterEach(() => { for (const c of children.splice(0)) c.kill('SIGKILL'); });

function testEnv(extraSpawnEnv: NodeJS.ProcessEnv = {}): { env: LaunchEnv; argsSeen: string[][] } {
  const argsSeen: string[][] = [];
  const env: LaunchEnv = {
    spawn(cmd, args) {
      argsSeen.push([cmd, ...args]);
      const child = spawn(process.execPath, [FAKE, ...args], { env: { ...process.env, ...extraSpawnEnv } });
      children.push(child);
    },
    probe: (host, port) => probe(host, port, fetch),
    hosts: async () => ['127.0.0.1'],
    toolProfileDir: async () => mkdtemp(join(tmpdir(), 'dtui-profile-')),
    delayMs: 100,
  };
  return { env, argsSeen };
}

const CAND = { kind: 'chrome' as const, name: 'Fake Chrome', path: '/fake/chrome', viaWsl: false };

test('launches with tool profile args and resolves the endpoint', async () => {
  const { env, argsSeen } = testEnv();
  const ep = await launchBrowser(CAND, { port: 19222, profile: 'tool', url: 'https://x.test/' }, env);
  expect(ep).toMatchObject({ host: '127.0.0.1', port: 19222, browser: 'FakeChrome/1.0' });
  const args = argsSeen[0];
  expect(args[0]).toBe('/fake/chrome');
  expect(args).toContain('--remote-debugging-port=19222');
  expect(args.some(a => a.startsWith('--user-data-dir='))).toBe(true);
  expect(args).toContain('--no-first-run');
  expect(args[args.length - 1]).toBe('https://x.test/');
});

test('existing profile omits user-data-dir', async () => {
  const { env, argsSeen } = testEnv();
  await launchBrowser(CAND, { port: 19223, profile: 'existing' }, env);
  expect(argsSeen[0].some(a => a.startsWith('--user-data-dir='))).toBe(false);
  expect(argsSeen[0]).not.toContain('--no-first-run');
});

test('existing-profile timeout raises ProfileRestrictedError', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  await expect(launchBrowser(CAND, { port: 19224, profile: 'existing', timeoutMs: 600 }, env))
    .rejects.toThrowError(ProfileRestrictedError);
});

test('tool-profile timeout raises a plain error naming the browser', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  await expect(launchBrowser(CAND, { port: 19225, profile: 'tool', timeoutMs: 600 }, env))
    .rejects.toThrow(/Fake Chrome/);
});

test('spawn failures reject instead of crashing', async () => {
  const env = { ...testEnv().env, spawn: realLaunchEnv().spawn };
  await expect(launchBrowser({ ...CAND, path: '/nonexistent-binary-dtui-xyz' }, { port: 19226, profile: 'tool', timeoutMs: 5000 }, env))
    .rejects.toThrow(/ENOENT/);
});

test('spawn-failure error includes the attempted command line', async () => {
  const env = { ...testEnv().env, spawn: realLaunchEnv().spawn };
  await expect(launchBrowser({ ...CAND, path: '/nonexistent-binary-dtui-xyz' }, { port: 19229, profile: 'tool', timeoutMs: 5000 }, env))
    .rejects.toThrow(/\/nonexistent-binary-dtui-xyz .*--remote-debugging-port=19229/);
});

test('ProfileRestrictedError names the attempted command line', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  await expect(launchBrowser(CAND, { port: 19230, profile: 'existing', timeoutMs: 600 }, env))
    .rejects.toThrow(/\/fake\/chrome .*--remote-debugging-port=19230/);
});

test('tool timeout error includes the attempted command line', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  await expect(launchBrowser(CAND, { port: 19227, profile: 'tool', timeoutMs: 600 }, env))
    .rejects.toThrow(/\/fake\/chrome .*--remote-debugging-port=19227/);
});

test('timeoutMs of zero still probes once', async () => {
  let probes = 0;
  const { env } = testEnv();
  const counting = { ...env, probe: async (h: string, p: number) => { probes++; return probe(h, p, fetch); } };
  await expect(launchBrowser(CAND, { port: 19228, profile: 'tool', timeoutMs: 0 }, counting)).rejects.toThrow();
  expect(probes).toBeGreaterThanOrEqual(1);
});

const WSL_CAND = { ...CAND, viaWsl: true };

const relayHooks = (overrides: Partial<WslRelayHooks> = {}): WslRelayHooks => ({
  available: () => true,
  windowsLoopbackListening: async () => true,
  ensure: async () => ({ port: 0, close: async () => {} }),
  ...overrides,
});

test('viaWsl candidate resolves through the relay when direct probes fail', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  const relayEp = { host: '127.0.0.1', port: 45678, browser: 'MockChrome/1.0', via: 'wsl-relay' as const, targetPort: 19231 };
  let calls = 0;
  const e: LaunchEnv = { ...env, wslRelay: relayHooks(), relayConnect: async () => { calls++; return relayEp; } };
  const ep = await launchBrowser(WSL_CAND, { port: 19231, profile: 'tool', timeoutMs: 5000 }, e);
  expect(ep).toBe(relayEp);
  expect(calls).toBe(1);
});

test('windows listening without relay connectivity raises WslLoopbackError in both profile modes', async () => {
  for (const profile of ['existing', 'tool'] as const) {
    const { env } = testEnv({ FAKE_NO_PORT: '1' });
    const e: LaunchEnv = { ...env, wslRelay: relayHooks(), relayConnect: async () => null };
    const err = await launchBrowser(WSL_CAND, { port: 19232, profile, timeoutMs: 400 }, e).then(() => null, (x: unknown) => x);
    expect(err).toBeInstanceOf(WslLoopbackError);
    expect((err as Error).name).toBe('WslLoopbackError');
  }
});

test('viaWsl candidate without a windows listener keeps ProfileRestrictedError', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  let connects = 0;
  const e: LaunchEnv = {
    ...env,
    wslRelay: relayHooks({ windowsLoopbackListening: async () => false }),
    relayConnect: async () => { connects++; return null; },
  };
  await expect(launchBrowser(WSL_CAND, { port: 19233, profile: 'existing', timeoutMs: 400 }, e))
    .rejects.toThrowError(ProfileRestrictedError);
  expect(connects).toBe(0);
});

test('non-WSL candidate never touches the relay hooks', async () => {
  const { env } = testEnv({ FAKE_NO_PORT: '1' });
  let touched = false;
  const e: LaunchEnv = {
    ...env,
    wslRelay: relayHooks({
      available: () => { touched = true; return true; },
      windowsLoopbackListening: async () => { touched = true; return true; },
    }),
    relayConnect: async () => { touched = true; return null; },
  };
  await expect(launchBrowser(CAND, { port: 19234, profile: 'tool', timeoutMs: 300 }, e)).rejects.toThrow(/Fake Chrome/);
  expect(touched).toBe(false);
});

test('WSL toolProfileDir resolves a real Windows LocalAppData path', async ctx => {
  const hasPwsh = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', 'echo ok']).then(() => true, () => false);
  if (!hasPwsh) return ctx.skip();
  const dir = await realLaunchEnv().toolProfileDir({ kind: 'chrome', name: 'x', path: '/x', viaWsl: true });
  expect(dir).toMatch(/^[A-Za-z]:\\/);
  expect(dir).toContain('AppData');
  expect(dir).toContain('devtools-tui\\profiles\\chrome');
});
