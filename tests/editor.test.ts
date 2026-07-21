import { test, expect } from 'vitest';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { editOuterHtml, resolveEditorArgv, type EditorOpts } from '../src/tui/lib/editor.js';

test('editOuterHtml round-trips through the runner and cleans up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-edit-'));
  let seenFile = '';
  const result = await editOuterHtml('<div>before</div>', async file => {
    seenFile = file;
    expect(await readFile(file, 'utf8')).toBe('<div>before</div>');
    await writeFile(file, '<div>after</div>');
  }, dir);
  expect(result).toBe('<div>after</div>');
  expect(seenFile.endsWith('.html')).toBe(true);
  expect((await readdir(dir)).length).toBe(0);
});

test('a passed ext names the temp file accordingly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-edit-ext-'));
  let seenFile = '';
  await editOuterHtml('.x { color: red }', async file => { seenFile = file; }, dir, 'css');
  expect(seenFile.endsWith('.css')).toBe(true);
  expect((await readdir(dir)).length).toBe(0);
});

test('cleans up even when the runner throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-edit2-'));
  await expect(editOuterHtml('<p>x</p>', async () => { throw new Error('editor died'); }, dir))
    .rejects.toThrow('editor died');
  expect((await readdir(dir)).length).toBe(0);
});

test('readonly opt chmods the temp file to 0444, forwards opts, and still cleans up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-view-'));
  let mode = 0;
  let seenOpts: EditorOpts | undefined;
  const result = await editOuterHtml('secret body', async (file, opts) => {
    mode = (await stat(file)).mode & 0o777;
    seenOpts = opts;
  }, dir, 'txt', { readonly: true });
  expect(mode).toBe(0o444);
  expect(seenOpts).toEqual({ readonly: true });
  expect(result).toBe('secret body');
  expect((await readdir(dir)).length).toBe(0);
});

test('without readonly the temp file stays writable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-rw-'));
  let mode = 0;
  await editOuterHtml('x', async file => {
    mode = (await stat(file)).mode & 0o200;
  }, dir);
  expect(mode).toBe(0o200);
});

test('resolveEditorArgv prefers config over env and env over the vi default', () => {
  expect(resolveEditorArgv({}, { VISUAL: 'vis', EDITOR: 'ed' }, { editor: 'code --wait' })).toEqual(['code', '--wait']);
  expect(resolveEditorArgv({}, { VISUAL: 'vis', EDITOR: 'ed' }, {})).toEqual(['vis']);
  expect(resolveEditorArgv({}, { EDITOR: 'ed' }, {})).toEqual(['ed']);
  expect(resolveEditorArgv({}, {}, {})).toEqual(['vi']);
  expect(resolveEditorArgv({}, { EDITOR: 'ed' }, { editor: '' })).toEqual(['ed']);
});

test('resolveEditorArgv appends -R only for vi/vim/nvim when readonly', () => {
  expect(resolveEditorArgv({ readonly: true }, {}, {})).toEqual(['vi', '-R']);
  expect(resolveEditorArgv({ readonly: true }, {}, { editor: 'nvim' })).toEqual(['nvim', '-R']);
  expect(resolveEditorArgv({ readonly: true }, { EDITOR: '/usr/bin/vim' }, {})).toEqual(['/usr/bin/vim', '-R']);
  expect(resolveEditorArgv({ readonly: true }, {}, { editor: 'code --wait' })).toEqual(['code', '--wait']);
  expect(resolveEditorArgv({ readonly: true }, { EDITOR: 'nano' }, {})).toEqual(['nano']);
  expect(resolveEditorArgv({ readonly: false }, {}, { editor: 'nvim' })).toEqual(['nvim']);
});
