import type { CdpConnection } from './connection.js';
import { RingBuffer } from '../store/ring.js';

export type BackgroundServiceName =
  | 'backgroundFetch'
  | 'backgroundSync'
  | 'pushMessaging'
  | 'notifications'
  | 'periodicBackgroundSync';

export const BACKGROUND_SERVICES: BackgroundServiceName[] = [
  'backgroundFetch',
  'backgroundSync',
  'pushMessaging',
  'notifications',
  'periodicBackgroundSync',
];

export interface BackgroundServiceEvent {
  timestamp: number;
  service: BackgroundServiceName;
  origin: string;
  name: string;
  instanceId: string;
  metadata: Array<[string, string]>;
}

const BG_EVENT_CAP = 500;

export class BackgroundServiceStore {
  private events = new RingBuffer<BackgroundServiceEvent>(BG_EVENT_CAP);
  private recording = new Set<BackgroundServiceName>();

  handleEvent(method: string, params: any): boolean {
    if (method === 'BackgroundService.backgroundServiceEventReceived') {
      const e = params?.backgroundServiceEvent;
      if (!e) return true;
      this.events.push({
        timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now() / 1000,
        service: e.service,
        origin: e.origin ?? '',
        name: e.eventName ?? '',
        instanceId: e.instanceId ?? '',
        metadata: (e.eventMetadata ?? []).map((m: any) => [m.key ?? '', m.value ?? ''] as [string, string]),
      });
      return true;
    }
    if (method === 'BackgroundService.recordingStateChanged') {
      if (params?.isRecording) this.recording.add(params.service);
      else this.recording.delete(params.service);
      return true;
    }
    return false;
  }

  list(): BackgroundServiceEvent[] {
    return this.events.items();
  }

  isRecording(service: BackgroundServiceName): boolean {
    return this.recording.has(service);
  }

  anyRecording(): boolean {
    return this.recording.size > 0;
  }

  clear(): void {
    this.events.clear();
  }
}

export async function startObserving(conn: CdpConnection, service: BackgroundServiceName): Promise<void> {
  await conn.send('BackgroundService.startObserving', { service });
}

export async function stopObserving(conn: CdpConnection, service: BackgroundServiceName): Promise<void> {
  await conn.send('BackgroundService.stopObserving', { service });
}

export async function setRecording(conn: CdpConnection, shouldRecord: boolean, service: BackgroundServiceName): Promise<void> {
  await conn.send('BackgroundService.setRecording', { shouldRecord, service });
}
