import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';
import {
  deleteRecording,
  listRecordings,
  loadRecording,
  recordingsDir,
  renameRecording,
  saveRecording,
  type RecordingMeta,
  type Step,
} from '../../store/recording.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';
import type { Attached } from './use-session-manager.js';

export interface RecorderPrompt {
  kind: 'name' | 'rename' | 'password';
  value: string;
  steps?: Step[];
  file?: string;
}

export interface RecorderToolOpts {
  attached: Attached | null;
  notify: (msg: string, level?: ToastLevel) => void;
  whenNotEditing?: (fn: () => void) => void;
}

export function useRecorderTool({ attached, notify, whenNotEditing = fn => fn() }: RecorderToolOpts) {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [recManagerOpen, setRecManagerOpen] = useState(false);
  const [recDetail, setRecDetail] = useState<{ file: string; name: string; steps: Step[] } | null>(null);
  const [recPrompt, setRecPrompt] = useState<RecorderPrompt | null>(null);
  const [recState, setRecState] = useState<{ recording: boolean; steps: number }>({ recording: false, steps: 0 });
  const [recReplaying, setRecReplaying] = useState(false);

  const guard = useRef(whenNotEditing);
  guard.current = whenNotEditing;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const dirRef = useRef(recordingsDir());
  const passwordResolverRef = useRef<((v: string | null) => void) | null>(null);

  const refreshRecordings = useCallback(() => {
    setRecordings(listRecordings(dirRef.current));
  }, []);

  useEffect(() => {
    refreshRecordings();
  }, [refreshRecordings]);

  useEffect(() => {
    const session = attached?.session;
    if (!session) {
      setRecState({ recording: false, steps: 0 });
      return;
    }
    const update = () => guard.current(() => setRecState({ recording: session.isRecording, steps: session.recordingStepCount }));
    update();
    session.on('rec-step', update);
    return () => {
      session.off('rec-step', update);
      const pending = passwordResolverRef.current;
      passwordResolverRef.current = null;
      pending?.(null);
    };
  }, [attached?.session]);

  const start = useCallback((session: DebugSession) => {
    void session.startRecording().then(
      () => notifyRef.current(t('rec.toast.started')),
      () => notifyRef.current(t('rec.toast.startFailed'), 'error'),
    );
  }, []);

  const stop = useCallback((session: DebugSession) => {
    void session.stopRecording().then(steps => guard.current(() => {
      if (steps.filter(s => s.kind !== 'goto' && s.kind !== 'nav').length === 0) {
        notifyRef.current(t('rec.toast.empty'));
        return;
      }
      setRecPrompt({ kind: 'name', value: '', steps });
    }));
  }, []);

  const saveNamed = useCallback((name: string, steps: Step[]): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      notifyRef.current(t('rec.toast.nameRequired'));
      return false;
    }
    try {
      saveRecording(dirRef.current, { name: trimmed, createdAt: new Date().toISOString(), steps, version: 1 });
      notifyRef.current(t('rec.toast.saved', { name: trimmed }), 'success');
      refreshRecordings();
    } catch {
      notifyRef.current(t('rec.toast.saveFailed'), 'error');
    }
    return true;
  }, [refreshRecordings]);

  const openManager = useCallback(() => {
    refreshRecordings();
    setRecDetail(null);
    setRecManagerOpen(true);
  }, [refreshRecordings]);

  const openDetail = useCallback((file: string) => {
    const rec = loadRecording(dirRef.current, file);
    if (!rec) {
      notifyRef.current(t('rec.toast.loadFailed'), 'error');
      return;
    }
    setRecDetail({ file, name: rec.name, steps: rec.steps });
  }, []);

  const replay = useCallback((session: DebugSession, file: string) => {
    const rec = loadRecording(dirRef.current, file);
    if (!rec) {
      notifyRef.current(t('rec.toast.loadFailed'), 'error');
      return;
    }
    setRecManagerOpen(false);
    setRecDetail(null);
    setRecReplaying(true);
    notifyRef.current(t('rec.toast.replaying', { name: rec.name }));
    const resolveRedacted = (_step: Step, _index: number): Promise<string | null> =>
      new Promise(resolve => {
        passwordResolverRef.current = resolve;
        guard.current(() => setRecPrompt({ kind: 'password', value: '' }));
      });
    void session.replayRecording(rec.steps, { resolveRedacted }).then(
      failure => guard.current(() => {
        setRecReplaying(false);
        if (failure) notifyRef.current(t('rec.toast.replayFailed', { step: String(failure.stepIndex + 1), reason: failure.reason }), 'error');
        else notifyRef.current(t('rec.toast.replayed', { name: rec.name }), 'success');
      }),
      e => guard.current(() => {
        setRecReplaying(false);
        notifyRef.current(t('rec.toast.replayFailed', { step: '?', reason: e instanceof Error ? e.message : String(e) }), 'error');
      }),
    );
  }, []);

  const submitPassword = useCallback((value: string | null) => {
    const resolve = passwordResolverRef.current;
    passwordResolverRef.current = null;
    setRecPrompt(null);
    resolve?.(value);
  }, []);

  const renameRec = useCallback((file: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    renameRecording(dirRef.current, file, trimmed);
    notifyRef.current(t('rec.toast.renamed'), 'success');
    refreshRecordings();
  }, [refreshRecordings]);

  const deleteRec = useCallback((file: string) => {
    deleteRecording(dirRef.current, file);
    notifyRef.current(t('rec.toast.deleted'), 'success');
    refreshRecordings();
  }, [refreshRecordings]);

  return {
    recordings,
    hasRecordings: recordings.length > 0,
    recManagerOpen,
    setRecManagerOpen,
    recDetail,
    setRecDetail,
    openDetail,
    recPrompt,
    setRecPrompt,
    recording: recState.recording,
    recSteps: recState.steps,
    recReplaying,
    refreshRecordings,
    start,
    stop,
    saveNamed,
    openManager,
    replay,
    submitPassword,
    renameRec,
    deleteRec,
  };
}

export type RecorderTool = ReturnType<typeof useRecorderTool>;
