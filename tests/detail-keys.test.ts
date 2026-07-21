import { test, expect } from 'vitest';
import type { Key } from 'ink';
import { handleDetailKey, type DetailKeyCtx } from '../src/tui/keys/detail-keys.js';
import type { NetworkEntry } from '../src/store/types.js';

const entry: NetworkEntry = {
  id: 'r1', url: 'https://api.test/data', method: 'POST', type: 'XHR',
  status: 200, statusText: 'OK', mimeType: 'application/json',
  requestHeaders: {}, responseHeaders: {},
  startTs: 0, durationMs: 142, encodedBytes: 2150,
  body: '{"ok":true}', bodyBase64: false, bodyTruncated: false,
};

const key = (over: Partial<Key> = {}): Key => over as Key;

const makeCtx = (over: Partial<DetailKeyCtx> = {}): DetailKeyCtx => ({
  detailEntry: entry,
  detailRich: [{ text: 'line one' }, { text: 'line two' }],
  detailMaxScroll: 0,
  detailH: 10,
  detailTab: 'summary',
  msgFilter: '',
  setMsgFilter: () => {},
  setMsgFilterEditing: () => {},
  gPending: { current: false },
  setDetailOpen: () => {},
  setDetailEntry: () => {},
  setDetailTab: () => {},
  setDetailScroll: () => {},
  setDetailWrap: () => {},
  copyFn: async () => {},
  setToast: () => {},
  withEditor: async () => null,
  ...over,
});

test('w toggles the body wrap flag back and forth', () => {
  let wrap = false;
  const ctx = makeCtx({
    setDetailWrap: u => {
      wrap = typeof u === 'function' ? u(wrap) : u;
    },
  });
  expect(handleDetailKey(ctx, 'w', key())).toBe(true);
  expect(wrap).toBe(true);
  expect(handleDetailKey(ctx, 'w', key())).toBe(true);
  expect(wrap).toBe(false);
});

test('e opens the tab text in the editor as read-only plain text', () => {
  const calls: Array<[string, string | undefined, { readonly?: boolean } | undefined]> = [];
  const ctx = makeCtx({
    withEditor: async (initial, ext, opts) => {
      calls.push([initial, ext, opts]);
      return null;
    },
  });
  expect(handleDetailKey(ctx, 'e', key())).toBe(true);
  expect(calls).toEqual([['line one\nline two', 'txt', { readonly: true }]]);
});

test('/ opens the frame filter only on the messages tab', () => {
  let editing = false;
  const ctx = makeCtx({
    detailTab: 'messages',
    setMsgFilterEditing: v => { editing = v; },
  });
  expect(handleDetailKey(ctx, '/', key())).toBe(true);
  expect(editing).toBe(true);
});

test('/ on other tabs does not open the frame filter', () => {
  let editing = false;
  const ctx = makeCtx({
    detailTab: 'summary',
    setMsgFilterEditing: v => { editing = v; },
  });
  handleDetailKey(ctx, '/', key());
  expect(editing).toBe(false);
});

test('esc clears an active frame filter before closing the overlay', () => {
  let open = true;
  let filter = 'ping';
  const ctx = makeCtx({
    detailTab: 'messages',
    msgFilter: 'ping',
    setMsgFilter: v => { filter = v; },
    setDetailOpen: v => { open = v; },
  });
  expect(handleDetailKey(ctx, '', key({ escape: true }))).toBe(true);
  expect(filter).toBe('');
  expect(open).toBe(true);
  expect(handleDetailKey(makeCtx({ detailTab: 'messages', msgFilter: '', setDetailOpen: v => { open = v; } }), '', key({ escape: true }))).toBe(true);
  expect(open).toBe(false);
});
