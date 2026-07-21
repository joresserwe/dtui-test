import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CookieInfo } from '../cdp/storage.js';

export function snapshotRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? homedir(), 'devtools-tui', 'snapshots');
  const base = env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share');
  return join(base, 'devtools-tui', 'snapshots');
}

export interface SnapshotDeps {
  url: string;
  origin: string;
  cookies: () => Promise<CookieInfo[]>;
  local: () => Promise<Array<[string, string]>>;
  session: () => Promise<Array<[string, string]>>;
  dom: () => Promise<string>;
  screenshotBase64: () => Promise<string | null>;
  networkHar: () => object;
  networkJsonl: () => string;
  consoleJsonl: () => string;
}

export function slug(url: string): string {
  return url
    .replace(/^[a-z]+:\/\//i, '')
    .split(/[?#]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export async function captureSnapshot(root: string, deps: SnapshotDeps, now = new Date()): Promise<string> {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const s = slug(deps.url);
  const dir = join(root, s ? `${stamp}-${s}` : stamp);

  const [cookies, local, session, dom, shot] = await Promise.all([
    deps.cookies(), deps.local(), deps.session(), deps.dom(), deps.screenshotBase64(),
  ]);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ url: deps.url, origin: deps.origin, capturedAt: now.toISOString() }, null, 2));
  writeFileSync(join(dir, 'cookies.json'), JSON.stringify(cookies, null, 2));
  writeFileSync(join(dir, 'storage.json'), JSON.stringify({ local, session }, null, 2));
  writeFileSync(join(dir, 'dom.html'), dom);
  writeFileSync(join(dir, 'session.har'), JSON.stringify(deps.networkHar(), null, 2));
  writeFileSync(join(dir, 'network.jsonl'), deps.networkJsonl());
  writeFileSync(join(dir, 'console.jsonl'), deps.consoleJsonl());
  if (shot) writeFileSync(join(dir, 'screenshot.png'), Buffer.from(shot, 'base64'));
  return dir;
}
