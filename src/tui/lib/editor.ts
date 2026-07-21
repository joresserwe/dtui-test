import { spawn } from 'node:child_process';
import { writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadConfig, type Config } from '../../config.js';

export interface EditorOpts {
  readonly?: boolean;
}

export type EditorRunner = (file: string, opts?: EditorOpts) => Promise<void>;

let counter = 0;

const READONLY_FLAG_EDITORS = ['vi', 'vim', 'nvim'];

export function resolveEditorArgv(
  opts: EditorOpts = {},
  env: NodeJS.ProcessEnv = process.env,
  config: Pick<Config, 'editor'> = loadConfig(),
): string[] {
  const editor = config.editor || env.VISUAL || env.EDITOR || 'vi';
  const argv = editor.split(/\s+/).filter(Boolean);
  if (opts.readonly && READONLY_FLAG_EDITORS.includes(basename(argv[0]))) argv.push('-R');
  return argv;
}

export function realEditorRunner(): EditorRunner {
  return (file: string, opts?: EditorOpts) =>
    new Promise<void>((resolve, reject) => {
      // Resolved inside the closure: a changed editor setting must apply on the next launch.
      const [cmd, ...args] = resolveEditorArgv(opts);
      const child = spawn(cmd, [...args, file], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', () => resolve());
    });
}

export async function editOuterHtml(
  html: string,
  run: EditorRunner = realEditorRunner(),
  dir: string = tmpdir(),
  ext = 'html',
  opts: EditorOpts = {},
): Promise<string> {
  const file = join(dir, `dtui-edit-${process.pid}-${counter++}.${ext}`);
  await writeFile(file, html);
  try {
    // 0444 makes any editor treat the file as read-only; unlink permission comes
    // from the directory, so the rm in finally still removes the 0444 file.
    if (opts.readonly) await chmod(file, 0o444);
    await run(file, opts);
    return await readFile(file, 'utf8');
  } finally {
    await rm(file, { force: true });
  }
}
