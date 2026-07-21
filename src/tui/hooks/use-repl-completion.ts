import { useEffect, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';
import { COMMAND_LINE_API, completionContext, rankCandidates, type ReplCandidate } from '../lib/repl-complete.js';

export const REPL_CANDIDATE_CAP = 50;

export interface ReplCompletionOpts {
  session: DebugSession | undefined;
  editing: boolean;
  draft: string;
  history: string[];
  contextId?: number;
  whenNotEditing: (fn: () => void) => void;
  onAccept: (next: string) => void;
  debounceMs?: number;
}

const kindOf = (type?: string): ReplCandidate['kind'] => (type === 'function' ? 'function' : 'property');

export function useReplCompletion({ session, editing, draft, history, contextId, whenNotEditing, onAccept, debounceMs = 120 }: ReplCompletionOpts) {
  const ctx = editing ? completionContext(draft) : null;
  const eligible = !!ctx && (ctx.base !== null || ctx.token.length >= 1);
  const fetchKey = ctx && eligible ? (ctx.base !== null ? `p:${ctx.base}` : 'g') : null;
  const [fetched, setFetched] = useState<{ key: string; items: ReplCandidate[] } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (editing) return;
    setArmed(false);
    setFetched(null);
    setSel(null);
  }, [editing]);

  useEffect(() => {
    setSel(null);
  }, [draft]);

  useEffect(() => {
    if (!editing || !session || !fetchKey || fetched?.key === fetchKey) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      void (async () => {
        let items: ReplCandidate[] = [];
        if (fetchKey.startsWith('p:')) {
          const props = await session.evaluateForCompletion(fetchKey.slice(2), contextId);
          items = (props ?? []).map(p => ({ name: p.name, kind: kindOf(p.type), source: 'property' as const }));
        } else {
          const [props, lexical] = await Promise.all([
            session.evaluateForCompletion('globalThis', contextId),
            session.globalLexicalScopeNames(),
          ]);
          items = [
            ...(props ?? []).map(p => ({ name: p.name, kind: kindOf(p.type), source: 'global' as const })),
            ...lexical.map(name => ({ name, source: 'global' as const })),
            ...COMMAND_LINE_API.map(name => ({ name, source: 'global' as const })),
          ];
        }
        whenNotEditing(() => {
          if (seq.current === id) setFetched({ key: fetchKey, items });
        });
      })();
    }, debounceMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  }, [editing, session, fetchKey, fetched?.key, contextId, debounceMs, whenNotEditing]);

  const raw = fetched && fetchKey && fetched.key === fetchKey ? fetched.items : [];
  const withHistory = ctx && ctx.base === null
    ? [...raw, ...history.map(name => ({ name, source: 'history' as const }))]
    : raw;
  const items = eligible && ctx ? rankCandidates(withHistory, ctx.token, REPL_CANDIDATE_CAP) : [];
  const visible = armed && eligible && !!ctx && items.length > 0 && !(items.length === 1 && items[0].name === ctx.token);

  const move = (dir: -1 | 1) => {
    if (!items.length) return;
    setSel(s => {
      if (s === null) return dir === 1 ? 0 : items.length - 1;
      return Math.max(0, Math.min(items.length - 1, s + dir));
    });
  };

  const accept = () => {
    if (!ctx || !items.length) return;
    const cand = items[Math.min(sel ?? 0, items.length - 1)];
    setArmed(false);
    onAccept(draft.slice(0, ctx.start) + cand.name);
  };

  return {
    items,
    sel,
    visible,
    tokenStart: ctx?.start ?? 0,
    arm: () => setArmed(true),
    dismiss: () => setArmed(false),
    move,
    accept,
  };
}

export type ReplCompletion = ReturnType<typeof useReplCompletion>;
