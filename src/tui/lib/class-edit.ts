import { HIDE_CLASS } from '../../cdp/dom.js';

export interface ClassEntry {
  name: string;
  on: boolean;
}

export function parseClassEntries(classAttr: string | undefined): ClassEntry[] {
  const seen = new Set<string>();
  const out: ClassEntry[] = [];
  for (const token of (classAttr ?? '').split(/\s+/)) {
    if (!token || token === HIDE_CLASS || seen.has(token)) continue;
    seen.add(token);
    out.push({ name: token, on: true });
  }
  return out;
}

export function composeClassAttr(entries: ClassEntry[], currentAttr: string | undefined): string {
  const managed = new Set(entries.map(e => e.name));
  const out: string[] = [];
  for (const e of entries) if (e.on) out.push(e.name);
  for (const token of (currentAttr ?? '').split(/\s+/)) {
    if (token && !managed.has(token) && !out.includes(token)) out.push(token);
  }
  return out.join(' ');
}

export function isClassToken(name: string): boolean {
  return /^[^\s"'`]+$/.test(name);
}

export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}
