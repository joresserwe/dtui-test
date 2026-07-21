import { test, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StorageOverlay, parseCookieAttrs, formatCookieAttrs, filterStorageRows, appViewRows, framesViewRows, windowViews, type CookieAttrs, type AppViewState, type StorageView } from '../src/tui/panels/StorageOverlay.js';
import { handleStorageKey } from '../src/tui/keys/storage-keys.js';
import { StorageDetailOverlay } from '../src/tui/overlays/StorageDetailOverlay.js';
import type { FrameNodeView } from '../src/cdp/page-app.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '42', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const cookieAttrs: CookieAttrs = { domain: 'a.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' };

const cookies = [{ key: 'sid', value: 'abc123' }, { key: 'theme', value: 'dark' }];
const local = [{ key: 'token', value: 'xyz' }];

test('renders the active view, tab strip, and rows', () => {
  const { lastFrame } = render(
    <StorageOverlay view="cookies" cookies={cookies} local={local} session={[]} selected={0} />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('Storage');
  expect(frame).toContain('cookies');
  expect(frame).toContain('local');
  expect(frame).toContain('session');
  expect(frame).toContain('sid = abc123');
  expect(frame).toContain('theme = dark');
});

test('shows the local view rows when selected', () => {
  const { lastFrame } = render(
    <StorageOverlay view="local" cookies={cookies} local={local} session={[]} selected={0} />,
  );
  expect(lastFrame()).toContain('token = xyz');
  expect(lastFrame()).not.toContain('sid = abc123');
});

test('shows the edit line and clear confirmation', () => {
  const { lastFrame } = render(
    <StorageOverlay view="cookies" cookies={cookies} local={[]} session={[]} selected={1}
      editing={{ key: 'theme', value: 'ligh' }} confirmClear />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('theme');
  expect(frame).toContain('ligh');
  expect(frame).toContain('X를 한 번 더');
});

test('empty view shows a placeholder', () => {
  const { lastFrame } = render(<StorageOverlay view="session" cookies={[]} local={[]} session={[]} selected={0} />);
  expect(lastFrame()).toContain('비어 있음');
});

const lineCount = (el: React.ReactElement) => render(el).lastFrame()!.split('\n').length;

const many = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));

test('renders exactly height rows across every state combination', () => {
  for (const height of [14, 20, 8]) {
    expect(lineCount(
      <StorageOverlay view="cookies" cookies={many} local={[]} session={[]} selected={29}
        editing={{ key: 'k', value: 'v' }} confirmClear error="boom" height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="cookies" cookies={many} local={[]} session={[]} selected={0} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="local" cookies={many} local={local} session={[]} selected={0} height={height} />,
    )).toBe(height);
    expect(lineCount(
      <StorageOverlay view="session" cookies={[]} local={[]} session={[]} selected={0} height={height} />,
    )).toBe(height);
  }
});

test('uses a constant height at the default with no height prop', () => {
  expect(lineCount(<StorageOverlay view="cookies" cookies={cookies} local={local} session={[]} selected={0} />))
    .toBe(lineCount(<StorageOverlay view="session" cookies={[]} local={[]} session={[]} selected={0}
      editing={{ key: 'k', value: 'v' }} confirmClear error="e" height={14} />));
});

test('keeps the selected row visible when windowed', () => {
  const { lastFrame } = render(
    <StorageOverlay view="cookies" cookies={many} local={[]} session={[]} selected={29} height={14} />,
  );
  expect(lastFrame()).toContain('k29 = v29');
});

test('honours an explicit width and is borderless', () => {
  const frame = render(
    <StorageOverlay view="cookies" cookies={cookies} local={local} session={[]} selected={0} height={12} width={50} />,
  ).lastFrame()!;
  expect(frame).not.toContain('╔');
  expect(frame).not.toContain('╭');
  expect(frame).toContain('─'.repeat(50));
  expect(Math.max(...frame.split('\n').map(l => l.length))).toBe(50);
});

test('selected row carries a cyan gutter and no footer hint', () => {
  const frame = render(
    <StorageOverlay view="cookies" cookies={cookies} local={local} session={[]} selected={0} height={12} />,
  ).lastFrame()!;
  expect(frame).toContain('▌');
  expect(frame).not.toContain('Esc close');
  expect(frame).not.toContain('h/l view');
});

test('cookie rows show a dim attribute suffix and a JWT badge', () => {
  const frame = stripAnsi(render(
    <StorageOverlay view="cookies" cookies={[{ key: 'sid', value: 'abc', attrs: cookieAttrs }, { key: 'tok', value: jwtToken }]} local={[]} session={[]} selected={0} width={120} height={12} />,
  ).lastFrame()!);
  expect(frame).toContain('sid = abc');
  expect(frame).toContain('a.test/');
  expect(frame).toContain('SameSite=Lax');
  expect(frame).toContain('HttpOnly');
  expect(frame).toContain('Secure');
  expect(frame).toContain('session');
  expect(frame).toContain('JWT');
});

test('the attribute suffix drops right-to-left when the row is narrow', () => {
  const wide = stripAnsi(render(
    <StorageOverlay view="cookies" cookies={[{ key: 'sid', value: 'abc', attrs: cookieAttrs }]} local={[]} session={[]} selected={0} width={120} height={10} />,
  ).lastFrame()!);
  expect(wide).toContain('session');
  const narrow = stripAnsi(render(
    <StorageOverlay view="cookies" cookies={[{ key: 'sid', value: 'abc', attrs: cookieAttrs }]} local={[]} session={[]} selected={0} width={34} height={10} />,
  ).lastFrame()!);
  const row = narrow.split('\n').find(l => l.includes('sid = abc'))!;
  expect(row).toContain('a.test/');
  expect(row).not.toContain('SameSite');
  expect(row).not.toContain('Secure');
});

test('filter matches key or value with AND tokens and -negation and shows the count', () => {
  const rows = [{ key: 'alpha', value: 'one' }, { key: 'beta', value: 'alpha-two' }, { key: 'gamma', value: 'three' }];
  const frame = stripAnsi(render(
    <StorageOverlay view="local" cookies={[]} local={rows} session={[]} selected={0} filter="alpha -two" width={60} height={10} />,
  ).lastFrame()!);
  expect(frame).toContain('alpha = one');
  expect(frame).not.toContain('beta = alpha-two');
  expect(frame).not.toContain('gamma = three');
  expect(frame).toContain('1/3');
});

test('filterStorageRows honours AND tokens and negation on key or value', () => {
  const rows = [{ key: 'alpha', value: 'one' }, { key: 'beta', value: 'alpha-two' }, { key: 'gamma', value: 'three' }];
  expect(filterStorageRows(rows, 'alpha').map(r => r.key)).toEqual(['alpha', 'beta']);
  expect(filterStorageRows(rows, 'alpha -two').map(r => r.key)).toEqual(['alpha']);
  expect(filterStorageRows(rows, '').length).toBe(3);
});

test('parseCookieAttrs round-trips formatCookieAttrs and flags malformed and unknown keys', () => {
  const attrs: CookieAttrs = { domain: 'a.test', path: '/x', expires: 1700000000, httpOnly: true, secure: false, sameSite: 'Lax' };
  const parsed = parseCookieAttrs(formatCookieAttrs(attrs));
  expect(parsed.error).toBeUndefined();
  expect(parsed.attrs.domain).toBe('a.test');
  expect(parsed.attrs.path).toBe('/x');
  expect(parsed.attrs.expires).toBe(1700000000);
  expect(parsed.attrs.httpOnly).toBe(true);
  expect(parsed.attrs.sameSite).toBe('Lax');
  expect(parseCookieAttrs('domain=a.test; expires=nope').error).toBeTruthy();
  expect(parseCookieAttrs('domain=a.test; wat=1; foo').unknown).toEqual(['wat', 'foo']);
  expect(parseCookieAttrs('expires=').attrs.expires).toBe(-1);
});

test('detail overlay pretty-prints JSON values with a cookie attribute table', () => {
  const frame = stripAnsi(render(
    <StorageDetailOverlay row={{ key: 'cfg', value: '{"a":1,"b":[2,3]}', attrs: cookieAttrs }} view="cookies" scroll={0} height={22} width={80} />,
  ).lastFrame()!);
  expect(frame).toContain('"a": 1');
  expect(frame).toContain('domain');
  expect(frame).toContain('a.test');
  expect(frame).toContain('sameSite');
  expect(frame).toContain('Lax');
});

test('detail overlay decodes JWT claims', () => {
  const frame = stripAnsi(render(
    <StorageDetailOverlay row={{ key: 'tok', value: jwtToken }} view="local" scroll={0} height={22} width={80} />,
  ).lastFrame()!);
  expect(frame).toContain('JWT');
  expect(frame).toContain('sub');
  expect(frame).toContain('exp');
  expect(frame).toContain('후 만료');
});

const partitionedAttrs: CookieAttrs = { domain: 'cdn.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None', partitionKey: 'https://top.test' };

test('a partitioned cookie shows a ⊞part badge in the row and a partition line in the detail', () => {
  const row = stripAnsi(render(
    <StorageOverlay view="cookies" cookies={[{ key: 'ad', value: 'x', attrs: partitionedAttrs }]} local={[]} session={[]} selected={0} width={120} height={12} />,
  ).lastFrame()!);
  expect(row).toContain('⊞part:https://top.test');
  const detail = stripAnsi(render(
    <StorageDetailOverlay row={{ key: 'ad', value: 'x', attrs: partitionedAttrs }} view="cookies" scroll={0} height={22} width={80} />,
  ).lastFrame()!);
  expect(detail).toContain('partition');
  expect(detail).toContain('https://top.test');
});

test('parseCookieAttrs reads partitionKey and clears it, and formatCookieAttrs round-trips it', () => {
  expect(parseCookieAttrs('partitionKey=https://top.test').attrs.partitionKey).toBe('https://top.test');
  expect('partitionKey' in parseCookieAttrs('partitionKey=').attrs).toBe(true);
  expect(parseCookieAttrs('partitionKey=').attrs.partitionKey).toBeUndefined();
  expect(parseCookieAttrs('partitioned=false').attrs.partitionKey).toBeUndefined();
  expect(formatCookieAttrs(partitionedAttrs)).toContain('partitionKey=https://top.test');
});

test('appViewRows builds manifest fields, an installability section, and origin trials with tones', () => {
  const app: AppViewState = {
    manifestUrl: 'https://a.test/manifest.json',
    manifestRaw: JSON.stringify({ name: 'App', start_url: '/', display: 'standalone', icons: [{ src: '/i.png' }] }),
    manifestErrors: [],
    installErrors: ['no-icon-available'],
    originTrials: [
      { name: 'Foo', status: 'Enabled', tokens: [{ status: 'Success' }] },
      { name: 'Bar', status: 'ValidTokenNotProvided', tokens: [{ status: 'Expired' }] },
    ],
  };
  const rows = appViewRows(app);
  const keys = rows.map(r => r.key);
  expect(keys[0]).toContain('manifest.json');
  expect(rows[0].value).toContain('"name":"App"');
  expect(keys.some(k => k.includes('name'))).toBe(true);
  expect(keys.some(k => k.includes('icons'))).toBe(true);
  const install = rows.find(r => r.key.includes('no-icon-available'))!;
  expect(install.tone).toBe('error');
  const foo = rows.find(r => r.key.includes('Foo'))!;
  expect(foo.tone).toBe('ok');
  expect(foo.value).toContain('Foo');
  const bar = rows.find(r => r.key.includes('Bar'))!;
  expect(bar.tone).toBe('error');
});

test('appViewRows degrades to a no-manifest row', () => {
  const rows = appViewRows({ manifestUrl: '', manifestRaw: null, manifestErrors: [], installErrors: [], originTrials: [] });
  expect(rows[0].tone).toBe('muted');
  expect(rows.some(r => r.tone === 'ok')).toBe(true);
});

test('framesViewRows indents children and marks isolation', () => {
  const frames: FrameNodeView[] = [
    { id: 'm', url: 'https://a.test/', origin: 'https://a.test', depth: 0, secureContext: 'Secure', crossOriginIsolated: 'Isolated', coep: 'RequireCorp', coop: 'SameOrigin' },
    { id: 'c', url: 'https://cdn.test/f', origin: 'https://cdn.test', depth: 1, secureContext: 'Secure', crossOriginIsolated: 'NotIsolated' },
  ];
  const rows = framesViewRows(frames);
  expect(rows[0].key).toBe('https://a.test/');
  expect(rows[0].tone).toBe('ok');
  expect(rows[0].meta).toContain('COOP:SameOrigin');
  expect(rows[1].key.startsWith('  ')).toBe(true);
  expect(rows[1].value).toContain('COEP:');
  expect(rows[1].value).toContain('crossOriginIsolated: NotIsolated');
});

test('Esc clears the pending clear-confirmation timer', () => {
  const timer = setTimeout(() => {}, 100000);
  const setConfirmClear = vi.fn();
  const storage = {
    storageView: 'cookies', cookieRows: [], localRows: [], sessionRows: [],
    idbDb: null, idbStore: null, cacheOpen: null,
    storageFilter: '', storageEditing: null, storageErr: undefined,
    confirmClear: 'store', setConfirmClear,
    setStorageEditing: vi.fn(), setStorageErr: vi.fn(), setStorageFilter: vi.fn(), setStorageSel: vi.fn(),
    clearTimer: { current: timer },
  } as any;
  const ctx = {
    storage, attached: null, bodyH: 20, listNav: () => false,
    copyFn: async () => {}, setToast: vi.fn(), setStorageDetail: vi.fn(),
    setStorageDetailScroll: vi.fn(), withEditor: async () => null,
  } as any;
  const spy = vi.spyOn(global, 'clearTimeout');
  handleStorageKey(ctx, '', { escape: true } as any);
  expect(spy).toHaveBeenCalledWith(timer);
  expect(setConfirmClear).toHaveBeenCalledWith(false);
  spy.mockRestore();
  clearTimeout(timer);
});

const VIEWS_ARR: StorageView[] = ['cookies', 'local', 'session', 'idb', 'cache', 'sw', 'app', 'frames', 'background', 'shared', 'pst'];

test('windowViews keeps the whole strip when it fits and windows it around the active view otherwise', () => {
  const all = windowViews(VIEWS_ARR, 'cookies', 999);
  expect(all.shown.length).toBe(VIEWS_ARR.length);
  expect(all.left).toBe(false);
  expect(all.right).toBe(false);
  const narrow = windowViews(VIEWS_ARR, 'pst', 20);
  expect(narrow.shown).toContain('pst');
  expect(narrow.left).toBe(true);
  expect(narrow.right).toBe(false);
});

test('the tab strip windows around the active view at narrow widths', () => {
  const narrow = stripAnsi(render(
    <StorageOverlay view="pst" cookies={[]} local={[]} session={[]} selected={0} trustTokens={[]} width={40} height={12} />,
  ).lastFrame()!);
  expect(narrow).toContain('pst');
  expect(narrow).toContain('‹');
  const wide = stripAnsi(render(
    <StorageOverlay view="cookies" cookies={cookies} local={local} session={[]} selected={0} width={120} height={12} />,
  ).lastFrame()!);
  expect(wide).toContain('cookies');
  expect(wide).toContain('pst');
  expect(wide).not.toContain('‹');
  expect(wide).not.toContain('›');
});

test('the storage overlay keeps a constant height in the app and frames views', () => {
  const lineCount = (el: React.ReactElement) => render(el).lastFrame()!.split('\n').length;
  const app: AppViewState = {
    manifestUrl: 'https://a.test/manifest.json',
    manifestRaw: JSON.stringify({ name: 'App', start_url: '/' }),
    manifestErrors: ['bad icon'],
    installErrors: ['no-icon-available'],
    originTrials: [{ name: 'Foo', status: 'Enabled', tokens: [{ status: 'Success' }] }],
  };
  const frames: FrameNodeView[] = Array.from({ length: 20 }, (_, i) => ({
    id: `f${i}`, url: `https://a.test/${i}`, origin: 'https://a.test', depth: i % 3, secureContext: 'Secure', crossOriginIsolated: 'NotIsolated',
  }));
  for (const height of [14, 20, 8]) {
    expect(lineCount(<StorageOverlay view="app" cookies={[]} local={[]} session={[]} selected={0} app={app} height={height} />)).toBe(height);
    expect(lineCount(<StorageOverlay view="frames" cookies={[]} local={[]} session={[]} selected={19} frames={frames} height={height} />)).toBe(height);
  }
});
