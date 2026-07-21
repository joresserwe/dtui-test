import { test, expect, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLang, setLang, t, type MessageKey } from '../src/tui/lib/i18n.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { describeSettings, parseSettingValue } from '../src/settings.js';

afterEach(() => setLang('ko'));

test('t() defaults to Korean and switches to English with setLang', () => {
  expect(getLang()).toBe('ko');
  expect(t('toast.reconnected')).toBe('재연결됨');
  setLang('en');
  expect(getLang()).toBe('en');
  expect(t('toast.reconnected')).toBe('reconnected');
  setLang('ko');
  expect(t('toast.reconnected')).toBe('재연결됨');
});

test('t() interpolates {placeholder} params in both languages', () => {
  expect(t('toast.attached', { name: 'My Tab' })).toBe('연결됨: My Tab');
  expect(t('status.reconnecting', { n: 3 })).toBe('재연결 중 (시도 3/5)…');
  setLang('en');
  expect(t('toast.attached', { name: 'My Tab' })).toBe('attached: My Tab');
  expect(t('toast.openUrlFailed', { url: 'https://a.test', error: 'boom' })).toBe('could not open https://a.test: boom');
});

test('t() falls back to the key for unknown keys at runtime', () => {
  expect(t('no.such.key' as MessageKey)).toBe('no.such.key');
});

test('parseSettingValue accepts ko/en for lang and rejects anything else', () => {
  expect(parseSettingValue('lang', 'en')).toEqual({ patch: { lang: 'en' } });
  expect(parseSettingValue('lang', ' ko ')).toEqual({ patch: { lang: 'ko' } });
  expect(parseSettingValue('lang', 'jp')).toMatchObject({ error: expect.any(String) });
});

test('describeSettings lists lang as a 표시 enum defaulting to ko', () => {
  const row = describeSettings({}).find(r => r.key === 'lang')!;
  expect(row).toMatchObject({ kind: 'enum', options: ['ko', 'en'], value: 'ko', source: 'default', section: '표시', description: 'UI 언어' });
  const configured = describeSettings({ lang: 'en' }).find(r => r.key === 'lang')!;
  expect(configured).toMatchObject({ value: 'en', source: 'config' });
});

test('describeSettings renders descriptions in the active language', () => {
  setLang('en');
  const row = describeSettings({}).find(r => r.key === 'lang')!;
  expect(row).toMatchObject({ section: 'Display', description: 'UI language' });
});

test('lang round-trips through saveConfig/loadConfig and drops invalid values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-i18n-cfg-'));
  const file = join(dir, 'config.json');
  saveConfig({ lang: 'en' }, file);
  expect(loadConfig(file).lang).toBe('en');
  saveConfig({ lang: 'jp' as 'ko' }, file);
  expect(loadConfig(file).lang).toBeUndefined();
});
