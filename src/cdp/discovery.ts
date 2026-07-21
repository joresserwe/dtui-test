import { readFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { realWslRelayHooks, type WslRelayHooks } from './relay.js';

export interface Endpoint {
  host: string;
  port: number;
  browser: string;
  via?: 'wsl-relay';
  targetPort?: number;
}

export interface DiscoveryEnv {
  isWsl(): Promise<boolean>;
  defaultGateway(): Promise<string | null>;
  fetchFn: typeof fetch;
  wslRelay?: WslRelayHooks;
}

export function realEnv(): DiscoveryEnv {
  return {
    async isWsl() {
      try {
        return /microsoft/i.test(await readFile('/proc/version', 'utf8'));
      } catch {
        return false;
      }
    },
    async defaultGateway() {
      try {
        const { stdout } = await promisify(exec)('ip route show default');
        const m = stdout.match(/\bvia\s+(\S+)/);
        return m ? m[1] : null;
      } catch {
        return null;
      }
    },
    fetchFn: fetch,
    wslRelay: realWslRelayHooks(),
  };
}

export async function candidateHosts(env: DiscoveryEnv): Promise<string[]> {
  const hosts = ['127.0.0.1'];
  if (await env.isWsl()) {
    const gw = await env.defaultGateway();
    if (gw) hosts.push(gw);
  }
  return hosts;
}

export async function probe(host: string, port: number, fetchFn: typeof fetch, timeoutMs = 1500): Promise<Endpoint | null> {
  try {
    const res = await fetchFn(`http://${host}:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const v = (await res.json()) as { Browser?: string };
    return { host, port, browser: v.Browser ?? 'unknown' };
  } catch {
    return null;
  }
}

// The first connection through a fresh relay pays its spawn cost (~1s),
// hence the longer probe timeout.
export async function relayEndpoint(port: number, fetchFn: typeof fetch, hooks: WslRelayHooks): Promise<Endpoint | null> {
  try {
    const relay = await hooks.ensure(port);
    const ep = await probe('127.0.0.1', relay.port, fetchFn, 5000);
    return ep ? { ...ep, via: 'wsl-relay', targetPort: port } : null;
  } catch {
    return null;
  }
}

async function relayFallback(port: number, env: DiscoveryEnv): Promise<Endpoint | null> {
  const relay = env.wslRelay;
  if (!relay?.available() || !(await env.isWsl())) return null;
  if (!(await relay.windowsLoopbackListening(port))) return null;
  return relayEndpoint(port, env.fetchFn, relay);
}

export async function discoverEndpoint(port: number, env: DiscoveryEnv = realEnv()): Promise<Endpoint | null> {
  for (const host of await candidateHosts(env)) {
    const ep = await probe(host, port, env.fetchFn);
    if (ep) return ep;
  }
  return relayFallback(port, env);
}

export async function scanEndpoints(ports: number[], env: DiscoveryEnv = realEnv()): Promise<Endpoint[]> {
  const hosts = await candidateHosts(env);
  const results = await Promise.all(
    hosts.flatMap(host => ports.map(port => probe(host, port, env.fetchFn))),
  );
  const out: Endpoint[] = [];
  const seen = new Set<string>();
  const add = (ep: Endpoint | null) => {
    if (!ep) return;
    const key = `${ep.host}:${ep.port}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ep);
  };
  for (const ep of results) add(ep);
  for (const port of new Set(ports)) {
    if (out.some(ep => ep.port === port || ep.targetPort === port)) continue;
    add(await relayFallback(port, env));
  }
  return out;
}
