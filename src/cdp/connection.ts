import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

export class CdpError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'CdpError';
  }
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class CdpConnection extends EventEmitter {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;

  private constructor(private ws: WebSocket) {
    super();
    ws.on('message', raw => this.onMessage(String(raw)));
    ws.on('close', () => this.onClose());
    ws.on('error', () => this.onClose());
  }

  static open(wsUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      // Some Chromium derivatives (e.g. Carbonyl) drop connections that
      // negotiate permessage-deflate.
      const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
      ws.once('open', () => resolve(new CdpConnection(ws)));
      ws.once('error', reject);
    });
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }), err => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  close(): void {
    this.ws.close();
  }

  private onMessage(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new CdpError(msg.error.code, msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.emit('event', msg.method, msg.params);
      this.emit(msg.method, msg.params);
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error('CDP connection closed'));
    this.pending.clear();
    this.emit('close');
  }
}
