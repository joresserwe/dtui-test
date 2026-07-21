import { EventEmitter } from 'node:events';
import { RingBuffer } from './ring.js';
import { formatConsoleArgs, toConsoleArg } from './console-format.js';
import type { ConsoleArg, ConsoleEntry, ConsoleKind, ExecutionContextInfo } from './types.js';

export function contextTag(ctx: ExecutionContextInfo): string {
  let host = '';
  if (ctx.origin) {
    try {
      host = new URL(ctx.origin).host || ctx.origin;
    } catch {
      host = ctx.origin;
    }
  }
  return host || ctx.name || `ctx#${ctx.id}`;
}

const CONSOLE_KINDS: Record<string, ConsoleKind> = {
  log: 'log', info: 'info', warning: 'warn', error: 'error', debug: 'debug',
  timeEnd: 'timer', trace: 'trace',
};

function richArgs(raw: any[]): ConsoleArg[] | undefined {
  return raw.some(a => a?.objectId || a?.preview) ? raw.map(toConsoleArg) : undefined;
}

// Persisted form: objectIds are protocol handles that die with the session,
// so a JSONL record keeps only the preview/description side of each arg.
export function persistableConsoleEntry(e: ConsoleEntry): ConsoleEntry {
  if (e.id === undefined && !e.args) return e;
  const { id: _id, args, ...rest } = e;
  return { ...rest, ...(args ? { args: args.map(({ objectId: _objectId, ...r }) => r) } : {}) };
}

function formatStack(stackTrace: any): string | undefined {
  const frames = stackTrace?.callFrames;
  if (!frames?.length) return undefined;
  return frames
    .map((f: any) => `    at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1})`)
    .join('\n');
}

export class ConsoleStore extends EventEmitter {
  private ring: RingBuffer<ConsoleEntry>;
  private idSeq = 0;
  private cache: ConsoleEntry[] | null = null;
  ctxLabelFor?: (id: number) => string | undefined;

  constructor(cap = 500) {
    super();
    this.ring = new RingBuffer<ConsoleEntry>(cap);
  }

  handleEvent(method: string, params: any): void {
    let entry: ConsoleEntry | undefined;
    if (method === 'Runtime.consoleAPICalled') {
      const rawArgs: any[] = params.args ?? [];
      const ctxLabel = params.executionContextId !== undefined ? this.ctxLabelFor?.(params.executionContextId) : undefined;
      entry = {
        kind: CONSOLE_KINDS[params.type] ?? 'log',
        text: formatConsoleArgs(rawArgs.map(toConsoleArg)),
        ts: params.timestamp,
        stack: formatStack(params.stackTrace),
        args: richArgs(rawArgs),
        ctxId: params.executionContextId,
        ...(ctxLabel !== undefined ? { ctxLabel } : {}),
        ...(params.type === 'table' ? { table: true } : {}),
      };
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      entry = {
        kind: 'exception',
        text: d.exception?.description ?? d.text,
        ts: params.timestamp,
        url: d.url,
        line: d.lineNumber + 1,
        stack: formatStack(d.stackTrace),
        args: d.exception ? richArgs([d.exception]) : undefined,
      };
    } else if (method === 'Log.entryAdded') {
      const e = params.entry;
      const kind: ConsoleKind = e.level === 'error' ? 'error' : e.level === 'warning' ? 'warn' : 'browser';
      entry = { kind, text: e.text, ts: e.timestamp, url: e.url };
    }
    if (!entry) return;
    this.cache = null;
    const last = this.ring.last();
    // args stay out of this equality: previews are baked into text, so equal
    // text already means equal-looking objects, while objectIds differ on
    // every occurrence and would defeat the collapse.
    if (last && last.kind === entry.kind && last.text === entry.text && last.stack === entry.stack) {
      last.count = (last.count ?? 1) + 1;
      last.ts = entry.ts;
    } else {
      entry.id = ++this.idSeq;
      this.ring.push(entry);
    }
    // Emitted per occurrence even when collapsed: the JSONL writer listens
    // here and must record every occurrence.
    this.emit('entry', entry);
  }

  // Synthesized entries (REPL echo/result) bypass the repeat-collapse: each
  // run is a distinct row even when the text repeats.
  push(entry: ConsoleEntry): void {
    entry.id = ++this.idSeq;
    this.cache = null;
    this.ring.push(entry);
    this.emit('entry', entry);
  }

  clear(): void {
    this.cache = null;
    this.ring.clear();
    this.emit('update');
  }

  entries(): ConsoleEntry[] {
    return (this.cache ??= this.ring.items());
  }

  get dropped(): number {
    return this.ring.dropped;
  }
}
