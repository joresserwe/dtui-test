import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AUDIT_CHILD_SCRIPT } from './child-script.js';
import type { AuditCategoryId, AuditPreset, Lhr } from './types.js';

export interface AuditRunRequest {
  url: string;
  port: number;
  hostname?: string;
  preset: AuditPreset;
  categories: AuditCategoryId[];
  outFile: string;
}

export interface AuditRunOpts {
  onStatus?: (msg: string) => void;
  timeoutMs?: number;
  killGraceMs?: number;
  execPath?: string;
  scriptSource?: string;
  moduleUrls?: LighthouseModuleUrls;
  env?: NodeJS.ProcessEnv;
}

export interface AuditRunHandle {
  done: Promise<Lhr>;
  cancel(): void;
}

export class AuditCanceledError extends Error {
  constructor() {
    super('audit canceled');
    this.name = 'AuditCanceledError';
  }
}

export interface LighthouseModuleUrls {
  lighthouseUrl: string;
  loggerUrl: string;
  desktopConfigUrl: string;
}

export function lighthouseModuleUrls(): LighthouseModuleUrls {
  const req = createRequire(import.meta.url);
  const lighthousePath = req.resolve('lighthouse');
  const fromLighthouse = createRequire(lighthousePath);
  return {
    lighthouseUrl: pathToFileURL(lighthousePath).href,
    loggerUrl: pathToFileURL(fromLighthouse.resolve('lighthouse-logger')).href,
    desktopConfigUrl: pathToFileURL(req.resolve('lighthouse/core/config/desktop-config.js')).href,
  };
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_KILL_GRACE_MS = 5000;
const STDERR_TAIL_BYTES = 4096;

export function runAudit(req: AuditRunRequest, opts: AuditRunOpts = {}): AuditRunHandle {
  const script = opts.scriptSource ?? AUDIT_CHILD_SCRIPT;
  const payload: Record<string, unknown> = { ...req };
  const urls = opts.moduleUrls ?? (opts.scriptSource === undefined ? lighthouseModuleUrls() : undefined);
  if (urls) Object.assign(payload, urls);
  const child = spawn(opts.execPath ?? process.execPath, ['--input-type=module', '-e', script], {
    env: { ...(opts.env ?? process.env), DTUI_AUDIT_REQ: JSON.stringify(payload) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const killChild = () => {
    child.kill('SIGTERM');
    const escalate = setTimeout(() => child.kill('SIGKILL'), opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    escalate.unref?.();
    child.once('exit', () => clearTimeout(escalate));
  };

  let canceled = false;
  let settled = false;
  let stderrTail = '';
  let timer: NodeJS.Timeout | undefined;

  const done = new Promise<Lhr>((resolve, reject) => {
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error(`audit timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)));
      killChild();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let msg: { type?: string; message?: string; outFile?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'status' && msg.message) {
          opts.onStatus?.(msg.message);
        } else if (msg.type === 'error') {
          settle(() => reject(new Error(msg.message ?? 'audit failed')));
        } else if (msg.type === 'done' && msg.outFile) {
          const file = msg.outFile;
          settle(() => {
            readFile(file, 'utf8').then(
              text => resolve(JSON.parse(text) as Lhr),
              e => reject(e instanceof Error ? e : new Error(String(e))),
            );
          });
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    child.on('error', e => settle(() => reject(e)));
    child.on('exit', (code, signal) => {
      settle(() => {
        if (canceled) reject(new AuditCanceledError());
        else {
          const tail = stderrTail.trim();
          reject(new Error(`audit child exited (${signal ?? code})${tail ? `: ${tail.slice(-500)}` : ''}`));
        }
      });
    });
  });

  return {
    done,
    cancel: () => {
      canceled = true;
      killChild();
    },
  };
}
