import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe } from '../src/cdp/discovery.js';
import { listPages } from '../src/cdp/targets.js';
import { DebugSession } from '../src/engine.js';

const CHROMIUM = process.env.DEVTOOLS_TUI_CHROMIUM;

test.skipIf(!CHROMIUM)('attaches to a real headless Chromium and records a session', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'dtui-profile-'));
  const child = spawn(CHROMIUM!, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', 'data:text/html,<script>console.error("integration-boom")</script>',
  ]);
  let root: string | undefined;
  try {
    let port = 0;
    for (let i = 0; i < 50 && !port; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const f = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
        port = Number(f.split('\n')[0]);
      } catch { /* not written yet */ }
    }
    expect(port).toBeGreaterThan(0);

    const ep = await probe('127.0.0.1', port, fetch);
    expect(ep).not.toBeNull();
    const pages = await listPages(ep!);
    expect(pages.length).toBeGreaterThan(0);

    root = await mkdtemp(join(tmpdir(), 'dtui-int-'));
    const session = await DebugSession.attach(pages[0], { sessionRoot: root, browser: ep!.browser });
    await session.navigate('data:text/html,<script>console.log("second-load");fetch("data:application/json,{}")</script>');
    await new Promise(r => setTimeout(r, 1500));
    const texts = session.console.entries().map(e => e.text);
    expect(texts.some(t => t.includes('second-load'))).toBe(true);
    await session.close();

    const har = JSON.parse(await readFile(join(session.sessionDir!, 'session.har'), 'utf8'));
    expect(har.log.version).toBe('1.2');
  } finally {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => {});
    await rm(profile, { recursive: true, force: true });
    if (root) await rm(root, { recursive: true, force: true });
  }
}, 30000);
