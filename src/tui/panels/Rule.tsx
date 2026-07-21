import React from 'react';
import { Text } from 'ink';
import { theme } from '../lib/theme.js';

export function Rule({ columns }: { columns: number }): React.JSX.Element {
  return <Text color={theme.faint} wrap="truncate">{'─'.repeat(Math.max(1, columns))}</Text>;
}
