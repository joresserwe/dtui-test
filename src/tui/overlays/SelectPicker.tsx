import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { displayWidth } from '../lib/format.js';
import { padRows, useListWindow } from '../lib/list-window.js';
import { useTerminalSize } from '../hooks/use-terminal-size.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';

export interface SelectPickerItem {
  value: string;
  label: string;
  group?: string;
  exclusive?: boolean;
  hint?: string;
}

export interface SelectPickerProps {
  title: string;
  items: SelectPickerItem[];
  multi?: boolean;
  directional?: boolean;
  initial?: string[];
  footer?: string;
  width?: number;
  height?: number;
  hintAlign?: 'left' | 'right';
  onApply?: (values: string[]) => void;
  onPick?: (value: string, dir?: 'asc' | 'desc') => void;
  onKey?: (input: string, value?: string) => void;
  onCancel: () => void;
}

export function toggleSelection(items: SelectPickerItem[], checked: ReadonlySet<string>, value: string): Set<string> {
  const item = items.find(it => it.value === value);
  if (!item) return new Set(checked);
  const next = new Set(checked);
  if (next.has(value)) {
    if (item.group) return next;
    next.delete(value);
    return next;
  }
  if (item.exclusive) return new Set([value]);
  for (const other of items) {
    if (other.exclusive) next.delete(other.value);
    if (item.group && other.group === item.group) next.delete(other.value);
  }
  next.add(value);
  return next;
}

export function SelectPicker({ title, items, multi = false, directional = false, initial, footer, width, height, hintAlign = 'left', onApply, onPick, onKey, onCancel }: SelectPickerProps) {
  const { columns } = useTerminalSize();
  const [rawCursor, setCursor] = useState(() => {
    if (multi || !initial?.length) return 0;
    const idx = items.findIndex(it => it.value === initial[0]);
    return idx >= 0 ? idx : 0;
  });
  const cursor = Math.min(rawCursor, Math.max(0, items.length - 1));
  const [checked, setChecked] = useState<Set<string>>(() => new Set(multi ? initial : initial?.slice(0, 1)));

  useInput((input, key) => {
    if (key.escape) return onCancel();
    const current = items[cursor];
    if (key.return && current) {
      if (multi) return onApply?.(items.filter(it => checked.has(it.value)).map(it => it.value));
      return onPick?.(current.value);
    }
    if (key.downArrow) return setCursor(i => Math.min(i + 1, items.length - 1));
    if (key.upArrow) return setCursor(i => Math.max(0, i - 1));
    if (!multi && directional && current) {
      if (key.leftArrow || input === 'h') return onPick?.(current.value, 'asc');
      if (key.rightArrow || input === 'l') return onPick?.(current.value, 'desc');
    }
    for (const ch of input) {
      if (ch === 'j') setCursor(i => Math.min(i + 1, items.length - 1));
      else if (ch === 'k') setCursor(i => Math.max(0, i - 1));
      else if (multi && ch === ' ' && current) setChecked(prev => toggleSelection(items, prev, current.value));
      else if (onKey) onKey(ch, current?.value);
    }
  });

  const counter = multi ? `${checked.size}/${items.length}` : `${cursor + 1}/${items.length}`;
  const hint = footer ?? (multi ? t('picker.footer.multi') : t('picker.footer.single'));
  const counterMax = `${items.length}/${items.length}`;
  const content = Math.max(
    displayWidth(title) + 1 + displayWidth(counterMax),
    displayWidth(hint),
    ...items.map(it => 4 + displayWidth(it.label) + (it.hint ? displayWidth(it.hint) + 2 : 0)),
  );
  const boxWidth = Math.min(content + 4, width ?? columns, columns);
  const inner = boxWidth - 4;
  const budget = height === undefined ? items.length : Math.max(1, height - 4);
  const start = useListWindow(items.length, cursor, budget);
  const rows = padRows(items.slice(start, start + budget).map((it, i) => {
    const idx = start + i;
    const on = idx === cursor;
    const isChecked = checked.has(it.value);
    const hint = it.hint ?? '';
    const used = 4 + displayWidth(it.label) + (hint ? displayWidth(hint) + 2 : 0);
    const pad = ' '.repeat(Math.max(0, inner - used));
    return (
      <Text key={it.value} backgroundColor={on ? '#223543' : undefined} wrap="truncate">
        {on ? <Text color="cyan" bold>❯ </Text> : '  '}
        {isChecked ? <Text color="cyan">● </Text> : <Text dimColor>{multi ? '○ ' : '  '}</Text>}
        <Text bold={on}>{it.label}</Text>
        {hintAlign === 'right' ? pad : null}
        {hint ? <Text dimColor>{'  ' + hint}</Text> : null}
        {hintAlign === 'right' ? null : pad}
      </Text>
    );
  }), budget, 'pad');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={boxWidth} backgroundColor={theme.overlayBg}>
      <Box justifyContent="space-between">
        <Text bold color="cyan" wrap="truncate">{title}</Text>
        <Text dimColor> {counter}</Text>
      </Box>
      <Text dimColor wrap="truncate">{'─'.repeat(Math.max(1, inner))}</Text>
      {rows}
      <Text dimColor wrap="truncate">{hint}</Text>
    </Box>
  );
}
