import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lhr } from './types.js';

export const AUDIT_FILE_RE = /^audit-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;
const AUDIT_TMP_RE = /^audit-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json\.tmp$/;
const STALE_TMP_MS = 60_000;

export function auditFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `audit-${stamp}.json`;
}

export function saveAudit(dir: string, lhr: Lhr, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, auditFileName(now));
  writeFileSync(file, JSON.stringify(lhr));
  return file;
}

export function listAudits(dir: string, now = Date.now()): string[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  for (const name of names) {
    if (!AUDIT_TMP_RE.test(name)) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > STALE_TMP_MS) unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  return names
    .filter(name => AUDIT_FILE_RE.test(name))
    .sort()
    .reverse();
}

export function loadAudit(file: string): Lhr {
  return JSON.parse(readFileSync(file, 'utf8')) as Lhr;
}

function tryLoadAudit(file: string): Lhr | undefined {
  try {
    const parsed: unknown = loadAudit(file);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Lhr) : undefined;
  } catch {
    return undefined;
  }
}

export function loadLatestAudit(dir: string): { name: string; lhr: Lhr } | undefined {
  for (const name of listAudits(dir)) {
    const lhr = tryLoadAudit(join(dir, name));
    if (lhr) return { name, lhr };
  }
  return undefined;
}

export function loadSessionAudit(dir: string, name?: string): Lhr | undefined {
  if (name === undefined) return loadLatestAudit(dir)?.lhr;
  if (!AUDIT_FILE_RE.test(name)) return undefined;
  const file = join(dir, name);
  if (!existsSync(file)) return undefined;
  return tryLoadAudit(file);
}
