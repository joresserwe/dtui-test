import { useCallback, useReducer, useRef } from 'react';
import { useStdin } from 'ink';
import { editOuterHtml, type EditorOpts, type EditorRunner } from '../lib/editor.js';

export interface EditorSuspend {
  editingRef: React.MutableRefObject<boolean>;
  toastStaleRef: React.MutableRefObject<boolean>;
  whenNotEditing: (fn: () => void) => void;
  withEditor: (initial: string, ext?: string, opts?: EditorOpts) => Promise<string | null>;
}

export function useEditorSuspend(editFn: EditorRunner, clearToast: () => void): EditorSuspend {
  const { stdin: inkStdin, setRawMode, isRawModeSupported } = useStdin();
  const editingRef = useRef(false);
  const [, refreshTick] = useReducer((n: number) => n + 1, 0);
  const deferredRef = useRef<Array<() => void>>([]);
  const toastStaleRef = useRef(false);
  const whenNotEditing = useCallback((fn: () => void) => {
    if (editingRef.current) deferredRef.current.push(fn);
    else fn();
  }, []);
  const withEditor = async (initial: string, ext = 'html', opts?: EditorOpts): Promise<string | null> => {
    if (editingRef.current) return null;
    editingRef.current = true;
    if (isRawModeSupported) setRawMode(false);
    inkStdin?.pause?.();
    try {
      return await editOuterHtml(initial, editFn, undefined, ext, opts);
    } finally {
      inkStdin?.resume?.();
      if (isRawModeSupported) setRawMode(true);
      editingRef.current = false;
      const deferred = deferredRef.current;
      deferredRef.current = [];
      for (const fn of deferred) fn();
      if (toastStaleRef.current) {
        toastStaleRef.current = false;
        clearToast();
      }
      refreshTick();
    }
  };
  return { editingRef, toastStaleRef, whenNotEditing, withEditor };
}
