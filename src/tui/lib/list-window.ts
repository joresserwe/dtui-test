import React, { useRef } from 'react';
import { Text } from 'ink';

export function clampWindowStart(prev: number, len: number, selected: number, budget: number): number {
  if (budget <= 0 || len <= budget) return 0;
  const start = Math.max(0, Math.min(prev, len - budget));
  const sel = Math.max(0, Math.min(selected, len - 1));
  if (sel < start) return sel;
  if (sel > start + budget - 1) return sel - budget + 1;
  return start;
}

export function useListWindow(len: number, selected: number, budget: number): number {
  const prev = useRef(0);
  const start = clampWindowStart(prev.current, len, selected, budget);
  prev.current = start;
  return start;
}

export function padRows(rows: React.ReactNode[], budget: number, keyPrefix: string): React.ReactNode[] {
  const out = rows.slice(0, budget);
  while (out.length < budget) out.push(React.createElement(Text, { key: `${keyPrefix}-pad-${out.length}` }, ' '));
  return out;
}
