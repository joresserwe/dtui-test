import { test, expect } from 'vitest';
import { detectBrowsers, type DetectEnv } from '../src/browser/detect.js';

const env = (over: Partial<DetectEnv>): DetectEnv => ({
  platform: 'linux',
  isWsl: async () => false,
  exists: () => false,
  readDir: () => [],
  env: {},
  extraPaths: [],
  regQuery: async () => undefined,
  mdfind: async () => undefined,
  ...over,
});

test('win32 finds browsers under the standard bases', async () => {
  const existing = new Set([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Perplexity\\Comet\\Application\\comet.exe',
    'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
  const found = await detectBrowsers(env({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\PF86' },
    exists: p => existing.has(p),
  }));
  expect(found.map(f => f.kind).sort()).toEqual(['chrome', 'comet', 'edge']);
  expect(found.every(f => !f.viaWsl)).toBe(true);
});

test('WSL finds Windows browsers under /mnt/c including per-user LocalAppData', async () => {
  const existing = new Set([
    '/mnt/c/Program Files/Perplexity/Comet/Application/comet.exe',
    '/mnt/c/Users/kartr/AppData/Local/Google/Chrome/Application/chrome.exe',
  ]);
  const found = await detectBrowsers(env({
    platform: 'linux',
    isWsl: async () => true,
    exists: p => existing.has(p),
    readDir: p => (p === '/mnt/c/Users' ? ['kartr', 'Public', 'Default'] : []),
  }));
  expect(found).toHaveLength(2);
  expect(found.every(f => f.viaWsl)).toBe(true);
  expect(found.map(f => f.kind).sort()).toEqual(['chrome', 'comet']);
});

test('darwin finds app bundles', async () => {
  const found = await detectBrowsers(env({
    platform: 'darwin',
    exists: p => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }));
  expect(found).toEqual([
    { kind: 'chrome', name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', viaWsl: false },
  ]);
});

test('WSL extraPaths under /mnt infer viaWsl', async () => {
  const found = await detectBrowsers(env({
    isWsl: async () => true,
    exists: p => p === '/mnt/c/tools/foo.exe',
    extraPaths: ['/mnt/c/tools/foo.exe'],
  }));
  expect(found).toEqual([
    { kind: 'custom', name: 'foo.exe', path: '/mnt/c/tools/foo.exe', viaWsl: true },
  ]);
});

test('linux scans PATH and extraPaths become custom candidates', async () => {
  const existing = new Set(['/usr/bin/chromium', '/opt/weird/mybrowser']);
  const found = await detectBrowsers(env({
    env: { PATH: '/usr/local/bin:/usr/bin' },
    exists: p => existing.has(p),
    extraPaths: ['/opt/weird/mybrowser', '/opt/absent'],
  }));
  expect(found).toEqual([
    { kind: 'chromium', name: 'Chromium', path: '/usr/bin/chromium', viaWsl: false },
    { kind: 'custom', name: 'mybrowser', path: '/opt/weird/mybrowser', viaWsl: false },
  ]);
});

test('linux finds a conventional /opt install', async () => {
  const found = await detectBrowsers(env({
    env: { PATH: '/usr/bin' },
    exists: p => p === '/opt/brave.com/brave/brave',
  }));
  expect(found).toEqual([
    { kind: 'brave', name: 'Brave', path: '/opt/brave.com/brave/brave', viaWsl: false },
  ]);
});

test('darwin mdfind adds an out-of-Applications Chrome', async () => {
  const found = await detectBrowsers(env({
    platform: 'darwin',
    exists: p => p === '/Users/kartr/Apps/Google Chrome.app/Contents/MacOS/Google Chrome',
    mdfind: async q => (q.includes('com.google.Chrome') ? '/Users/kartr/Apps/Google Chrome.app\n' : undefined),
  }));
  expect(found).toEqual([
    { kind: 'chrome', name: 'Google Chrome', path: '/Users/kartr/Apps/Google Chrome.app/Contents/MacOS/Google Chrome', viaWsl: false },
  ]);
});

test('darwin mdfind is skipped for a kind found under /Applications', async () => {
  const queried: string[] = [];
  const found = await detectBrowsers(env({
    platform: 'darwin',
    exists: p => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    mdfind: async q => { queried.push(q); return undefined; },
  }));
  expect(found.map(f => f.kind)).toContain('chrome');
  expect(queried.some(q => q.includes('com.google.Chrome'))).toBe(false);
  expect(queried.some(q => q.includes('com.microsoft.edgemac'))).toBe(true);
});

test('a rejecting mdfind soft-fails on darwin', async () => {
  const found = await detectBrowsers(env({
    platform: 'darwin',
    exists: p => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    mdfind: async () => { throw new Error('timeout'); },
  }));
  expect(found).toEqual([
    { kind: 'chrome', name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', viaWsl: false },
  ]);
});

test('registry App Paths hits are merged on win32', async () => {
  const reg: Record<string, string> = {
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe': [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      '    (Default)    REG_SZ    C:\\Custom\\Chrome\\chrome.exe',
    ].join('\r\n'),
  };
  const found = await detectBrowsers(env({
    platform: 'win32',
    env: {},
    exists: p => p === 'C:\\Custom\\Chrome\\chrome.exe',
    regQuery: async key => reg[key],
  }));
  expect(found).toContainEqual({ kind: 'chrome', name: 'Google Chrome', path: 'C:\\Custom\\Chrome\\chrome.exe', viaWsl: false });
});

test('WSL translates a registry C: path to /mnt/c', async () => {
  const reg: Record<string, string> = {
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe':
      '    (Default)    REG_SZ    C:\\Tools\\Brave\\brave.exe',
  };
  const found = await detectBrowsers(env({
    platform: 'linux',
    isWsl: async () => true,
    exists: p => p === '/mnt/c/Tools/Brave/brave.exe',
    readDir: () => [],
    regQuery: async key => reg[key],
  }));
  expect(found).toContainEqual({ kind: 'brave', name: 'Brave', path: '/mnt/c/Tools/Brave/brave.exe', viaWsl: true });
});

test('registry parse is locale-agnostic and handles REG_EXPAND_SZ and quotes', async () => {
  const reg: Record<string, string> = {
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe':
      '    (기본값)    REG_SZ    C:\\Custom\\chrome.exe',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe':
      '    (Default)    REG_EXPAND_SZ    C:\\Edge\\msedge.exe',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe':
      '    (Default)    REG_SZ    "C:\\Program Files\\Brave\\brave.exe"',
  };
  const existing = new Set(['C:\\Custom\\chrome.exe', 'C:\\Edge\\msedge.exe', 'C:\\Program Files\\Brave\\brave.exe']);
  const found = await detectBrowsers(env({
    platform: 'win32',
    exists: p => existing.has(p),
    regQuery: async key => reg[key],
  }));
  expect(found).toContainEqual({ kind: 'chrome', name: 'Google Chrome', path: 'C:\\Custom\\chrome.exe', viaWsl: false });
  expect(found).toContainEqual({ kind: 'edge', name: 'Microsoft Edge', path: 'C:\\Edge\\msedge.exe', viaWsl: false });
  expect(found).toContainEqual({ kind: 'brave', name: 'Brave', path: 'C:\\Program Files\\Brave\\brave.exe', viaWsl: false });
});

test('registry query is skipped for a kind found by the filesystem scan', async () => {
  const queried: string[] = [];
  const found = await detectBrowsers(env({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    exists: p => p === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    regQuery: async key => { queried.push(key); return undefined; },
  }));
  expect(found.map(f => f.kind)).toContain('chrome');
  expect(queried.some(k => k.endsWith('App Paths\\chrome.exe'))).toBe(false);
  expect(queried.some(k => k.endsWith('App Paths\\msedge.exe'))).toBe(true);
});

test('a rejecting regQuery soft-fails without affecting the browser list', async () => {
  const found = await detectBrowsers(env({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    exists: p => p === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    regQuery: async () => { throw new Error('timeout'); },
  }));
  expect(found).toEqual([
    { kind: 'chrome', name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', viaWsl: false },
  ]);
});
