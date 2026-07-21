import { test, expect } from 'vitest';
import { openFolder, type OpenFolderEnv } from '../src/util/open-folder.js';

function fakeEnv(over: Partial<OpenFolderEnv> = {}) {
  const spawned: Array<[string, string[]]> = [];
  const ensured: string[] = [];
  const env: OpenFolderEnv = {
    platform: 'linux',
    isWsl: async () => false,
    spawn: async (cmd, args) => { spawned.push([cmd, args]); },
    windowsPath: async dir => `\\\\wsl.localhost\\Ubuntu${dir.replace(/\//g, '\\')}`,
    ensureDir: async dir => { ensured.push(dir); },
    ...over,
  };
  return { env, spawned, ensured };
}

test('linux opens the folder with xdg-open after ensuring it exists', async () => {
  const { env, spawned, ensured } = fakeEnv();
  await openFolder('/data/devtools-tui', env);
  expect(ensured).toEqual(['/data/devtools-tui']);
  expect(spawned).toEqual([['xdg-open', ['/data/devtools-tui']]]);
});

test('WSL converts the path with wslpath and opens it with explorer.exe', async () => {
  const { env, spawned } = fakeEnv({ isWsl: async () => true });
  await openFolder('/data/devtools-tui', env);
  expect(spawned).toEqual([['explorer.exe', ['\\\\wsl.localhost\\Ubuntu\\data\\devtools-tui']]]);
});

test('darwin opens the folder with open', async () => {
  const { env, spawned } = fakeEnv({ platform: 'darwin' });
  await openFolder('/data/devtools-tui', env);
  expect(spawned).toEqual([['open', ['/data/devtools-tui']]]);
});

test('win32 opens the folder with explorer.exe without conversion', async () => {
  const { env, spawned } = fakeEnv({ platform: 'win32' });
  await openFolder('C:\\data\\devtools-tui', env);
  expect(spawned).toEqual([['explorer.exe', ['C:\\data\\devtools-tui']]]);
});

test('a spawn failure rejects', async () => {
  const { env } = fakeEnv({ spawn: async () => { throw new Error('nope'); } });
  await expect(openFolder('/data/devtools-tui', env)).rejects.toThrow('nope');
});
