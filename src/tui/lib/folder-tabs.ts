import { displayWidth } from './format.js';

export function tabUnderline(preCols: number, activeCols: number, width: number): string {
  const pre = Math.max(0, Math.min(preCols, width));
  const bar = Math.max(0, Math.min(activeCols, width - pre));
  return `${' '.repeat(pre)}${'━'.repeat(bar)}`;
}

// Assumes the tab row is rendered as `${' '.repeat(indent)}${labels.join(sep)}`.
export function tabSpan(
  labels: readonly string[],
  activeIdx: number,
  indent: number,
  sep: string,
): { preCols: number; activeCols: number } {
  const sepW = displayWidth(sep);
  let pre = indent;
  for (let i = 0; i < activeIdx; i++) pre += displayWidth(labels[i]) + sepW;
  return { preCols: pre, activeCols: displayWidth(labels[activeIdx] ?? '') };
}
