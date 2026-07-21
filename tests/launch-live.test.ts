import { test, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe } from '../src/cdp/discovery.js';
import { detectBrowsers } from '../src/browser/detect.js';
import { launchBrowser, type LaunchEnv } from '../src/browser/launch.js';
import { listPages } from '../src/cdp/targets.js';

const CHROMIUM = process.env.DEVTOOLS_TUI_CHROMIUM;

test.skipIf(!CHROMIUM)('detects and launches a real browser through the launcher path', async () => {
  const found = await detectBrowsers({
    platform: 'linux',
    isWsl: async () => false,
    exists: () => true,
    readDir: () => [],
    regQuery: async () => undefined,
    mdfind: async () => undefined,
    env: {},
    extraPaths: [CHROMIUM!],
  });
  const cand = found.find(c => c.kind === 'custom');
  expect(cand).toBeDefined();

  const children: ChildProcess[] = [];
  const profiles: string[] = [];
  const env: LaunchEnv = {
    spawn(cmd, args) { children.push(spawn(cmd, ['--headless=new', ...args])); },
    probe: (host, port) => probe(host, port, fetch),
    hosts: async () => ['127.0.0.1'],
    toolProfileDir: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'dtui-live-profile-'));
      profiles.push(dir);
      return dir;
    },
    delayMs: 300,
  };
  try {
    const ep = await launchBrowser(cand!, { port: 19444, profile: 'tool', timeoutMs: 20000 }, env);
    expect(ep.browser).toContain('Chrome');
    const pages = await listPages(ep);
    expect(Array.isArray(pages)).toBe(true);
  } finally {
    for (const c of children) {
      c.kill('SIGKILL');
      await once(c, 'exit').catch(() => {});
    }
    for (const p of profiles) await rm(p, { recursive: true, force: true });
  }
}, 30000);
