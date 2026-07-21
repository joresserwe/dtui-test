import type { CdpConnection } from './connection.js';

export interface ScreenOrientation {
  type: 'portraitPrimary' | 'landscapePrimary';
  angle: number;
}

export interface DeviceMetrics {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  screenOrientation?: ScreenOrientation;
}

export async function setDeviceMetrics(conn: CdpConnection, m: DeviceMetrics): Promise<void> {
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: m.width,
    height: m.height,
    deviceScaleFactor: m.deviceScaleFactor,
    mobile: m.mobile,
    ...(m.screenOrientation ? { screenOrientation: m.screenOrientation } : {}),
  });
}

export async function clearDeviceMetrics(conn: CdpConnection): Promise<void> {
  await conn.send('Emulation.clearDeviceMetricsOverride');
}

export async function setCpuThrottling(conn: CdpConnection, rate: number): Promise<void> {
  await conn.send('Emulation.setCPUThrottlingRate', { rate });
}

export interface GeoOverride {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export async function setGeolocation(conn: CdpConnection, g: GeoOverride): Promise<void> {
  await conn.send('Emulation.setGeolocationOverride', {
    latitude: g.latitude,
    longitude: g.longitude,
    accuracy: g.accuracy,
  });
}

export async function clearGeolocation(conn: CdpConnection): Promise<void> {
  await conn.send('Emulation.clearGeolocationOverride');
}

export interface MediaFeature {
  name: string;
  value: string;
}

export async function setEmulatedMedia(
  conn: CdpConnection,
  opts: { media?: string; features?: MediaFeature[] },
): Promise<void> {
  await conn.send('Emulation.setEmulatedMedia', {
    media: opts.media ?? '',
    features: opts.features ?? [],
  });
}

export type VisionDeficiency =
  | 'none'
  | 'blurredVision'
  | 'reducedContrast'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'achromatopsia';

export async function setVisionDeficiency(conn: CdpConnection, type: VisionDeficiency): Promise<void> {
  await conn.send('Emulation.setEmulatedVisionDeficiency', { type });
}

export async function setPaintFlashing(conn: CdpConnection, on: boolean): Promise<void> {
  await conn.send('Overlay.enable');
  await conn.send('Overlay.setShowPaintRects', { result: on });
}

export async function setTimezoneOverride(conn: CdpConnection, timezoneId: string): Promise<void> {
  await conn.send('Emulation.setTimezoneOverride', { timezoneId });
}

export async function setTouchEmulation(conn: CdpConnection, enabled: boolean, maxTouchPoints = 1): Promise<void> {
  await conn.send('Emulation.setTouchEmulationEnabled', { enabled, maxTouchPoints });
  await conn.send('Emulation.setEmitTouchEventsForMouse', { enabled, configuration: 'mobile' });
}

export interface UaBrand {
  brand: string;
  version: string;
}

export interface UserAgentMetadata {
  brands: UaBrand[];
  fullVersion?: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
}

export interface UserAgentOverride {
  userAgent: string;
  acceptLanguage?: string;
  platform?: string;
  userAgentMetadata?: UserAgentMetadata;
}

export async function setUserAgentOverride(conn: CdpConnection, o: UserAgentOverride): Promise<void> {
  await conn.send('Emulation.setUserAgentOverride', {
    userAgent: o.userAgent,
    ...(o.acceptLanguage ? { acceptLanguage: o.acceptLanguage } : {}),
    ...(o.platform ? { platform: o.platform } : {}),
    ...(o.userAgentMetadata ? { userAgentMetadata: o.userAgentMetadata } : {}),
  });
}

export async function setLocaleOverride(conn: CdpConnection, locale: string | null): Promise<void> {
  await conn.send('Emulation.setLocaleOverride', locale ? { locale } : {});
}

export async function setAutoDarkMode(conn: CdpConnection, enabled: boolean): Promise<void> {
  await conn.send('Emulation.setAutoDarkModeOverride', enabled ? { enabled: true } : {});
}

export interface IdleState {
  isUserActive: boolean;
  isScreenUnlocked: boolean;
}

export async function setIdleOverride(conn: CdpConnection, s: IdleState): Promise<void> {
  await conn.send('Emulation.setIdleOverride', { isUserActive: s.isUserActive, isScreenUnlocked: s.isScreenUnlocked });
}

export async function clearIdleOverride(conn: CdpConnection): Promise<void> {
  await conn.send('Emulation.clearIdleOverride');
}

export interface OrientationReading {
  alpha: number;
  beta: number;
  gamma: number;
}

const ORIENTATION_SENSOR_TYPE = 'relative-orientation';

function orientationQuaternion({ alpha, beta, gamma }: OrientationReading): { x: number; y: number; z: number; w: number } {
  const half = (deg: number) => (deg * Math.PI) / 360;
  const [cZ, cX, cY] = [half(alpha), half(beta), half(gamma)].map(Math.cos);
  const [sZ, sX, sY] = [half(alpha), half(beta), half(gamma)].map(Math.sin);
  return {
    x: sX * cY * cZ - cX * sY * sZ,
    y: cX * sY * cZ + sX * cY * sZ,
    z: cX * cY * sZ + sX * sY * cZ,
    w: cX * cY * cZ - sX * sY * sZ,
  };
}

export async function setSensorOverride(conn: CdpConnection, o: OrientationReading): Promise<void> {
  // setSensorOverrideReadings errors unless the sensor is enabled first; enable must precede readings.
  await conn.send('Emulation.setSensorOverrideEnabled', { enabled: true, type: ORIENTATION_SENSOR_TYPE });
  await conn.send('Emulation.setSensorOverrideReadings', {
    type: ORIENTATION_SENSOR_TYPE,
    reading: { quaternion: orientationQuaternion(o) },
  });
}

export async function clearSensorOverride(conn: CdpConnection): Promise<void> {
  await conn.send('Emulation.setSensorOverrideEnabled', { enabled: false, type: ORIENTATION_SENSOR_TYPE });
}
