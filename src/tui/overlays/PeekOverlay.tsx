import React from 'react';
import { Box, Text } from 'ink';
import type { NetworkEntry } from '../../store/types.js';
import { fmtBytes, fmtMs, statusColor, truncate } from '../lib/format.js';
import { nameOf } from '../panels/NetworkPanel.js';

export const PEEK_HEIGHT = 12;

const URL_ROWS = 7;

function statusText(e: NetworkEntry): string {
  if (e.error) return `FAIL (${e.error})`;
  if (e.status !== undefined) return `${e.status}${e.statusText ? ` ${e.statusText}` : ''}`;
  return 'pending';
}

function urlRows(url: string, method: string, inner: number): string[] {
  const widths = [Math.max(1, inner - (method.length + 1)), ...Array.from({ length: URL_ROWS - 1 }, () => inner)];
  const rows: string[] = [];
  let rest = url;
  for (let i = 0; i < URL_ROWS; i++) {
    if (i < URL_ROWS - 1) {
      rows.push(rest.slice(0, widths[i]));
      rest = rest.slice(widths[i]);
    } else {
      rows.push(rest.length > widths[i] ? truncate(rest, widths[i]) : rest);
    }
  }
  return rows;
}

export interface PeekOverlayProps {
  entry: NetworkEntry;
  width?: number;
}

export function PeekOverlay({ entry, width = 100 }: PeekOverlayProps): React.JSX.Element {
  const inner = width - 4;
  const [head, ...tail] = urlRows(entry.url, entry.method, inner);
  const name = entry.gqlOperation ? `gql·${entry.gqlOperation}` : nameOf(entry.url).name;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={width}>
      <Text bold color="cyan" wrap="truncate">{name.slice(0, inner)}</Text>
      <Box>
        <Text bold>{entry.method} </Text>
        <Text wrap="truncate">{head || ' '}</Text>
      </Box>
      {tail.map((row, i) => (
        <Text key={i} wrap="truncate">{row || ' '}</Text>
      ))}
      <Box>
        <Text color={statusColor(entry)} wrap="truncate">{statusText(entry)}</Text>
        <Text dimColor wrap="truncate">{` · ${entry.type} · ${entry.mimeType ?? '-'}`}</Text>
      </Box>
      <Box>
        <Text wrap="truncate">{`time ${fmtMs(entry.durationMs)} · size ${fmtBytes(entry.encodedBytes)}`}</Text>
        {entry.body !== undefined ? <Text dimColor wrap="truncate"> ⏺ body captured</Text> : null}
      </Box>
    </Box>
  );
}
