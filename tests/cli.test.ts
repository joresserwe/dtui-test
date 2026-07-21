import { test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, truncateSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { ArchiveApp } from '../src/tui/ArchiveApp.js';
import { loadArchive } from '../src/archive.js';

const RESTORE_LIMITATION = 'live JS state, WebSocket connections, and server-side state are not restored';

function makeSnapshotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dtui-cli-restore-'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ url: 'https://a.test/deep?x=1', origin: 'https://a.test', capturedAt: '2026-07-16T00:00:00.000Z' }));
  writeFileSync(join(dir, 'cookies.json'), JSON.stringify([{ name: 'sid', value: 'abc', domain: 'a.test', path: '/', expires: -1, httpOnly: false, secure: false }]));
  writeFileSync(join(dir, 'storage.json'), JSON.stringify({ local: [['k', 'v']], session: [['s', '1']] }));
  return dir;
}

let mock: MockCdp;
beforeAll(async () => { mock = await MockCdp.start(); });
afterAll(async () => { await mock.close(); });

function writeConfig(patch: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), 'dtui-cfg-'));
  mkdirSync(join(home, 'devtools-tui'), { recursive: true });
  writeFileSync(join(home, 'devtools-tui', 'config.json'), JSON.stringify(patch));
  return home;
}

function runCli(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('npx', ['tsx', 'src/cli.ts', ...args], {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('--list prints page targets', async () => {
  const res = await runCli(['--list', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(0);
  expect(res.stdout).toContain('Mock Page');
  expect(res.stdout).toContain('https://mock.test/');
});

test('fails with guidance when no endpoint exists', async () => {
  const res = await runCli(['--list', '--host', '127.0.0.1', '--port', '1']);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('--remote-debugging-port');
});

test('rejects an invalid --port', async () => {
  const res = await runCli(['--list', '--host', '127.0.0.1', '--port', 'abc']);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('Invalid --port');
});

test('config port is used when no --port flag is given', async () => {
  const home = writeConfig({ port: mock.port });
  const res = await runCli(['--list', '--host', '127.0.0.1'], { XDG_CONFIG_HOME: home });
  expect(res.code).toBe(0);
  expect(res.stdout).toContain('Mock Page');
});

test('an explicit --port overrides the config port', async () => {
  const home = writeConfig({ port: 1 });
  const res = await runCli(['--list', '--host', '127.0.0.1', '--port', String(mock.port)], { XDG_CONFIG_HOME: home });
  expect(res.code).toBe(0);
  expect(res.stdout).toContain('Mock Page');
});

test('rejects an invalid --profile', async () => {
  const res = await runCli(['--list', '--profile', 'bogus', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('Invalid --profile');
});

test('rejects more than one url', async () => {
  const res = await runCli(['--list', 'a.test', 'b.test', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('At most one url');
});

test('a positional url opens a new tab and prefixes a bare host', async () => {
  const opened: string[] = [];
  mock.respond('Target.createTarget', params => {
    opened.push(params.url);
    return { targetId: 'newtab' };
  });
  const res = await runCli(['--list', 'example.com', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(0);
  expect(opened).toEqual(['https://example.com']);
});

test('a positional url with a scheme is opened as-is', async () => {
  const opened: string[] = [];
  mock.respond('Target.createTarget', params => {
    opened.push(params.url);
    return { targetId: 'newtab' };
  });
  const res = await runCli(['--list', 'http://already.test/x', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(0);
  expect(opened).toEqual(['http://already.test/x']);
});

test('normalizeUrl prefixes bare authorities and preserves real schemes', async () => {
  const cases: [string, string][] = [
    ['localhost:3000', 'https://localhost:3000'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['https://a.b', 'https://a.b'],
    ['about:blank', 'about:blank'],
    ['chrome://version', 'chrome://version'],
    ['data:text/html,hi', 'data:text/html,hi'],
  ];
  for (const [input, expected] of cases) {
    const opened: string[] = [];
    mock.respond('Target.createTarget', params => {
      opened.push(params.url);
      return { targetId: 'newtab' };
    });
    const res = await runCli(['--list', input, '--host', '127.0.0.1', '--port', String(mock.port)]);
    expect(res.code).toBe(0);
    expect(opened).toEqual([expected]);
  }
}, 30_000);

function spawnCli(args: string[], env?: NodeJS.ProcessEnv): {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
  waitForStdout: (needle: string) => Promise<void>;
  exit: Promise<number | null>;
} {
  const child = spawn('npx', ['tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    shell: process.platform === 'win32',
    env: env ? { ...process.env, ...env } : process.env,
  });
  let out = '', err = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (err += d));
  return {
    child,
    stdout: () => out,
    stderr: () => err,
    waitForStdout: needle => new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (out.includes(needle)) { clearInterval(timer); resolve(); }
      }, 50);
      child.on('close', () => { clearInterval(timer); reject(new Error(`process exited before "${needle}"; stdout=${out} stderr=${err}`)); });
    }),
    exit: new Promise(resolve => child.on('close', code => resolve(code))),
  };
}

test('flushes session when the browser closes the connection', async () => {
  const closeMock = await MockCdp.start();
  const root = mkdtempSync(join(tmpdir(), 'devtools-tui-'));
  const cli = spawnCli(['--host', '127.0.0.1', '--port', String(closeMock.port), '--session-root', root]);

  await cli.waitForStdout('attached:');
  await closeMock.close();

  const code = await cli.exit;
  expect(code).toBe(0);
  expect(cli.stderr()).toContain('connection closed by browser');

  const dirs = readdirSync(root);
  expect(dirs.length).toBe(1);
  expect(existsSync(join(root, dirs[0], 'session.har'))).toBe(true);
}, 10_000);

test('a headless positional url attaches the created tab, not the first page', async () => {
  const attachMock = await MockCdp.start();
  attachMock.pages = [{ id: 'first', title: 'First Tab', url: 'https://first.test/' }];
  attachMock.respond('Target.createTarget', params => {
    attachMock.pages.push({ id: 'created-tab', title: 'Created Tab', url: params.url });
    return { targetId: 'created-tab' };
  });
  const cli = spawnCli(['https://created.test/', '--no-persist', '--host', '127.0.0.1', '--port', String(attachMock.port)]);
  try {
    await cli.waitForStdout('attached:');
    expect(cli.stdout()).toContain('created.test');
    expect(cli.stdout()).not.toContain('First Tab');
  } finally {
    await attachMock.close();
    await cli.exit;
  }
}, 10_000);

test('--profile is ignored in headless mode with a stderr warning', async () => {
  const res = await runCli(['--list', '--profile', 'temp', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(0);
  expect(res.stderr).toContain('--profile is ignored in headless mode');
});

test('prunes over-budget sessions on the headless attach path', async () => {
  const pruneMock = await MockCdp.start();
  const root = mkdtempSync(join(tmpdir(), 'devtools-tui-prune-'));
  const ancient = join(root, 'ancient');
  mkdirSync(ancient);
  const big = join(ancient, 'network.jsonl');
  writeFileSync(big, '');
  truncateSync(big, 600 * 1024 * 1024);
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(ancient, past, past);

  const cli = spawnCli(['--host', '127.0.0.1', '--port', String(pruneMock.port), '--session-root', root]);
  try {
    await cli.waitForStdout('attached:');
    expect(existsSync(ancient)).toBe(false);
  } finally {
    await pruneMock.close();
    await cli.exit;
  }
}, 10_000);

test('config bodyCapBytes reaches the headless attach and truncates oversized bodies', async () => {
  const capMock = await MockCdp.start();
  const home = writeConfig({ bodyCapBytes: 10 });
  const root = mkdtempSync(join(tmpdir(), 'devtools-tui-cap-'));
  const cli = spawnCli(['--host', '127.0.0.1', '--port', String(capMock.port), '--session-root', root], { XDG_CONFIG_HOME: home });
  try {
    await cli.waitForStdout('attached:');
    capMock.emitEvent('Network.requestWillBeSent', {
      requestId: 'cap1', timestamp: 1, wallTime: 1700000000, type: 'XHR',
      request: { url: 'https://a.test/api/cap-me', method: 'GET', headers: {} },
    });
    capMock.emitEvent('Network.responseReceived', {
      requestId: 'cap1', timestamp: 1.1, type: 'XHR',
      response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
    });
    capMock.emitEvent('Network.loadingFinished', { requestId: 'cap1', timestamp: 1.2, encodedDataLength: 5000 });
    await cli.waitForStdout('cap-me');
  } finally {
    await capMock.close();
    await cli.exit;
  }
  const dirs = readdirSync(root);
  expect(dirs).toHaveLength(1);
  const net = JSON.parse(readFileSync(join(root, dirs[0], 'network.jsonl'), 'utf8').trim());
  expect(net).toMatchObject({ id: 'cap1', bodyTruncated: true });
}, 10_000);

test('a restore in a headless (non-TTY) run reports the tab and the archive hint without a viewer', async () => {
  const restoreMock = await MockCdp.start();
  restoreMock.respond('Target.createTarget', () => ({ targetId: 'page1' }));
  const dir = makeSnapshotDir();
  const res = await runCli(['--restore', dir, '--host', '127.0.0.1', '--port', String(restoreMock.port)]);
  await restoreMock.close();
  expect(res.code).toBe(0);
  expect(res.stdout).toContain('restored https://a.test/deep?x=1 into a new tab');
  expect(res.stdout).toContain(RESTORE_LIMITATION);
  expect(res.stdout).toContain(`view history: devtools-tui --archive ${dir}`);
  expect(res.stdout).not.toContain('archive:');
}, 10_000);

test('--tui without a TTY fails with guidance', async () => {
  const res = await runCli(['--tui', '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('TUI requires a TTY');
});

test('help documents the browser picker flag', async () => {
  const res = await runCli(['--help']);
  expect(res.code).toBe(0);
  expect(res.stdout).toContain('--browser-path');
});

test('help documents restore and archive', async () => {
  const res = await runCli(['--help']);
  expect(res.code).toBe(0);
  expect(res.stdout).toContain('--restore');
  expect(res.stdout).toContain('--archive');
});

test('archive of a missing dir errors', async () => {
  const res = await runCli(['--archive', '/no/such/dtui-archive-xyz']);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('No such archive');
});

test('archive of a malformed .har file errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dtui-cli-har-'));
  const file = join(dir, 'broken.har');
  writeFileSync(file, 'not json');
  const res = await runCli(['--archive', file]);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('Could not read archive');
});

test('archive accepts a valid .har file up to the TTY requirement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dtui-cli-har2-'));
  const file = join(dir, 'ok.har');
  writeFileSync(file, JSON.stringify({ log: { version: '1.2', entries: [] } }));
  const res = await runCli(['--archive', file]);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('--archive requires a TTY.');
});

test('a .har archive renders in the viewer with an empty console tab', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dtui-cli-har3-'));
  const file = join(dir, 'session.har');
  writeFileSync(file, JSON.stringify({
    log: {
      version: '1.2',
      entries: [{
        startedDateTime: '2026-07-17T00:00:00.000Z',
        time: 42,
        request: { url: 'https://a.test/api/from-har', method: 'GET', headers: [] },
        response: { status: 200, statusText: 'OK', content: { mimeType: 'application/json' }, headers: [] },
      }],
    },
  }));
  const data = loadArchive(file);
  expect(data.console).toEqual([]);
  const { lastFrame } = render(React.createElement(ArchiveApp, { data }));
  const frame = lastFrame()!;
  expect(frame).toContain('archive:');
  expect(frame).toContain('from-har');
});

test('restore without a TTY prints the hint and full limitation text', async () => {
  mock.respond('Target.createTarget', () => ({ targetId: 'page1' }));
  const dir = makeSnapshotDir();
  const res = await runCli(['--restore', dir, '--host', '127.0.0.1', '--port', String(mock.port)]);
  expect(res.code).toBe(0);
  expect(res.stdout).toContain(`view history: devtools-tui --archive ${dir}`);
  expect(res.stdout).toContain(RESTORE_LIMITATION);
});

test('restore in a TTY renders the archive view with the limitation', () => {
  const dir = makeSnapshotDir();
  const { lastFrame } = render(React.createElement(ArchiveApp, { data: loadArchive(dir), limitation: RESTORE_LIMITATION }));
  const frame = lastFrame()!;
  expect(frame).toContain('archive:');
  expect(frame).toContain(RESTORE_LIMITATION);
});
