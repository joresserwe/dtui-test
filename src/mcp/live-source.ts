import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { LineDecoder, encodeFrame } from './rpc.js';
import { socketDir } from './host.js';
import type { LiveExtras, RecorderReplayResult, ScreenshotResult, SessionInfo, SessionSource, TabInfo } from './source.js';
import type { SelectedElementData } from '../tui/lib/handoff.js';
import type { ConsoleEntry, NetworkEntry } from '../store/types.js';
import type { Lhr } from '../audit/types.js';

const CONNECT_TIMEOUT_MS = 1000;
const CALL_TIMEOUT_MS = 15_000;
const AUDIT_RUN_TIMEOUT_MS = 360_000;
const REPLAY_TIMEOUT_MS = 180_000;

export class LiveClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;

  private constructor(private socket: Socket, readonly path: string) {
    const decoder = new LineDecoder();
    socket.on('data', chunk => {
      for (const frame of decoder.push(chunk)) {
        const id = frame.id;
        if (typeof id !== 'number') continue;
        const entry = this.pending.get(id);
        if (!entry) continue;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        if (typeof frame.error === 'string') entry.reject(new Error(frame.error));
        else entry.resolve(frame.result);
      }
    });
    const fail = () => this.abort(new Error('live TUI connection closed; restart the MCP server to fall back to recorded sessions'));
    socket.on('error', fail);
    socket.on('close', fail);
  }

  static connect(path: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<LiveClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(path);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`timed out connecting to ${path}`));
      }, timeoutMs);
      timer.unref?.();
      socket.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');
        resolve(new LiveClient(socket, path));
      });
    });
  }

  private abort(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.socket.destroy();
  }

  call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('live TUI connection closed; restart the MCP server to fall back to recorded sessions'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`live TUI call timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket.write(encodeFrame({ id, method, params }));
    });
  }

  close(): void {
    this.abort(new Error('client closed'));
  }
}

export async function detectLiveClient(dir: string = socketDir()): Promise<LiveClient | null> {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter(name => name.endsWith('.sock'))
    .map(name => join(dir, name))
    .map(path => ({ path, mtime: statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0 }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { path } of candidates) {
    let client: LiveClient;
    try {
      client = await LiveClient.connect(path);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED' || code === 'ENOENT') rmSync(path, { force: true });
      continue;
    }
    try {
      await client.call('ping', {}, 2000);
      return client;
    } catch {
      client.close();
    }
  }
  return null;
}

export class LiveSessionSource implements SessionSource {
  readonly kind = 'live';
  readonly live: LiveExtras;

  constructor(private readonly client: LiveClient) {
    this.live = {
      listTabs: () => this.client.call<TabInfo[]>('list_tabs'),
      selectedElement: () => this.client.call<SelectedElementData>('selected_element'),
      screenshot: (target, session) => this.client.call<ScreenshotResult>('screenshot', { target, session }),
      auditRun: args => this.client.call<Lhr>('audit_run', { ...args }, AUDIT_RUN_TIMEOUT_MS),
      recorderReplay: args =>
        this.client.call<RecorderReplayResult>('recorder_replay', { name: args.name, timeout_ms: args.timeoutMs }, REPLAY_TIMEOUT_MS),
    };
  }

  get path(): string {
    return this.client.path;
  }

  listSessions(limit?: number): Promise<SessionInfo[]> {
    return this.client.call<SessionInfo[]>('list_sessions', limit !== undefined ? { limit } : {});
  }

  readNetwork(id: string): Promise<NetworkEntry[]> {
    return this.client.call<NetworkEntry[]>('read_network', { id });
  }

  readRequest(session: string, id: string): Promise<NetworkEntry | undefined> {
    return this.client.call<NetworkEntry | undefined>('read_request', { session, id });
  }

  readConsole(id: string): Promise<ConsoleEntry[]> {
    return this.client.call<ConsoleEntry[]>('read_console', { id });
  }

  readAudit(id: string, name?: string): Promise<Lhr | undefined> {
    return this.client.call<Lhr | undefined>('read_audit', name !== undefined ? { id, name } : { id });
  }
}
