import type { CdpConnection } from './connection.js';

export interface SwRegView {
  id: string;
  scope: string;
  script: string;
  status: string;
  running: string;
}

export function scopeOrigin(scope: string): string {
  try {
    return new URL(scope).origin;
  } catch {
    return '';
  }
}

interface SwRegistration {
  id: string;
  scope: string;
  deleted: boolean;
}

interface SwVersion {
  id: string;
  regId: string;
  script: string;
  running: string;
  status: string;
}

const SW_STATUS_PRIORITY: Record<string, number> = {
  activated: 5,
  activating: 4,
  installed: 3,
  installing: 2,
  new: 1,
  redundant: 0,
};

export class SwStore {
  private regs = new Map<string, SwRegistration>();
  private versions = new Map<string, SwVersion>();

  handleEvent(method: string, params: any): boolean {
    if (method === 'ServiceWorker.workerRegistrationUpdated') {
      for (const r of params?.registrations ?? []) {
        this.regs.set(r.registrationId, { id: r.registrationId, scope: r.scopeURL, deleted: !!r.isDeleted });
      }
      return true;
    }
    if (method === 'ServiceWorker.workerVersionUpdated') {
      for (const v of params?.versions ?? []) {
        this.versions.set(v.versionId, {
          id: v.versionId,
          regId: v.registrationId,
          script: v.scriptURL ?? '',
          running: v.runningStatus ?? '',
          status: v.status ?? '',
        });
      }
      return true;
    }
    return false;
  }

  registrations(): SwRegView[] {
    const out: SwRegView[] = [];
    for (const r of this.regs.values()) {
      if (r.deleted) continue;
      let latest: SwVersion | undefined;
      for (const v of this.versions.values()) {
        if (v.regId !== r.id) continue;
        if (!latest || (SW_STATUS_PRIORITY[v.status] ?? -1) >= (SW_STATUS_PRIORITY[latest.status] ?? -1)) latest = v;
      }
      out.push({
        id: r.id,
        scope: r.scope,
        script: latest?.script ?? '',
        status: latest?.status ?? '',
        running: latest?.running ?? '',
      });
    }
    return out;
  }
}

export async function enableServiceWorker(conn: CdpConnection): Promise<void> {
  await conn.send('ServiceWorker.enable');
}

export async function setForceUpdateOnPageLoad(conn: CdpConnection, forceUpdateOnPageLoad: boolean): Promise<void> {
  await conn.send('ServiceWorker.setForceUpdateOnPageLoad', { forceUpdateOnPageLoad });
}

export async function setBypassServiceWorker(conn: CdpConnection, bypass: boolean): Promise<void> {
  await conn.send('Network.setBypassServiceWorker', { bypass });
}

export async function deliverPushMessage(conn: CdpConnection, origin: string, registrationId: string, data: string): Promise<void> {
  await conn.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data });
}

export async function dispatchSyncEvent(conn: CdpConnection, origin: string, registrationId: string, tag: string, lastChance: boolean): Promise<void> {
  await conn.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId, tag, lastChance });
}

export async function dispatchPeriodicSyncEvent(conn: CdpConnection, origin: string, registrationId: string, tag: string): Promise<void> {
  await conn.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin, registrationId, tag });
}
