import type { CdpConnection } from './connection.js';
import type { BoxModel } from './dom.js';

export function contentCenter(box: BoxModel | null): { x: number; y: number } | null {
  const q = box?.content;
  if (!q || q.length < 8) return null;
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  };
}

export async function synthClick(conn: CdpConnection, x: number, y: number): Promise<void> {
  await conn.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await conn.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

export async function synthHover(conn: CdpConnection, x: number, y: number): Promise<void> {
  await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
}

export async function insertText(conn: CdpConnection, text: string): Promise<void> {
  await conn.send('Input.insertText', { text });
}

export interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

export const REPLAY_KEYS: Record<string, KeyDef> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9, text: '\t' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
};

export async function dispatchKey(conn: CdpConnection, def: KeyDef): Promise<void> {
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
  };
  await conn.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, ...(def.text ? { text: def.text } : {}) });
  if (def.text) await conn.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: def.text, unmodifiedText: def.text });
  await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
