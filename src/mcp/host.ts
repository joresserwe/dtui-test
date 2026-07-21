import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LineDecoder, encodeFrame } from './rpc.js';
import type { AuditRunParams, MaybePromise, RecorderReplayResult, ScreenshotResult, SessionInfo, TabInfo } from './source.js';
import type { SelectedElementData } from '../tui/lib/handoff.js';
import type { ConsoleEntry, NetworkEntry } from '../store/types.js';
import type { Lhr } from '../audit/types.js';

export type StrippedNetworkEntry = Omit<NetworkEntry, 'body' | 'bodyBase64' | 'bodyTruncated' | 'postData' | 'wsFrames'>;

export interface HostDelegate {
  listSessions(): MaybePromise<SessionInfo[]>;
  readNetwork(id: string): MaybePromise<StrippedNetworkEntry[]>;
  readRequest(session: string, id: string): MaybePromise<NetworkEntry | undefined>;
  readConsole(id: string): MaybePromise<ConsoleEntry[]>;
  listTabs(): MaybePromise<TabInfo[]>;
  selectedElement(): MaybePromise<SelectedElementData>;
  screenshot(target: 'viewport' | 'element', session?: string): MaybePromise<ScreenshotResult>;
  readAudit?(session: string, name?: string): MaybePromise<Lhr | undefined>;
  auditRun?(args: AuditRunParams): MaybePromise<Lhr>;
  recorderReplay?(name: string, timeoutMs?: number): MaybePromise<RecorderReplayResult>;
}

export function socketDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, 'devtools-tui');
  const base = env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share');
  return join(base, 'devtools-tui', 'run');
}

export function socketPath(pid: number = process.pid, dir: string = socketDir()): string {
  return join(dir, `${pid}.sock`);
}

export interface LiveHost {
  path: string;
  close(): Promise<void>;
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(path);
  });
}

async function dispatch(delegate: HostDelegate | null, method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'ping') return { ok: true, pid: process.pid };
  if (!delegate) throw new Error('TUI not ready');
  switch (method) {
    case 'list_sessions': {
      const rows = await delegate.listSessions();
      const limit = typeof params.limit === 'number' ? params.limit : undefined;
      return limit !== undefined ? rows.slice(0, limit) : rows;
    }
    case 'read_network':
      return delegate.readNetwork(String(params.id ?? ''));
    case 'read_request':
      return delegate.readRequest(String(params.session ?? ''), String(params.id ?? ''));
    case 'read_console':
      return delegate.readConsole(String(params.id ?? ''));
    case 'list_tabs':
      return delegate.listTabs();
    case 'selected_element':
      return delegate.selectedElement();
    case 'screenshot': {
      const target = params.target === 'element' ? 'element' : 'viewport';
      const session = typeof params.session === 'string' ? params.session : undefined;
      return delegate.screenshot(target, session);
    }
    case 'read_audit': {
      if (!delegate.readAudit) throw new Error('stored audits are not available from this TUI');
      const name = typeof params.name === 'string' ? params.name : undefined;
      return delegate.readAudit(String(params.id ?? ''), name);
    }
    case 'audit_run': {
      if (!delegate.auditRun) throw new Error('audit_run is not available from this TUI');
      return delegate.auditRun({
        session: typeof params.session === 'string' ? params.session : undefined,
        preset: params.preset === 'desktop' ? 'desktop' : params.preset === 'mobile' ? 'mobile' : undefined,
        categories: Array.isArray(params.categories) ? params.categories.map(String) : undefined,
      });
    }
    case 'recorder_replay': {
      if (!delegate.recorderReplay) throw new Error('recorder_replay is not available from this TUI');
      const timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined;
      return delegate.recorderReplay(String(params.name ?? ''), timeoutMs);
    }
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

const SUN_PATH_MAX = 103;

export async function startLiveHost(
  getDelegate: () => HostDelegate | null,
  path: string = socketPath(),
): Promise<LiveHost> {
  if (Buffer.byteLength(path, 'utf8') > SUN_PATH_MAX) {
    console.error(`devtools-tui: socket path exceeds the unix-socket length limit, live MCP bridge unavailable: ${path}`);
  }
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    const decoder = new LineDecoder();
    socket.on('data', chunk => {
      for (const frame of decoder.push(chunk)) {
        const id = frame.id;
        if (typeof id !== 'number' || typeof frame.method !== 'string') continue;
        const params = typeof frame.params === 'object' && frame.params !== null ? (frame.params as Record<string, unknown>) : {};
        void Promise.resolve()
          .then(() => dispatch(getDelegate(), frame.method as string, params))
          .then(
            result => socket.write(encodeFrame({ id, result })),
            e => socket.write(encodeFrame({ id, error: e instanceof Error ? e.message : String(e) })),
          );
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  try {
    await listen(server, path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    rmSync(path, { force: true });
    await listen(server, path);
  }
  chmodSync(path, 0o600);
  return {
    path,
    close: () =>
      new Promise<void>(resolve => {
        for (const s of sockets) s.destroy();
        server.close(() => {
          rmSync(path, { force: true });
          resolve();
        });
      }),
  };
}
