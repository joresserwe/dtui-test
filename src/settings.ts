import { DEFAULT_NET_COLUMNS, NET_COLUMN_IDS, normalizeNetColumns, type Config } from './config.js';
import { isSubseq } from './tui/lib/format.js';
import { t, type MessageKey } from './tui/lib/i18n.js';

export interface SettingRow {
  key: string;
  value: string;
  source: 'config' | 'default' | 'runtime';
  kind: 'enum' | 'number' | 'text';
  options?: string[];
  description: string;
  section: string;
}

const DEFAULTS = {
  port: '9222',
  ports: '9222',
  throttle: 'off',
  cacheDisabled: 'off',
  clearOnNav: 'off',
  networkColumns: DEFAULT_NET_COLUMNS.join(', '),
  bodyCapBytes: '262144',
  networkCap: '1000',
  harSanitize: 'on',
  copyRedact: 'off',
  browserPaths: '',
  layout: 'tabs',
  lang: 'ko',
  editor: '(env)',
  sessionCap: '8',
  hints: '2',
  persistSanitize: 'off',
  agentCmd: '',
};

type Meta = Pick<SettingRow, 'kind'> & { options?: string[]; section: MessageKey; description: MessageKey };

const META: Record<keyof typeof DEFAULTS, Meta> = {
  port: { kind: 'number', section: 'settings.section.connection', description: 'settings.desc.port' },
  ports: { kind: 'text', section: 'settings.section.connection', description: 'settings.desc.ports' },
  browserPaths: { kind: 'text', section: 'settings.section.connection', description: 'settings.desc.browserPaths' },
  layout: { kind: 'enum', options: ['tabs', 'split'], section: 'settings.section.display', description: 'settings.desc.layout' },
  lang: { kind: 'enum', options: ['ko', 'en'], section: 'settings.section.display', description: 'settings.desc.lang' },
  editor: { kind: 'text', section: 'settings.section.editor', description: 'settings.desc.editor' },
  throttle: { kind: 'enum', options: ['off', 'fast3g', 'slow3g', 'offline'], section: 'settings.section.display', description: 'settings.desc.throttle' },
  cacheDisabled: { kind: 'enum', options: ['off', 'on'], section: 'settings.section.display', description: 'settings.desc.cacheDisabled' },
  clearOnNav: { kind: 'enum', options: ['off', 'on'], section: 'settings.section.display', description: 'settings.desc.clearOnNav' },
  networkColumns: { kind: 'text', section: 'settings.section.display', description: 'settings.desc.networkColumns' },
  bodyCapBytes: { kind: 'number', section: 'settings.section.capture', description: 'settings.desc.bodyCapBytes' },
  networkCap: { kind: 'number', section: 'settings.section.capture', description: 'settings.desc.networkCap' },
  harSanitize: { kind: 'enum', options: ['off', 'on'], section: 'settings.section.capture', description: 'settings.desc.harSanitize' },
  copyRedact: { kind: 'enum', options: ['off', 'on'], section: 'settings.section.capture', description: 'settings.desc.copyRedact' },
  sessionCap: { kind: 'number', section: 'settings.section.capture', description: 'settings.desc.sessionCap' },
  hints: { kind: 'enum', options: ['2', '1', 'off'], section: 'settings.section.display', description: 'settings.desc.hints' },
  persistSanitize: { kind: 'enum', options: ['off', 'on'], section: 'settings.section.capture', description: 'settings.desc.persistSanitize' },
  agentCmd: { kind: 'text', section: 'settings.section.agent', description: 'settings.desc.agentCmd' },
};

type EffectiveKey = 'port' | 'ports' | 'throttle' | 'cacheDisabled' | 'clearOnNav' | 'bodyCapBytes' | 'networkCap' | 'layout' | 'lang' | 'networkColumns';

export function describeSettings(
  config: Config,
  effective: Partial<Record<EffectiveKey, string>> = {},
): SettingRow[] {
  const row = (key: keyof typeof DEFAULTS, configured: string | undefined): SettingRow => {
    const meta = META[key];
    const base = { key, kind: meta.kind, options: meta.options, section: t(meta.section), description: t(meta.description) };
    const override = effective[key as EffectiveKey];
    if (override !== undefined) return { ...base, value: override, source: 'runtime' };
    return configured !== undefined
      ? { ...base, value: configured, source: 'config' }
      : { ...base, value: DEFAULTS[key], source: 'default' };
  };
  return [
    row('port', config.port !== undefined ? String(config.port) : undefined),
    row('ports', config.ports ? config.ports.join(', ') : undefined),
    row('browserPaths', config.browserPaths ? config.browserPaths.join(', ') : undefined),
    row('layout', config.layout),
    row('lang', config.lang),
    row('throttle', config.throttle),
    row('cacheDisabled', config.cacheDisabled !== undefined ? (config.cacheDisabled ? 'on' : 'off') : undefined),
    row('clearOnNav', config.clearOnNav !== undefined ? (config.clearOnNav ? 'on' : 'off') : undefined),
    row('networkColumns', config.networkColumns ? config.networkColumns.join(', ') : undefined),
    row('bodyCapBytes', config.bodyCapBytes !== undefined ? String(config.bodyCapBytes) : undefined),
    row('networkCap', config.networkCap !== undefined ? String(config.networkCap) : undefined),
    row('harSanitize', config.harSanitize !== undefined ? (config.harSanitize ? 'on' : 'off') : undefined),
    row('copyRedact', config.copyRedact !== undefined ? (config.copyRedact ? 'on' : 'off') : undefined),
    // Append-only from here: several tests reach earlier rows by a fixed number of j presses.
    row('editor', config.editor),
    row('sessionCap', config.sessionCap !== undefined ? String(config.sessionCap) : undefined),
    row('hints', config.hints),
    row('persistSanitize', config.persistSanitize !== undefined ? (config.persistSanitize ? 'on' : 'off') : undefined),
    row('agentCmd', config.agentCmd),
  ];
}

export function parseSettingValue(key: string, raw: string): { patch: Partial<Config> } | { error: string } {
  const trimmed = raw.trim();
  if (key === 'port' || key === 'bodyCapBytes') {
    if (!/^\d+$/.test(trimmed)) return { error: t('settings.err.invalid', { key, raw }) };
    const n = Number(trimmed);
    if (n < (key === 'port' ? 1 : 0) || (key === 'port' && n > 65535)) {
      return { error: t('settings.err.invalid', { key, raw }) };
    }
    return { patch: { [key]: n } };
  }
  if (key === 'networkCap') {
    if (!/^\d+$/.test(trimmed)) return { error: t('settings.err.invalid', { key, raw }) };
    const n = Number(trimmed);
    if (n < 100 || n > 5000) return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { networkCap: n } };
  }
  if (key === 'sessionCap') {
    if (!/^\d+$/.test(trimmed)) return { error: t('settings.err.invalid', { key, raw }) };
    const n = Number(trimmed);
    if (n < 1 || n > 32) return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { sessionCap: n } };
  }
  if (key === 'ports') {
    const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    const ports: number[] = [];
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return { error: t('settings.err.invalid', { key, raw }) };
      const n = Number(part);
      if (n < 1 || n > 65535) return { error: t('settings.err.invalid', { key, raw }) };
      ports.push(n);
    }
    if (!ports.length) return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { ports } };
  }
  if (key === 'throttle') {
    if (trimmed !== 'off' && trimmed !== 'fast3g' && trimmed !== 'slow3g' && trimmed !== 'offline') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { throttle: trimmed } };
  }
  if (key === 'cacheDisabled') {
    if (trimmed !== 'off' && trimmed !== 'on') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { cacheDisabled: trimmed === 'on' } };
  }
  if (key === 'clearOnNav') {
    if (trimmed !== 'off' && trimmed !== 'on') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { clearOnNav: trimmed === 'on' } };
  }
  if (key === 'harSanitize') {
    if (trimmed !== 'off' && trimmed !== 'on') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { harSanitize: trimmed === 'on' } };
  }
  if (key === 'copyRedact') {
    if (trimmed !== 'off' && trimmed !== 'on') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { copyRedact: trimmed === 'on' } };
  }
  if (key === 'persistSanitize') {
    if (trimmed !== 'off' && trimmed !== 'on') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { persistSanitize: trimmed === 'on' } };
  }
  if (key === 'agentCmd') {
    return { patch: { agentCmd: trimmed || undefined } };
  }
  if (key === 'layout') {
    if (trimmed !== 'tabs' && trimmed !== 'split') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { layout: trimmed } };
  }
  if (key === 'hints') {
    if (trimmed !== '2' && trimmed !== '1' && trimmed !== 'off') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { hints: trimmed } };
  }
  if (key === 'lang') {
    if (trimmed !== 'ko' && trimmed !== 'en') return { error: t('settings.err.invalid', { key, raw }) };
    return { patch: { lang: trimmed } };
  }
  if (key === 'networkColumns') {
    const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!(NET_COLUMN_IDS as readonly string[]).includes(part)) return { error: t('settings.err.invalid', { key, raw: part }) };
    }
    return { patch: { networkColumns: normalizeNetColumns(parts) } };
  }
  if (key === 'editor') {
    // Edit mode prefills the displayed value, so the '(env)' default placeholder
    // must round-trip to "unset".
    if (!trimmed || trimmed === '(env)') return { patch: { editor: undefined } };
    return { patch: { editor: trimmed } };
  }
  if (key === 'browserPaths') {
    return { patch: { browserPaths: trimmed.split(',').map(s => s.trim()).filter(Boolean) } };
  }
  return { error: t('settings.err.unknown', { key }) };
}

export function fuzzyFilter(rows: SettingRow[], q: string): SettingRow[] {
  if (!q) return rows;
  const needle = q.toLowerCase();
  return rows.filter(r => isSubseq(r.key, needle));
}
