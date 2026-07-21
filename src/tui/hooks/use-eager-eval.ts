import { useEffect, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';

export interface EagerEvalOpts {
  session: DebugSession | undefined;
  editing: boolean;
  draft: string;
  contextId?: number;
  whenNotEditing: (fn: () => void) => void;
  debounceMs?: number;
}

export function useEagerEval({ session, editing, draft, contextId, whenNotEditing, debounceMs = 150 }: EagerEvalOpts): string | undefined {
  const [preview, setPreview] = useState<string | null>(null);
  const seq = useRef(0);
  const expr = draft.trim();

  useEffect(() => {
    setPreview(null);
    if (!editing || !session || !expr) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      void session.evaluateEager(expr, contextId).then(res => {
        whenNotEditing(() => {
          if (seq.current === id) setPreview(res);
        });
      });
    }, debounceMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  }, [editing, session, expr, contextId, debounceMs, whenNotEditing]);

  return preview !== null && preview !== expr ? preview : undefined;
}
