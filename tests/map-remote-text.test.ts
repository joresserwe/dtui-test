import { test, expect } from 'vitest';
import { formatMapRemoteText, formatMapRemoteRuleText, parseMapRemoteText } from '../src/tui/lib/map-remote-text.js';

test('formatMapRemoteText prefills MATCH and TO with the entry url', () => {
  const text = formatMapRemoteText('https://a.test/api/users');
  expect(parseMapRemoteText(text)).toEqual({ pattern: 'https://a.test/api/users', target: 'https://a.test/api/users' });
});

test('formatMapRemoteRuleText round-trips a rule', () => {
  const text = formatMapRemoteRuleText({ pattern: 'https://a.test/api/*', target: 'http://localhost:3000/api/*' });
  expect(parseMapRemoteText(text)).toEqual({ pattern: 'https://a.test/api/*', target: 'http://localhost:3000/api/*' });
});

test('parse skips comments and blank lines and requires both keys', () => {
  expect(parseMapRemoteText('# map remote\n\nMATCH https://a.test/*\n# to local\nTO http://localhost/*\n'))
    .toEqual({ pattern: 'https://a.test/*', target: 'http://localhost/*' });
  expect(parseMapRemoteText('MATCH https://a.test/*\n')).toBeNull();
  expect(parseMapRemoteText('TO http://x/\n')).toBeNull();
  expect(parseMapRemoteText('MATCH\nTO http://x/\n')).toBeNull();
});
