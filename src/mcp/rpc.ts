export function encodeFrame(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

export const DEFAULT_MAX_LINE_BYTES = 64 * 1024 * 1024;

export class LineDecoder {
  private buffer = Buffer.alloc(0);
  private skipping = false;

  constructor(private readonly maxLineBytes = DEFAULT_MAX_LINE_BYTES) {}

  push(chunk: Buffer | string): Record<string, unknown>[] {
    this.buffer = Buffer.concat([this.buffer, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk]);
    const out: Record<string, unknown>[] = [];
    for (;;) {
      const nl = this.buffer.indexOf(0x0a);
      if (nl === -1) {
        if (this.buffer.length > this.maxLineBytes) {
          this.buffer = Buffer.alloc(0);
          this.skipping = true;
        }
        break;
      }
      const raw = this.buffer.subarray(0, nl);
      this.buffer = this.buffer.subarray(nl + 1);
      if (this.skipping) {
        this.skipping = false;
        continue;
      }
      if (raw.length > this.maxLineBytes) continue;
      const line = raw.toString('utf8').trim();
      if (!line) continue;
      try {
        const value = JSON.parse(line);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) out.push(value);
      } catch {
        continue;
      }
    }
    return out;
  }
}

export interface RpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}
