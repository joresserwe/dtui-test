import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { promisify } from 'node:util';

export interface WslRelay {
  port: number;
  close(): Promise<void>;
}

export interface WslRelayHooks {
  available(): boolean;
  windowsLoopbackListening(port: number): Promise<boolean>;
  ensure(targetPort: number): Promise<WslRelay>;
}

let enabled = true;

export function setWslRelayEnabled(on: boolean): void {
  enabled = on;
}

let wsl: boolean | undefined;

function underWsl(): boolean {
  if (wsl === undefined) {
    try {
      wsl = process.platform === 'linux' && /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
    } catch {
      wsl = false;
    }
  }
  return wsl;
}

function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const PROBE = (port: number) => `
$c = New-Object System.Net.Sockets.TcpClient
try { $c.Connect('127.0.0.1', ${port}); 'listening' } catch { 'closed' } finally { $c.Dispose() }`;

const BRIDGE = (port: number) => `
$ErrorActionPreference = 'Stop'
$c = New-Object System.Net.Sockets.TcpClient
$c.NoDelay = $true
$c.Connect('127.0.0.1', ${port})
$s = $c.GetStream()
$down = $s.CopyToAsync([Console]::OpenStandardOutput())
$up = [Console]::OpenStandardInput().CopyToAsync($s)
[System.Threading.Tasks.Task]::WaitAny(@($down, $up)) | Out-Null
$c.Close()`;

const relays = new Map<number, Promise<WslRelay>>();

function bridge(socket: Socket, targetPort: number): void {
  const child = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', encodeCommand(BRIDGE(targetPort))], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  socket.on('error', () => child.kill());
  child.on('error', () => socket.destroy());
  child.stdin.on('error', () => {});
  child.stdout.on('error', () => {});
  child.once('exit', () => socket.destroy());
  socket.once('close', () => child.kill());
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
}

async function listen(targetPort: number): Promise<WslRelay> {
  const sockets = new Set<Socket>();
  const server: Server = createServer(socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.once('close', () => sockets.delete(socket));
    bridge(socket, targetPort);
  });
  server.unref();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('relay did not bind a port'));
    });
  });
  return {
    port,
    close: () =>
      new Promise<void>(resolve => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

export function realWslRelayHooks(): WslRelayHooks {
  return {
    available: () => enabled && underWsl(),
    async windowsLoopbackListening(port) {
      try {
        const { stdout } = await promisify(execFile)(
          'powershell.exe',
          ['-NoProfile', '-EncodedCommand', encodeCommand(PROBE(port))],
          { timeout: 5000 },
        );
        return stdout.includes('listening');
      } catch {
        return false;
      }
    },
    ensure(targetPort) {
      let relay = relays.get(targetPort);
      if (!relay) {
        relay = listen(targetPort).catch(e => {
          relays.delete(targetPort);
          throw e;
        });
        relays.set(targetPort, relay);
      }
      return relay;
    },
  };
}

export async function closeWslRelays(): Promise<void> {
  const pending = [...relays.values()];
  relays.clear();
  await Promise.all(pending.map(p => p.then(r => r.close()).catch(() => {})));
}
