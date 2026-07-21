import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const NET_COLUMN_IDS = ['status', 'method', 'type', 'time', 'size', 'cookies', 'host', 'protocol', 'priority', 'initiator', 'set-cookies', 'remote', 'waterfall', 'name', 'url'] as const;
export type NetColumnId = (typeof NET_COLUMN_IDS)[number];
export const DEFAULT_NET_COLUMNS: NetColumnId[] = ['status', 'type', 'time', 'size', 'waterfall', 'name'];

export function normalizeNetColumns(raw: readonly unknown[]): NetColumnId[] {
  const set = new Set(raw.filter((c): c is NetColumnId => typeof c === 'string' && (NET_COLUMN_IDS as readonly string[]).includes(c)));
  if (set.has('url')) set.delete('name');
  else set.add('name');
  return NET_COLUMN_IDS.filter(c => set.has(c));
}

export const CONSOLE_HISTORY_CAP = 50;

export interface Config {
  browserPaths?: string[];
  port?: number;
  ports?: number[];
  throttle?: 'off' | 'fast3g' | 'slow3g' | 'offline';
  cacheDisabled?: boolean;
  clearOnNav?: boolean;
  harSanitize?: boolean;
  copyRedact?: boolean;
  persistSanitize?: boolean;
  agentCmd?: string;
  bodyCapBytes?: number;
  networkCap?: number;
  sessionCap?: number;
  layout?: 'tabs' | 'split';
  hints?: '2' | '1' | 'off';
  lang?: 'ko' | 'en';
  editor?: string;
  networkColumns?: NetColumnId[];
  // Most recent first.
  consoleHistory?: string[];
}

export function configPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(env.APPDATA ?? homedir(), 'devtools-tui', 'config.json');
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config');
  return join(base, 'devtools-tui', 'config.json');
}

export function loadConfig(file: string = configPath()): Config {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const out: Config = {};
    if (Array.isArray(raw.browserPaths)) {
      const paths = raw.browserPaths.filter((p: unknown): p is string => typeof p === 'string');
      if (paths.length || raw.browserPaths.length === 0) out.browserPaths = paths;
    }
    if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 1 && raw.port <= 65535) out.port = raw.port;
    if (Array.isArray(raw.ports)) {
      const ports = raw.ports.filter(
        (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535,
      );
      if (ports.length) out.ports = ports;
    }
    if (raw.throttle === 'off' || raw.throttle === 'fast3g' || raw.throttle === 'slow3g' || raw.throttle === 'offline') out.throttle = raw.throttle;
    if (typeof raw.cacheDisabled === 'boolean') out.cacheDisabled = raw.cacheDisabled;
    if (typeof raw.clearOnNav === 'boolean') out.clearOnNav = raw.clearOnNav;
    if (typeof raw.harSanitize === 'boolean') out.harSanitize = raw.harSanitize;
    if (typeof raw.copyRedact === 'boolean') out.copyRedact = raw.copyRedact;
    if (typeof raw.persistSanitize === 'boolean') out.persistSanitize = raw.persistSanitize;
    if (typeof raw.agentCmd === 'string' && raw.agentCmd.trim()) out.agentCmd = raw.agentCmd.trim();
    if (typeof raw.bodyCapBytes === 'number') out.bodyCapBytes = raw.bodyCapBytes;
    if (typeof raw.networkCap === 'number' && Number.isInteger(raw.networkCap) && raw.networkCap >= 100 && raw.networkCap <= 5000) out.networkCap = raw.networkCap;
    if (typeof raw.sessionCap === 'number' && Number.isInteger(raw.sessionCap) && raw.sessionCap >= 1 && raw.sessionCap <= 32) out.sessionCap = raw.sessionCap;
    if (raw.layout === 'tabs' || raw.layout === 'split') out.layout = raw.layout;
    if (raw.hints === '2' || raw.hints === '1' || raw.hints === 'off') out.hints = raw.hints;
    if (raw.lang === 'ko' || raw.lang === 'en') out.lang = raw.lang;
    if (typeof raw.editor === 'string' && raw.editor.trim()) out.editor = raw.editor.trim();
    if (Array.isArray(raw.networkColumns)) out.networkColumns = normalizeNetColumns(raw.networkColumns);
    if (Array.isArray(raw.consoleHistory)) {
      out.consoleHistory = raw.consoleHistory
        .filter((s: unknown): s is string => typeof s === 'string')
        .slice(0, CONSOLE_HISTORY_CAP);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveConfig(patch: Partial<Config>, file: string = configPath()): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    current = {};
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2));
}
