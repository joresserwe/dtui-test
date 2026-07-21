import { test, expect } from 'vitest';
import { COMMAND_LINE_API, completionContext, rankCandidates, type ReplCandidate } from '../src/tui/lib/repl-complete.js';

test('a partial property chain evaluates the base and completes the last segment', () => {
  expect(completionContext('foo.ba')).toEqual({ base: 'foo', token: 'ba', start: 4 });
  expect(completionContext('a.b.c')).toEqual({ base: 'a.b', token: 'c', start: 4 });
  expect(completionContext('a.b.c.')).toEqual({ base: 'a.b.c', token: '', start: 6 });
  expect(completionContext('foo?.ba')).toEqual({ base: 'foo', token: 'ba', start: 5 });
});

test('a bare identifier completes against globals from its start offset', () => {
  expect(completionContext('doc')).toEqual({ base: null, token: 'doc', start: 0 });
  expect(completionContext('1 + doc')).toEqual({ base: null, token: 'doc', start: 4 });
  expect(completionContext('$')).toEqual({ base: null, token: '$', start: 0 });
});

test('a chain nested in other syntax only sees the trailing chain', () => {
  expect(completionContext('foo(bar.')).toEqual({ base: 'bar', token: '', start: 8 });
  expect(completionContext('x = win.doc')).toEqual({ base: 'win', token: 'doc', start: 8 });
});

test('non-completable tails yield no context', () => {
  expect(completionContext('')).toBeNull();
  expect(completionContext('1+2')).toBeNull();
  expect(completionContext('foo(')).toBeNull();
  expect(completionContext('a[0].x')).toBeNull();
  expect(completionContext('123.')).toBeNull();
});

test('an unterminated string suppresses completion; a closed one does not', () => {
  expect(completionContext('"doc')).toBeNull();
  expect(completionContext("copy('doc")).toBeNull();
  expect(completionContext('`tpl ${doc')).toBeNull();
  expect(completionContext('"done" + doc')).toEqual({ base: null, token: 'doc', start: 9 });
  expect(completionContext('"a \\" b" + doc')).toEqual({ base: null, token: 'doc', start: 11 });
});

const cand = (name: string, source: ReplCandidate['source'] = 'global', kind?: ReplCandidate['kind']): ReplCandidate =>
  ({ name, source, ...(kind ? { kind } : {}) });

test('ranking orders case-sensitive prefix, then case-insensitive, then contains', () => {
  const out = rankCandidates(
    [cand('myDocument'), cand('Docs'), cand('doc'), cand('document')],
    'doc',
  );
  expect(out.map(c => c.name)).toEqual(['doc', 'document', 'Docs', 'myDocument']);
});

test('within a tier properties rank before globals before history, then alphabetically', () => {
  const out = rankCandidates(
    [
      cand('aa2', 'history'),
      cand('aa1', 'global'),
      cand('aa0', 'property'),
      cand('aa3', 'property'),
    ],
    'aa',
  );
  expect(out.map(c => c.name)).toEqual(['aa0', 'aa3', 'aa1', 'aa2']);
});

test('duplicates collapse to the higher-priority source and the cap limits output', () => {
  const dup = rankCandidates([cand('x', 'history'), cand('x', 'property', 'function')], 'x');
  expect(dup).toEqual([{ name: 'x', source: 'property', kind: 'function' }]);
  const many = Array.from({ length: 80 }, (_, i) => cand(`v${String(i).padStart(2, '0')}`));
  expect(rankCandidates(many, 'v')).toHaveLength(50);
  expect(rankCandidates(many, 'v', 5)).toHaveLength(5);
});

test('an empty token (after a dot) keeps every candidate', () => {
  const out = rankCandidates([cand('b', 'property'), cand('a', 'property')], '');
  expect(out.map(c => c.name)).toEqual(['a', 'b']);
});

test('non-matching candidates are dropped entirely', () => {
  expect(rankCandidates([cand('foo'), cand('bar')], 'zz')).toEqual([]);
});

test('the command-line API list covers the $ shortcuts and helpers', () => {
  for (const name of ['$0', '$4', '$_', '$', '$$', '$x', 'copy', 'inspect', 'keys', 'values', 'monitor']) {
    expect(COMMAND_LINE_API).toContain(name);
  }
});
