import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

export interface OpenFolderEnv {
  platform: NodeJS.Platform;
  isWsl(): Promise<boolean>;
  spawn(cmd: string, args: string[]): Promise<void>;
  windowsPath(dir: string): Promise<string>;
  ensureDir(dir: string): Promise<void>;
}

export function realOpenFolderEnv(): OpenFolderEnv {
  return {
    platform: process.platform,
    async isWsl() {
      try {
        return /microsoft/i.test(await readFile('/proc/version', 'utf8'));
      } catch {
        return false;
      }
    },
    spawn(cmd, args) {
      return new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
        child.once('error', reject);
      });
    },
    async windowsPath(dir) {
      const { stdout } = await promisify(execFile)('wslpath', ['-w', dir]);
      return stdout.trim();
    },
    async ensureDir(dir) {
      await mkdir(dir, { recursive: true });
    },
  };
}

export async function openFolder(dir: string, env: OpenFolderEnv = realOpenFolderEnv()): Promise<void> {
  await env.ensureDir(dir);
  if (env.platform === 'linux' && (await env.isWsl())) {
    await env.spawn('explorer.exe', [await env.windowsPath(dir)]);
    return;
  }
  const cmd = env.platform === 'darwin' ? 'open' : env.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  await env.spawn(cmd, [dir]);
}
