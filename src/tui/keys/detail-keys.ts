import type { Key } from 'ink';
import type { NetworkEntry } from '../../store/types.js';
import { detailTabsFor, type DetailTab, type Line } from '../overlays/DetailOverlay.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';

export interface DetailKeyCtx {
  detailEntry: NetworkEntry;
  detailRich: Line[];
  detailMaxScroll: number;
  detailH: number;
  detailTab: DetailTab;
  msgFilter: string;
  setMsgFilter: (v: string) => void;
  setMsgFilterEditing: (v: boolean) => void;
  gPending: { current: boolean };
  setDetailOpen: (open: boolean) => void;
  setDetailEntry: (entry: NetworkEntry | null) => void;
  setDetailTab: React.Dispatch<React.SetStateAction<DetailTab>>;
  setDetailScroll: React.Dispatch<React.SetStateAction<number>>;
  setDetailWrap: React.Dispatch<React.SetStateAction<boolean>>;
  copyFn: (text: string) => Promise<void>;
  setToast: (msg: string, level?: ToastLevel) => void;
  withEditor: (initial: string, ext?: string, opts?: { readonly?: boolean }) => Promise<string | null>;
}

export function handleDetailKey(ctx: DetailKeyCtx, input: string, key: Key): boolean {
  const { detailEntry, detailRich, detailMaxScroll, detailH, detailTab, msgFilter, setMsgFilter, setMsgFilterEditing, gPending, setDetailOpen, setDetailEntry, setDetailTab, setDetailScroll, setDetailWrap, copyFn, setToast, withEditor } = ctx;
  if (key.escape && detailTab === 'messages' && msgFilter) {
    setMsgFilter('');
    setDetailScroll(0);
    return true;
  }
  if (key.escape || input === 'q') {
    setDetailOpen(false);
    setDetailEntry(null);
    setDetailScroll(0);
    setMsgFilter('');
    return true;
  }
  if (input === '/' && detailTab === 'messages') {
    setMsgFilterEditing(true);
    return true;
  }
  const dTabs = detailTabsFor(detailEntry);
  if (input >= '1' && input <= String(dTabs.length)) {
    setDetailTab(dTabs[Number(input) - 1]);
    setDetailScroll(0);
    return true;
  }
  if (input === 'l' || key.rightArrow) {
    setDetailTab(t => dTabs[(dTabs.indexOf(t) + 1) % dTabs.length]);
    setDetailScroll(0);
    return true;
  }
  if (input === 'h' || key.leftArrow) {
    setDetailTab(t => dTabs[(dTabs.indexOf(t) + dTabs.length - 1) % dTabs.length]);
    setDetailScroll(0);
    return true;
  }
  if (input === 'y') {
    void copyFn(detailRich.map(l => l.text).join('\n')).then(
      () => setToast(t('toast.copied'), 'success'),
      () => setToast(t('toast.copyFailed'), 'error'),
    );
    return true;
  }
  if (input === 'e') {
    void withEditor(detailRich.map(l => l.text).join('\n'), 'txt', { readonly: true });
    return true;
  }
  if (input === 'w') {
    setDetailWrap(w => !w);
    return true;
  }
  const page = Math.max(1, Math.floor(detailH / 2));
  if (key.downArrow || input === 'j') setDetailScroll(s => Math.min(s + 1, detailMaxScroll));
  else if (key.upArrow || input === 'k') setDetailScroll(s => Math.max(0, s - 1));
  else if (key.ctrl && input === 'd') setDetailScroll(s => Math.min(s + page, detailMaxScroll));
  else if (key.ctrl && input === 'u') setDetailScroll(s => Math.max(0, s - page));
  else if (input === 'G') setDetailScroll(detailMaxScroll);
  else if (input === 'g') {
    if (gPending.current) {
      gPending.current = false;
      setDetailScroll(0);
    } else {
      gPending.current = true;
    }
  }
  return true;
}
