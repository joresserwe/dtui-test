import type { CdpConnection } from './connection.js';

export const ANIMATION_CAP = 50;
export const PLAYBACK_RATES = [1, 0.25, 0.1] as const;

export type AnimationState = 'created' | 'running' | 'canceled';

export interface AnimationInfo {
  id: string;
  name: string;
  type: string;
  state: AnimationState;
  pausedState?: boolean;
  playbackRate?: number;
  duration?: number;
  delay?: number;
  iterations?: number;
  backendNodeId?: number;
  nodeLabel?: string;
}

export async function enableAnimations(conn: CdpConnection): Promise<void> {
  await conn.send('Animation.enable');
}

export async function disableAnimations(conn: CdpConnection): Promise<void> {
  await conn.send('Animation.disable');
}

export async function setAnimationsPaused(conn: CdpConnection, animations: string[], paused: boolean): Promise<void> {
  await conn.send('Animation.setPaused', { animations, paused });
}

export async function setAnimationPlaybackRate(conn: CdpConnection, playbackRate: number): Promise<void> {
  await conn.send('Animation.setPlaybackRate', { playbackRate });
}

export async function seekAnimations(conn: CdpConnection, animations: string[], currentTime: number): Promise<void> {
  await conn.send('Animation.seekAnimations', { animations, currentTime });
}

export function animationFromStarted(params: any): AnimationInfo {
  const a = params?.animation ?? {};
  const src = a.source ?? {};
  const id = String(a.id ?? '');
  return {
    id,
    name: String(a.name || id),
    type: String(a.type ?? 'WebAnimation'),
    state: 'running',
    pausedState: !!a.pausedState,
    ...(typeof a.playbackRate === 'number' ? { playbackRate: a.playbackRate } : {}),
    ...(typeof src.duration === 'number' ? { duration: src.duration } : {}),
    ...(typeof src.delay === 'number' ? { delay: src.delay } : {}),
    ...(typeof src.iterations === 'number' ? { iterations: src.iterations } : {}),
    ...(typeof src.backendNodeId === 'number' ? { backendNodeId: src.backendNodeId } : {}),
  };
}

export function upsertAnimation(list: AnimationInfo[], info: AnimationInfo, cap = ANIMATION_CAP): AnimationInfo[] {
  const idx = list.findIndex(a => a.id === info.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...info };
    return next;
  }
  const next = [...list, info];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function markAnimationCanceled(list: AnimationInfo[], id: string): AnimationInfo[] {
  return list.map(a => (a.id === id ? { ...a, state: 'canceled' as const } : a));
}
