import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type BrowserKind = 'chrome' | 'edge' | 'comet' | 'brave' | 'chromium' | 'custom';

export interface BrowserCandidate {
  name: string;
  path: string;
  kind: BrowserKind;
  viaWsl: boolean;
}

export interface DetectEnv {
  platform: NodeJS.Platform;
  isWsl(): Promise<boolean>;
  exists(p: string): boolean;
  readDir(p: string): string[];
  regQuery(key: string): Promise<string | undefined>;
  mdfind(query: string): Promise<string | undefined>;
  env: NodeJS.ProcessEnv;
  extraPaths: string[];
}

export function realDetectEnv(extraPaths: string[] = []): DetectEnv {
  return {
    platform: process.platform,
    async isWsl() {
      try {
        return /microsoft/i.test(await readFile('/proc/version', 'utf8'));
      } catch {
        return false;
      }
    },
    exists: existsSync,
    readDir(p) {
      try {
        return readdirSync(p);
      } catch {
        return [];
      }
    },
    async regQuery(key) {
      try {
        const { stdout } = await execFileAsync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', timeout: 5000 });
        return stdout;
      } catch {
        return undefined;
      }
    },
    async mdfind(query) {
      try {
        const { stdout } = await execFileAsync('mdfind', [query], { encoding: 'utf8', timeout: 5000 });
        return stdout;
      } catch {
        return undefined;
      }
    },
    env: process.env,
    extraPaths,
  };
}

type WinBase = 'pf' | 'pf86' | 'local';

const WINDOWS_RELATIVE: Array<{ kind: BrowserKind; name: string; rel: string; bases: WinBase[] }> = [
  { kind: 'chrome', name: 'Google Chrome', rel: 'Google\\Chrome\\Application\\chrome.exe', bases: ['pf', 'local'] },
  { kind: 'edge', name: 'Microsoft Edge', rel: 'Microsoft\\Edge\\Application\\msedge.exe', bases: ['pf86', 'pf'] },
  { kind: 'comet', name: 'Comet', rel: 'Perplexity\\Comet\\Application\\comet.exe', bases: ['pf', 'local'] },
  { kind: 'brave', name: 'Brave', rel: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', bases: ['pf', 'local'] },
  { kind: 'chromium', name: 'Chromium', rel: 'Chromium\\Application\\chrome.exe', bases: ['local'] },
];

const DARWIN_APPS: Array<{ kind: BrowserKind; name: string; path: string }> = [
  { kind: 'chrome', name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  { kind: 'edge', name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  { kind: 'comet', name: 'Comet', path: '/Applications/Comet.app/Contents/MacOS/Comet' },
  { kind: 'brave', name: 'Brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
  { kind: 'chromium', name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
];

const LINUX_BINARIES: Array<{ kind: BrowserKind; name: string; bin: string }> = [
  { kind: 'chrome', name: 'Google Chrome', bin: 'google-chrome' },
  { kind: 'chrome', name: 'Google Chrome', bin: 'google-chrome-stable' },
  { kind: 'edge', name: 'Microsoft Edge', bin: 'microsoft-edge' },
  { kind: 'brave', name: 'Brave', bin: 'brave-browser' },
  { kind: 'chromium', name: 'Chromium', bin: 'chromium' },
  { kind: 'chromium', name: 'Chromium', bin: 'chromium-browser' },
];

const LINUX_OPT_PATHS: Array<{ kind: BrowserKind; name: string; path: string }> = [
  { kind: 'chrome', name: 'Google Chrome', path: '/opt/google/chrome/chrome' },
  { kind: 'brave', name: 'Brave', path: '/opt/brave.com/brave/brave' },
  { kind: 'chromium', name: 'Chromium', path: '/snap/bin/chromium' },
];

const MAC_BUNDLE_IDS: Array<{ id: string; kind: BrowserKind }> = [
  { id: 'com.google.Chrome', kind: 'chrome' },
  { id: 'com.microsoft.edgemac', kind: 'edge' },
  { id: 'com.brave.Browser', kind: 'brave' },
  { id: 'org.chromium.Chromium', kind: 'chromium' },
];

const MAC_APP_META = new Map(DARWIN_APPS.map(a => {
  const rel = a.path.slice(a.path.indexOf('.app/') + '.app/'.length);
  return [a.kind, { name: a.name, rel }] as const;
}));

const APP_PATH_EXES: Array<{ exe: string; kind: BrowserKind; name: string }> = (() => {
  const seen = new Set<string>();
  const rows: Array<{ exe: string; kind: BrowserKind; name: string }> = [];
  for (const w of WINDOWS_RELATIVE) {
    const exe = basename(w.rel.replace(/\\/g, '/'));
    if (seen.has(exe)) continue;
    seen.add(exe);
    rows.push({ exe, kind: w.kind, name: w.name });
  }
  return rows;
})();

const WSL_USER_SKIP = new Set(['Public', 'Default', 'Default User', 'All Users', 'desktop.ini']);

export async function detectBrowsers(env: DetectEnv = realDetectEnv()): Promise<BrowserCandidate[]> {
  const found: BrowserCandidate[] = [];
  const add = (c: BrowserCandidate) => {
    if (env.exists(c.path) && !found.some(f => f.path === c.path)) found.push(c);
  };

  if (env.platform === 'win32') {
    const bases: Record<WinBase, string | undefined> = {
      pf: env.env.ProgramFiles ?? 'C:\\Program Files',
      pf86: env.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      local: env.env.LOCALAPPDATA,
    };
    for (const w of WINDOWS_RELATIVE) {
      for (const b of w.bases) {
        const base = bases[b];
        if (base) add({ kind: w.kind, name: w.name, path: `${base}\\${w.rel}`, viaWsl: false });
      }
    }
  } else if (env.platform === 'darwin') {
    for (const a of DARWIN_APPS) add({ ...a, viaWsl: false });
  } else {
    if (await env.isWsl()) {
      const winBases: Record<WinBase, string[]> = {
        pf: ['/mnt/c/Program Files'],
        pf86: ['/mnt/c/Program Files (x86)'],
        local: env.readDir('/mnt/c/Users')
          .filter(u => !WSL_USER_SKIP.has(u))
          .map(u => `/mnt/c/Users/${u}/AppData/Local`),
      };
      for (const w of WINDOWS_RELATIVE) {
        const rel = w.rel.replace(/\\/g, '/');
        for (const b of w.bases) {
          for (const base of winBases[b]) add({ kind: w.kind, name: w.name, path: `${base}/${rel}`, viaWsl: true });
        }
      }
    }
    const pathDirs = (env.env.PATH ?? '').split(delimiter).filter(Boolean);
    for (const l of LINUX_BINARIES) {
      for (const dir of pathDirs) add({ kind: l.kind, name: l.name, path: join(dir, l.bin), viaWsl: false });
    }
    for (const o of LINUX_OPT_PATHS) add({ ...o, viaWsl: false });
  }

  const wsl = await env.isWsl();

  if (env.platform === 'win32' || (env.platform !== 'darwin' && wsl)) {
    const pending = APP_PATH_EXES.filter(e => !found.some(f => f.kind === e.kind));
    const resolved = await Promise.all(pending.map(async ({ exe, kind, name }) => {
      const out = await env.regQuery(`HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`).catch(() => undefined);
      if (!out) return undefined;
      const match = out.split(/\r?\n/)
        .map(l => l.match(/REG_(?:EXPAND_)?SZ\s+"?(.*?\.exe)"?\s*$/i))
        .find(Boolean);
      if (!match) return undefined;
      let path = match[1].trim();
      if (wsl) path = path.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
      return { kind, name, path, viaWsl: wsl };
    }));
    for (const c of resolved) if (c) add(c);
  }

  if (env.platform === 'darwin') {
    const pending = MAC_BUNDLE_IDS.filter(b => !found.some(f => f.kind === b.kind));
    const resolved = await Promise.all(pending.map(async ({ id, kind }) => {
      const out = await env.mdfind(`kMDItemCFBundleIdentifier == '${id}'`).catch(() => undefined);
      if (!out) return undefined;
      const bundle = out.split(/\r?\n/).map(l => l.trim()).find(Boolean);
      const meta = MAC_APP_META.get(kind);
      if (!bundle || !meta) return undefined;
      return { kind, name: meta.name, path: `${bundle}/${meta.rel}`, viaWsl: false };
    }));
    for (const c of resolved) if (c) add(c);
  }

  for (const p of env.extraPaths) add({ kind: 'custom', name: basename(p), path: p, viaWsl: wsl && p.startsWith('/mnt/') });
  return found;
}
