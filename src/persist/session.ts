import { appendFile, readdir, rm, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';

export interface SessionPaths {
  dir: string;
  networkFile: string;
  consoleFile: string;
}

export function sessionRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA ?? homedir(), 'devtools-tui', 'sessions');
  }
  const base = env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share');
  return join(base, 'devtools-tui', 'sessions');
}

export function urlSlug(tabUrl: string): string {
  return tabUrl
    .replace(/^[a-z]+:\/\//i, '')
    .split(/[?#]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export function createSessionDir(root: string, tabUrl: string, now = new Date()): SessionPaths {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const slug = urlSlug(tabUrl);
  const dir = join(root, slug ? `${stamp}-${slug}` : stamp);
  mkdirSync(dir, { recursive: true });
  return { dir, networkFile: join(dir, 'network.jsonl'), consoleFile: join(dir, 'console.jsonl') };
}

export class JsonlWriter {
  private queue: Promise<unknown> = Promise.resolve();
  error?: Error;

  constructor(readonly file: string) {}

  write(obj: unknown): void {
    const line = JSON.stringify(obj) + '\n';
    this.queue = this.queue.then(() => appendFile(this.file, line)).catch((err: Error) => {
      if (!this.error) {
        this.error = err;
        process.stderr.write(`devtools-tui: failed to persist ${this.file}: ${err.message}\n`);
      }
    });
  }

  close(): Promise<void> {
    return this.queue.then(() => {});
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir)) {
    const st = await stat(join(dir, name));
    total += st.isDirectory() ? await dirSize(join(dir, name)) : st.size;
  }
  return total;
}

export async function pruneSessions(root: string, budgetBytes = 500 * 1024 * 1024): Promise<string[]> {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) return [];
  const abs = resolve(root);
  if (abs === parse(abs).root) return [];
  const dirs: Array<{ name: string; path: string; st: import('node:fs').Stats; size: number }> = [];
  for (const name of await readdir(root)) {
    const path = join(root, name);
    const st = await stat(path);
    if (st.isDirectory()) dirs.push({ name, path, st, size: await dirSize(path) });
  }
  dirs.sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);
  let total = dirs.reduce((sum, d) => sum + d.size, 0);
  const deleted: string[] = [];
  for (const d of dirs) {
    if (total <= budgetBytes) break;
    await rm(d.path, { recursive: true, force: true });
    total -= d.size;
    deleted.push(d.name);
  }
  return deleted;
}
