import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp/server.js';
import { JsonlSessionSource, type SessionSource } from '../src/mcp/source.js';

async function connectedSource(source: SessionSource): Promise<Client> {
  const server = buildServer(source);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function connectedClient(root: string): Promise<Client> {
  return connectedSource(new JsonlSessionSource(root));
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dtui-mcp-srv-'));
  const dir = join(root, '2026-07-19T09-30-00-api-example-com');
  await mkdir(dir);
  await writeFile(join(dir, 'network.jsonl'), JSON.stringify({
    id: 'n1', url: 'https://api.example.com/users', method: 'GET', type: 'XHR',
    requestHeaders: { Authorization: 'Bearer secret' }, responseHeaders: {},
    startTs: Date.UTC(2026, 6, 19, 9, 30, 1), status: 200, mimeType: 'application/json',
  }) + '\n');
  return root;
}

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe('text');
  return content[0].text;
}

test('server exposes the eleven tools', async () => {
  const client = await connectedClient(await makeRoot());
  const { tools } = await client.listTools();
  expect(tools.map(t => t.name).sort()).toEqual([
    'audit_failing', 'audit_run', 'audit_summary',
    'console_messages', 'get_request', 'list_sessions', 'list_tabs', 'network_search',
    'recorder_list', 'recorder_replay',
    'selected_element', 'session_summary', 'take_screenshot',
  ]);
  await client.close();
});

test('tools return compact JSON over the protocol', async () => {
  const client = await connectedClient(await makeRoot());
  const sessions = JSON.parse(textOf(await client.callTool({ name: 'list_sessions', arguments: {} })));
  expect(sessions).toHaveLength(1);
  expect(sessions[0].id).toBe('2026-07-19T09-30-00-api-example-com');
  const { rows, cursor } = JSON.parse(textOf(await client.callTool({ name: 'network_search', arguments: { url_pattern: 'users' } })));
  expect(rows.map((r: { id: string }) => r.id)).toEqual(['n1']);
  expect(cursor).toBe(Date.UTC(2026, 6, 19, 9, 30, 1));
  const detail = JSON.parse(textOf(await client.callTool({ name: 'get_request', arguments: { id: 'n1' } })));
  expect(detail.requestHeaders.Authorization).toBe('[redacted]');
  await client.close();
});

test('handler errors surface as isError results, not protocol failures', async () => {
  const client = await connectedClient(await makeRoot());
  const result = await client.callTool({ name: 'network_search', arguments: { session: 'nope' } });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toMatch(/unknown session/);
  await client.close();
});

test('live-only tools answer with guidance errors on a files source', async () => {
  const client = await connectedClient(await makeRoot());
  for (const call of [
    { name: 'list_tabs', arguments: {} },
    { name: 'selected_element', arguments: {} },
    { name: 'take_screenshot', arguments: { target: 'viewport' } },
  ]) {
    const result = await client.callTool(call);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/running devtools-tui/);
  }
  await client.close();
});

function liveSource(): SessionSource {
  return {
    kind: 'live',
    listSessions: async () => [{ id: 'live-1', startedAt: '2026-07-20T00:00:00.000Z', urlSlug: 's', path: '', networkCount: 0, consoleCount: 0 }],
    readNetwork: async () => [],
    readConsole: async () => [],
    live: {
      listTabs: async () => [{ id: 't1', url: 'https://shop.test/', title: 'Shop' }],
      selectedElement: async () => ({
        url: 'https://shop.test/', capturedAt: '2026-07-20T00:00:01.000Z', selectorPath: 'div#app', missing: [],
      }),
      screenshot: async target => ({ data: Buffer.from(`${target}-shot`).toString('base64'), mimeType: 'image/png' }),
    },
  };
}

test('take_screenshot returns MCP image content from a live source', async () => {
  const client = await connectedSource(liveSource());
  const result = await client.callTool({ name: 'take_screenshot', arguments: { target: 'element' } });
  const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe('image');
  expect(content[0].mimeType).toBe('image/png');
  expect(Buffer.from(content[0].data!, 'base64').toString()).toBe('element-shot');
  await client.close();
});

test('selected_element and list_tabs work over the protocol against a live source', async () => {
  const client = await connectedSource(liveSource());
  const tabs = JSON.parse(textOf(await client.callTool({ name: 'list_tabs', arguments: {} })));
  expect(tabs).toEqual([{ id: 't1', url: 'https://shop.test/', title: 'Shop' }]);
  const el = JSON.parse(textOf(await client.callTool({ name: 'selected_element', arguments: {} })));
  expect(el.selectorPath).toBe('div#app');
  const summary = JSON.parse(textOf(await client.callTool({ name: 'session_summary', arguments: {} })));
  expect(summary.source).toBe('live');
  await client.close();
});
