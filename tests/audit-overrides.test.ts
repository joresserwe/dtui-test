import { test, expect } from 'vitest';
import {
  captureOverrides,
  clearOverrides,
  hasActiveOverrides,
  restoreOverrides,
  withOverridesCleared,
  type OverridableSession,
} from '../src/audit/overrides.js';
import type { DeviceOverrideState, ThrottleName } from '../src/engine.js';

const DEVICE: DeviceOverrideState = { label: 'iPhone', width: 393, height: 852, deviceScaleFactor: 3, mobile: true };

function fakeSession(over: Partial<OverridableSession> = {}) {
  const calls: string[] = [];
  const s: OverridableSession = {
    throttle: 'off',
    cacheDisabled: false,
    deviceOverride: null,
    cpuRate: 1,
    async setThrottle(name: ThrottleName) {
      calls.push(`throttle:${name}`);
      s.throttle = name;
    },
    async setCacheDisabled(v: boolean) {
      calls.push(`cache:${v}`);
      s.cacheDisabled = v;
    },
    async setDeviceOverride(p: DeviceOverrideState | null) {
      calls.push(`device:${p ? p.label : 'off'}`);
      s.deviceOverride = p;
    },
    async setCpuThrottling(rate: number) {
      calls.push(`cpu:${rate}`);
      s.cpuRate = rate;
    },
    ...over,
  };
  return { s, calls };
}

test('captureOverrides snapshots current state and detects activity', () => {
  const { s } = fakeSession();
  expect(hasActiveOverrides(captureOverrides(s))).toBe(false);
  s.throttle = 'slow3g';
  s.cacheDisabled = true;
  s.deviceOverride = DEVICE;
  s.cpuRate = 4;
  const snap = captureOverrides(s);
  expect(snap).toEqual({ throttle: 'slow3g', cacheDisabled: true, device: DEVICE, cpuRate: 4 });
  expect(hasActiveOverrides(snap)).toBe(true);
});

test('clearOverrides only touches active overrides', async () => {
  const { s, calls } = fakeSession();
  s.throttle = 'fast3g';
  s.cpuRate = 6;
  await clearOverrides(s, captureOverrides(s));
  expect(calls).toEqual(['throttle:off', 'cpu:1']);
  expect(s.throttle).toBe('off');
  expect(s.cpuRate).toBe(1);
});

test('clearOverrides is a no-op when nothing is active', async () => {
  const { s, calls } = fakeSession();
  await clearOverrides(s, captureOverrides(s));
  expect(calls).toEqual([]);
});

test('restoreOverrides reapplies only what was recorded', async () => {
  const { s, calls } = fakeSession();
  s.cacheDisabled = true;
  s.deviceOverride = DEVICE;
  const snap = captureOverrides(s);
  await clearOverrides(s, snap);
  calls.length = 0;
  await restoreOverrides(s, snap);
  expect(calls).toEqual(['cache:true', 'device:iPhone']);
  expect(s.cacheDisabled).toBe(true);
  expect(s.deviceOverride).toEqual(DEVICE);
});

test('restoreOverrides keeps going after a failure and rethrows the first error', async () => {
  const { s, calls } = fakeSession({
    setThrottle: async () => {
      throw new Error('throttle boom');
    },
  });
  s.throttle = 'slow3g';
  s.cpuRate = 4;
  const snap = captureOverrides(s);
  await expect(restoreOverrides(s, snap)).rejects.toThrow('throttle boom');
  expect(calls).toContain('cpu:4');
});

test('withOverridesCleared clears, runs, and restores around success', async () => {
  const { s, calls } = fakeSession();
  s.throttle = 'slow3g';
  const result = await withOverridesCleared(s, async () => {
    expect(s.throttle).toBe('off');
    calls.push('audit');
    return 42;
  });
  expect(result).toBe(42);
  expect(calls).toEqual(['throttle:off', 'audit', 'throttle:slow3g']);
  expect(s.throttle).toBe('slow3g');
});

test('withOverridesCleared restores even when the audit fails', async () => {
  const { s } = fakeSession();
  s.cacheDisabled = true;
  await expect(
    withOverridesCleared(s, async () => {
      throw new Error('lighthouse failed');
    }),
  ).rejects.toThrow('lighthouse failed');
  expect(s.cacheDisabled).toBe(true);
});
