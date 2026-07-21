import { useEffect, useState } from 'react';
import type { Endpoint } from '../../cdp/discovery.js';
import type { ThrottleName } from '../../engine.js';
import { describeSettings, type SettingRow } from '../../settings.js';
import { loadConfig } from '../../config.js';
import type { Tool } from '../panels/ToolTabs.js';

export interface SettingsToolOpts {
  activeTool: Tool;
  ep: Endpoint;
  throttle: ThrottleName;
}

export function useSettingsTool({ activeTool, ep, throttle }: SettingsToolOpts) {
  const [settingsQuery, setSettingsQuery] = useState('');
  const [settingsSearching, setSettingsSearching] = useState(false);
  const [settingsSel, setSettingsSel] = useState(0);
  const [settingsRows, setSettingsRows] = useState<SettingRow[]>([]);
  const [settingsEditing, setSettingsEditing] = useState<{ key: string; value: string } | null>(null);
  const [settingsErr, setSettingsErr] = useState<string | undefined>();

  useEffect(() => {
    if (activeTool !== 'settings') return;
    setSettingsRows(describeSettings(loadConfig(), { port: String(ep.port), throttle }));
    setSettingsQuery('');
    setSettingsSel(0);
    setSettingsEditing(null);
    setSettingsErr(undefined);
  }, [activeTool]);

  return {
    settingsQuery,
    setSettingsQuery,
    settingsSearching,
    setSettingsSearching,
    settingsSel,
    setSettingsSel,
    settingsRows,
    setSettingsRows,
    settingsEditing,
    setSettingsEditing,
    settingsErr,
    setSettingsErr,
  };
}

export type SettingsTool = ReturnType<typeof useSettingsTool>;
