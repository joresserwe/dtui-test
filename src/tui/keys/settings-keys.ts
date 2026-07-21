import type { Key } from 'ink';
import type { Endpoint } from '../../cdp/discovery.js';
import type { DebugSession, ThrottleName } from '../../engine.js';
import { describeSettings, fuzzyFilter, parseSettingValue } from '../../settings.js';
import { loadConfig, saveConfig, type NetColumnId } from '../../config.js';
import type { ListNav } from '../lib/keys.js';
import type { Attached } from '../hooks/use-session-manager.js';
import type { SettingsTool } from '../hooks/use-settings-tool.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { setLang, t } from '../lib/i18n.js';

export interface SettingsKeyCtx {
  settings: SettingsTool;
  attached: Attached | null;
  allSessions: () => DebugSession[];
  ep: Endpoint;
  throttle: ThrottleName;
  bodyH: number;
  listNav: ListNav;
  setToast: (msg: string, level?: ToastLevel) => void;
  setLayout: (layout: 'tabs' | 'split') => void;
  setHintsMode: (mode: '2' | '1' | 'off') => void;
  setNetColumns: (cols: NetColumnId[]) => void;
  setThrottleState: (t: ThrottleName) => void;
  setCacheDisabledState: (v: boolean) => void;
}

export function handleSettingsKey(ctx: SettingsKeyCtx, input: string, key: Key): boolean {
  const { settings, attached, allSessions, ep, throttle, bodyH, listNav, setToast, setLayout, setHintsMode, setNetColumns, setThrottleState, setCacheDisabledState } = ctx;
  const {
    settingsQuery,
    setSettingsQuery,
    setSettingsSearching,
    settingsSel,
    setSettingsSel,
    settingsRows,
    setSettingsRows,
    settingsEditing,
    setSettingsEditing,
    setSettingsErr,
  } = settings;
  const applyValue = (settingKey: string, value: string): boolean => {
    const result = parseSettingValue(settingKey, value);
    if ('error' in result) {
      setSettingsErr(result.error);
      return false;
    }
    saveConfig(result.patch);
    if (result.patch.lang !== undefined) setLang(result.patch.lang);
    if (result.patch.layout !== undefined) setLayout(result.patch.layout);
    if (result.patch.hints !== undefined) setHintsMode(result.patch.hints);
    if (result.patch.networkColumns !== undefined) setNetColumns(result.patch.networkColumns);
    if (result.patch.throttle !== undefined && attached) {
      const next = result.patch.throttle as ThrottleName;
      void attached.session.setThrottle(next).then(
        () => {
          setThrottleState(next);
          setToast(`throttle:${next}`);
        },
        () => setToast(t('toast.throttleFailed'), 'error'),
      );
    }
    if (result.patch.cacheDisabled !== undefined && attached) {
      const next = result.patch.cacheDisabled;
      void attached.session.setCacheDisabled(next).then(
        () => {
          setCacheDisabledState(next);
          setToast(`nocache:${next ? 'on' : 'off'}`);
        },
        () => setToast(t('toast.nocacheFailed'), 'error'),
      );
    }
    if (result.patch.clearOnNav !== undefined && attached) {
      for (const s of allSessions()) s.clearOnNav = result.patch.clearOnNav;
      setToast(`clearOnNav:${result.patch.clearOnNav ? 'on' : 'off'}`);
    }
    if (result.patch.harSanitize !== undefined && attached) {
      for (const s of allSessions()) s.harSanitize = result.patch.harSanitize;
      setToast(`harSanitize:${result.patch.harSanitize ? 'on' : 'off'}`);
    }
    if (result.patch.persistSanitize !== undefined && attached) {
      for (const s of allSessions()) s.persistSanitize = result.patch.persistSanitize;
      setToast(`persistSanitize:${result.patch.persistSanitize ? 'on' : 'off'}`);
    }
    if (result.patch.networkCap !== undefined && attached) {
      for (const s of allSessions()) s.network.setCap(result.patch.networkCap);
      setToast(`networkCap:${result.patch.networkCap}`);
    }
    setSettingsRows(describeSettings(loadConfig(), { port: String(ep.port), throttle: (result.patch.throttle as string | undefined) ?? throttle }));
    setSettingsErr(undefined);
    return true;
  };
  if (settingsEditing) {
    if (key.return && applyValue(settingsEditing.key, settingsEditing.value)) {
      setSettingsEditing(null);
    }
    return true;
  }
  if (key.escape) {
    if (settingsQuery) {
      setSettingsQuery('');
      setSettingsSel(0);
    }
    return true;
  }
  if (input === '/') {
    setSettingsSearching(true);
    return true;
  }
  const rows = fuzzyFilter(settingsRows, settingsQuery);
  const row = rows[Math.min(settingsSel, Math.max(0, rows.length - 1))];
  if (row && row.kind === 'enum' && row.options?.length && (input === 'h' || input === 'l' || key.leftArrow || key.rightArrow || key.return)) {
    const dir = input === 'h' || key.leftArrow ? -1 : 1;
    const cur = row.options.indexOf(row.value);
    applyValue(row.key, row.options[(cur + dir + row.options.length) % row.options.length]);
    return true;
  }
  if (key.return) {
    if (row) {
      setSettingsEditing({ key: row.key, value: row.value });
      setSettingsErr(undefined);
    }
    return true;
  }
  const page = Math.max(1, Math.floor((bodyH - 6) / 2));
  if (listNav(input, key, rows.length, setSettingsSel, page)) return true;
  return true;
}
