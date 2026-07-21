import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockCdp } from './helpers/mock-cdp.js';
import { listPages } from '../src/cdp/targets.js';
import { DebugSession, THROTTLE_PROFILES, rewriteUrl } from '../src/engine.js';
import { waitUntil } from './helpers/wait-for.js';

let mock: MockCdp;
let root: string;

beforeEach(async () => {
  mock = await MockCdp.start();
  root = await mkdtemp(join(tmpdir(), 'dtui-engine-'));
});
afterEach(async () => { await mock.close(); });

async function attach(persist = true) {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  return DebugSession.attach(page, { sessionRoot: root, persist, browser: 'MockChrome/1.0' });
}

function feedRequest(id: string, mimeType = 'application/json') {
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: id, timestamp: 10, wallTime: 1700000000, type: 'XHR',
    request: { url: `https://a.test/${id}`, method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: id, timestamp: 10.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType, headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: id, timestamp: 10.2, encodedDataLength: 11 });
}

test('routes events to stores and fetches capped bodies', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: '{"ok":true}', base64Encoded: false }));
  const session = await attach(false);
  feedRequest('r1');
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'error', timestamp: 1, args: [{ type: 'string', value: 'boom' }] });
  await waitUntil(() => session.network.entries()[0]?.body === '{"ok":true}' && session.console.entries().length > 0);
  expect(session.network.entries()).toHaveLength(1);
  expect(session.network.entries()[0].body).toBe('{"ok":true}');
  expect(session.console.entries()[0]).toMatchObject({ kind: 'error', text: 'boom' });
  expect(session.sessionDir).toBeUndefined();
  await session.close();
});

test('skips bodies for non-text or oversized responses', async () => {
  let calls = 0;
  mock.respond('Network.getResponseBody', () => { calls++; return { body: 'x', base64Encoded: false }; });
  const session = await attach(false);
  feedRequest('img1', 'image/png');
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'big', timestamp: 20, wallTime: 1700000001, type: 'XHR',
    request: { url: 'https://a.test/big', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'big', timestamp: 20.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'big', timestamp: 20.2, encodedDataLength: 999_999_999 });
  await waitUntil(() => session.network.entries().length >= 2);
  expect(calls).toBe(0);
  await session.close();
});

test('persists network and console JSONL plus final HAR', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: '{"ok":true}', base64Encoded: false }));
  const session = await attach(true);
  expect(session.sessionDir).toBeDefined();
  feedRequest('r1');
  mock.emitEvent('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args: [{ type: 'string', value: 'hello' }] });
  await waitUntil(() => session.network.entries().length > 0 && session.console.entries().length > 0);
  await session.close();

  const files = await readdir(session.sessionDir!);
  expect(files.sort()).toEqual(['console.jsonl', 'network.jsonl', 'session.har']);
  const net = JSON.parse((await readFile(join(session.sessionDir!, 'network.jsonl'), 'utf8')).trim());
  expect(net).toMatchObject({ id: 'r1', status: 200, body: '{"ok":true}' });
  const har = JSON.parse(await readFile(join(session.sessionDir!, 'session.har'), 'utf8'));
  expect(har.log.entries).toHaveLength(1);
  expect(har.log.browser.name).toBe('MockChrome/1.0');
});

test('persistSanitize masks sensitive headers and cookies in JSONL but not in memory', async () => {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  const session = await DebugSession.attach(page, { sessionRoot: root, persist: true, browser: 'MockChrome/1.0', persistSanitize: true });
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 's1', timestamp: 10, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/s1', method: 'GET', headers: { Authorization: 'Bearer secret', Accept: 'application/json' } },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 's1', timestamp: 10.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'text/plain', headers: { 'Set-Cookie': 'sid=secret-cookie; HttpOnly', 'Content-Type': 'text/plain' } },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 's1', timestamp: 10.2, encodedDataLength: 999_999_999 });
  await waitUntil(() => session.network.entries().length > 0);
  await session.close();
  const line = JSON.parse((await readFile(join(session.sessionDir!, 'network.jsonl'), 'utf8')).trim());
  expect(line.requestHeaders).toEqual({ Authorization: '[redacted]', Accept: 'application/json' });
  expect(line.responseHeaders).toEqual({ 'Set-Cookie': '[redacted]', 'Content-Type': 'text/plain' });
  expect(line.setCookies).toEqual(['sid=[redacted]']);
  const mem = session.network.entries()[0];
  expect(mem.requestHeaders.Authorization).toBe('Bearer secret');
  expect(mem.responseHeaders['Set-Cookie']).toBe('sid=secret-cookie; HttpOnly');
  expect(mem.setCookies).toEqual(['sid=secret-cookie; HttpOnly']);
});

test('persistSanitize defaults off: JSONL keeps raw header values', async () => {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  const session = await DebugSession.attach(page, { sessionRoot: root, persist: true, browser: 'MockChrome/1.0' });
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'p1', timestamp: 10, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/p1', method: 'GET', headers: { Authorization: 'Bearer secret' } },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'p1', timestamp: 10.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'text/plain', headers: { 'Set-Cookie': 'sid=raw' } },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'p1', timestamp: 10.2, encodedDataLength: 999_999_999 });
  await waitUntil(() => session.network.entries().length > 0);
  await session.close();
  const line = JSON.parse((await readFile(join(session.sessionDir!, 'network.jsonl'), 'utf8')).trim());
  expect(line.requestHeaders.Authorization).toBe('Bearer secret');
  expect(line.setCookies).toEqual(['sid=raw']);
});

test('writes the session HAR only at close', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: '{"ok":true}', base64Encoded: false }));
  const session = await attach(true);
  feedRequest('r1');
  await waitUntil(() => session.network.entries().length > 0);
  await expect(readFile(join(session.sessionDir!, 'session.har'), 'utf8')).rejects.toThrow();
  await session.close();
  const har = JSON.parse(await readFile(join(session.sessionDir!, 'session.har'), 'utf8'));
  expect(har.log.entries).toHaveLength(1);
  expect(har.log.entries[0].response.content.text).toBe('{"ok":true}');
});

test('marks oversized bodies as truncated in JSONL and the HAR comment', async () => {
  const session = await attach(true);
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'big', timestamp: 20, wallTime: 1700000001, type: 'XHR',
    request: { url: 'https://a.test/big', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'big', timestamp: 20.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'big', timestamp: 20.2, encodedDataLength: 999_999_999 });
  await waitUntil(() => session.network.entries().some(e => e.id === 'big'));
  await session.close();

  const net = JSON.parse((await readFile(join(session.sessionDir!, 'network.jsonl'), 'utf8')).trim());
  expect(net).toMatchObject({ id: 'big', bodyTruncated: true });
  expect(net.body).toBeUndefined();
  const har = JSON.parse(await readFile(join(session.sessionDir!, 'session.har'), 'utf8'));
  expect(har.log.entries[0].response.content.comment).toContain('truncated');
});

test('close waits for in-flight body fetches before writing HAR', async () => {
  mock.respond('Network.getResponseBody', () =>
    new Promise(r => setTimeout(() => r({ body: '{"late":true}', base64Encoded: false }), 120)));
  const session = await attach(true);
  feedRequest('slow1');
  await new Promise(r => setTimeout(r, 30));
  await session.close();

  const har = JSON.parse(await readFile(join(session.sessionDir!, 'session.har'), 'utf8'));
  expect(har.log.entries[0].response.content.text).toBe('{"late":true}');
  const net = JSON.parse((await readFile(join(session.sessionDir!, 'network.jsonl'), 'utf8')).trim());
  expect(net.body).toBe('{"late":true}');
});

test('setThrottle sends emulateNetworkConditions and reload sends Page.reload', async () => {
  const sent: Array<[string, any]> = [];
  mock.respond('Network.emulateNetworkConditions', p => { sent.push(['emulate', p]); return {}; });
  mock.respond('Page.reload', p => { sent.push(['reload', p]); return {}; });
  const session = await attach(false);
  await session.setThrottle('slow3g');
  expect(session.throttle).toBe('slow3g');
  expect(sent[0][1]).toMatchObject({ offline: false, latency: THROTTLE_PROFILES.slow3g!.latency });
  await session.setThrottle('offline');
  expect(session.throttle).toBe('offline');
  expect(sent[1][1]).toMatchObject({ offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await session.setThrottle('off');
  expect(sent[2][1]).toMatchObject({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await session.reload();
  expect(sent[3][0]).toBe('reload');
  await session.close();
});

test('body cap is byte-based and never splits multibyte characters', async () => {
  mock.respond('Network.getResponseBody', () => ({ body: '한글테스트', base64Encoded: false }));
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  const session = await DebugSession.attach(page, { persist: false, bodyCapBytes: 10 });
  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'mb1', timestamp: 10, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/mb1', method: 'GET', headers: {} },
  });
  mock.emitEvent('Network.responseReceived', {
    requestId: 'mb1', timestamp: 10.1, type: 'XHR',
    response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
  });
  mock.emitEvent('Network.loadingFinished', { requestId: 'mb1', timestamp: 10.2, encodedDataLength: 5 });
  await waitUntil(() => session.network.entries()[0]?.body !== undefined);
  const [e] = session.network.entries();
  expect(e.bodyTruncated).toBe(true);
  expect(e.body).toBe('한글테');
  expect(Buffer.byteLength(e.body!, 'utf8')).toBeLessThanOrEqual(10);
  await session.close();
});

test('storage surface delegates with the target origin', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
  mock.respond('DOMStorage.enable', () => ({}));
  let getParams: any;
  mock.respond('DOMStorage.getDOMStorageItems', p => { getParams = p; return { entries: [['a', '1']] }; });
  let clearParams: any;
  mock.respond('Storage.clearDataForOrigin', p => { clearParams = p; return {}; });

  const session = await attach(false);
  expect(session.origin).toBe('https://mock.test');
  expect(await session.cookies()).toEqual([]);
  expect(await session.storageItems(true)).toEqual([['a', '1']]);
  expect(getParams.storageId).toEqual({ securityOrigin: 'https://mock.test', isLocalStorage: true });
  await session.clearSiteData();
  expect(clearParams.origin).toBe('https://mock.test');
  await session.close();
});

test('origin tracks main-frame navigation', async () => {
  const session = await attach(false);
  expect(session.origin).toBe('https://mock.test');
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://other.test/x', id: 'f1' } });
  await new Promise(r => setTimeout(r, 50));
  expect(session.origin).toBe('https://other.test');
  expect(session.url).toBe('https://other.test/x');
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://sub.test/y', id: 'f2', parentId: 'f1' } });
  await new Promise(r => setTimeout(r, 50));
  expect(session.origin).toBe('https://other.test');
  await session.close();
});

test('clearOnNav wipes the network log on main-frame navigation and keeps streaming', async () => {
  const session = await attach(false);
  session.clearOnNav = true;
  feedRequest('nav-a');
  await waitUntil(() => session.network.entries().length === 1);
  expect(session.network.entries()).toHaveLength(1);
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://gone.test/next', id: 'main-2' } });
  await new Promise(r => setTimeout(r, 50));
  expect(session.network.entries()).toEqual([]);
  feedRequest('nav-b');
  await waitUntil(() => session.network.entries().some(e => e.id === 'nav-b'));
  expect(session.network.entries().map(e => e.id)).toEqual(['nav-b']);
  await session.close();
});

test('clearOnNav off preserves the network log across navigation', async () => {
  const session = await attach(false);
  feedRequest('keep-a');
  await waitUntil(() => session.network.entries().length > 0);
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://gone.test/next', id: 'main-3' } });
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://gone.test/sub', id: 'sub-3', parentId: 'main-3' } });
  await new Promise(r => setTimeout(r, 50));
  expect(session.network.entries().map(e => e.id)).toEqual(['keep-a']);
  await session.close();
});

test('DOM/CSS surface delegates and emits mutation events', async () => {
  mock.respond('DOM.getDocument', () => ({ root: { nodeId: 1 } }));
  mock.respond('DOM.querySelector', () => ({ nodeId: 7 }));
  mock.respond('DOM.getOuterHTML', () => ({ outerHTML: '<b>x</b>' }));
  mock.respond('CSS.enable', () => ({}));
  mock.respond('CSS.getComputedStyleForNode', () => ({ computedStyle: [{ name: 'display', value: 'block' }] }));
  mock.respond('DOM.enable', () => ({}));

  const session = await attach(false);
  expect(await session.querySelector('.x')).toBe(7);
  expect(await session.outerHTML(7)).toBe('<b>x</b>');
  expect(await session.computedStyles(7)).toEqual([['display', 'block']]);

  await session.watchDomMutations();
  const seen = new Promise<string>(r => session.once('dom-mutation', r));
  mock.emitEvent('DOM.attributeModified', { nodeId: 7, name: 'class', value: 'y' });
  expect(await seen).toBe('DOM.attributeModified');
  await session.close();
});

test('editRuleStyle delegates to CSS.setStyleTexts', async () => {
  let seen: any;
  mock.respond('CSS.setStyleTexts', p => { seen = p; return { styles: [] }; });
  const session = await attach(false);
  await session.editRuleStyle('sheet-9', { startLine: 1, startColumn: 0, endLine: 1, endColumn: 5 }, 'color: green');
  expect(seen.edits[0]).toMatchObject({ styleSheetId: 'sheet-9', text: 'color: green' });
  await session.close();
});

test('domTree delegates and addCssRule creates a sheet then adds a rule', async () => {
  mock.respond('DOM.getDocument', () => ({ root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, attributes: [], children: [] } }));
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-9' } } }));
  let created = 0;
  mock.respond('CSS.createStyleSheet', () => { created++; return { styleSheetId: 'sheet-x' }; });
  const added: string[] = [];
  mock.respond('CSS.addRule', p => { added.push(p.ruleText); return { rule: {} }; });

  const session = await attach(false);
  const map = await session.domTree();
  expect(map.get(1)?.nodeName).toBe('html');
  await session.addCssRule('.a', 'color: red');
  await session.addCssRule('.b', 'color: blue');
  expect(created).toBe(1);
  expect(added).toEqual(['.a { color: red }', '.b { color: blue }']);
  await session.close();
});

test('addCssRule recreates the sheet after main-frame navigation', async () => {
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-9' } } }));
  let created = 0;
  const frameIds: string[] = [];
  mock.respond('CSS.createStyleSheet', p => { created++; frameIds.push(p.frameId); return { styleSheetId: 'sheet-x' }; });
  mock.respond('CSS.addRule', () => ({ rule: {} }));

  const session = await attach(false);
  await session.addCssRule('.a', 'color: red');
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://other.test/x', id: 'frame-new' } });
  await new Promise(r => setTimeout(r, 50));
  await session.addCssRule('.b', 'color: blue');
  expect(created).toBe(2);
  expect(frameIds).toEqual(['frame-9', 'frame-new']);
  await session.close();
});

test('a subframe navigation keeps the inspector stylesheet cached', async () => {
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-9' } } }));
  let created = 0;
  mock.respond('CSS.createStyleSheet', () => { created++; return { styleSheetId: 'sheet-x' }; });
  mock.respond('CSS.addRule', () => ({ rule: {} }));

  const session = await attach(false);
  await session.addCssRule('.a', 'color: red');
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://a.test/sub', id: 'sub-1', parentId: 'frame-9' } });
  await new Promise(r => setTimeout(r, 50));
  await session.addCssRule('.b', 'color: blue');
  expect(created).toBe(1);
  await session.close();
});

test('toggleNodeVisibility injects the hide rule once and toggles the marker class', async () => {
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-9' } } }));
  let created = 0;
  const added: string[] = [];
  mock.respond('CSS.createStyleSheet', () => { created++; return { styleSheetId: 'sheet-x' }; });
  mock.respond('CSS.addRule', p => { added.push(p.ruleText); return { rule: {} }; });
  let classAttr: string | undefined = 'btn';
  mock.respond('DOM.getAttributes', () => ({ attributes: classAttr === undefined ? [] : ['class', classAttr] }));
  const sets: any[] = [];
  const removals: any[] = [];
  mock.respond('DOM.setAttributeValue', p => { sets.push(p); classAttr = p.value; return {}; });
  mock.respond('DOM.removeAttribute', p => { removals.push(p); classAttr = undefined; return {}; });

  const session = await attach(false);
  expect(await session.toggleNodeVisibility(42)).toBe(true);
  expect(created).toBe(1);
  expect(added).toEqual(['.__devtools-tui-hide__ { visibility: hidden !important }']);
  expect(sets).toEqual([{ nodeId: 42, name: 'class', value: 'btn __devtools-tui-hide__' }]);

  expect(await session.toggleNodeVisibility(42)).toBe(false);
  expect(sets[1]).toEqual({ nodeId: 42, name: 'class', value: 'btn' });

  classAttr = '__devtools-tui-hide__';
  expect(await session.toggleNodeVisibility(42)).toBe(false);
  expect(removals).toEqual([{ nodeId: 42, name: 'class' }]);

  expect(await session.toggleNodeVisibility(42)).toBe(true);
  expect(sets[2]).toEqual({ nodeId: 42, name: 'class', value: '__devtools-tui-hide__' });
  expect(created).toBe(1);
  expect(added).toHaveLength(1);
  await session.close();
});

test('toggleNodeVisibility re-injects the hide rule after main-frame navigation', async () => {
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-9' } } }));
  const added: string[] = [];
  mock.respond('CSS.createStyleSheet', () => ({ styleSheetId: 'sheet-x' }));
  mock.respond('CSS.addRule', p => { added.push(p.ruleText); return { rule: {} }; });
  mock.respond('DOM.getAttributes', () => ({ attributes: [] }));
  mock.respond('DOM.setAttributeValue', () => ({}));

  const session = await attach(false);
  await session.toggleNodeVisibility(42);
  mock.emitEvent('Page.frameNavigated', { frame: { url: 'https://other.test/x', id: 'frame-new' } });
  await new Promise(r => setTimeout(r, 50));
  mock.respond('DOM.getAttributes', () => ({ attributes: [] }));
  await session.toggleNodeVisibility(43);
  expect(added).toHaveLength(2);
  await session.close();
});

const OV_RULE = {
  id: 'ov-1',
  pattern: 'https://a.test/users*',
  status: 201,
  headers: [['content-type', 'application/json']] as Array<[string, string]>,
  body: '{"mocked":true}',
  enabled: true,
};

test('setOverrides enables Fetch per rule and fulfills matching pauses', async () => {
  const calls: Array<[string, any]> = [];
  for (const m of ['Fetch.enable', 'Fetch.disable', 'Fetch.fulfillRequest', 'Fetch.continueRequest']) {
    mock.respond(m, p => { calls.push([m.slice('Fetch.'.length), p]); return {}; });
  }
  const session = await attach(false);
  await session.setOverrides([OV_RULE]);
  expect(calls[0]).toEqual(['enable', { patterns: [{ urlPattern: 'https://a.test/users*', requestStage: 'Response' }] }]);

  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'net-ov', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/users?id=1', method: 'GET', headers: {} },
  });
  mock.emitEvent('Fetch.requestPaused', { requestId: 'fp-1', networkId: 'net-ov', responseStatusCode: 200, request: { url: 'https://a.test/users?id=1' } });
  await waitUntil(() => calls.some(c => c[0] === 'fulfillRequest'));
  const fulfill = calls.find(c => c[0] === 'fulfillRequest');
  expect(fulfill?.[1]).toMatchObject({
    requestId: 'fp-1',
    responseCode: 201,
    responseHeaders: [{ name: 'content-type', value: 'application/json' }],
  });
  expect(Buffer.from(fulfill![1].body, 'base64').toString('utf8')).toBe('{"mocked":true}');
  expect(session.network.entries().find(e => e.id === 'net-ov')?.overridden).toBe(true);

  mock.emitEvent('Fetch.requestPaused', { requestId: 'fp-2', networkId: 'net-other', responseStatusCode: 200, request: { url: 'https://a.test/other' } });
  await waitUntil(() => calls.some(c => c[0] === 'continueRequest'));
  expect(calls.find(c => c[0] === 'continueRequest')?.[1]).toEqual({ requestId: 'fp-2' });
  await session.close();
});

test('setOverrides with no active rules disables Fetch only after it was enabled', async () => {
  const calls: string[] = [];
  mock.respond('Fetch.enable', () => { calls.push('enable'); return {}; });
  mock.respond('Fetch.disable', () => { calls.push('disable'); return {}; });
  const session = await attach(false);
  await session.setOverrides([]);
  expect(calls).toEqual([]);
  await session.setOverrides([OV_RULE]);
  await session.setOverrides([]);
  expect(calls).toEqual(['enable', 'disable']);
  await session.setOverrides([]);
  expect(calls).toEqual(['enable', 'disable']);
  await session.close();
});

test('setOverrides([]) disables Fetch even while the preceding enable is still in flight', async () => {
  const calls: string[] = [];
  mock.respond('Fetch.enable', () => { calls.push('enable'); return {}; });
  mock.respond('Fetch.disable', () => { calls.push('disable'); return {}; });
  const session = await attach(false);
  const inflight = session.setOverrides([OV_RULE]);
  await session.setOverrides([]);
  await inflight;
  expect(calls).toEqual(['enable', 'disable']);
  await session.close();
});

test('setCustomConditions emulates the given profile and flips throttle to custom', async () => {
  const sent: any[] = [];
  mock.respond('Network.emulateNetworkConditions', p => { sent.push(p); return {}; });
  const session = await attach(false);
  const cond = { offline: false, latency: 42, downloadThroughput: 12_345, uploadThroughput: 6_789 };
  await session.setCustomConditions(cond);
  expect(sent[0]).toEqual(cond);
  expect(session.throttle).toBe('custom');
  expect(session.customConditions).toEqual(cond);
  await session.setCustomConditions(null);
  expect(sent[1]).toEqual({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  expect(session.throttle).toBe('off');
  expect(session.customConditions).toBeNull();
  await session.close();
});

test('setThrottle custom replays the stored custom conditions', async () => {
  const sent: any[] = [];
  mock.respond('Network.emulateNetworkConditions', p => { sent.push(p); return {}; });
  const session = await attach(false);
  const cond = { offline: true, latency: 5, downloadThroughput: 100, uploadThroughput: 100 };
  await session.setCustomConditions(cond);
  await session.setThrottle('custom');
  expect(sent[1]).toEqual(cond);
  expect(session.throttle).toBe('custom');
  await session.close();
});

test('rewriteUrl substitutes glob captures into the target', () => {
  expect(rewriteUrl('https://prod.test/api/*', 'http://localhost:3000/api/*', 'https://prod.test/api/users?id=1'))
    .toBe('http://localhost:3000/api/users?id=1');
  expect(rewriteUrl('https://prod.test/*', 'http://localhost:9/fixed', 'https://prod.test/x'))
    .toBe('http://localhost:9/fixed');
  expect(rewriteUrl('https://prod.test/api/*', 'http://localhost/*', 'https://other.test/api/users')).toBeNull();
  expect(rewriteUrl('https://a.test/*/v?/*', 'https://b.test/*/*', 'https://a.test/svc/v2/users'))
    .toBe('https://b.test/svc/users');
});

const MAP_RULE = { id: 'mr-1', pattern: 'https://a.test/api/*', target: 'http://localhost:3000/api/*', enabled: true };

test('setMapRemote enables Fetch at Request stage and rewrites matching pauses', async () => {
  const calls: Array<[string, any]> = [];
  for (const m of ['Fetch.enable', 'Fetch.disable', 'Fetch.continueRequest']) {
    mock.respond(m, p => { calls.push([m.slice('Fetch.'.length), p]); return {}; });
  }
  const session = await attach(false);
  await session.setMapRemote([MAP_RULE]);
  expect(calls[0]).toEqual(['enable', { patterns: [{ urlPattern: 'https://a.test/api/*', requestStage: 'Request' }] }]);

  mock.emitEvent('Network.requestWillBeSent', {
    requestId: 'net-mr', timestamp: 1, wallTime: 1700000000, type: 'XHR',
    request: { url: 'https://a.test/api/users', method: 'GET', headers: {} },
  });
  mock.emitEvent('Fetch.requestPaused', { requestId: 'fp-mr', networkId: 'net-mr', request: { url: 'https://a.test/api/users' } });
  await waitUntil(() => calls.some(c => c[0] === 'continueRequest'));
  expect(calls.find(c => c[0] === 'continueRequest')?.[1]).toEqual({ requestId: 'fp-mr', url: 'http://localhost:3000/api/users' });
  expect(session.network.entries().find(e => e.id === 'net-mr')?.remappedTo).toBe('http://localhost:3000/api/users');

  mock.emitEvent('Fetch.requestPaused', { requestId: 'fp-none', networkId: 'net-x', request: { url: 'https://a.test/other' } });
  await waitUntil(() => calls.filter(c => c[0] === 'continueRequest').length >= 2);
  expect(calls.filter(c => c[0] === 'continueRequest').at(-1)?.[1]).toEqual({ requestId: 'fp-none' });

  await session.setMapRemote([]);
  expect(calls.at(-1)?.[0]).toBe('disable');
  await session.close();
});

test('overrides and map remote rules share one Fetch.enable with both stages', async () => {
  const calls: Array<[string, any]> = [];
  for (const m of ['Fetch.enable', 'Fetch.disable']) {
    mock.respond(m, p => { calls.push([m.slice('Fetch.'.length), p]); return {}; });
  }
  const session = await attach(false);
  await session.setOverrides([OV_RULE]);
  await session.setMapRemote([MAP_RULE]);
  expect(calls.at(-1)).toEqual(['enable', { patterns: [
    { urlPattern: OV_RULE.pattern, requestStage: 'Response' },
    { urlPattern: MAP_RULE.pattern, requestStage: 'Request' },
  ] }]);
  await session.setOverrides([]);
  expect(calls.at(-1)).toEqual(['enable', { patterns: [{ urlPattern: MAP_RULE.pattern, requestStage: 'Request' }] }]);
  await session.setMapRemote([]);
  expect(calls.at(-1)?.[0]).toBe('disable');
  await session.close();
});

test('setBlocked sends Network.setBlockedURLs and records the patterns', async () => {
  const calls: any[] = [];
  mock.respond('Network.setBlockedURLs', p => { calls.push(p); return {}; });
  const session = await attach(false);
  await session.setBlocked(['https://a.test/x*', '*://a.test/*']);
  expect(calls).toEqual([{ urls: ['https://a.test/x*', '*://a.test/*'] }]);
  expect(session.blockedUrls).toEqual(['https://a.test/x*', '*://a.test/*']);
  await session.setBlocked([]);
  expect(calls[1]).toEqual({ urls: [] });
  expect(session.blockedUrls).toEqual([]);
  await session.close();
});

test('a failed fulfillRequest falls back to continueRequest', async () => {
  const continued: string[] = [];
  mock.respond('Fetch.enable', () => ({}));
  mock.respond('Fetch.fulfillRequest', () => { throw new Error('boom'); });
  mock.respond('Fetch.continueRequest', p => { continued.push(p.requestId); return {}; });
  const session = await attach(false);
  await session.setOverrides([{ ...OV_RULE, pattern: '*' }]);
  mock.emitEvent('Fetch.requestPaused', { requestId: 'fp-err', networkId: 'net-x', responseStatusCode: 200, request: { url: 'https://a.test/anything' } });
  await waitUntil(() => continued.length > 0);
  expect(continued).toEqual(['fp-err']);
  await session.close();
});

test('addCssRule recreates the sheet after a rejected CSS.addRule', async () => {
  mock.respond('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'frame-9' } } }));
  let created = 0;
  mock.respond('CSS.createStyleSheet', () => { created++; return { styleSheetId: 'sheet-x' }; });
  let addCalls = 0;
  mock.respond('CSS.addRule', () => {
    addCalls++;
    if (addCalls === 1) throw new Error('dead sheet');
    return { rule: {} };
  });

  const session = await attach(false);
  await expect(session.addCssRule('.a', 'color: red')).rejects.toThrow('dead sheet');
  await session.addCssRule('.b', 'color: blue');
  expect(created).toBe(2);
  await session.close();
});

test('getProperties requests own properties with previews and maps lean args', async () => {
  let seen: any;
  mock.respond('Runtime.getProperties', params => {
    seen = params;
    return {
      result: [
        { name: 'a', configurable: true, value: { type: 'number', value: 1, className: 'Number' } },
        { name: 'getterOnly', configurable: true, get: { type: 'function' } },
        {
          name: 'nested', configurable: true,
          value: {
            type: 'object', objectId: 'obj-2', className: 'Object', description: 'Object',
            preview: { type: 'object', description: 'Object', overflow: false, properties: [{ name: 'x', type: 'number', value: '2' }] },
          },
        },
      ],
    };
  });
  const session = await attach(false);
  const props = await session.getProperties('obj-1');
  expect(seen).toMatchObject({ objectId: 'obj-1', ownProperties: true, generatePreview: true });
  expect(props).toEqual([
    { name: 'a', value: { type: 'number', value: 1 } },
    {
      name: 'nested',
      value: {
        type: 'object', objectId: 'obj-2', description: 'Object',
        preview: { type: 'object', description: 'Object', properties: [{ name: 'x', type: 'number', value: '2' }] },
      },
    },
  ]);
  await session.close();
});

test('console JSONL keeps arg previews but strips objectIds', async () => {
  const session = await attach(true);
  mock.emitEvent('Runtime.consoleAPICalled', {
    type: 'log', timestamp: 1,
    args: [{
      type: 'object', objectId: 'obj-1', className: 'Object', description: 'Object',
      preview: { type: 'object', description: 'Object', overflow: false, properties: [{ name: 'a', type: 'number', value: '1' }] },
    }],
  });
  await waitUntil(() => session.console.entries().length > 0);
  await session.close();
  const line = JSON.parse((await readFile(join(session.sessionDir!, 'console.jsonl'), 'utf8')).trim());
  expect(line.text).toBe('{a: 1}');
  expect(line.args).toHaveLength(1);
  expect(line.args[0].objectId).toBeUndefined();
  expect(line.args[0].preview).toMatchObject({ type: 'object' });
  expect(session.console.entries()[0].args![0].objectId).toBe('obj-1');
});

test('evaluate sends the full REPL parameter set and maps the result to a lean arg', async () => {
  let seen: any;
  mock.respond('Runtime.evaluate', params => {
    seen = params;
    return {
      result: {
        type: 'object', objectId: 'repl-1', className: 'Object', description: 'Object',
        preview: { type: 'object', description: 'Object', overflow: false, properties: [{ name: 'a', type: 'number', value: '1' }] },
      },
    };
  });
  const session = await attach(false);
  const { result, exceptionDetails } = await session.evaluate('({a: 1})');
  expect(seen).toMatchObject({
    expression: '({a: 1})',
    includeCommandLineAPI: true,
    replMode: true,
    awaitPromise: true,
    generatePreview: true,
    userGesture: true,
    objectGroup: 'console-repl',
  });
  expect(exceptionDetails).toBeUndefined();
  expect(result).toEqual({
    type: 'object', objectId: 'repl-1', description: 'Object',
    preview: { type: 'object', description: 'Object', properties: [{ name: 'a', type: 'number', value: '1' }] },
  });
  await session.close();
});

test('evaluate surfaces exceptionDetails untouched alongside no result mapping', async () => {
  mock.respond('Runtime.evaluate', () => ({
    result: { type: 'object', subtype: 'error', description: 'ReferenceError: nope' },
    exceptionDetails: { text: 'Uncaught', lineNumber: 0, exception: { type: 'object', subtype: 'error', description: 'ReferenceError: nope' } },
  }));
  const session = await attach(false);
  const { exceptionDetails } = await session.evaluate('nope');
  expect(exceptionDetails).toMatchObject({ text: 'Uncaught', exception: { description: 'ReferenceError: nope' } });
  await session.close();
});

test('releaseReplObjects releases the console-repl object group and swallows failures', async () => {
  let seen: any;
  mock.respond('Runtime.releaseObjectGroup', params => { seen = params; return {}; });
  const session = await attach(false);
  await session.releaseReplObjects();
  expect(seen).toEqual({ objectGroup: 'console-repl' });
  mock.respond('Runtime.releaseObjectGroup', () => { throw new Error('gone'); });
  await expect(session.releaseReplObjects()).resolves.toBeUndefined();
  await session.close();
});

test('evaluateForCompletion probes side-effect-free, lists inherited properties, and releases its group', async () => {
  const calls: string[] = [];
  let evalSeen: any;
  let propsSeen: any;
  let releaseSeen: any;
  mock.respond('Runtime.evaluate', params => {
    calls.push('evaluate');
    evalSeen = params;
    return { result: { type: 'object', objectId: 'comp-1' } };
  });
  mock.respond('Runtime.getProperties', params => {
    calls.push('getProperties');
    propsSeen = params;
    return {
      result: [
        { name: 'slice', value: { type: 'function' } },
        { name: 'length', value: { type: 'number' } },
        { name: 'broken' },
      ],
    };
  });
  mock.respond('Runtime.releaseObjectGroup', params => {
    calls.push('release');
    releaseSeen = params;
    return {};
  });
  const session = await attach(false);
  const props = await session.evaluateForCompletion('foo.bar');
  expect(evalSeen).toMatchObject({
    expression: 'foo.bar',
    throwOnSideEffect: true,
    silent: true,
    timeout: 500,
    objectGroup: 'console-completion',
    generatePreview: false,
    includeCommandLineAPI: true,
    replMode: true,
  });
  expect(propsSeen).toEqual({ objectId: 'comp-1', ownProperties: false, generatePreview: false });
  expect(props).toEqual([
    { name: 'slice', type: 'function' },
    { name: 'length', type: 'number' },
    { name: 'broken', type: undefined },
  ]);
  await waitUntil(() => calls.includes('release'));
  expect(releaseSeen).toEqual({ objectGroup: 'console-completion' });
  expect(calls).toEqual(['evaluate', 'getProperties', 'release']);
  await session.close();
});

test('evaluateForCompletion maps side-effect throws, protocol errors and non-objects to null', async () => {
  const session = await attach(false);
  let gotProps = 0;
  mock.respond('Runtime.getProperties', () => { gotProps++; return { result: [] }; });
  let released = 0;
  mock.respond('Runtime.releaseObjectGroup', () => { released++; return {}; });

  mock.respond('Runtime.evaluate', () => ({
    result: { type: 'object', objectId: 'x' },
    exceptionDetails: { text: 'EvalError: Possible side-effect in debug-evaluate' },
  }));
  expect(await session.evaluateForCompletion('foo')).toBeNull();

  mock.respond('Runtime.evaluate', () => { throw new Error('boom'); });
  expect(await session.evaluateForCompletion('foo')).toBeNull();

  mock.respond('Runtime.evaluate', () => ({ result: { type: 'string', value: 'primitive' } }));
  expect(await session.evaluateForCompletion('foo')).toBeNull();

  expect(gotProps).toBe(0);
  await waitUntil(() => released === 3);
  expect(released).toBe(3);
  await session.close();
});

test('globalLexicalScopeNames passes through names and maps failures to []', async () => {
  mock.respond('Runtime.globalLexicalScopeNames', () => ({ names: ['store', 'router'] }));
  const session = await attach(false);
  expect(await session.globalLexicalScopeNames()).toEqual(['store', 'router']);
  mock.respond('Runtime.globalLexicalScopeNames', () => { throw new Error('nope'); });
  expect(await session.globalLexicalScopeNames()).toEqual([]);
  await session.close();
});

test('setInspectedNode delegates to DOM.setInspectedNode', async () => {
  let seen: any;
  mock.respond('DOM.setInspectedNode', params => { seen = params; return {}; });
  const session = await attach(false);
  await session.setInspectedNode(42);
  expect(seen).toEqual({ nodeId: 42 });
  await session.close();
});

test('Runtime.executionContextsCleared emits contexts-cleared', async () => {
  const session = await attach(false);
  const seen = new Promise<void>(r => session.once('contexts-cleared', r));
  mock.emitEvent('Runtime.executionContextsCleared', {});
  await seen;
  await session.close();
});
