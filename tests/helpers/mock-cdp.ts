import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export interface MockPage { id: string; title: string; url: string; noWs?: boolean }

export class MockCdp {
  port = 0;
  browser = 'MockChrome/1.0';
  pages: MockPage[] = [{ id: 'page1', title: 'Mock Page', url: 'https://mock.test/' }];
  activated: string[] = [];
  closed: string[] = [];
  private handlers = new Map<string, (params: any, pageId?: string) => unknown>();
  private swallowed = new Set<string>();
  private sockets = new Map<WebSocket, string | undefined>();
  private constructor(private server: Server, private wss: WebSocketServer) {}

  static start(): Promise<MockCdp> {
    return new Promise(resolve => {
      const server = createServer();
      const wss = new WebSocketServer({ server });
      const mock = new MockCdp(server, wss);

      server.on('request', (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/json/version') {
          res.end(JSON.stringify({
            Browser: mock.browser,
            'Protocol-Version': '1.3',
            webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/browser/mock-browser-id`,
          }));
        } else if (req.url === '/json/list' || req.url === '/json') {
          res.end(JSON.stringify(mock.pages.map(({ noWs, ...p }) => ({
            ...p,
            type: 'page',
            ...(noWs ? {} : { webSocketDebuggerUrl: mock.pageWsUrl(p.id) }),
          }))));
        } else if (req.url?.startsWith('/json/activate/')) {
          mock.activated.push(req.url.slice('/json/activate/'.length));
          res.end('{}');
        } else if (req.url?.startsWith('/json/close/')) {
          const id = req.url.slice('/json/close/'.length);
          mock.closed.push(id);
          mock.pages = mock.pages.filter(p => p.id !== id);
          mock.dropConnections(id);
          res.end('{}');
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });

      wss.on('connection', (ws, req) => {
        const pageId = /\/devtools\/page\/([^/?]+)/.exec(req.url ?? '')?.[1];
        mock.sockets.set(ws, pageId);
        ws.on('close', () => mock.sockets.delete(ws));
        ws.on('message', async raw => {
          const msg = JSON.parse(String(raw));
          if (mock.swallowed.has(msg.method)) return;
          const handler = mock.handlers.get(msg.method);
          try {
            const result = handler ? await handler(msg.params, mock.sockets.get(ws)) : {};
            ws.send(JSON.stringify({ id: msg.id, result }));
          } catch (e: any) {
            ws.send(JSON.stringify({ id: msg.id, error: { code: e.code ?? -32000, message: e.message ?? String(e) } }));
          }
        });
      });

      server.listen(0, '127.0.0.1', () => {
        mock.port = (server.address() as { port: number }).port;
        resolve(mock);
      });
    });
  }

  respond(method: string, handler: (params: any, pageId?: string) => unknown): void {
    this.handlers.set(method, handler);
  }

  swallow(method: string): void {
    this.swallowed.add(method);
  }

  emitEvent(method: string, params: object): void {
    const line = JSON.stringify({ method, params });
    for (const ws of this.sockets.keys()) ws.send(line);
  }

  emitEventTo(pageId: string, method: string, params: object): void {
    const line = JSON.stringify({ method, params });
    for (const [ws, id] of this.sockets) if (id === pageId) ws.send(line);
  }

  pageWsUrl(id: string): string {
    return `ws://127.0.0.1:${this.port}/devtools/page/${id}`;
  }

  dropConnections(pageId?: string): void {
    for (const [ws, id] of this.sockets) if (pageId === undefined || id === pageId) ws.terminate();
  }

  close(): Promise<void> {
    for (const ws of this.sockets.keys()) ws.terminate();
    this.wss.close();
    return new Promise(r => this.server.close(() => r()));
  }
}
