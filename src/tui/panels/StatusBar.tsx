import React from 'react';
import { Box, Text } from 'ink';
import { TOAST_COLORS, TOAST_ICONS, type ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';

export interface StatusBarProps {
  browser: string;
  throttle: string;
  nocache?: boolean;
  override?: string;
  blocked?: string;
  mapped?: string;
  emulation?: string;
  sort?: string;
  range?: string;
  recording?: string;
  recCount?: number;
  dropped?: number;
  count?: string;
  filter?: string;
  filterEditing?: boolean;
  search?: string;
  searchEditing?: boolean;
  toast?: string;
  toastLevel?: ToastLevel;
  width?: number;
}

export function StatusBar({ browser, throttle, nocache, override, blocked, mapped, emulation, sort, range, recording, recCount, dropped = 0, count, filter, filterEditing, search, searchEditing, toast, toastLevel, width }: StatusBarProps) {
  const toastIcon = toastLevel ? TOAST_ICONS[toastLevel] : '';
  return (
    <Box paddingX={1} width={width}>
      <Text wrap="truncate">
        <Text dimColor>{browser}</Text>
        {recording ? <Text color="red"> · ⏺ rec</Text> : null}
        {recCount !== undefined ? <Text color="red"> · ● rec {recCount}</Text> : null}
        {throttle !== 'off' ? <Text color="yellow"> · throttle {throttle}</Text> : null}
        {nocache ? <Text color="yellow"> · nocache</Text> : null}
        {override ? <Text color="yellow"> · {override}</Text> : null}
        {blocked ? <Text color="yellow"> · {blocked}</Text> : null}
        {mapped ? <Text color="yellow"> · {mapped}</Text> : null}
        {emulation ? <Text color="magenta"> · {emulation}</Text> : null}
        {sort ? <Text color="yellow"> · {sort}</Text> : null}
        {range ? <Text color="yellow"> · {range}</Text> : null}
        {count ? <Text dimColor> · {count}</Text> : null}
        {dropped > 0 ? <Text dimColor> · {t('status.dropped', { n: dropped })}</Text> : null}
        {filter || filterEditing ? (
          <Text color="cyan"> · /{filter}{filterEditing ? '▌' : ''}</Text>
        ) : null}
        {search || searchEditing ? (
          <Text color="cyan"> · find:{search}{searchEditing ? '▌' : ''}</Text>
        ) : null}
        {toast ? (
          <Text>
            {'  │ '}
            {toastIcon ? <Text color={toastLevel ? TOAST_COLORS[toastLevel] : undefined}>{toastIcon} </Text> : null}
            {toast}
          </Text>
        ) : null}
      </Text>
    </Box>
  );
}
