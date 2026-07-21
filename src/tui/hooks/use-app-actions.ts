import { activatePage, closePage } from '../../cdp/targets.js';
import type { DebugSession } from '../../engine.js';
import type { MultiTabs } from '../lib/multi-tabs.js';
import type { NetworkEntry } from '../../store/types.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { buildContext } from '../lib/session-context.js';
import { abbrevPath } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { Attached, SessionEntry, SessionKey } from './use-session-manager.js';
import type { NetworkTool } from './use-network-tool.js';

export interface AppActionDeps {
  tabs: MultiTabs;
  attached: Attached | null;
  active: SessionEntry | null;
  closeSession: (key: SessionKey) => Promise<boolean>;
  closeArm: string | null;
  setCloseArm: React.Dispatch<React.SetStateAction<string | null>>;
  armClose: (token: string) => void;
  setToast: (msg: string, level?: ToastLevel) => void;
  copyFn: (text: string) => Promise<void>;
  snapshotFn: (session: DebugSession) => Promise<string>;
  selEntry: NetworkEntry | undefined;
  net: NetworkTool;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHelpScroll: React.Dispatch<React.SetStateAction<number>>;
  setPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPickerQuery: React.Dispatch<React.SetStateAction<string>>;
  setPickerSel: React.Dispatch<React.SetStateAction<number>>;
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPaletteQuery: React.Dispatch<React.SetStateAction<string>>;
  setPaletteSel: React.Dispatch<React.SetStateAction<number>>;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNotifSel: React.Dispatch<React.SetStateAction<number>>;
  setSessionControlOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSessionControlSel: React.Dispatch<React.SetStateAction<number>>;
}

export function useAppActions(deps: AppActionDeps) {
  const {
    tabs,
    attached,
    active,
    closeSession,
    closeArm,
    setCloseArm,
    armClose,
    setToast,
    copyFn,
    snapshotFn,
    selEntry,
    net,
    setHelpOpen,
    setHelpScroll,
    setPickerOpen,
    setPickerQuery,
    setPickerSel,
    setPaletteOpen,
    setPaletteQuery,
    setPaletteSel,
    setNotifOpen,
    setNotifSel,
    setSessionControlOpen,
    setSessionControlSel,
  } = deps;

  // Session first, then the browser tab: closing the page first would trip the
  // session's reconnect loop and produce a second tab-closed toast.
  const closeSessionTab = (entry: SessionEntry) => {
    const name = entry.target.title || entry.target.url;
    const saved = !!entry.session.sessionDir;
    void (async () => {
      await closeSession(entry.key);
      await closePage(entry.ep, entry.target.id).catch(() => {});
      void tabs.refresh();
      setToast(t(saved ? 'toast.tabClosedSaved' : 'toast.tabClosed', { name }), 'success');
    })();
  };

  const openHelp = () => {
    setHelpScroll(0);
    setHelpOpen(true);
  };
  const openTabPicker = () => {
    setPickerQuery('');
    setPickerSel(0);
    setPickerOpen(true);
  };
  const openPalette = () => {
    setPaletteQuery('');
    setPaletteSel(0);
    setPaletteOpen(true);
  };
  const openNotifications = () => {
    setNotifSel(0);
    setNotifOpen(true);
  };
  const openSessionControl = () => {
    if (!active) {
      setToast(t('toast.noAttachedTab'));
      return;
    }
    setSessionControlSel(0);
    setSessionControlOpen(true);
  };
  const focusBrowser = () => {
    if (!attached) {
      setToast(t('toast.noAttachedTab'));
      return;
    }
    void activatePage(attached.ep, attached.target.id).then(
      () => setToast(t('toast.tabActivated'), 'success'),
      () => setToast(t('toast.tabActivateFailed'), 'error'),
    );
  };
  const closeActiveSession = () => {
    const entry = active;
    if (!entry) {
      setToast(t('toast.noAttachedTab'));
      return;
    }
    const saved = !!entry.session.sessionDir;
    void closeSession(entry.key).then(ok => {
      if (ok) setToast(t(saved ? 'toast.sessionClosed' : 'toast.sessionEnded'), 'success');
    });
  };
  const armOrCloseActiveTab = () => {
    const entry = active;
    if (!entry) {
      setToast(t('toast.noAttachedTab'));
      return;
    }
    if (closeArm !== entry.key) {
      armClose(entry.key);
      setToast(t('toast.confirmCloseTab'));
      return;
    }
    setCloseArm(null);
    closeSessionTab(entry);
  };
  const reloadPage = () => {
    if (!attached) return;
    void attached.session.reload().then(() => setToast(t('toast.reloaded'), 'success'), () => setToast(t('toast.reloadFailed'), 'error'));
  };
  const copyContextAction = () => {
    if (!attached) return;
    void copyFn(buildContext(attached.target, attached.session, selEntry)).then(
      () => setToast(t('toast.contextCopied'), 'success'),
      () => setToast(t('toast.copyFailed'), 'error'),
    );
  };
  const takeSnapshot = () => {
    if (!attached) return;
    setToast(t('toast.snapshotCapturing'));
    void snapshotFn(attached.session).then(
      dir =>
        copyFn(dir).then(
          () => setToast(t('toast.snapshotSavedCopied', { dir: abbrevPath(dir) }), 'success'),
          () => setToast(t('toast.snapshotSaved', { dir: abbrevPath(dir) }), 'success'),
        ),
      e => setToast(t('toast.snapshotFailed', { error: e instanceof Error ? e.message : String(e) }), 'error'),
    );
  };
  const openNetSearch = () => {
    net.setSearchDraft(net.searchQuery);
    net.setSearchEditing(true);
  };

  return {
    closeSessionTab,
    openHelp,
    openTabPicker,
    openPalette,
    openNotifications,
    openSessionControl,
    focusBrowser,
    closeActiveSession,
    armOrCloseActiveTab,
    reloadPage,
    copyContextAction,
    takeSnapshot,
    openNetSearch,
  };
}
