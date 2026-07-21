import { theme } from './theme.js';

export type ToastLevel = 'info' | 'success' | 'warn' | 'error';

export interface ToastEntry {
  id: number;
  msg: string;
  level: ToastLevel;
  ts: number;
  count: number;
}

export const TOAST_TTL_MS: Record<ToastLevel, number> = {
  info: 3000,
  success: 3000,
  warn: 5000,
  error: 5000,
};

export const TOAST_ICONS: Record<ToastLevel, string> = {
  info: '',
  success: '✓',
  warn: '⚠',
  error: '✖',
};

export const TOAST_COLORS: Record<ToastLevel, string | undefined> = {
  info: undefined,
  success: theme.ok,
  warn: theme.warn,
  error: theme.err,
};

export const TOAST_HISTORY_CAP = 50;
export const TOAST_DEDUPE_MS = 1000;

export const displayToast = (e: ToastEntry): string => (e.count > 1 ? `${e.msg} ×${e.count}` : e.msg);

export class ToastManager {
  private entries: ToastEntry[] = [];
  private seq = 0;

  push(msg: string, level: ToastLevel = 'info', now = Date.now()): ToastEntry {
    const last = this.entries[this.entries.length - 1];
    if (last && last.msg === msg && last.level === level && now - last.ts <= TOAST_DEDUPE_MS) {
      last.count += 1;
      last.ts = now;
      return last;
    }
    const entry: ToastEntry = { id: this.seq++, msg, level, ts: now, count: 1 };
    this.entries.push(entry);
    if (this.entries.length > TOAST_HISTORY_CAP) this.entries.splice(0, this.entries.length - TOAST_HISTORY_CAP);
    return entry;
  }

  /** Newest first. */
  history(): ToastEntry[] {
    return [...this.entries].reverse();
  }

  get size(): number {
    return this.entries.length;
  }
}
