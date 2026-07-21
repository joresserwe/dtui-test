import React from 'react';
import { Box, Text } from 'ink';
import type { AnimationInfo } from '../../cdp/animation.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { t } from '../lib/i18n.js';

export const ANIMATIONS_CHROME = 5;

export function animationMeta(a: AnimationInfo): string {
  const parts: string[] = [];
  if (a.duration !== undefined) parts.push(`${Math.round(a.duration)}ms`);
  if (a.delay) parts.push(`delay ${Math.round(a.delay)}ms`);
  if (a.iterations !== undefined) parts.push(`×${Number.isFinite(a.iterations) ? a.iterations : '∞'}`);
  return parts.join(' · ');
}

const STATE_GLYPH: Record<AnimationInfo['state'], string> = {
  created: '·',
  running: '▶',
  canceled: '✗',
};

export interface AnimationsViewProps {
  animations: AnimationInfo[];
  selected: number;
  paused: boolean;
  rate: number;
  error?: string;
  height?: number;
  width?: number;
}

export function AnimationsView({ animations, selected, paused, rate, error, height = 24, width = 100 }: AnimationsViewProps): React.JSX.Element {
  const rule = '─'.repeat(width);
  const budget = Math.max(0, height - ANIMATIONS_CHROME);
  const sel = Math.max(0, Math.min(selected, animations.length - 1));
  const start = useListWindow(animations.length, sel, budget);

  const body = animations.length === 0
    ? [<Text key="an-empty" dimColor wrap="truncate">{t('anim.empty')}</Text>]
    : animations.slice(start, start + budget).map((a, i) => {
        const idx = start + i;
        const canceled = a.state === 'canceled';
        return (
          <Text key={`an-${idx}`} wrap="truncate" inverse={idx === sel}>
            <Text dimColor={canceled}>{STATE_GLYPH[a.state]} </Text>
            <Text color="yellow" dimColor={canceled}>{a.name}</Text>
            <Text dimColor> {a.type}</Text>
            {a.pausedState ? <Text dimColor> ⏸</Text> : null}
            <Text dimColor> {animationMeta(a)}</Text>
            {a.nodeLabel ? <Text color="cyan"> → {a.nodeLabel}</Text> : null}
          </Text>
        );
      });

  return (
    <Box flexDirection="column" width={width}>
      <Text dimColor>Elements</Text>
      <Text wrap="truncate">
        {t('anim.title')} <Text dimColor>({animations.length})</Text>
        <Text dimColor> · rate {Math.round(rate * 100)}%</Text>
        {paused ? <Text color="yellow"> · {t('anim.paused')}</Text> : null}
      </Text>
      <Text dimColor wrap="truncate">{rule}</Text>
      {padRows(body, budget, 'anim')}
      {error ? <Text color="red" wrap="truncate">{error}</Text> : <Text dimColor wrap="truncate">{t('anim.hint')}</Text>}
      <Text dimColor wrap="truncate">{rule}</Text>
    </Box>
  );
}
