import { test, expect } from 'vitest';
import { parseCustomDevice } from '../src/tui/hooks/use-emulation-tool.js';

test('parses WxH@DPR with a mobile flag', () => {
  expect(parseCustomDevice('360x640@2 mobile')).toEqual({
    label: '360×640', width: 360, height: 640, deviceScaleFactor: 2, mobile: true,
  });
});

test('defaults DPR to 1 and mobile to false, tolerating the × separator and spacing', () => {
  expect(parseCustomDevice('1440 × 900')).toEqual({
    label: '1440×900', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
});

test('skips comment and blank lines, reading the first real line', () => {
  expect(parseCustomDevice('# format: WxH@DPR\n\n375x812@3 mobile\n')).toMatchObject({
    width: 375, height: 812, deviceScaleFactor: 3, mobile: true,
  });
});

test('clamps oversized width, height and DPR to their maximums', () => {
  expect(parseCustomDevice('99999x88888@50')).toEqual({
    label: '10000×10000', width: 10000, height: 10000, deviceScaleFactor: 10, mobile: false,
  });
  expect(parseCustomDevice('20000x480@3 mobile')).toEqual({
    label: '10000×480', width: 10000, height: 480, deviceScaleFactor: 3, mobile: true,
  });
});

test('rejects malformed input, zero dimensions and non-positive DPR', () => {
  expect(parseCustomDevice('')).toBeNull();
  expect(parseCustomDevice('wide')).toBeNull();
  expect(parseCustomDevice('0x640')).toBeNull();
  expect(parseCustomDevice('360x640@0')).toBeNull();
  expect(parseCustomDevice('# only a comment')).toBeNull();
});
