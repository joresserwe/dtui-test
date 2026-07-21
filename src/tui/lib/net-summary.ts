import type { NetworkEntry } from '../../store/types.js';

export interface NetSummary {
  count: number;
  transferred: number;
  resources: number;
}

export function networkSummary(entries: readonly NetworkEntry[]): NetSummary {
  let transferred = 0;
  let resources = 0;
  for (const e of entries) {
    transferred += e.encodedBytes ?? 0;
    resources += e.decodedBytes ?? 0;
  }
  return { count: entries.length, transferred, resources };
}
