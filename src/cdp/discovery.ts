import { readFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export interface Endpoint {
  host: string;
  port: number;
  browser: string;
}

export interface DiscoveryEnv {
  isWsl(): Promise<boolean>;
  defaultGateway(): Promise<string | null>;
  fetchFn: typeof fetch;
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

export async function probe(host: string, port: number, fetchFn: typeof fetch): Promise<Endpoint | null> {
  try {
    const res = await fetchFn(`http://${host}:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const v = (await res.json()) as { Browser?: string };
    return { host, port, browser: v.Browser ?? 'unknown' };
  } catch {
    return null;
  }
}

export async function discoverEndpoint(port: number, env: DiscoveryEnv = realEnv()): Promise<Endpoint | null> {
  for (const host of await candidateHosts(env)) {
    const ep = await probe(host, port, env.fetchFn);
    if (ep) return ep;
  }
  return null;
}

export async function scanEndpoints(ports: number[], env: DiscoveryEnv = realEnv()): Promise<Endpoint[]> {
  const hosts = await candidateHosts(env);
  const results = await Promise.all(
    hosts.flatMap(host => ports.map(port => probe(host, port, env.fetchFn))),
  );
  const out: Endpoint[] = [];
  const seen = new Set<string>();
  for (const ep of results) {
    if (!ep) continue;
    const key = `${ep.host}:${ep.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
  }
  return out;
}
