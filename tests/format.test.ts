import { test, expect } from 'vitest';
import { abbrevPath, displayWidth, fmtDateTime, fmtRel, prettyBody } from '../src/tui/lib/format.js';
import { methodColor, theme } from '../src/tui/lib/theme.js';

test('indents xml by nesting depth', () => {
  const out = prettyBody('<note><to>Tove</to><from>Jani</from></note>', 'application/xml');
  expect(out).toBe('<note>\n  <to>Tove</to>\n  <from>Jani</from>\n</note>');
});

test('handles self-closing and declaration tags', () => {
  const out = prettyBody('<?xml version="1.0"?><root><br/><item>x</item></root>', 'text/xml');
  expect(out).toBe('<?xml version="1.0"?>\n<root>\n  <br/>\n  <item>x</item>\n</root>');
});

test('keeps depth for a mixed-content line whose trailing tag is self-closing', () => {
  const out = prettyBody('<a><b>text<c/></b></a>', 'application/xml');
  expect(out).toBe('<a>\n  <b>text<c/>\n  </b>\n</a>');
});

test('falls back to raw text on malformed xml', () => {
  const raw = 'not really <xml at all';
  expect(prettyBody(raw, 'application/xml')).toBe(raw);
});

test('fmtRel picks the largest whole unit and ignores sign', () => {
  expect(fmtRel(45_000)).toBe('45s');
  expect(fmtRel(-45_000)).toBe('45s');
  expect(fmtRel(90_000)).toBe('2m');
  expect(fmtRel(7_200_000)).toBe('2h');
  expect(fmtRel(3 * 86_400_000)).toBe('3d');
});

test('fmtDateTime renders a local YYYY-MM-DD HH:MM:SS stamp', () => {
  const ts = new Date(2026, 6, 17, 9, 5, 3).getTime();
  expect(fmtDateTime(ts)).toBe('2026-07-17 09:05:03');
});

test('methodColor maps verbs to distinct tokens and is case-insensitive', () => {
  expect(methodColor('GET')).toBe(theme.key);
  expect(methodColor('post')).toBe(theme.ok);
  expect(methodColor('PUT')).toBe(theme.warn);
  expect(methodColor('PATCH')).toBe(theme.accent);
  expect(methodColor('DELETE')).toBe(theme.err);
  expect(methodColor('DELETE')).not.toBe(methodColor('GET'));
  expect(methodColor('OPTIONS')).toBe(theme.muted);
});

test('abbrevPath substitutes ~ for the home directory', () => {
  expect(abbrevPath('/home/u/data/file.har', 44, '/home/u')).toBe('~/data/file.har');
  expect(abbrevPath('/home/u', 44, '/home/u')).toBe('~');
  expect(abbrevPath('/home/user2/f.har', 44, '/home/u')).toBe('/home/user2/f.har');
});

test('abbrevPath leaves short paths unchanged', () => {
  expect(abbrevPath('/tmp/session-xyz.har', 44, '/home/u')).toBe('/tmp/session-xyz.har');
});

test('abbrevPath middle-ellipsizes long paths but keeps the filename', () => {
  const p = '/home/u/.local/share/devtools-tui/har/session-2026-07-17-0930.har';
  const out = abbrevPath(p, 44, '/home/u');
  expect(out.startsWith('~/')).toBe(true);
  expect(out).toContain('…');
  expect(out.endsWith('/session-2026-07-17-0930.har')).toBe(true);
  expect(displayWidth(out)).toBeLessThanOrEqual(44);
});

test('abbrevPath keeps the tail of an oversized filename', () => {
  const out = abbrevPath(`/x/${'a'.repeat(60)}-tail.har`, 20, '/home/u');
  expect(out.startsWith('…')).toBe(true);
  expect(out.endsWith('-tail.har')).toBe(true);
  expect(displayWidth(out)).toBeLessThanOrEqual(20);
});
