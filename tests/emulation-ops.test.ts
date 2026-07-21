import { test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import { DebugSession } from '../src/engine.js';
import { listPages } from '../src/cdp/targets.js';
import {
  setDeviceMetrics,
  clearDeviceMetrics,
  setCpuThrottling,
  setGeolocation,
  clearGeolocation,
  setEmulatedMedia,
  setVisionDeficiency,
  setPaintFlashing,
  setTimezoneOverride,
  setTouchEmulation,
  setUserAgentOverride,
  setLocaleOverride,
  setAutoDarkMode,
  setIdleOverride,
  clearIdleOverride,
  setSensorOverride,
  clearSensorOverride,
} from '../src/cdp/emulation.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('setDeviceMetrics forwards only the four override fields', async () => {
  let seen: any;
  mock.respond('Emulation.setDeviceMetricsOverride', p => { seen = p; return {}; });
  await setDeviceMetrics(conn, { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  expect(seen).toEqual({ width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
});

test('clearDeviceMetrics maps to clearDeviceMetricsOverride', async () => {
  let called = false;
  mock.respond('Emulation.clearDeviceMetricsOverride', () => { called = true; return {}; });
  await clearDeviceMetrics(conn);
  expect(called).toBe(true);
});

test('setCpuThrottling sends the slowdown rate', async () => {
  let seen: any;
  mock.respond('Emulation.setCPUThrottlingRate', p => { seen = p; return {}; });
  await setCpuThrottling(conn, 4);
  expect(seen).toEqual({ rate: 4 });
});

test('setGeolocation forwards latitude/longitude/accuracy', async () => {
  let seen: any;
  mock.respond('Emulation.setGeolocationOverride', p => { seen = p; return {}; });
  await setGeolocation(conn, { latitude: 37.5665, longitude: 126.978, accuracy: 100 });
  expect(seen).toEqual({ latitude: 37.5665, longitude: 126.978, accuracy: 100 });
});

test('clearGeolocation maps to clearGeolocationOverride', async () => {
  let called = false;
  mock.respond('Emulation.clearGeolocationOverride', () => { called = true; return {}; });
  await clearGeolocation(conn);
  expect(called).toBe(true);
});

test('setEmulatedMedia combines media type and features, defaulting both to empty', async () => {
  let seen: any;
  mock.respond('Emulation.setEmulatedMedia', p => { seen = p; return {}; });
  await setEmulatedMedia(conn, { media: 'print', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  expect(seen).toEqual({ media: 'print', features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await setEmulatedMedia(conn, {});
  expect(seen).toEqual({ media: '', features: [] });
});

test('setVisionDeficiency sends the deficiency type', async () => {
  let seen: any;
  mock.respond('Emulation.setEmulatedVisionDeficiency', p => { seen = p; return {}; });
  await setVisionDeficiency(conn, 'deuteranopia');
  expect(seen).toEqual({ type: 'deuteranopia' });
});

test('setPaintFlashing enables Overlay before toggling paint rects', async () => {
  const calls: string[] = [];
  let seen: any;
  mock.respond('Overlay.enable', () => { calls.push('enable'); return {}; });
  mock.respond('Overlay.setShowPaintRects', p => { calls.push('show'); seen = p; return {}; });
  await setPaintFlashing(conn, true);
  expect(calls).toEqual(['enable', 'show']);
  expect(seen).toEqual({ result: true });
});

test('setEmulatedMedia composes the accessibility media features', async () => {
  let seen: any;
  mock.respond('Emulation.setEmulatedMedia', p => { seen = p; return {}; });
  await setEmulatedMedia(conn, {
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'forced-colors', value: 'active' },
      { name: 'prefers-contrast', value: 'more' },
    ],
  });
  expect(seen).toEqual({
    media: '',
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'forced-colors', value: 'active' },
      { name: 'prefers-contrast', value: 'more' },
    ],
  });
});

test('setTimezoneOverride forwards the IANA id and clears with an empty string', async () => {
  let seen: any;
  mock.respond('Emulation.setTimezoneOverride', p => { seen = p; return {}; });
  await setTimezoneOverride(conn, 'Asia/Seoul');
  expect(seen).toEqual({ timezoneId: 'Asia/Seoul' });
  await setTimezoneOverride(conn, '');
  expect(seen).toEqual({ timezoneId: '' });
});

test('setTouchEmulation enables the touch override and mouse→touch synthesis', async () => {
  const calls: string[] = [];
  let touch: any;
  let mouse: any;
  mock.respond('Emulation.setTouchEmulationEnabled', p => { calls.push('touch'); touch = p; return {}; });
  mock.respond('Emulation.setEmitTouchEventsForMouse', p => { calls.push('mouse'); mouse = p; return {}; });
  await setTouchEmulation(conn, true);
  expect(calls).toEqual(['touch', 'mouse']);
  expect(touch).toEqual({ enabled: true, maxTouchPoints: 1 });
  expect(mouse).toEqual({ enabled: true, configuration: 'mobile' });
});

test('setDeviceMetrics appends screenOrientation only when a rotation is given', async () => {
  let seen: any;
  mock.respond('Emulation.setDeviceMetricsOverride', p => { seen = p; return {}; });
  await setDeviceMetrics(conn, { width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  expect(seen).toEqual({ width: 852, height: 393, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
});

test('setUserAgentOverride forwards the UA plus optional metadata/platform/acceptLanguage', async () => {
  let seen: any;
  mock.respond('Emulation.setUserAgentOverride', p => { seen = p; return {}; });
  await setUserAgentOverride(conn, {
    userAgent: 'UA/1',
    platform: 'iPhone',
    userAgentMetadata: { brands: [], platform: 'iOS', platformVersion: '17.0', architecture: '', model: 'iPhone', mobile: true },
  });
  expect(seen).toEqual({
    userAgent: 'UA/1',
    platform: 'iPhone',
    userAgentMetadata: { brands: [], platform: 'iOS', platformVersion: '17.0', architecture: '', model: 'iPhone', mobile: true },
  });
  await setUserAgentOverride(conn, { userAgent: 'default-ua' });
  expect(seen).toEqual({ userAgent: 'default-ua' });
});

test('setLocaleOverride sends the BCP47 locale and clears with an empty payload', async () => {
  let seen: any;
  mock.respond('Emulation.setLocaleOverride', p => { seen = p; return {}; });
  await setLocaleOverride(conn, 'ko-KR');
  expect(seen).toEqual({ locale: 'ko-KR' });
  await setLocaleOverride(conn, null);
  expect(seen).toEqual({});
});

test('setAutoDarkMode enables with a flag and disables with an empty payload', async () => {
  let seen: any;
  mock.respond('Emulation.setAutoDarkModeOverride', p => { seen = p; return {}; });
  await setAutoDarkMode(conn, true);
  expect(seen).toEqual({ enabled: true });
  await setAutoDarkMode(conn, false);
  expect(seen).toEqual({});
});

test('setIdleOverride forwards the user-active and screen-unlocked flags', async () => {
  let seen: any;
  mock.respond('Emulation.setIdleOverride', p => { seen = p; return {}; });
  await setIdleOverride(conn, { isUserActive: false, isScreenUnlocked: false });
  expect(seen).toEqual({ isUserActive: false, isScreenUnlocked: false });
});

test('clearIdleOverride maps to clearIdleOverride', async () => {
  let called = false;
  mock.respond('Emulation.clearIdleOverride', () => { called = true; return {}; });
  await clearIdleOverride(conn);
  expect(called).toBe(true);
});

test('setSensorOverride enables the orientation sensor before pushing readings', async () => {
  const calls: string[] = [];
  let enabled: any;
  let readings: any;
  mock.respond('Emulation.setSensorOverrideEnabled', p => { calls.push('enable'); enabled = p; return {}; });
  mock.respond('Emulation.setSensorOverrideReadings', p => { calls.push('readings'); readings = p; return {}; });
  await setSensorOverride(conn, { alpha: 0, beta: 0, gamma: 0 });
  expect(calls).toEqual(['enable', 'readings']);
  expect(enabled).toEqual({ enabled: true, type: 'relative-orientation' });
  expect(readings.type).toBe('relative-orientation');
  const q = readings.reading.quaternion;
  expect(q.x).toBeCloseTo(0, 6);
  expect(q.y).toBeCloseTo(0, 6);
  expect(q.z).toBeCloseTo(0, 6);
  expect(q.w).toBeCloseTo(1, 6);
});

test('setSensorOverride maps a beta tilt to a rotation about the X axis', async () => {
  let readings: any;
  mock.respond('Emulation.setSensorOverrideEnabled', () => ({}));
  mock.respond('Emulation.setSensorOverrideReadings', p => { readings = p; return {}; });
  await setSensorOverride(conn, { alpha: 0, beta: 90, gamma: 0 });
  const q = readings.reading.quaternion;
  expect(q.x).toBeCloseTo(Math.SQRT1_2, 6);
  expect(q.y).toBeCloseTo(0, 6);
  expect(q.z).toBeCloseTo(0, 6);
  expect(q.w).toBeCloseTo(Math.SQRT1_2, 6);
});

test('setSensorOverride maps a gamma tilt to a rotation about the Y axis', async () => {
  let readings: any;
  mock.respond('Emulation.setSensorOverrideEnabled', () => ({}));
  mock.respond('Emulation.setSensorOverrideReadings', p => { readings = p; return {}; });
  await setSensorOverride(conn, { alpha: 0, beta: 0, gamma: 90 });
  const q = readings.reading.quaternion;
  expect(q.x).toBeCloseTo(0, 6);
  expect(q.y).toBeCloseTo(Math.SQRT1_2, 6);
  expect(q.z).toBeCloseTo(0, 6);
  expect(q.w).toBeCloseTo(Math.SQRT1_2, 6);
});

test('clearSensorOverride disables the orientation sensor', async () => {
  let seen: any;
  mock.respond('Emulation.setSensorOverrideEnabled', p => { seen = p; return {}; });
  await clearSensorOverride(conn);
  expect(seen).toEqual({ enabled: false, type: 'relative-orientation' });
});

test('setDeviceOverride leaves recorded state untouched when the touch override fails', async () => {
  const m = await MockCdp.start();
  const root = await mkdtemp(join(tmpdir(), 'dtui-emu-'));
  const [page] = await listPages({ host: '127.0.0.1', port: m.port, browser: 'MockChrome/1.0' });
  const session = await DebugSession.attach(page, { sessionRoot: root, persist: false, browser: 'MockChrome/1.0' });
  m.respond('Emulation.setDeviceMetricsOverride', () => ({}));
  m.respond('Emulation.setTouchEmulationEnabled', () => { throw new Error('boom'); });
  await expect(
    session.setDeviceOverride({ label: 'iPhone', width: 393, height: 852, deviceScaleFactor: 3, mobile: true }),
  ).rejects.toThrow();
  expect(session.deviceOverride).toBeNull();
  expect(session.touchEnabled).toBe(false);
  expect(session.landscape).toBe(false);
  await session.close();
  await m.close();
});
