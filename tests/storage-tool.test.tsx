import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { MockCdp } from './helpers/mock-cdp.js';
import { MultiTabs } from '../src/tui/lib/multi-tabs.js';
import { DebugSession } from '../src/engine.js';
import { App } from '../src/tui/App.js';
import { waitForFrame } from './helpers/wait-for.js';

let mock: MockCdp;
let tabs: MultiTabs;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ep = () => ({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = '\x1b';

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '42', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

let prevConfigHome: string | undefined;
let prevDataHome: string | undefined;

beforeEach(async () => {
  prevConfigHome = process.env.XDG_CONFIG_HOME;
  prevDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'dtui-sto-cfg-'));
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), 'dtui-sto-data-'));
  mock = await MockCdp.start();
  mock.respond('DOMStorage.enable', () => ({}));
  tabs = new MultiTabs([ep()]);
  await tabs.refresh();
});
afterEach(async () => {
  tabs.stop();
  await mock.close();
  if (prevConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevConfigHome;
  if (prevDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevDataHome;
});

const cookie = (name: string, value: string, extra: Record<string, unknown> = {}) => ({
  name, value, domain: 'mock.test', path: '/', expires: -1, httpOnly: false, secure: false, ...extra,
});

function renderApp(extra: Partial<React.ComponentProps<typeof App>> = {}) {
  return render(
    <App ep={ep()} tabs={tabs} attach={t => DebugSession.attach(t, { persist: false })} reconnectBaseMs={10} {...extra} />,
  );
}

async function attach(lastFrame: () => string | undefined, stdin: { write: (data: string) => void }) {
  stdin.write('b');
  await waitForFrame(lastFrame, 'Mock Page');
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Mock Page');
}

test('Enter opens the entry detail with pretty JSON and the cookie attribute table; y copies; esc closes', async () => {
  let copied = '';
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('cfg', '{"a":1,"b":2}', { sameSite: 'Lax', secure: true })] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'cfg = ');
  stdin.write('\r');
  await waitForFrame(lastFrame, '"a": 1');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('"b": 2');
  expect(frame).toContain('domain');
  expect(frame).toContain('mock.test');
  expect(frame).toContain('sameSite');
  expect(frame).toContain('Lax');
  stdin.write('y');
  await waitForFrame(lastFrame, '복사됨');
  expect(copied).toBe('{"a":1,"b":2}');
  stdin.write(ESC);
  await sleep(60);
  expect(stripAnsi(lastFrame()!)).not.toContain('"a": 1');
});

test('a edits cookie attributes and round-trips through setCookie', async () => {
  let seen: any;
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('sid', 'abc')] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  mock.respond('Network.setCookie', p => { seen = p; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'sid = abc');
  stdin.write('a');
  await waitForFrame(lastFrame, 'domain=mock.test');
  stdin.write('; path=/x; sameSite=strict');
  await sleep(40);
  stdin.write('\r');
  await sleep(150);
  expect(seen).toBeTruthy();
  expect(seen.name).toBe('sid');
  expect(seen.value).toBe('abc');
  expect(seen.path).toBe('/x');
  expect(seen.sameSite).toBe('Strict');
});

test('a with a malformed attribute string shows an error and never calls setCookie', async () => {
  let called = false;
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('sid', 'abc')] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  mock.respond('Network.setCookie', () => { called = true; return { success: true }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'sid = abc');
  stdin.write('a');
  await waitForFrame(lastFrame, 'domain=mock.test');
  stdin.write('; expires=notanumber');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '잘못된 속성');
  await sleep(80);
  expect(called).toBe(false);
});

test('/ filters rows by key or value with -negation and shows the filtered count', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [['alpha', 'one'], ['beta', 'alphaX'], ['gamma', 'three']] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await sleep(40);
  stdin.write('l');
  await waitForFrame(lastFrame, 'alpha = one');
  stdin.write('/');
  await sleep(40);
  stdin.write('alpha -x');
  await sleep(40);
  stdin.write('\r');
  await sleep(60);
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('alpha = one');
  expect(frame).not.toContain('beta = alphaX');
  expect(frame).not.toContain('gamma = three');
  expect(frame).toContain('1/3');
  stdin.write(ESC);
  await waitForFrame(lastFrame, 'beta = alphaX');
});

test('y copies the selected row value with a toast', async () => {
  let copied = '';
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('sid', 'secret-value')] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  const { lastFrame, stdin } = renderApp({ clipboard: async t => { copied = t; } });
  await attach(lastFrame, stdin);
  stdin.write('4');
  await waitForFrame(lastFrame, 'sid = secret-value');
  stdin.write('y');
  await waitForFrame(lastFrame, '복사됨');
  expect(copied).toBe('secret-value');
});

test('a JWT storage value shows a badge in the row and decoded claims in the detail', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [['token', jwtToken]] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await sleep(40);
  stdin.write('l');
  await waitForFrame(lastFrame, 'token = ');
  expect(stripAnsi(lastFrame()!)).toContain('JWT');
  stdin.write('\r');
  await waitForFrame(lastFrame, 'sub');
  const frame = stripAnsi(lastFrame()!);
  expect(frame).toContain('exp');
  expect(frame).toContain('후 만료');
});

test('DOMStorage events refresh the active view, and no refresh happens on another tool', async () => {
  let items = [['k', 'v1']];
  let refetched = false;
  mock.respond('Network.getCookies', () => ({ cookies: [] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => { refetched = true; return { entries: items }; });
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await sleep(40);
  stdin.write('l');
  await waitForFrame(lastFrame, 'k = v1');
  items = [['k', 'v2']];
  mock.emitEvent('DOMStorage.domStorageItemUpdated', {
    storageId: { securityOrigin: 'https://mock.test', isLocalStorage: true }, key: 'k', oldValue: 'v1', newValue: 'v2',
  });
  await waitForFrame(lastFrame, 'k = v2');
  stdin.write('1');
  await sleep(60);
  refetched = false;
  items = [['k', 'v3']];
  mock.emitEvent('DOMStorage.domStorageItemUpdated', {
    storageId: { securityOrigin: 'https://mock.test', isLocalStorage: true }, key: 'k', oldValue: 'v2', newValue: 'v3',
  });
  await sleep(250);
  expect(refetched).toBe(false);
});

test('the command palette lists storage commands only on the storage tool', async () => {
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('sid', 'abc')] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('스토리지');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).not.toContain('스토리지 필터');
  stdin.write(ESC);
  await sleep(40);
  stdin.write('4');
  await waitForFrame(lastFrame, 'sid = abc');
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('스토리지');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).toContain('스토리지 필터');
  stdin.write(ESC);
  await sleep(40);
  stdin.write(':');
  await waitForFrame(lastFrame, '명령 팔레트');
  stdin.write('값 복사');
  await sleep(50);
  expect(stripAnsi(lastFrame()!)).toContain('값 복사');
});

test('storage view and filter are restored per session on switch-back', async () => {
  mock.pages.push({ id: 'page2', title: 'Second Page', url: 'https://second.test/' });
  await tabs.refresh();
  mock.respond('Network.getCookies', () => ({ cookies: [cookie('sid', 'abc')] }));
  mock.respond('DOMStorage.getDOMStorageItems', () => ({ entries: [['lk', 'lv']] }));
  const { lastFrame, stdin } = renderApp();
  await attach(lastFrame, stdin);
  stdin.write('4');
  await sleep(40);
  stdin.write('l');
  await waitForFrame(lastFrame, 'lk = lv');
  stdin.write('/');
  await sleep(40);
  stdin.write('lk');
  await sleep(40);
  stdin.write('\r');
  await sleep(60);
  expect(stripAnsi(lastFrame()!)).toContain('lk = lv');

  stdin.write('b');
  await waitForFrame(lastFrame, 'Second Page');
  stdin.write('j');
  await sleep(40);
  stdin.write('\r');
  await waitForFrame(lastFrame, '◉ Second Page');
  await sleep(60);
  const onSecond = stripAnsi(lastFrame()!);
  expect(onSecond).toContain('sid = abc');
  expect(onSecond).not.toContain('lk = lv');

  stdin.write('[');
  await waitForFrame(lastFrame, '◉ Mock Page');
  await sleep(60);
  const back = stripAnsi(lastFrame()!);
  expect(back).toContain('lk = lv');
  expect(back).toContain('/lk');
  mock.pages.pop();
});
