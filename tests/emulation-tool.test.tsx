import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-emu-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-emu-data-'));
  mock = await MockCdp.start();
  tabs = new MultiTabs([ep()]);
  await tabs.refresh();
});
afterEach(async () => {
  tabs.stop();
  await mock.close();
  if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevConfigHome;
  if (prevDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevDataHome;
});

function renderApp(extra: Partial<React.ComponentProps<typeof App>> = {}) {
  return render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} {...extra} />,
  );
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

async function palette(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }, query: string) {
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write(query);
  await sleep(40);
}

test('device command opens a picker; applying iPhone sends metrics and shows the status indicator', async () => {
  let metrics: any;
  mock.respond('Emulation.setDeviceMetricsOverride', p => { metrics = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 에뮬레이션');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu device:iPhone');
  expect(metrics).toEqual({ width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  expect(stripAnsi(lastFrame()!)).toContain('emu:iPhone');
  expect(stripAnsi(lastFrame()!)).not.toContain('기기 에뮬레이션');
});

test('CPU slowdown picker sends the throttling rate and shows 4x', async () => {
  let rate: any;
  mock.respond('Emulation.setCPUThrottlingRate', p => { rate = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'slowdown');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'CPU 속도 저하');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu cpu:4x');
  expect(rate).toEqual({ rate: 4 });
  expect(stripAnsi(lastFrame()!)).toContain('emu:4x');
});

test('color scheme picker forces prefers-color-scheme dark', async () => {
  let media: any;
  mock.respond('Emulation.setEmulatedMedia', p => { media = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'color scheme');
  stdin.write('\r');
  await waitForFrame(lastFrame, '색 구성표');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu color:dark');
  expect(media).toEqual({ media: '', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  expect(stripAnsi(lastFrame()!)).toContain('emu:dark');
});

test('paint flashing is a direct toggle that enables the Overlay paint rects', async () => {
  const calls: string[] = [];
  let show: any;
  mock.respond('Overlay.enable', () => { calls.push('enable'); return {}; });
  mock.respond('Overlay.setShowPaintRects', p => { calls.push('show'); show = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'paint');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu paint:on');
  expect(calls).toEqual(['enable', 'show']);
  expect(show).toEqual({ result: true });
  expect(stripAnsi(lastFrame()!)).toContain('emu:paint');
});

test('print media toggle emulates the print media type', async () => {
  let media: any;
  mock.respond('Emulation.setEmulatedMedia', p => { media = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'print');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu print:on');
  expect(media).toEqual({ media: 'print', features: [] });
  expect(stripAnsi(lastFrame()!)).toContain('emu:print');
});

test('reduced motion toggle emulates prefers-reduced-motion:reduce', async () => {
  let media: any;
  mock.respond('Emulation.setEmulatedMedia', p => { media = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'reduced motion');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu reduced-motion:on');
  expect(media).toEqual({ media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  expect(stripAnsi(lastFrame()!)).toContain('emu:rmotion');
});

test('forced colors toggle emulates forced-colors:active', async () => {
  let media: any;
  mock.respond('Emulation.setEmulatedMedia', p => { media = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'forced colors');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu forced-colors:on');
  expect(media).toEqual({ media: '', features: [{ name: 'forced-colors', value: 'active' }] });
  expect(stripAnsi(lastFrame()!)).toContain('emu:fcolors');
});

test('contrast picker forces prefers-contrast to more', async () => {
  let media: any;
  mock.respond('Emulation.setEmulatedMedia', p => { media = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'prefers-contrast');
  stdin.write('\r');
  await waitForFrame(lastFrame, '대비 선호');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu contrast:more');
  expect(media).toEqual({ media: '', features: [{ name: 'prefers-contrast', value: 'more' }] });
  expect(stripAnsi(lastFrame()!)).toContain('emu:contrast:more');
});

test('vision picker emulates a blurred-vision deficiency', async () => {
  let seen: any;
  mock.respond('Emulation.setEmulatedVisionDeficiency', p => { seen = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'vision deficiency');
  stdin.write('\r');
  await waitForFrame(lastFrame, '시각 결함');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu vision:blurredVision');
  expect(seen).toEqual({ type: 'blurredVision' });
  expect(stripAnsi(lastFrame()!)).toContain('emu:blur');
});

test('geolocation picker overrides the position with the Seoul preset', async () => {
  let seen: any;
  mock.respond('Emulation.setGeolocationOverride', p => { seen = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'geolocation override');
  stdin.write('\r');
  await waitForFrame(lastFrame, '위치 오버라이드');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu geo:Seoul');
  expect(seen).toEqual({ latitude: 37.5665, longitude: 126.978, accuracy: 100 });
  expect(stripAnsi(lastFrame()!)).toContain('emu:Seoul');
});

test('timezone picker overrides the clock with Asia/Seoul', async () => {
  let tz: any;
  mock.respond('Emulation.setTimezoneOverride', p => { tz = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'timezone override');
  stdin.write('\r');
  await waitForFrame(lastFrame, '타임존 오버라이드');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu tz:Seoul');
  expect(tz).toEqual({ timezoneId: 'Asia/Seoul' });
  expect(stripAnsi(lastFrame()!)).toContain('emu:tz:Seoul');
});

test('touch toggle enables touch emulation and mouse→touch synthesis', async () => {
  const calls: string[] = [];
  let touch: any;
  mock.respond('Emulation.setTouchEmulationEnabled', p => { calls.push('touch'); touch = p; return {}; });
  mock.respond('Emulation.setEmitTouchEventsForMouse', () => { calls.push('mouse'); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'touch emulation');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu touch:on');
  expect(calls).toEqual(['touch', 'mouse']);
  expect(touch).toEqual({ enabled: true, maxTouchPoints: 1 });
  expect(stripAnsi(lastFrame()!)).toContain('emu:touch');
});

test('applying a mobile device preset auto-enables touch emulation', async () => {
  let touch: any;
  mock.respond('Emulation.setTouchEmulationEnabled', p => { touch = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 에뮬레이션');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu device:iPhone');
  expect(touch).toEqual({ enabled: true, maxTouchPoints: 1 });
  expect(stripAnsi(lastFrame()!)).toContain('emu:iPhone·touch');
});

test('user-agent picker applies the iOS Safari UA + metadata bundle', async () => {
  let ua: any;
  mock.respond('Emulation.setUserAgentOverride', p => { ua = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'user agent');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'User-Agent 오버라이드');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu ua:iOS');
  expect(ua.userAgent).toContain('iPhone; CPU iPhone OS 17_0');
  expect(ua.userAgentMetadata).toMatchObject({ platform: 'iOS', mobile: true });
  expect(stripAnsi(lastFrame()!)).toContain('emu:ua:iOS');
});

test('locale picker overrides navigator.language with ko-KR', async () => {
  let loc: any;
  mock.respond('Emulation.setLocaleOverride', p => { loc = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'locale override');
  stdin.write('\r');
  await waitForFrame(lastFrame, '로케일 오버라이드');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu locale:ko-KR');
  expect(loc).toEqual({ locale: 'ko-KR' });
  expect(stripAnsi(lastFrame()!)).toContain('emu:loc:ko-KR');
});

test('auto dark mode toggle enables the override', async () => {
  let seen: any;
  mock.respond('Emulation.setAutoDarkModeOverride', p => { seen = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'auto dark');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu auto-dark:on');
  expect(seen).toEqual({ enabled: true });
  expect(stripAnsi(lastFrame()!)).toContain('emu:autodark');
});

test('idle picker overrides the idle state to locked', async () => {
  let seen: any;
  mock.respond('Emulation.setIdleOverride', p => { seen = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'idle state');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'Idle 상태');
  stdin.write('jjj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu idle:locked');
  expect(seen).toEqual({ isUserActive: false, isScreenUnlocked: false });
  expect(stripAnsi(lastFrame()!)).toContain('emu:idle:locked');
});

test('orientation picker enables the sensor and pushes a landscape reading', async () => {
  let enabled: any;
  let readings: any;
  mock.respond('Emulation.setSensorOverrideEnabled', p => { enabled = p; return {}; });
  mock.respond('Emulation.setSensorOverrideReadings', p => { readings = p; return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device orientation');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 방향');
  stdin.write('jjj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu orientation:landscape');
  expect(enabled).toEqual({ enabled: true, type: 'relative-orientation' });
  expect(readings.type).toBe('relative-orientation');
  expect(readings.reading.quaternion.y).toBeCloseTo(Math.SQRT1_2, 6);
  expect(stripAnsi(lastFrame()!)).toContain('emu:orient:landscape');
});

test('custom orientation entry parses alpha,beta,gamma from the editor and applies it', async () => {
  let readings: any;
  mock.respond('Emulation.setSensorOverrideEnabled', () => ({}));
  mock.respond('Emulation.setSensorOverrideReadings', p => { readings = p; return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '0,90,0\n');
    },
  });
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device orientation');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 방향');
  stdin.write('jjjj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu orientation:0/90/0');
  expect(readings.reading.quaternion.x).toBeCloseTo(Math.SQRT1_2, 6);
  expect(stripAnsi(lastFrame()!)).toContain('emu:orient:0/90/0');
});

test('rotate swaps the active device dimensions and sets a landscape orientation', async () => {
  const metrics: any[] = [];
  mock.respond('Emulation.setDeviceMetricsOverride', p => { metrics.push(p); return {}; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 에뮬레이션');
  stdin.write('j');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu device:iPhone');
  await palette(lastFrame, stdin, 'rotate viewport');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu rotate:landscape');
  expect(metrics.at(-1)).toEqual({ width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  expect(stripAnsi(lastFrame()!)).toContain('emu:iPhone·landscape');
});

test('rotate without an active device reports that a device is required', async () => {
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'rotate viewport');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 오버라이드가 없음');
  expect(stripAnsi(lastFrame()!)).not.toContain('emu:landscape');
});

test('webauthn toggle enables the virtual environment and adds an authenticator', async () => {
  const calls: string[] = [];
  let opts: any;
  mock.respond('WebAuthn.enable', () => { calls.push('enable'); return {}; });
  mock.respond('WebAuthn.addVirtualAuthenticator', p => { calls.push('add'); opts = p; return { authenticatorId: 'auth-1' }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'webauthn');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu webauthn:on');
  expect(calls).toEqual(['enable', 'add']);
  expect(opts.options).toMatchObject({ protocol: 'ctap2', transport: 'internal', hasUserVerification: true });
  expect(stripAnsi(lastFrame()!)).toContain('emu:webauthn');
});

test('custom device entry parses a WxH@DPR spec from the editor and applies it', async () => {
  let metrics: any;
  mock.respond('Emulation.setDeviceMetricsOverride', p => { metrics = p; return {}; });
  const { lastFrame, stdin } = renderApp({
    editRunner: async (file: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, '360x640@2 mobile\n');
    },
  });
  await attach(lastFrame, stdin);
  await palette(lastFrame, stdin, 'device');
  stdin.write('\r');
  await waitForFrame(lastFrame, '기기 에뮬레이션');
  stdin.write('jjjjj');
  await sleep(30);
  stdin.write('\r');
  await waitForFrame(lastFrame, 'emu device:360×640');
  expect(metrics).toEqual({ width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
  expect(stripAnsi(lastFrame()!)).toContain('emu:360×640');
});
