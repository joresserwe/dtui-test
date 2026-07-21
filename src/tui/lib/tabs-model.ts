import { listPages, type PageTarget } from '../../cdp/targets.js';
import type { Endpoint } from '../../cdp/discovery.js';

export interface TabGroup {
  windowId: number | null;
  tabs: PageTarget[];
}

export class TabsModel {
  groups: TabGroup[] = [];
  error?: string;

  constructor(
    private ep: Endpoint,
    private windowIdFor?: (targetId: string) => Promise<number | null>,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async refresh(): Promise<void> {
    try {
      const pages = await listPages(this.ep, this.fetchFn);
      const byWindow = new Map<number | null, PageTarget[]>();
      for (const p of pages) {
        let win: number | null = null;
        if (this.windowIdFor) {
          try {
            win = await this.windowIdFor(p.id);
          } catch {
            win = null;
          }
        }
        const list = byWindow.get(win) ?? [];
        list.push(p);
        byWindow.set(win, list);
      }
      this.groups = [...byWindow.entries()].map(([windowId, tabs]) => ({ windowId, tabs }));
      this.error = undefined;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  flat(): PageTarget[] {
    return this.groups.flatMap(g => g.tabs);
  }
}
