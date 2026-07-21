import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:net';

const PS_PATH = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const CURL_PATH = '/mnt/c/Windows/System32/curl.exe';

// $ProgressPreference silences PS 5.1 CLIXML progress noise on stderr.
// WaitAny, not WaitAll: the surviving copy pump only unblocks via the closes.
const relayScript = (host: string, port: number) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $client.NoDelay = $true
  $client.Connect('${host}', ${port})
  $net = $client.GetStream()
  $in = [Console]::OpenStandardInput()
  $out = [Console]::OpenStandardOutput()
  $up = $in.CopyToAsync($net, 65536)
  $down = $net.CopyToAsync($out, 65536)
  [System.Threading.Tasks.Task]::WaitAny(@($up, $down)) | Out-Null
  try { $out.Flush() } catch {}
  try { $client.Close() } catch {}
  try { $in.Close() } catch {}
  try { $out.Close() } catch {}
} catch {
  exit 1
}
exit 0
`;

export interface WslRelay {
  port: number;
  close(): Promise<void>;
}

export interface WslRelayHooks {
  available(): boolean;
  windowsLoopbackListening(port: number, timeoutMs?: number): Promise<boolean>;
  ensure(port: number): Promise<WslRelay>;
}

export interface RelayEnv {
  spawnRelay(targetHost: string, targetPort: number): ChildProcess;
}

export function realRelayEnv(): RelayEnv {
  return {
    spawnRelay(targetHost, targetPort) {
      const encoded = Buffer.from(relayScript(targetHost, targetPort), 'utf16le').toString('base64');
      return spawn(PS_PATH, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    },
  };
}

let enabled = true;

export function setWslRelayEnabled(v: boolean): void {
  enabled = v;
}

const active = new Map<number, Promise<WslRelay>>();

export async function startWslRelay(targetPort: number, env: RelayEnv = realRelayEnv()): Promise<WslRelay> {
  const open = new Set<import('node:net').Socket>();
  const server: Server = createServer(socket => {
    open.add(socket);
    socket.once('close', () => open.delete(socket));
    socket.setNoDelay(true);
    const child = env.spawnRelay('127.0.0.1', targetPort);
    socket.on('error', () => {});
    child.stdin?.on('error', () => {});
    child.stdout?.on('error', () => {});
    socket.pipe(child.stdin!);
    child.stdout!.pipe(socket);
    socket.on('close', () => {
      try {
        child.stdin?.end();
      } catch {}
    });
    child.once('exit', () => {
      try {
        socket.end();
      } catch {}
    });
    child.once('error', () => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}

export function ensureWslRelay(targetPort: number, env: RelayEnv = realRelayEnv()): Promise<WslRelay> {
  let relay = active.get(targetPort);
  if (!relay) {
    relay = startWslRelay(targetPort, env);
    relay.catch(() => active.delete(targetPort));
    active.set(targetPort, relay);
  }
  return relay;
}

export async function closeWslRelays(): Promise<void> {
  const pending = [...active.values()];
  active.clear();
  await Promise.all(pending.map(p => p.then(r => r.close()).catch(() => {})));
}

export function realWslRelayHooks(): WslRelayHooks {
  return {
    available() {
      return enabled && process.env.DTUI_NO_WSL_RELAY === undefined && existsSync(PS_PATH);
    },
    windowsLoopbackListening(port, timeoutMs = 2000) {
      const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
      const url = `http://127.0.0.1:${port}/json/version`;
      const [cmd, args] = existsSync(CURL_PATH)
        ? [CURL_PATH, ['-sf', '--max-time', String(secs), url]]
        : [PS_PATH, ['-NoProfile', '-NonInteractive', '-Command', `try{Invoke-WebRequest -UseBasicParsing -TimeoutSec ${secs} '${url}'|Out-Null;exit 0}catch{exit 1}`]];
      return new Promise(resolve => {
        const child = spawn(cmd, args, { stdio: 'ignore' });
        const timer = setTimeout(() => {
          child.kill();
          resolve(false);
        }, timeoutMs + 3000);
        timer.unref?.();
        child.once('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        child.once('exit', code => {
          clearTimeout(timer);
          resolve(code === 0);
        });
      });
    },
    ensure: port => ensureWslRelay(port),
  };
}
