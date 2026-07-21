import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth } from '../lib/format.js';
import { theme } from '../lib/theme.js';

export interface TextPromptProps {
  title: string;
  value: string;
  footer: string;
  masked?: boolean;
  width?: number;
}

export function TextPrompt({ title, value, footer, masked = false, width = 52 }: TextPromptProps): React.JSX.Element {
  const inner = width - 4;
  const shown = masked ? '•'.repeat(displayWidth(value)) : value;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} backgroundColor={theme.overlayBg}>
      <Text dimColor wrap="truncate">── {title} {'─'.repeat(Math.max(0, inner - displayWidth(title) - 4))}</Text>
      <Text wrap="truncate">
        <Text bold color="cyan">❯ </Text>
        {shown}
        <Text color="cyan">▌</Text>
      </Text>
      <Text dimColor wrap="truncate">{footer}</Text>
    </Box>
  );
}
