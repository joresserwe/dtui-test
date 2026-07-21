import type { DeviceOverrideState, ThrottleName } from '../engine.js';

export interface OverridableSession {
  throttle: ThrottleName;
  cacheDisabled: boolean;
  deviceOverride: DeviceOverrideState | null;
  cpuRate: number;
  setThrottle(name: ThrottleName): Promise<void>;
  setCacheDisabled(disabled: boolean): Promise<void>;
  setDeviceOverride(preset: DeviceOverrideState | null): Promise<void>;
  setCpuThrottling(rate: number): Promise<void>;
}

export interface OverrideSnapshot {
  throttle: ThrottleName;
  cacheDisabled: boolean;
  device: DeviceOverrideState | null;
  cpuRate: number;
}

export function captureOverrides(s: OverridableSession): OverrideSnapshot {
  return {
    throttle: s.throttle,
    cacheDisabled: s.cacheDisabled,
    device: s.deviceOverride,
    cpuRate: s.cpuRate,
  };
}

export function hasActiveOverrides(snap: OverrideSnapshot): boolean {
  return snap.throttle !== 'off' || snap.cacheDisabled || snap.device !== null || snap.cpuRate !== 1;
}

export async function clearOverrides(s: OverridableSession, snap: OverrideSnapshot): Promise<void> {
  if (snap.throttle !== 'off') await s.setThrottle('off');
  if (snap.cacheDisabled) await s.setCacheDisabled(false);
  if (snap.device !== null) await s.setDeviceOverride(null);
  if (snap.cpuRate !== 1) await s.setCpuThrottling(1);
}

export async function restoreOverrides(s: OverridableSession, snap: OverrideSnapshot): Promise<void> {
  let firstError: unknown;
  const attempt = async (active: boolean, fn: () => Promise<void>) => {
    if (!active) return;
    try {
      await fn();
    } catch (e) {
      firstError ??= e;
    }
  };
  await attempt(snap.throttle !== 'off', () => s.setThrottle(snap.throttle));
  await attempt(snap.cacheDisabled, () => s.setCacheDisabled(true));
  await attempt(snap.device !== null, () => s.setDeviceOverride(snap.device));
  await attempt(snap.cpuRate !== 1, () => s.setCpuThrottling(snap.cpuRate));
  if (firstError !== undefined) throw firstError;
}

export async function withOverridesCleared<T>(s: OverridableSession, fn: () => Promise<T>): Promise<T> {
  const snap = captureOverrides(s);
  await clearOverrides(s, snap);
  try {
    return await fn();
  } finally {
    await restoreOverrides(s, snap);
  }
}
