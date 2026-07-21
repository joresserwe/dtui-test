import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsoleEntry, NetworkEntry } from '../store/types.js';
import type { SelectedElementData } from '../tui/lib/handoff.js';
import type { Lhr } from '../audit/types.js';
import { loadSessionAudit } from '../audit/store.js';

export type MaybePromise<T> = T | Promise<T>;

export interface SessionInfo {
  id: string;
  startedAt: string;
  urlSlug: string;
  path: string;
  networkCount: number;
  consoleCount: number;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
}

export interface ScreenshotResult {
  data: string;
  mimeType: string;
}

export interface AuditRunParams {
  session?: string;
  preset?: 'mobile' | 'desktop';
  categories?: string[];
}

export interface RecordingInfo {
  name: string;
  steps: number;
  createdAt: string;
}

export interface RecorderReplayResult {
  ok: boolean;
  steps: number;
  failure?: { stepIndex: number; kind: string; selector?: string; reason: string };
}

export interface LiveExtras {
  listTabs(): MaybePromise<TabInfo[]>;
  selectedElement(): MaybePromise<SelectedElementData>;
  screenshot(target: 'viewport' | 'element', session?: string): MaybePromise<ScreenshotResult>;
  auditRun?(args: AuditRunParams): MaybePromise<Lhr>;
  recorderReplay?(args: { name: string; timeoutMs?: number }): MaybePromise<RecorderReplayResult>;
}

export interface SessionSource {
  readonly kind: 'files' | 'live';
  readonly live?: LiveExtras;
  listSessions(limit?: number): MaybePromise<SessionInfo[]>;
  readNetwork(id: string): MaybePromise<NetworkEntry[]>;
  readConsole(id: string): MaybePromise<ConsoleEntry[]>;
  readRequest?(session: string, id: string): MaybePromise<NetworkEntry | undefined>;
  readAudit?(id: string, name?: string): MaybePromise<Lhr | undefined>;
}

const STAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(.*))?$/;

export function parseSessionId(id: string): { startedAt?: string; urlSlug: string } {
  const m = STAMP_RE.exec(id);
  if (!m) return { urlSlug: '' };
  return { startedAt: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`, urlSlug: m[5] ?? '' };
}

function countLines(file: string): number {
  if (!existsSync(file)) return 0;
  const buf = Buffer.alloc(64 * 1024);
  const fd = openSync(file, 'r');
  let count = 0;
  try {
    let bytes: number;
    while ((bytes = readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < bytes; i++) if (buf[i] === 0x0a) count++;
    }
  } finally {
    closeSync(fd);
  }
  return count;
}

function readJsonlTail<T>(file: string, maxBytes: number, maxLines: number): T[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  if (size === 0) return [];
  const readBytes = Math.min(size, maxBytes);
  const buf = Buffer.alloc(readBytes);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, readBytes, size - readBytes);
  } finally {
    closeSync(fd);
  }
  let text = buf.toString('utf8');
  if (readBytes < size) {
    const nl = text.indexOf('\n');
    if (nl === -1) return [];
    text = text.slice(nl + 1);
  }
  const out: T[] = [];
  for (const line of text.split('\n').filter(l => l.trim() !== '').slice(-maxLines)) {
    try {
      const value = JSON.parse(line);
      if (typeof value === 'object' && value !== null) out.push(value as T);
    } catch {
      continue;
    }
  }
  return out;
}

export class JsonlSessionSource implements SessionSource {
  readonly kind = 'files';
  private readonly maxBytes: number;
  private readonly maxLines: number;

  constructor(private readonly root: string, opts: { maxBytes?: number; maxLines?: number } = {}) {
    this.maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
    this.maxLines = opts.maxLines ?? 5000;
  }

  listSessions(limit = Infinity): SessionInfo[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const path = join(this.root, d.name);
        const parsed = parseSessionId(d.name);
        return {
          id: d.name,
          path,
          startedAt: parsed.startedAt ?? statSync(path).mtime.toISOString(),
          urlSlug: parsed.urlSlug,
        };
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map(m => ({
        ...m,
        networkCount: countLines(join(m.path, 'network.jsonl')),
        consoleCount: countLines(join(m.path, 'console.jsonl')),
      }));
  }

  readNetwork(id: string): NetworkEntry[] {
    return this.readJsonl<NetworkEntry>(id, 'network.jsonl');
  }

  readConsole(id: string): ConsoleEntry[] {
    return this.readJsonl<ConsoleEntry>(id, 'console.jsonl');
  }

  readAudit(id: string, name?: string): Lhr | undefined {
    return loadSessionAudit(this.sessionDir(id), name);
  }

  private sessionDir(id: string): string {
    const dir = join(this.root, id);
    if (id.includes('/') || id.includes('\\') || id === '.' || id === '..' || !existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`unknown session: ${id}`);
    }
    return dir;
  }

  private readJsonl<T>(id: string, file: string): T[] {
    return readJsonlTail<T>(join(this.sessionDir(id), file), this.maxBytes, this.maxLines);
  }
}
