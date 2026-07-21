import { test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, loadConfig, normalizeNetColumns, saveConfig } from '../src/config.js';

test('configPath follows XDG and APPDATA conventions', () => {
  expect(configPath({ XDG_CONFIG_HOME: '/xdg' }, 'linux')).toBe('/xdg/devtools-tui/config.json');
  expect(configPath({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.config/devtools-tui/config.json');
  expect(configPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32'))
    .toBe(join('C:\\Users\\u\\AppData\\Roaming', 'devtools-tui', 'config.json'));
});

test('loadConfig parses browserPaths and never throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-cfg-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ browserPaths: ['/opt/x/browser', 42] }));
  expect(loadConfig(file)).toEqual({ browserPaths: ['/opt/x/browser'] });
  expect(loadConfig(join(dir, 'missing.json'))).toEqual({});
  await writeFile(file, 'not json');
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig round-trips layout and drops invalid values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-layout-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ layout: 'split' }));
  expect(loadConfig(file)).toEqual({ layout: 'split' });
  await writeFile(file, JSON.stringify({ layout: 'grid' }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig round-trips cacheDisabled and drops non-boolean values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-cache-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ cacheDisabled: true }));
  expect(loadConfig(file)).toEqual({ cacheDisabled: true });
  await writeFile(file, JSON.stringify({ cacheDisabled: 'yes' }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig round-trips clearOnNav and drops non-boolean values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-clearnav-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ clearOnNav: true }));
  expect(loadConfig(file)).toEqual({ clearOnNav: true });
  await writeFile(file, JSON.stringify({ clearOnNav: 'yes' }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig round-trips networkCap and rejects out-of-range or non-integer values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-netcap-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ networkCap: 2500 }));
  expect(loadConfig(file)).toEqual({ networkCap: 2500 });
  await writeFile(file, JSON.stringify({ networkCap: 100 }));
  expect(loadConfig(file)).toEqual({ networkCap: 100 });
  await writeFile(file, JSON.stringify({ networkCap: 5000 }));
  expect(loadConfig(file)).toEqual({ networkCap: 5000 });
  await writeFile(file, JSON.stringify({ networkCap: 99 }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ networkCap: 5001 }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ networkCap: 500.5 }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ networkCap: '1000' }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig keeps a valid port and drops out-of-range, non-integer, or wrong-type values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-port-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ port: 9333 }));
  expect(loadConfig(file)).toEqual({ port: 9333 });
  await writeFile(file, JSON.stringify({ port: 0 }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ port: 70000 }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ port: 9222.5 }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ port: '9222' }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig keeps valid ports and drops invalid entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-ports-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ ports: [9222, 9333, 0, 70000, 9444.5, '9555'] }));
  expect(loadConfig(file)).toEqual({ ports: [9222, 9333] });
  await writeFile(file, JSON.stringify({ ports: [0, 70000] }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ ports: [] }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig round-trips networkColumns, dropping unknown ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-cols-'));
  const file = join(dir, 'config.json');
  saveConfig({ networkColumns: ['status', 'method', 'name'] }, file);
  expect(loadConfig(file)).toEqual({ networkColumns: ['status', 'method', 'name'] });
  await writeFile(file, JSON.stringify({ networkColumns: ['status', 'bogus', 42, 'url'] }));
  expect(loadConfig(file)).toEqual({ networkColumns: ['status', 'url'] });
  await writeFile(file, JSON.stringify({ networkColumns: 'status' }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig keeps a non-empty editor string and drops empty or non-string values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-editor-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ editor: 'code --wait' }));
  expect(loadConfig(file)).toEqual({ editor: 'code --wait' });
  await writeFile(file, JSON.stringify({ editor: '  nvim  ' }));
  expect(loadConfig(file)).toEqual({ editor: 'nvim' });
  await writeFile(file, JSON.stringify({ editor: '   ' }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ editor: 42 }));
  expect(loadConfig(file)).toEqual({});
});

test('loadConfig parses persistSanitize and agentCmd, dropping invalid values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-ai-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ persistSanitize: true, agentCmd: ' claude --print ' }));
  expect(loadConfig(file)).toEqual({ persistSanitize: true, agentCmd: 'claude --print' });
  await writeFile(file, JSON.stringify({ persistSanitize: 'yes', agentCmd: '   ' }));
  expect(loadConfig(file)).toEqual({});
  await writeFile(file, JSON.stringify({ agentCmd: 42 }));
  expect(loadConfig(file)).toEqual({});
});

test('saveConfig with an undefined editor removes the key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-editor-clear-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ editor: 'nvim', port: 9333 }));
  saveConfig({ editor: undefined }, file);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ port: 9333 });
});

test('normalizeNetColumns orders canonically and keeps exactly one of name/url', () => {
  expect(normalizeNetColumns(['time', 'status'])).toEqual(['status', 'time', 'name']);
  expect(normalizeNetColumns(['url', 'name', 'size'])).toEqual(['size', 'url']);
  expect(normalizeNetColumns([])).toEqual(['name']);
});

test('normalizeNetColumns accepts the optional protocol/priority/initiator/set-cookies/remote ids and drops unknown', () => {
  expect(normalizeNetColumns(['remote', 'protocol', 'status'])).toEqual(['status', 'protocol', 'remote', 'name']);
  expect(normalizeNetColumns(['set-cookies', 'priority', 'initiator', 'url'])).toEqual(['priority', 'initiator', 'set-cookies', 'url']);
  expect(normalizeNetColumns(['protocol', 'bogus', 'nope'])).toEqual(['protocol', 'name']);
});

test('saveConfig merges into the existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-save-'));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ browserPaths: ['/x'], custom: 1 }));
  saveConfig({ port: 9500 }, file);
  const written = JSON.parse(await readFile(file, 'utf8'));
  expect(written).toEqual({ browserPaths: ['/x'], custom: 1, port: 9500 });
});

test('saveConfig writes to a fresh file when none exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-save2-'));
  const file = join(dir, 'nested', 'config.json');
  saveConfig({ throttle: 'slow3g' }, file);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ throttle: 'slow3g' });
});

test('loadConfig round-trips consoleHistory, dropping non-strings and capping at 50', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-conhist-'));
  const file = join(dir, 'config.json');
  saveConfig({ consoleHistory: ['b', 'a'] }, file);
  expect(loadConfig(file)).toEqual({ consoleHistory: ['b', 'a'] });
  await writeFile(file, JSON.stringify({ consoleHistory: ['x', 42, null, 'y'] }));
  expect(loadConfig(file)).toEqual({ consoleHistory: ['x', 'y'] });
  await writeFile(file, JSON.stringify({ consoleHistory: Array.from({ length: 60 }, (_, i) => `e${i}`) }));
  expect(loadConfig(file).consoleHistory).toHaveLength(50);
  await writeFile(file, JSON.stringify({ consoleHistory: 'nope' }));
  expect(loadConfig(file)).toEqual({});
});
