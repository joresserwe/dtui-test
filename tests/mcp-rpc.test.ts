import { test, expect } from 'vitest';
import { LineDecoder, encodeFrame } from '../src/mcp/rpc.js';

test('encodeFrame emits one JSON line with a trailing newline', () => {
  expect(encodeFrame({ id: 1, method: 'ping' })).toBe('{"id":1,"method":"ping"}\n');
});

test('LineDecoder yields complete frames and buffers partial ones', () => {
  const dec = new LineDecoder();
  expect(dec.push(Buffer.from('{"id":1}\n{"id"'))).toEqual([{ id: 1 }]);
  expect(dec.push(Buffer.from(':2}\n'))).toEqual([{ id: 2 }]);
});

test('LineDecoder handles multiple frames in one chunk', () => {
  const dec = new LineDecoder();
  expect(dec.push(Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n'))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('LineDecoder reassembles a multi-byte UTF-8 sequence split across chunks', () => {
  const dec = new LineDecoder();
  const line = Buffer.from('{"msg":"한글"}\n');
  expect(dec.push(line.subarray(0, 9))).toEqual([]);
  expect(dec.push(line.subarray(9))).toEqual([{ msg: '한글' }]);
});

test('LineDecoder skips blank and malformed lines', () => {
  const dec = new LineDecoder();
  expect(dec.push(Buffer.from('\n  \nnot-json{{{\n{"ok":true}\n'))).toEqual([{ ok: true }]);
});

test('LineDecoder ignores non-object frames', () => {
  const dec = new LineDecoder();
  expect(dec.push(Buffer.from('42\n"str"\nnull\n{"o":1}\n'))).toEqual([{ o: 1 }]);
});

test('LineDecoder drops an oversized line without unbounded buffering', () => {
  const dec = new LineDecoder(16);
  expect(dec.push(Buffer.from('x'.repeat(40)))).toEqual([]);
  expect(dec.push(Buffer.from('y'.repeat(40)))).toEqual([]);
  expect(dec.push(Buffer.from('zz\n{"ok":1}\n'))).toEqual([{ ok: 1 }]);
});

test('LineDecoder drops a complete line that exceeds the cap in one chunk', () => {
  const dec = new LineDecoder(16);
  expect(dec.push(Buffer.from(`{"pad":"${'x'.repeat(64)}"}\n{"ok":2}\n`))).toEqual([{ ok: 2 }]);
});
