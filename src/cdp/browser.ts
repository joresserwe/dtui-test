import { CdpConnection } from './connection.js';
import type { Endpoint } from './discovery.js';

export class BrowserSession {
  private constructor(private conn: CdpConnection) {}

  static async connect(ep: Endpoint, fetchFn: typeof fetch = fetch): Promise<BrowserSession> {
    const res = await fetchFn(`http://${ep.host}:${ep.port}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`Browser version probe failed: HTTP ${res.status}`);
    const v = (await res.json()) as { webSocketDebuggerUrl?: string };
    if (!v.webSocketDebuggerUrl) throw new Error('Browser exposes no webSocketDebuggerUrl');
    const wsUrl = v.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://${ep.host}:${ep.port}`);
    return new BrowserSession(await CdpConnection.open(wsUrl));
  }

  async createTab(url = 'about:blank', opts: { incognito?: boolean } = {}): Promise<string> {
    let browserContextId: string | undefined;
    if (opts.incognito) {
      ({ browserContextId } = await this.conn.send<{ browserContextId: string }>('Target.createBrowserContext'));
    }
    const { targetId } = await this.conn.send<{ targetId: string }>('Target.createTarget', {
      url,
      ...(browserContextId ? { browserContextId } : {}),
    });
    return targetId;
  }

  async windowIdFor(targetId: string): Promise<number | null> {
    try {
      const { windowId } = await this.conn.send<{ windowId: number }>('Browser.getWindowForTarget', { targetId });
      return windowId;
    } catch {
      return null;
    }
  }

  close(): void {
    this.conn.close();
  }
}
