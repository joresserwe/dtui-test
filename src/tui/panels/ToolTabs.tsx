import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../lib/theme.js';

export type Tool = 'network' | 'console' | 'elements' | 'storage' | 'sources' | 'components' | 'audit' | 'settings';

export const TOOLS: ReadonlyArray<{ key: Tool; label: string }> = [
  { key: 'network', label: 'Network' },
  { key: 'console', label: 'Console' },
  { key: 'elements', label: 'Elements' },
  { key: 'storage', label: 'Storage' },
  { key: 'sources', label: 'Sources' },
  { key: 'components', label: 'Components' },
  { key: 'audit', label: 'Audit' },
  { key: 'settings', label: 'Settings' },
];

export interface ToolTabsProps {
  active: Tool;
  width?: number;
  tools?: ReadonlyArray<{ key: Tool; label: string }>;
}

export function ToolTabs({ active, width, tools = TOOLS }: ToolTabsProps) {
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        {' '}
        {tools.map((t, i) => (
          <Text key={t.key}>
            {i > 0 ? ' ' : null}
            {t.key === active ? (
              <Text backgroundColor={theme.accent} color={theme.badgeFg} bold>
                {` ${i + 1} ${t.label} `}
              </Text>
            ) : (
              <>
                {' '}
                <Text color={theme.key}>{`${i + 1}`}</Text>
                {' '}
                <Text color={theme.muted}>{t.label}</Text>
                {' '}
              </>
            )}
          </Text>
        ))}
      </Text>
      <Text wrap="truncate">
        <Text color={theme.faint}>{'─'.repeat(Math.max(1, width ?? 80))}</Text>
      </Text>
    </Box>
  );
}
