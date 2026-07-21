import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from '../config.js';

export interface GotoStep { kind: 'goto'; url: string }
export interface NavStep { kind: 'nav'; url: string }
export interface ClickStep { kind: 'click'; selector: string; alt?: { x: number; y: number } }
export interface InputStep { kind: 'input'; selector: string; value?: string; redacted?: boolean }
export interface KeyStep { kind: 'key'; selector: string | null; key: string }
export interface SelectStep { kind: 'select'; selector: string; value: string }
export type Step = GotoStep | NavStep | ClickStep | InputStep | KeyStep | SelectStep;

export interface Recording {
  name: string;
  createdAt: string;
  steps: Step[];
  version: 1;
}

export interface RecordingMeta {
  file: string;
  name: string;
  createdAt: string;
  stepCount: number;
}

const STALE_TMP_MS = 60_000;

export function recordingsDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return join(dirname(configPath(env, platform)), 'recordings');
}

export function recordingSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'recording';
}

function str(v: unknown): v is string {
  return typeof v === 'string';
}

export function parseStep(raw: unknown): Step | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case 'goto':
      return str(s.url) ? { kind: 'goto', url: s.url } : null;
    case 'nav':
      return str(s.url) ? { kind: 'nav', url: s.url } : null;
    case 'click': {
      if (!str(s.selector)) return null;
      const step: ClickStep = { kind: 'click', selector: s.selector };
      const alt = s.alt as Record<string, unknown> | undefined;
      if (alt && typeof alt.x === 'number' && typeof alt.y === 'number') step.alt = { x: alt.x, y: alt.y };
      return step;
    }
    case 'input': {
      if (!str(s.selector)) return null;
      if (s.redacted === true) return { kind: 'input', selector: s.selector, redacted: true };
      return str(s.value) ? { kind: 'input', selector: s.selector, value: s.value } : null;
    }
    case 'key':
      if (!str(s.key)) return null;
      if (s.selector !== null && !str(s.selector)) return null;
      return { kind: 'key', selector: (s.selector as string | null) ?? null, key: s.key };
    case 'select':
      return str(s.selector) && str(s.value) ? { kind: 'select', selector: s.selector, value: s.value } : null;
    default:
      return null;
  }
}

export function parseRecording(raw: unknown): Recording | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !str(r.name) || !Array.isArray(r.steps)) return null;
  const createdAt = str(r.createdAt) ? r.createdAt : new Date(0).toISOString();
  const steps = r.steps.map(parseStep).filter((s): s is Step => s !== null);
  return { name: r.name, createdAt, steps, version: 1 };
}

function cleanStaleTmp(dir: string, now = Date.now()): void {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json.tmp')) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > STALE_TMP_MS) unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

export function listRecordings(dir: string): RecordingMeta[] {
  if (!existsSync(dir)) return [];
  cleanStaleTmp(dir);
  const metas: RecordingMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const parsed = tryLoad(join(dir, name));
    if (parsed) metas.push({ file: name, name: parsed.name, createdAt: parsed.createdAt, stepCount: parsed.steps.length });
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function tryLoad(file: string): Recording | null {
  try {
    return parseRecording(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

export function loadRecording(dir: string, file: string): Recording | undefined {
  return tryLoad(join(dir, file)) ?? undefined;
}

function uniqueFile(dir: string, base: string): string {
  let name = `${base}.json`;
  let n = 2;
  while (existsSync(join(dir, name))) name = `${base}-${n++}.json`;
  return name;
}

export function saveRecording(dir: string, rec: Recording, file?: string): string {
  mkdirSync(dir, { recursive: true });
  const target = file ?? uniqueFile(dir, recordingSlug(rec.name));
  const dest = join(dir, target);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(persistable(rec)));
  renameSync(tmp, dest);
  return target;
}

function persistable(rec: Recording): Recording {
  return {
    name: rec.name,
    createdAt: rec.createdAt,
    version: 1,
    steps: rec.steps.map(step => {
      if (step.kind === 'input' && step.redacted) return { kind: 'input', selector: step.selector, redacted: true };
      return step;
    }),
  };
}

export function renameRecording(dir: string, file: string, name: string): void {
  const current = loadRecording(dir, file);
  if (!current) return;
  saveRecording(dir, { ...current, name }, file);
}

export function deleteRecording(dir: string, file: string): void {
  try {
    unlinkSync(join(dir, file));
  } catch {
    /* ignore */
  }
}
