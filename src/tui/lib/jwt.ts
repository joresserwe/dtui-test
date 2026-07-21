import { header } from '../../util/headers.js';

export interface JwtToken {
  source: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

// Base64url of '{"' is "eyJ", so a JSON-header JWT always starts with it.
const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

function parseSegment(seg: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function decodeJwt(raw: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  if (!JWT_SHAPE.test(raw)) return null;
  const [h, p] = raw.split('.');
  const head = parseSegment(h);
  const payload = parseSegment(p);
  return head && payload ? { header: head, payload } : null;
}

function cookiePairJwt(pair: string): JwtToken | null {
  const eq = pair.indexOf('=');
  if (eq < 0) return null;
  const decoded = decodeJwt(pair.slice(eq + 1).trim());
  return decoded ? { source: pair.slice(0, eq).trim(), ...decoded } : null;
}

export function requestJwts(headers: Record<string, string>): JwtToken[] {
  const out: JwtToken[] = [];
  const bearer = /^Bearer\s+(\S+)$/i.exec(header(headers, 'authorization').trim());
  if (bearer) {
    const decoded = decodeJwt(bearer[1]);
    if (decoded) out.push({ source: 'Authorization', ...decoded });
  }
  for (const part of header(headers, 'cookie').split(';')) {
    const tok = cookiePairJwt(part);
    if (tok) out.push(tok);
  }
  return out;
}

export function setCookieJwts(lines: string[]): JwtToken[] {
  const out: JwtToken[] = [];
  for (const line of lines) {
    const tok = cookiePairJwt(line.split(';', 1)[0]);
    if (tok) out.push(tok);
  }
  return out;
}
