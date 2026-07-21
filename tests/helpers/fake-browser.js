import { createServer } from 'node:http';

const portArg = process.argv.find(a => a.startsWith('--remote-debugging-port='));
const port = Number(portArg?.split('=')[1] ?? 0);

if (process.env.FAKE_NO_PORT === '1' || !port) {
  setInterval(() => {}, 60_000);
} else {
  createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/json/version') {
      res.end(JSON.stringify({
        Browser: 'FakeChrome/1.0',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake`,
      }));
    } else if (req.url === '/json/list' || req.url === '/json') {
      res.end('[]');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  }).listen(port, '127.0.0.1');
}
