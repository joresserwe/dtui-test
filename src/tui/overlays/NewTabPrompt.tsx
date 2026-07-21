import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth } from '../lib/format.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export interface NewTabPromptProps {
  value: string;
  incognito: boolean;
  width?: number;
}

export function NewTabPrompt({ value, incognito, width = 52 }: NewTabPromptProps): React.JSX.Element {
  const inner = width - 4;
  const title = incognito ? `${t('prompt.newTab.title')} · ${t('prompt.newTab.incognito')}` : t('prompt.newTab.title');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} backgroundColor={theme.overlayBg}>
      <Text dimColor wrap="truncate">── {title} {'─'.repeat(Math.max(0, inner - displayWidth(title) - 4))}</Text>
      <Text wrap="truncate">
        <Text color={theme.muted}>URL </Text>
        <Text bold color="cyan">❯ </Text>
        {value}
        <Text color="cyan">▌</Text>
      </Text>
      <Text dimColor wrap="truncate">{t('prompt.newTab.footer')}</Text>
    </Box>
  );
}
