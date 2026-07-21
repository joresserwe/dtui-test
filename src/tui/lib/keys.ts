import type { Key } from 'ink';

const CSI_REMNANT = /^\[\[?[0-9;?]*[ -/]*[@-~]$/;
const SS3_REMNANT = /^O[@-~]$/;

export function isEscapeRemnant(input: string): boolean {
  return input.includes('\u001b') || CSI_REMNANT.test(input) || SS3_REMNANT.test(input);
}

export type ListNav = (input: string, key: Key, len: number, set: (fn: (i: number) => number) => void, page: number) => boolean;

export function makeListNav(gPending: { current: boolean }): ListNav {
  return (input, key, len, set, page) => {
    const clamp = (i: number) => Math.max(0, Math.min(i, Math.max(0, len - 1)));
    if (key.downArrow || input === 'j') { set(i => clamp(i + 1)); return true; }
    if (key.upArrow || input === 'k') { set(i => clamp(i - 1)); return true; }
    if (key.ctrl && input === 'd') { set(i => clamp(i + page)); return true; }
    if (key.ctrl && input === 'u') { set(i => clamp(i - page)); return true; }
    if (input === 'G') { set(() => clamp(len - 1)); return true; }
    if (input === 'g' && !key.ctrl) {
      if (gPending.current) {
        gPending.current = false;
        set(() => 0);
      } else {
        gPending.current = true;
      }
      return true;
    }
    return false;
  };
}

export type FollowNav = (
  input: string,
  key: Key,
  len: number,
  cur: number,
  page: number,
  apply: (idx: number, follow: boolean) => void,
) => boolean;

export function makeFollowNav(gPending: { current: boolean }): FollowNav {
  return (input, key, len, cur, page, apply) => {
    const clamp = (i: number) => Math.max(0, Math.min(i, Math.max(0, len - 1)));
    const go = (i: number) => {
      const n = clamp(i);
      apply(n, n >= len - 1);
    };
    if (key.downArrow || input === 'j') { go(cur + 1); return true; }
    if (key.upArrow || input === 'k') { go(cur - 1); return true; }
    if (key.ctrl && input === 'd') { go(cur + page); return true; }
    if (key.ctrl && input === 'u') { go(cur - page); return true; }
    if (input === 'G') { go(len - 1); return true; }
    if (input === 'g' && !key.ctrl) {
      if (gPending.current) {
        gPending.current = false;
        go(0);
      } else {
        gPending.current = true;
      }
      return true;
    }
    return false;
  };
}

export function editLine(
  input: string,
  key: Key,
  apply: (fn: (s: string) => string) => void,
  opts: { excludeTab?: boolean } = {},
): boolean {
  if (key.backspace || key.delete) {
    apply(s => s.slice(0, -1));
    return true;
  }
  if (input && !key.ctrl && !key.meta && (!opts.excludeTab || !key.tab)) {
    apply(s => s + input);
    return true;
  }
  return false;
}

export function dispatchInput(input: string, key: Key, handleKey: (input: string, key: Key) => void, batch = true): void {
  if (batch && input.length > 1 && !key.ctrl && !key.meta) {
    if (isEscapeRemnant(input)) return;
    for (const ch of input) handleKey(ch, key);
    return;
  }
  handleKey(input, key);
}
