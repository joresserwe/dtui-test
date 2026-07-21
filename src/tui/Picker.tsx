import React from 'react';
import { Box, Text } from 'ink';
import type { BrowserCandidate } from '../browser/detect.js';
import type { ProfileMode } from '../browser/launch.js';
import { displayWidth } from './lib/format.js';

export interface PickerProps {
  candidates: BrowserCandidate[];
  selected: number;
  profile: ProfileMode;
  busy?: string;
  error?: string;
}

const WIDTH = 76;
const INNER = WIDTH - 4;

export function Picker({ candidates, selected, profile, busy, error }: PickerProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={WIDTH}>
      <Box justifyContent="space-between">
        <Text bold color="cyan" wrap="truncate">Pick a browser to launch</Text>
        {candidates.length > 0 ? <Text dimColor> {Math.min(selected, candidates.length - 1) + 1}/{candidates.length}</Text> : null}
      </Box>
      <Text dimColor wrap="truncate">No CDP endpoint found — launch one of these with debugging enabled.</Text>
      <Text dimColor wrap="truncate">{'─'.repeat(INNER)}</Text>
      {candidates.map((c, i) => {
        const on = i === selected;
        const name = c.name.padEnd(16);
        const wsl = c.viaWsl ? '(windows) ' : '';
        const pad = ' '.repeat(Math.max(0, INNER - 2 - displayWidth(name) - wsl.length - displayWidth(c.path)));
        return (
          <Text key={c.path} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
            {on ? <Text color="cyan" bold>❯ </Text> : '  '}
            <Text bold={on}>{name}</Text>
            {wsl ? <Text dimColor>{wsl}</Text> : ''}
            <Text dimColor>{c.path}</Text>
            {pad}
          </Text>
        );
      })}
      {candidates.length === 0 ? (
        <Box flexDirection="column">
          <Text color="red">No Chromium-based browser found. Point at one with --browser-path.</Text>
          <Text dimColor>Or start one manually: chrome --remote-debugging-port=9222</Text>
          <Text dimColor>(Chrome/Edge 136+ also need --user-data-dir=&lt;separate dir&gt;)</Text>
        </Box>
      ) : null}
      <Text dimColor wrap="truncate">{'─'.repeat(INNER)}</Text>
      <Text>
        {'  '}profile: <Text color="cyan">{profile}</Text>
        <Text dimColor>{profile === 'existing' ? ' (keeps logins; Chrome/Edge 136+ may block it)' : ' (isolated, always works)'}</Text>
      </Text>
      {error ? (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text bold color="red" wrap="truncate">launch failed</Text>
          <Text wrap="wrap">{error}</Text>
        </Box>
      ) : busy ? (
        <Box flexDirection="column">
          <Text color="yellow" wrap="wrap">{'\u25CC'} {busy}</Text>
          <Text dimColor wrap="wrap">  a first launch can take a few seconds</Text>
        </Box>
      ) : candidates.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor wrap="wrap">⏎ starts the selected browser with its DevTools port open and attaches to it.</Text>
          {candidates.some(c => c.viaWsl) ? (
            <Text dimColor wrap="wrap">(windows) browsers connect through an automatic relay.</Text>
          ) : null}
        </Box>
      ) : null}
      <Text dimColor>{candidates.length > 0 ? 'j/k move · p profile · ⏎ launch · q quit' : 'q quit'}</Text>
    </Box>
  );
}
