import type { CdpConnection } from './connection.js';

export interface PreloadRuleSet {
  id: string;
  url: string;
  errorType?: string;
  errorMessage?: string;
}

export interface PreloadAttempt {
  key: string;
  action: string;
  url: string;
  status: string;
  failureReason?: string;
}

const attemptKey = (k: any): string => `${k?.action ?? ''}:${k?.url ?? ''}:${k?.targetHint ?? ''}`;

export class PreloadStore {
  private ruleSets = new Map<string, PreloadRuleSet>();
  private attempts = new Map<string, PreloadAttempt>();

  handleEvent(method: string, params: any): boolean {
    if (method === 'Preload.ruleSetUpdated') {
      const rs = params?.ruleSet;
      if (rs?.id) {
        this.ruleSets.set(rs.id, {
          id: rs.id,
          url: rs.sourceText ? '(inline)' : (rs.url ?? ''),
          ...(rs.errorType ? { errorType: rs.errorType } : {}),
          ...(rs.errorMessage ? { errorMessage: rs.errorMessage } : {}),
        });
      }
      return true;
    }
    if (method === 'Preload.ruleSetRemoved') {
      if (params?.id) this.ruleSets.delete(params.id);
      return true;
    }
    if (method === 'Preload.prefetchStatusUpdated' || method === 'Preload.prerenderStatusUpdated') {
      const action = method === 'Preload.prefetchStatusUpdated' ? 'prefetch' : 'prerender';
      const key = params?.key ? attemptKey(params.key) : (params?.pipelineId ?? params?.url ?? '');
      this.attempts.set(key, {
        key,
        action,
        url: params?.prefetchUrl ?? params?.prerenderUrl ?? params?.key?.url ?? params?.url ?? '',
        status: params?.status ?? '',
        ...(params?.prerenderStatus || params?.prefetchStatus ? { failureReason: params.prerenderStatus ?? params.prefetchStatus } : {}),
        ...(params?.disallowedMojoInterface ? { failureReason: params.disallowedMojoInterface } : {}),
      });
      return true;
    }
    if (method === 'Preload.preloadingAttemptSourcesUpdated') {
      for (const src of params?.preloadingAttemptSources ?? []) {
        const key = attemptKey(src?.key);
        const existing = this.attempts.get(key);
        if (!existing) {
          this.attempts.set(key, {
            key,
            action: src?.key?.action ?? '',
            url: src?.key?.url ?? '',
            status: 'Pending',
          });
        }
      }
      return true;
    }
    return false;
  }

  ruleSetList(): PreloadRuleSet[] {
    return [...this.ruleSets.values()];
  }

  attemptList(): PreloadAttempt[] {
    return [...this.attempts.values()];
  }

  clear(): void {
    this.ruleSets.clear();
    this.attempts.clear();
  }
}

export async function enablePreload(conn: CdpConnection): Promise<void> {
  await conn.send('Preload.enable');
}

export async function disablePreload(conn: CdpConnection): Promise<void> {
  await conn.send('Preload.disable').catch(() => {});
}
