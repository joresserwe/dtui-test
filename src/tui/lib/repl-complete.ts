export interface ReplCandidate {
  name: string;
  kind?: 'function' | 'property';
  source: 'property' | 'global' | 'history';
}

export const COMMAND_LINE_API: readonly string[] = [
  '$', '$$', '$0', '$1', '$2', '$3', '$4', '$_', '$x',
  'clear', 'copy', 'debug', 'dir', 'dirxml', 'getEventListeners', 'inspect',
  'keys', 'monitor', 'monitorEvents', 'profile', 'profileEnd', 'queryObjects',
  'table', 'undebug', 'unmonitor', 'unmonitorEvents', 'values',
];

export interface CompletionContext {
  // null = bare identifier: complete against globals, not object properties.
  base: string | null;
  token: string;
  // Accepting a candidate replaces draft.slice(start).
  start: number;
}

const CHAIN_RE = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.([A-Za-z_$][\w$]*)?$/;
const BARE_RE = /[A-Za-z_$][\w$]*$/;

function inUnterminatedString(draft: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < draft.length; i++) {
    const c = draft[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    }
  }
  return quote !== null;
}

export function completionContext(draft: string): CompletionContext | null {
  if (inUnterminatedString(draft)) return null;
  const chain = CHAIN_RE.exec(draft);
  if (chain) {
    const token = chain[2] ?? '';
    return { base: chain[1], token, start: draft.length - token.length };
  }
  const bare = BARE_RE.exec(draft);
  if (!bare) return null;
  const start = draft.length - bare[0].length;
  // A dot right before the token means a property context whose base the chain
  // regex could not capture (e.g. `a[0].x`); global candidates would be wrong.
  if (start > 0 && draft[start - 1] === '.') return null;
  return { base: null, token: bare[0], start };
}

const SOURCE_ORDER: Record<ReplCandidate['source'], number> = { property: 0, global: 1, history: 2 };

export function rankCandidates(cands: ReplCandidate[], token: string, cap = 50): ReplCandidate[] {
  const lower = token.toLowerCase();
  const seen = new Map<string, { c: ReplCandidate; tier: number }>();
  for (const c of cands) {
    const tier = c.name.startsWith(token) ? 0
      : c.name.toLowerCase().startsWith(lower) ? 1
      : c.name.toLowerCase().includes(lower) ? 2
      : -1;
    if (tier < 0) continue;
    const prev = seen.get(c.name);
    if (!prev || SOURCE_ORDER[c.source] < SOURCE_ORDER[prev.c.source]) seen.set(c.name, { c, tier });
  }
  return [...seen.values()]
    .sort((a, b) =>
      a.tier - b.tier ||
      SOURCE_ORDER[a.c.source] - SOURCE_ORDER[b.c.source] ||
      (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0))
    .slice(0, cap)
    .map(x => x.c);
}
