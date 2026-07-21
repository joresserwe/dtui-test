import { test, expect } from 'vitest';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { socketDir, socketPath, startLiveHost, type HostDelegate } from '../src/mcp/host.js';
import { LiveClient, LiveSessionSource, detectLiveClient } from '../src/mcp/live-source.js';
import type { SessionInfo } from '../src/mcp/source.js';
import type { NetworkEntry } from '../src/store/types.js';

const INFO: SessionInfo = {
  id: 'live-1', startedAt: '2026-07-20T00:00:00.000Z', urlSlug: 'shop-test', path: '/tmp/live-1',
  networkCount: 1, consoleCount: 1,
};

const NET: NetworkEntry = {
  id: 'n1', url: 'https://shop.test/api', method: 'GET', type: 'XHR',
  requestHeaders: {}, responseHeaders: {}, startTs: 1_000, status: 200,
};

function delegate(over: Partial<HostDelegate> = {}): HostDelegate {
  return {
    listSessions: () => [INFO, { ...INFO, id: 'live-2' }],
    readNetwork: id => (id === 'live-1' ? [NET] : []),
    readRequest: (session, id) => (session === 'live-1' && id === 'n1' ? { ...NET, body: '{"full":true}' } : undefined),
    readConsole: () => [{ kind: 'log', text: 'hello', ts: 2_000 }],
    listTabs: () => [{ id: 't1', url: 'https://shop.test/', title: 'Shop' }],
    selectedElement: () => ({
      url: 'https://shop.test/', capturedAt: '2026-07-20T00:00:01.000Z',
      selectorPath: 'div#app > button', missing: [],
    }),
    screenshot: target => ({ data: Buffer.from(`${target}-shot`).toString('base64'), mimeType: 'image/png' }),
    ...over,
  };
}

async function tmpSock(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dtui-sock-')), `${process.pid}.sock`);
}

test('socketDir prefers XDG_RUNTIME_DIR and falls back under XDG_DATA_HOME', () => {
  expect(socketDir({ XDG_RUNTIME_DIR: '/run/user/1' })).toBe('/run/user/1/devtools-tui');
  expect(socketDir({ XDG_DATA_HOME: '/data' })).toBe('/data/devtools-tui/run');
  expect(socketPath(42, '/run/user/1/devtools-tui')).toBe('/run/user/1/devtools-tui/42.sock');
});

test('host answers ping and delegate methods over the socket', async () => {
  const path = await tmpSock();
  const host = await startLiveHost(() => delegate(), path);
  try {
    const client = await LiveClient.connect(path);
    expect(await client.call('ping')).toMatchObject({ ok: true });
    const src = new LiveSessionSource(client);
    expect((await src.listSessions()).map(s => s.id)).toEqual(['live-1', 'live-2']);
    expect((await src.listSessions(1)).map(s => s.id)).toEqual(['live-1']);
    expect(await src.readNetwork('live-1')).toEqual([NET]);
    expect(await src.readNetwork('other')).toEqual([]);
    expect(await src.readRequest('live-1', 'n1')).toEqual({ ...NET, body: '{"full":true}' });
    expect(await src.readRequest('live-1', 'missing')).toBeUndefined();
    expect((await src.readConsole('live-1'))[0]).toMatchObject({ text: 'hello' });
    expect(await src.live.listTabs()).toEqual([{ id: 't1', url: 'https://shop.test/', title: 'Shop' }]);
    expect((await src.live.selectedElement()).selectorPath).toBe('div#app > button');
    const shot = await src.live.screenshot('element');
    expect(Buffer.from(shot.data, 'base64').toString()).toBe('element-shot');
    client.close();
  } finally {
    await host.close();
  }
});

test('host socket is 0600 and removed on close', async () => {
  const path = await tmpSock();
  const host = await startLiveHost(() => delegate(), path);
  expect(((await stat(path)).mode & 0o777)).toBe(0o600);
  await host.close();
  expect(existsSync(path)).toBe(false);
});

test('delegate errors travel back as error frames without killing the connection', async () => {
  const path = await tmpSock();
  const host = await startLiveHost(() => delegate({
    selectedElement: () => { throw new Error('no element selected in the TUI'); },
  }), path);
  try {
    const client = await LiveClient.connect(path);
    const src = new LiveSessionSource(client);
    await expect(src.live.selectedElement()).rejects.toThrow(/no element selected/);
    expect((await src.listSessions()).length).toBe(2);
    client.close();
  } finally {
    await host.close();
  }
});

test('unknown methods and a missing delegate produce errors', async () => {
  const path = await tmpSock();
  let ready = false;
  const host = await startLiveHost(() => (ready ? delegate() : null), path);
  try {
    const client = await LiveClient.connect(path);
    expect(await client.call('ping')).toMatchObject({ ok: true });
    await expect(client.call('list_tabs')).rejects.toThrow(/TUI not ready/);
    ready = true;
    expect(await client.call('list_tabs')).toHaveLength(1);
    await expect(client.call('bogus_method')).rejects.toThrow(/unknown method/);
    client.close();
  } finally {
    await host.close();
  }
});

test('startLiveHost replaces a stale socket file', async () => {
  const path = await tmpSock();
  await writeFile(path, '');
  const host = await startLiveHost(() => delegate(), path);
  try {
    const client = await LiveClient.connect(path);
    expect(await client.call('ping')).toMatchObject({ ok: true });
    client.close();
  } finally {
    await host.close();
  }
});

test('detectLiveClient finds a responsive socket and prunes dead ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-sockdir-'));
  const dead = join(dir, '111.sock');
  await writeFile(dead, '');
  expect(await detectLiveClient(dir)).toBeNull();
  expect(existsSync(dead)).toBe(false);
  const live = join(dir, '222.sock');
  const host = await startLiveHost(() => delegate(), live);
  try {
    const client = await detectLiveClient(dir);
    expect(client).not.toBeNull();
    expect(await client!.call('list_tabs')).toHaveLength(1);
    client!.close();
  } finally {
    await host.close();
  }
});

test('detectLiveClient returns null for a missing directory', async () => {
  expect(await detectLiveClient('/nonexistent/dtui-run-dir')).toBeNull();
});

test('startLiveHost warns on stderr when the socket path exceeds the sun_path limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-longsock-'));
  const path = join(dir, 'x'.repeat(120) + '.sock');
  const { vi } = await import('vitest');
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(startLiveHost(() => delegate(), path)).rejects.toThrow();
    expect(spy.mock.calls.flat().join(' ')).toMatch(/socket path/);
  } finally {
    spy.mockRestore();
  }
});

test('client calls reject once the host goes away', async () => {
  const path = await tmpSock();
  const host = await startLiveHost(() => delegate(), path);
  const client = await LiveClient.connect(path);
  expect(await client.call('ping')).toMatchObject({ ok: true });
  await host.close();
  await expect(client.call('list_tabs')).rejects.toThrow(/connection closed/);
});
