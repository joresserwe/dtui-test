import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CdpConnection } from './cdp/connection.js';
import type { CookieInfo } from './cdp/storage.js';
import { setCookie, setStorageItem } from './cdp/storage.js';

export interface SnapshotData {
  meta: { url: string; origin: string; capturedAt: string };
  cookies: CookieInfo[];
  local: Array<[string, string]>;
  session: Array<[string, string]>;
}

export function loadSnapshot(dir: string): SnapshotData {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const cookies = JSON.parse(readFileSync(join(dir, 'cookies.json'), 'utf8'));
  const storage = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
  return { meta, cookies, local: storage.local ?? [], session: storage.session ?? [] };
}

export interface RestoreDeps {
  createTab: (url: string) => Promise<string>;
  attach: (targetId: string) => Promise<CdpConnection>;
}

export async function restoreSnapshot(dir: string, deps: RestoreDeps): Promise<SnapshotData> {
  const data = loadSnapshot(dir);
  const targetId = await deps.createTab(data.meta.origin);
  const conn = await deps.attach(targetId);
  try {
    for (const c of data.cookies) await setCookie(conn, data.meta.url, c.name, c.value, {
      domain: c.domain, path: c.path, expires: c.expires,
      httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
    });
    for (const [k, v] of data.local) await setStorageItem(conn, data.meta.origin, true, k, v);
    for (const [k, v] of data.session) await setStorageItem(conn, data.meta.origin, false, k, v);
    await conn.send('Page.navigate', { url: data.meta.url });
    return data;
  } finally {
    conn.close();
  }
}
