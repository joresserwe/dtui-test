import { EventEmitter } from 'node:events';
import { TabsModel, type TabGroup } from './tabs-model.js';
import type { PageTarget } from '../../cdp/targets.js';
import type { Endpoint } from '../../cdp/discovery.js';

export interface TabSection {
  endpoint: Endpoint;
  groups: TabGroup[];
}

export const epKey = (ep: Endpoint) => `${ep.host}:${ep.port}`;

export class MultiTabs extends EventEmitter {
  error?: string;
  private models: TabsModel[];
  private timer?: NodeJS.Timeout;
  private seenIds: Array<Set<string> | undefined>;

  constructor(
    private endpoints: Endpoint[],
    windowIdFor?: (ep: Endpoint) => ((targetId: string) => Promise<number | null>) | undefined,
    private intervalMs = 2000,
    fetchFn: typeof fetch = fetch,
  ) {
    super();
    this.models = endpoints.map(ep => new TabsModel(ep, windowIdFor?.(ep), fetchFn));
    this.seenIds = endpoints.map(() => undefined);
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    await Promise.all(this.models.map(m => m.refresh()));

    const errors: string[] = [];
    let anyOk = false;
    for (const m of this.models) {
      if (m.error) errors.push(m.error);
      else anyOk = true;
    }
    this.error = anyOk ? undefined : errors.join('; ');

    const additions: Array<{ endpoint: Endpoint; tabs: PageTarget[] }> = [];
    this.models.forEach((m, i) => {
      if (m.error) return;
      const ids = new Set(m.flat().map(t => t.id));
      const prev = this.seenIds[i];
      this.seenIds[i] = ids;
      if (!prev) return;
      const added = m.flat().filter(t => !prev.has(t.id));
      if (added.length) additions.push({ endpoint: this.endpoints[i], tabs: added });
    });

    this.emit('update');
    for (const a of additions) this.emit('added', a);
  }

  sections(): TabSection[] {
    return this.models.map((m, i) => ({ endpoint: this.endpoints[i], groups: m.error ? [] : m.groups }));
  }

  flat(): PageTarget[] {
    return this.models.flatMap(m => (m.error ? [] : m.flat()));
  }
}
