import { useCallback, useRef, useState } from 'react';
import { ToastManager, TOAST_TTL_MS, type ToastEntry, type ToastLevel } from '../lib/toast-manager.js';

export interface ToastSuspendRefs {
  editingRef: { current: boolean };
  toastStaleRef: { current: boolean };
}

export interface Toasts {
  toast: ToastEntry | undefined;
  setToast: (msg: string, level?: ToastLevel) => void;
  clearToast: () => void;
  history: () => ToastEntry[];
  bindSuspend: (refs: ToastSuspendRefs) => void;
}

// The suspend refs arrive via bindSuspend rather than as hook arguments:
// useEditorSuspend needs clearToast at creation time while the expiry timer
// needs the refs useEditorSuspend returns, so neither hook can be called first
// with the other's output.
export function useToasts(): Toasts {
  const managerRef = useRef<ToastManager | null>(null);
  if (!managerRef.current) managerRef.current = new ToastManager();
  const manager = managerRef.current;
  const [toast, setEntry] = useState<ToastEntry | undefined>();
  const timer = useRef<NodeJS.Timeout | undefined>(undefined);
  const suspendRef = useRef<ToastSuspendRefs | null>(null);
  const bindSuspend = useCallback((refs: ToastSuspendRefs) => {
    suspendRef.current = refs;
  }, []);
  const clearToast = useCallback(() => setEntry(undefined), []);
  const setToast = useCallback((msg: string, level: ToastLevel = 'info') => {
    const suspend = suspendRef.current;
    if (suspend) suspend.toastStaleRef.current = false;
    const entry = manager.push(msg, level);
    // Copy: a dedupe hit mutates the stored entry in place, which React state
    // equality would otherwise swallow.
    setEntry({ ...entry });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const s = suspendRef.current;
      if (s?.editingRef.current) {
        s.toastStaleRef.current = true;
        return;
      }
      setEntry(undefined);
    }, TOAST_TTL_MS[entry.level]);
    timer.current.unref?.();
  }, [manager]);
  const history = useCallback(() => manager.history(), [manager]);
  return { toast, setToast, clearToast, history, bindSuspend };
}
