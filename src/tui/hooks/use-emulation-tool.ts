import { useReducer, useState } from 'react';
import type { DebugSession, DeviceOverrideState, GeoOverrideState, UaOverrideState, IdleOverrideState, SensorOverrideState } from '../../engine.js';
import type { VisionDeficiency } from '../../cdp/emulation.js';
import type { SelectPickerItem } from '../overlays/SelectPicker.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';

export type EmuPickerKind = 'device' | 'cpu' | 'color' | 'vision' | 'geo' | 'contrast' | 'timezone' | 'userAgent' | 'locale' | 'idle' | 'orientation';
export type WithEditor = (initial: string, ext?: string) => Promise<string | null>;

const CUSTOM_DEVICE = 'custom';
const CUSTOM_DEVICE_TEMPLATE = '# Custom device — format: WxH@DPR [mobile]  (e.g. 360x640@2 mobile)\n375x812@3 mobile\n';
const MAX_DEVICE_DIM = 10000;
const MAX_DEVICE_DPR = 10;

const CUSTOM_ORIENTATION = 'custom';
const CUSTOM_ORIENTATION_TEMPLATE = '# Device orientation — format: alpha,beta,gamma  (degrees, e.g. 0,90,0)\n0,90,0\n';

export function parseCustomOrientation(input: string): SensorOverrideState | null {
  const line = input.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
  if (!line) return null;
  const m = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(line);
  if (!m) return null;
  const [alpha, beta, gamma] = [m[1], m[2], m[3]].map(Number);
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  return { label: `${alpha}/${beta}/${gamma}`, reading: { alpha, beta, gamma } };
}

export function parseCustomDevice(input: string): DeviceOverrideState | null {
  const line = input.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
  if (!line) return null;
  const m = /^(\d+)\s*[x×]\s*(\d+)(?:\s*@\s*([\d.]+))?\s*(mobile)?$/i.exec(line);
  if (!m) return null;
  const width = Math.min(Number(m[1]), MAX_DEVICE_DIM);
  const height = Math.min(Number(m[2]), MAX_DEVICE_DIM);
  const deviceScaleFactor = m[3] !== undefined ? Math.min(Number(m[3]), MAX_DEVICE_DPR) : 1;
  if (!width || !height || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0) return null;
  return { label: `${width}×${height}`, width, height, deviceScaleFactor, mobile: !!m[4] };
}
type ColorScheme = 'dark' | 'light' | null;
type Contrast = 'more' | 'less' | null;
type SetToast = (msg: string, level?: ToastLevel) => void;

const DEVICE_PRESETS: Array<{ value: string; pickerLabel: string; device: DeviceOverrideState | null }> = [
  { value: 'off', pickerLabel: '', device: null },
  { value: 'iphone14', pickerLabel: 'iPhone 14 Pro', device: { label: 'iPhone', width: 393, height: 852, deviceScaleFactor: 3, mobile: true } },
  { value: 'pixel8', pickerLabel: 'Pixel 8', device: { label: 'Pixel', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true } },
  { value: 'ipad', pickerLabel: 'iPad', device: { label: 'iPad', width: 820, height: 1180, deviceScaleFactor: 2, mobile: true } },
  { value: 'desktop', pickerLabel: 'Desktop 1080p', device: { label: 'Desktop', width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false } },
];

const CPU_PRESETS: Array<{ value: string; label: string; rate: number }> = [
  { value: '1', label: '', rate: 1 },
  { value: '4', label: '4x', rate: 4 },
  { value: '6', label: '6x', rate: 6 },
];

const COLOR_PRESETS: Array<{ value: string; label: string; scheme: ColorScheme }> = [
  { value: 'auto', label: '', scheme: null },
  { value: 'dark', label: 'dark', scheme: 'dark' },
  { value: 'light', label: 'light', scheme: 'light' },
];

const VISION_PRESETS: Array<{ value: VisionDeficiency; label: string }> = [
  { value: 'none', label: '' },
  { value: 'blurredVision', label: 'blurred vision' },
  { value: 'reducedContrast', label: 'reduced contrast' },
  { value: 'protanopia', label: 'protanopia' },
  { value: 'deuteranopia', label: 'deuteranopia' },
  { value: 'tritanopia', label: 'tritanopia' },
  { value: 'achromatopsia', label: 'achromatopsia' },
];

const GEO_PRESETS: Array<{ value: string; pickerLabel: string; geo: GeoOverrideState | null }> = [
  { value: 'off', pickerLabel: '', geo: null },
  { value: 'seoul', pickerLabel: 'Seoul', geo: { label: 'Seoul', latitude: 37.5665, longitude: 126.978, accuracy: 100 } },
  { value: 'sf', pickerLabel: 'San Francisco', geo: { label: 'SF', latitude: 37.7749, longitude: -122.4194, accuracy: 100 } },
  { value: 'berlin', pickerLabel: 'Berlin', geo: { label: 'Berlin', latitude: 52.52, longitude: 13.405, accuracy: 100 } },
];

const CONTRAST_PRESETS: Array<{ value: string; label: string; contrast: Contrast }> = [
  { value: 'no-preference', label: '', contrast: null },
  { value: 'more', label: 'more', contrast: 'more' },
  { value: 'less', label: 'less', contrast: 'less' },
];

const TIMEZONE_PRESETS: Array<{ value: string; pickerLabel: string; tz: string | null; tag: string }> = [
  { value: 'off', pickerLabel: '', tz: null, tag: '' },
  { value: 'seoul', pickerLabel: 'Asia/Seoul', tz: 'Asia/Seoul', tag: 'Seoul' },
  { value: 'utc', pickerLabel: 'UTC', tz: 'UTC', tag: 'UTC' },
  { value: 'newyork', pickerLabel: 'America/New_York', tz: 'America/New_York', tag: 'New York' },
  { value: 'london', pickerLabel: 'Europe/London', tz: 'Europe/London', tag: 'London' },
];

const UA_PRESETS: Array<{ value: string; pickerLabel: string; tag: string; ua: UaOverrideState | null }> = [
  { value: 'off', pickerLabel: '', tag: '', ua: null },
  {
    value: 'ios', pickerLabel: 'iOS Safari', tag: 'iOS',
    ua: {
      label: 'iOS',
      override: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        userAgentMetadata: { brands: [], platform: 'iOS', platformVersion: '17.0', architecture: '', model: 'iPhone', mobile: true },
      },
    },
  },
  {
    value: 'android', pickerLabel: 'Android Chrome', tag: 'Android',
    ua: {
      label: 'Android',
      override: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        userAgentMetadata: {
          brands: [{ brand: 'Not_A Brand', version: '8' }, { brand: 'Chromium', version: '120' }, { brand: 'Google Chrome', version: '120' }],
          fullVersion: '120.0.0.0', platform: 'Android', platformVersion: '14.0.0', architecture: '', model: 'Pixel 8', mobile: true,
        },
      },
    },
  },
  {
    value: 'windows', pickerLabel: 'Windows Chrome', tag: 'Windows',
    ua: {
      label: 'Windows',
      override: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        platform: 'Win32',
        userAgentMetadata: {
          brands: [{ brand: 'Not_A Brand', version: '8' }, { brand: 'Chromium', version: '120' }, { brand: 'Google Chrome', version: '120' }],
          fullVersion: '120.0.0.0', platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86', model: '', mobile: false,
        },
      },
    },
  },
];

const LOCALE_PRESETS: Array<{ value: string; pickerLabel: string; locale: string | null }> = [
  { value: 'off', pickerLabel: '', locale: null },
  { value: 'ko-KR', pickerLabel: 'ko-KR', locale: 'ko-KR' },
  { value: 'en-US', pickerLabel: 'en-US', locale: 'en-US' },
  { value: 'ja-JP', pickerLabel: 'ja-JP', locale: 'ja-JP' },
  { value: 'de-DE', pickerLabel: 'de-DE', locale: 'de-DE' },
];

const IDLE_PRESETS: Array<{ value: string; pickerLabel: string; tag: string; idle: IdleOverrideState | null }> = [
  { value: 'off', pickerLabel: '', tag: '', idle: null },
  { value: 'active', pickerLabel: 'user active', tag: 'active', idle: { label: 'active', state: { isUserActive: true, isScreenUnlocked: true } } },
  { value: 'idle', pickerLabel: 'idle · unlocked', tag: 'idle', idle: { label: 'idle', state: { isUserActive: false, isScreenUnlocked: true } } },
  { value: 'locked', pickerLabel: 'idle · locked', tag: 'locked', idle: { label: 'locked', state: { isUserActive: false, isScreenUnlocked: false } } },
];

const ORIENTATION_PRESETS: Array<{ value: string; pickerLabel: string; sensor: SensorOverrideState | null }> = [
  { value: 'off', pickerLabel: '', sensor: null },
  { value: 'flat', pickerLabel: 'flat', sensor: { label: 'flat', reading: { alpha: 0, beta: 0, gamma: 0 } } },
  { value: 'portrait', pickerLabel: 'portrait upright', sensor: { label: 'portrait', reading: { alpha: 0, beta: 90, gamma: 0 } } },
  { value: 'landscape', pickerLabel: 'landscape', sensor: { label: 'landscape', reading: { alpha: 0, beta: 0, gamma: 90 } } },
];

const VISION_TAG: Record<VisionDeficiency, string> = {
  none: '',
  blurredVision: 'blur',
  reducedContrast: 'lowcon',
  protanopia: 'protan',
  deuteranopia: 'deuter',
  tritanopia: 'tritan',
  achromatopsia: 'achrom',
};

export const deviceItems = (): SelectPickerItem[] => [
  ...DEVICE_PRESETS.map(p => ({
    value: p.value,
    label: p.device ? p.pickerLabel : t('emu.item.off'),
    ...(p.device ? { hint: `${p.device.width}×${p.device.height} @${p.device.deviceScaleFactor}x` } : {}),
  })),
  { value: CUSTOM_DEVICE, label: t('emu.item.custom'), hint: 'WxH@DPR' },
];

export const cpuItems = (): SelectPickerItem[] =>
  CPU_PRESETS.map(p => ({ value: p.value, label: p.rate === 1 ? t('emu.item.off') : p.label }));

export const colorItems = (): SelectPickerItem[] =>
  COLOR_PRESETS.map(p => ({ value: p.value, label: p.scheme ? p.label : t('emu.item.auto') }));

export const visionItems = (): SelectPickerItem[] =>
  VISION_PRESETS.map(p => ({ value: p.value, label: p.value === 'none' ? t('emu.item.none') : p.label }));

export const geoItems = (): SelectPickerItem[] =>
  GEO_PRESETS.map(p => ({ value: p.value, label: p.geo ? p.pickerLabel : t('emu.item.off') }));

export const contrastItems = (): SelectPickerItem[] =>
  CONTRAST_PRESETS.map(p => ({ value: p.value, label: p.contrast ? p.label : t('emu.item.off') }));

export const timezoneItems = (): SelectPickerItem[] =>
  TIMEZONE_PRESETS.map(p => ({ value: p.value, label: p.tz ? p.pickerLabel : t('emu.item.off') }));

export const userAgentItems = (): SelectPickerItem[] =>
  UA_PRESETS.map(p => ({ value: p.value, label: p.ua ? p.pickerLabel : t('emu.item.off') }));

export const localeItems = (): SelectPickerItem[] =>
  LOCALE_PRESETS.map(p => ({ value: p.value, label: p.locale ? p.pickerLabel : t('emu.item.off') }));

export const idleItems = (): SelectPickerItem[] =>
  IDLE_PRESETS.map(p => ({ value: p.value, label: p.idle ? p.pickerLabel : t('emu.item.off') }));

export const orientationItems = (): SelectPickerItem[] => [
  ...ORIENTATION_PRESETS.map(p => ({
    value: p.value,
    label: p.sensor ? p.pickerLabel : t('emu.item.off'),
    ...(p.sensor ? { hint: `α${p.sensor.reading.alpha} β${p.sensor.reading.beta} γ${p.sensor.reading.gamma}` } : {}),
  })),
  { value: CUSTOM_ORIENTATION, label: t('emu.item.custom'), hint: 'α,β,γ' },
];

export function emuInitial(session: DebugSession | undefined, kind: EmuPickerKind): string[] {
  if (kind === 'device') return [DEVICE_PRESETS.find(p => p.device?.label === session?.deviceOverride?.label)?.value ?? 'off'];
  if (kind === 'cpu') return [session?.cpuRate === 4 ? '4' : session?.cpuRate === 6 ? '6' : '1'];
  if (kind === 'color') return [session?.colorScheme ?? 'auto'];
  if (kind === 'vision') return [session?.visionDeficiency ?? 'none'];
  if (kind === 'contrast') return [session?.contrast ?? 'no-preference'];
  if (kind === 'timezone') return [TIMEZONE_PRESETS.find(p => p.tz === session?.timezone)?.value ?? 'off'];
  if (kind === 'userAgent') return [UA_PRESETS.find(p => p.ua?.label === session?.userAgentOverride?.label)?.value ?? 'off'];
  if (kind === 'locale') return [LOCALE_PRESETS.find(p => p.locale === session?.locale)?.value ?? 'off'];
  if (kind === 'idle') return [IDLE_PRESETS.find(p => p.idle?.label === session?.idleOverride?.label)?.value ?? 'off'];
  if (kind === 'orientation') return [ORIENTATION_PRESETS.find(p => p.sensor?.label === session?.sensorOverride?.label)?.value ?? 'off'];
  return [GEO_PRESETS.find(p => p.geo?.label === session?.geoOverride?.label)?.value ?? 'off'];
}

export function emulationStatus(session: DebugSession | undefined): string | undefined {
  if (!session) return undefined;
  const seg: string[] = [];
  if (session.deviceOverride) seg.push(session.deviceOverride.label);
  if (session.userAgentOverride) seg.push(`ua:${session.userAgentOverride.label}`);
  if (session.landscape) seg.push('landscape');
  if (session.touchEnabled) seg.push('touch');
  if (session.cpuRate !== 1) seg.push(`${session.cpuRate}x`);
  if (session.colorScheme) seg.push(session.colorScheme);
  if (session.autoDarkMode) seg.push('autodark');
  if (session.reducedMotion) seg.push('rmotion');
  if (session.forcedColors) seg.push('fcolors');
  if (session.contrast) seg.push(`contrast:${session.contrast}`);
  if (session.visionDeficiency !== 'none') seg.push(VISION_TAG[session.visionDeficiency]);
  if (session.geoOverride) seg.push(session.geoOverride.label);
  if (session.timezone) seg.push(`tz:${TIMEZONE_PRESETS.find(p => p.tz === session.timezone)?.tag ?? session.timezone}`);
  if (session.locale) seg.push(`loc:${session.locale}`);
  if (session.idleOverride) seg.push(`idle:${session.idleOverride.label}`);
  if (session.sensorOverride) seg.push(`orient:${session.sensorOverride.label}`);
  if (session.paintFlashing) seg.push('paint');
  if (session.printMedia) seg.push('print');
  if (session.webauthnEnabled) seg.push('webauthn');
  return seg.length ? `emu:${seg.join('·')}` : undefined;
}

export function useEmulationTool() {
  const [emuPicker, setEmuPicker] = useState<EmuPickerKind | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const run = (promise: Promise<void>, ok: string, setToast: SetToast) => {
    void promise.then(
      () => { bump(); setToast(ok); },
      () => setToast(t('emu.toast.failed'), 'error'),
    );
  };

  const applyDevice = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = DEVICE_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setDeviceOverride(preset.device), `emu device:${preset.device ? preset.device.label : 'off'}`, setToast);
  };

  const applyCpu = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = CPU_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setCpuThrottling(preset.rate), `emu cpu:${preset.rate === 1 ? 'off' : preset.label}`, setToast);
  };

  const applyColor = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = COLOR_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setColorScheme(preset.scheme), `emu color:${preset.scheme ?? 'auto'}`, setToast);
  };

  const applyVision = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = VISION_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setVisionDeficiency(preset.value), `emu vision:${preset.value}`, setToast);
  };

  const applyGeo = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = GEO_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setGeoOverride(preset.geo), `emu geo:${preset.geo ? preset.geo.label : 'off'}`, setToast);
  };

  const applyContrast = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = CONTRAST_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setContrast(preset.contrast), `emu contrast:${preset.contrast ?? 'off'}`, setToast);
  };

  const applyTimezone = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = TIMEZONE_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setTimezone(preset.tz), `emu tz:${preset.tz ? preset.tag : 'off'}`, setToast);
  };

  const applyUserAgent = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = UA_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setUserAgentOverride(preset.ua), `emu ua:${preset.ua ? preset.tag : 'off'}`, setToast);
  };

  const applyLocale = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = LOCALE_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setLocale(preset.locale), `emu locale:${preset.locale ?? 'off'}`, setToast);
  };

  const applyIdle = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = IDLE_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setIdleOverride(preset.idle), `emu idle:${preset.idle ? preset.tag : 'off'}`, setToast);
  };

  const applyOrientation = (session: DebugSession | undefined, value: string, setToast: SetToast) => {
    setEmuPicker(null);
    const preset = ORIENTATION_PRESETS.find(p => p.value === value);
    if (!session || !preset) return;
    run(session.setSensorOverride(preset.sensor), `emu orientation:${preset.sensor ? preset.sensor.label : 'off'}`, setToast);
  };

  const applyCustomOrientation = (session: DebugSession | undefined, withEditor: WithEditor, setToast: SetToast) => {
    setEmuPicker(null);
    if (!session) return;
    void withEditor(CUSTOM_ORIENTATION_TEMPLATE, 'txt').then(text => {
      if (text === null) return;
      const sensor = parseCustomOrientation(text);
      if (!sensor) { setToast(t('emu.toast.badOrientation'), 'error'); return; }
      run(session.setSensorOverride(sensor), `emu orientation:${sensor.label}`, setToast);
    });
  };

  const applyCustomDevice = (session: DebugSession | undefined, withEditor: WithEditor, setToast: SetToast) => {
    setEmuPicker(null);
    if (!session) return;
    void withEditor(CUSTOM_DEVICE_TEMPLATE, 'txt').then(text => {
      if (text === null) return;
      const device = parseCustomDevice(text);
      if (!device) { setToast(t('emu.toast.badDevice'), 'error'); return; }
      run(session.setDeviceOverride(device), `emu device:${device.label}`, setToast);
    });
  };

  const toggleAutoDark = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.autoDarkMode;
    run(session.setAutoDarkMode(next), `emu auto-dark:${next ? 'on' : 'off'}`, setToast);
  };

  const rotateDevice = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    if (!session.deviceOverride) { setToast(t('emu.toast.noDevice'), 'error'); return; }
    const next = !session.landscape;
    run(session.rotateDevice(), `emu rotate:${next ? 'landscape' : 'portrait'}`, setToast);
  };

  const toggleWebAuthn = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.webauthnEnabled;
    run(session.setWebAuthn(next), `emu webauthn:${next ? 'on' : 'off'}`, setToast);
  };

  const togglePaint = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.paintFlashing;
    run(session.setPaintFlashing(next), `emu paint:${next ? 'on' : 'off'}`, setToast);
  };

  const togglePrint = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.printMedia;
    run(session.setPrintMedia(next), `emu print:${next ? 'on' : 'off'}`, setToast);
  };

  const toggleReducedMotion = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.reducedMotion;
    run(session.setReducedMotion(next), `emu reduced-motion:${next ? 'on' : 'off'}`, setToast);
  };

  const toggleForcedColors = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.forcedColors;
    run(session.setForcedColors(next), `emu forced-colors:${next ? 'on' : 'off'}`, setToast);
  };

  const toggleTouch = (session: DebugSession | undefined, setToast: SetToast) => {
    if (!session) return;
    const next = !session.touchEnabled;
    run(session.setTouchEmulation(next), `emu touch:${next ? 'on' : 'off'}`, setToast);
  };

  return {
    emuPicker,
    setEmuPicker,
    applyDevice,
    applyCpu,
    applyColor,
    applyVision,
    applyGeo,
    applyContrast,
    applyTimezone,
    applyUserAgent,
    applyLocale,
    applyIdle,
    applyOrientation,
    applyCustomOrientation,
    applyCustomDevice,
    togglePaint,
    togglePrint,
    toggleReducedMotion,
    toggleForcedColors,
    toggleTouch,
    toggleAutoDark,
    rotateDevice,
    toggleWebAuthn,
  };
}

export type EmulationTool = ReturnType<typeof useEmulationTool>;
