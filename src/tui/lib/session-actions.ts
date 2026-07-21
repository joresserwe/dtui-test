import type { DebugSession, ThrottleName } from '../../engine.js';
import type { NetworkEntry } from '../../store/types.js';
import { abbrevPath } from './format.js';
import type { ToastLevel } from './toast-manager.js';
import { t } from './i18n.js';

export const THROTTLE_ORDER: ThrottleName[] = ['off', 'fast3g', 'slow3g', 'offline'];

export const cycleThrottle = (cur: ThrottleName, dir: -1 | 1 = 1): ThrottleName =>
  THROTTLE_ORDER[(THROTTLE_ORDER.indexOf(cur) + dir + THROTTLE_ORDER.length) % THROTTLE_ORDER.length];

export function applyThrottle(
  session: DebugSession,
  next: ThrottleName,
  setThrottleState: (v: ThrottleName) => void,
  setToast: (msg: string, level?: ToastLevel) => void,
): void {
  void session.setThrottle(next).then(
    () => {
      setThrottleState(next);
      setToast(`throttle:${next}`);
    },
    () => setToast(t('toast.throttleFailed'), 'error'),
  );
}

export function applyCacheDisabled(
  session: DebugSession,
  next: boolean,
  setCacheDisabledState: (v: boolean) => void,
  setToast: (msg: string, level?: ToastLevel) => void,
): void {
  void session.setCacheDisabled(next).then(
    () => {
      setCacheDisabledState(next);
      setToast(`nocache:${next ? 'on' : 'off'}`);
    },
    () => setToast(t('toast.nocacheFailed'), 'error'),
  );
}

export function exportSessionHar(
  session: DebugSession,
  exportHarFn: (session: DebugSession, entries?: NetworkEntry[]) => Promise<string>,
  copyFn: (text: string) => Promise<void>,
  setToast: (msg: string, level?: ToastLevel) => void,
  entries?: NetworkEntry[],
): void {
  void exportHarFn(session, entries).then(
    file =>
      copyFn(file).then(
        () => setToast(t('toast.harSavedCopied', { file: abbrevPath(file) }), 'success'),
        () => setToast(t('toast.harSaved', { file: abbrevPath(file) }), 'success'),
      ),
    e => setToast(t('toast.harFailed', { error: e instanceof Error ? e.message : String(e) }), 'error'),
  );
}
