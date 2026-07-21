import { useEffect, useReducer } from 'react';
import type { EventEmitter } from 'node:events';

export function useEmitterTick(
  emitter: EventEmitter | undefined,
  events: string[],
  pausedRef?: { current: boolean },
  throttleMs = 80,
): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!emitter) return;
    let pending = false;
    let timer: NodeJS.Timeout | undefined;
    const onEvent = () => {
      if (pausedRef?.current) return;
      if (pending) return;
      pending = true;
      timer = setTimeout(() => {
        pending = false;
        if (pausedRef?.current) return;
        bump();
      }, throttleMs);
    };
    for (const e of events) emitter.on(e, onEvent);
    return () => {
      for (const e of events) emitter.off(e, onEvent);
      if (timer) clearTimeout(timer);
    };
  }, [emitter]);
  return tick;
}
