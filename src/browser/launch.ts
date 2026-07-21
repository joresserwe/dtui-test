import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { candidateHosts, probe, realEnv, relayEndpoint, type Endpoint } from '../cdp/discovery.js';
import { realWslRelayHooks, type WslRelayHooks } from '../cdp/relay.js';
import type { BrowserCandidate } from './detect.js';

export type ProfileMode = 'tool' | 'existing';

export interface LaunchOptions {
  port?: number;
  profile: ProfileMode;
  url?: string;
  timeoutMs?: number;
}

export interface LaunchEnv {
  spawn(cmd: string, args: string[]): void | Promise<void>;
  probe(host: string, port: number): Promise<Endpoint | null>;
  hosts(): Promise<string[]>;
  toolProfileDir(c: BrowserCandidate): Promise<string>;
  delayMs: number;
  wslRelay?: WslRelayHooks;
  relayConnect?(port: number): Promise<Endpoint | null>;
}

export class ProfileRestrictedError extends Error {
  constructor(commandLine?: string) {
    super(`The browser never opened the debugging port on its existing profile — Chrome/Edge 136+ block this. Retrying with an isolated tool profile usually works.${commandLine ? ` (${commandLine})` : ''}`);
    this.name = 'ProfileRestrictedError';
  }
}

export class WslLoopbackError extends Error {
  constructor(commandLine?: string) {
    super(`The browser opened its DevTools port on the Windows side, but WSL cannot reach the Windows loopback and the interop relay could not connect. Workarounds: enable mirrored networking in .wslconfig, add a netsh portproxy for the port, or pass --host with a reachable address.${commandLine ? ` (${commandLine})` : ''}`);
    this.name = 'WslLoopbackError';
  }
}

export function realLaunchEnv(): LaunchEnv {
  return {
    spawn(cmd, args) {
      return new Promise<void>((resolve, reject) => {
        const child = nodeSpawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
        child.once('error', reject);
      });
    },
    probe: (host, port) => probe(host, port, fetch),
    hosts: () => candidateHosts(realEnv()),
    wslRelay: realWslRelayHooks(),
    relayConnect: port => relayEndpoint(port, fetch, realWslRelayHooks()),
    async toolProfileDir(c) {
      if (c.viaWsl) {
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', '$env:LOCALAPPDATA']);
        return `${stdout.trim()}\\devtools-tui\\profiles\\${c.kind}`;
      }
      const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
      const dir = join(base, 'devtools-tui', 'profiles', c.kind);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    delayMs: 500,
  };
}

const sleep = (ms: number) =>
  new Promise<void>(r => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

export async function launchBrowser(c: BrowserCandidate, opts: LaunchOptions, env: LaunchEnv = realLaunchEnv()): Promise<Endpoint> {
  const port = opts.port ?? 9222;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const args = [`--remote-debugging-port=${port}`];
  if (opts.profile === 'tool') {
    args.push(`--user-data-dir=${await env.toolProfileDir(c)}`, '--no-first-run');
  }
  if (opts.url) args.push(opts.url);
  const commandLine = `${c.path} ${args.join(' ')}`;
  try {
    await env.spawn(c.path, args);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)} (${commandLine})`);
  }

  const relay = c.viaWsl && env.wslRelay?.available() ? env.wslRelay : undefined;
  let windowsListening = false;
  const deadline = Date.now() + timeoutMs;
  do {
    for (const host of await env.hosts()) {
      const ep = await env.probe(host, port);
      if (ep) return ep;
    }
    if (relay && (await relay.windowsLoopbackListening(port))) {
      windowsListening = true;
      const ep = await env.relayConnect?.(port);
      if (ep) return ep;
    }
    await sleep(env.delayMs);
  } while (Date.now() < deadline);
  if (windowsListening) throw new WslLoopbackError(commandLine);
  if (opts.profile === 'existing') throw new ProfileRestrictedError(commandLine);
  throw new Error(`${c.name} did not open the debugging port within ${timeoutMs}ms (${commandLine})`);
}
