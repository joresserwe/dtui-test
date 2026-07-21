import { THROTTLE_PROFILES, type NetworkConditions, type ThrottleName } from '../../engine.js';

export function effectiveConditions(throttle: ThrottleName, custom: NetworkConditions | null): NetworkConditions | null {
  if (custom) return custom;
  const preset = THROTTLE_PROFILES[throttle as keyof typeof THROTTLE_PROFILES];
  return preset ? { ...preset } : null;
}

export function formatConditionsText(c: NetworkConditions | null): string {
  return [
    '# network conditions — LATENCY in ms; DOWNLOAD/UPLOAD in bytes/sec, 0 or -1 = unlimited',
    `OFFLINE ${c?.offline ?? false}`,
    `LATENCY ${c?.latency ?? 0}`,
    `DOWNLOAD ${c?.downloadThroughput ?? -1}`,
    `UPLOAD ${c?.uploadThroughput ?? -1}`,
    '',
  ].join('\n');
}

const BOOL: Record<string, boolean> = { true: true, false: false, on: true, off: false, '1': true, '0': false };

export function parseConditionsText(text: string): NetworkConditions | null {
  const out: NetworkConditions = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  let any = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(\S+)\s+(\S+)$/.exec(line);
    if (!m) return null;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === 'offline') {
      const b = BOOL[val.toLowerCase()];
      if (b === undefined) return null;
      out.offline = b;
    } else if (key === 'latency' || key === 'download' || key === 'upload') {
      const n = Number(val);
      if (!Number.isFinite(n)) return null;
      if (key === 'latency') out.latency = Math.max(0, n);
      else if (key === 'download') out.downloadThroughput = n <= 0 ? -1 : n;
      else out.uploadThroughput = n <= 0 ? -1 : n;
    } else {
      return null;
    }
    any = true;
  }
  return any ? out : null;
}

export const isUnthrottled = (c: NetworkConditions): boolean =>
  !c.offline && c.latency <= 0 && c.downloadThroughput <= 0 && c.uploadThroughput <= 0;
