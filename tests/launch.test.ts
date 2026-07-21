import { test, expect, afterEach } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { probe } from '../src/cdp/discovery.js';
import { launchBrowser, ProfileRestrictedError, realLaunchEnv, type LaunchEnv } from '../src/browser/launch.js';

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

test('WSL toolProfileDir resolves a real Windows LocalAppData path', async ctx => {
  const hasPwsh = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', 'echo ok']).then(() => true, () => false);
  if (!hasPwsh) return ctx.skip();
  const dir = await realLaunchEnv().toolProfileDir({ kind: 'chrome', name: 'x', path: '/x', viaWsl: true });
  expect(dir).toMatch(/^[A-Za-z]:\\/);
  expect(dir).toContain('AppData');
  expect(dir).toContain('devtools-tui\\profiles\\chrome');
});
