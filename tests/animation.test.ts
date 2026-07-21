import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  ANIMATION_CAP,
  animationFromStarted,
  disableAnimations,
  enableAnimations,
  markAnimationCanceled,
  seekAnimations,
  setAnimationPlaybackRate,
  setAnimationsPaused,
  upsertAnimation,
  type AnimationInfo,
} from '../src/cdp/animation.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('enable/disable map to the Animation domain', async () => {
  const calls: string[] = [];
  mock.respond('Animation.enable', () => { calls.push('enable'); return {}; });
  mock.respond('Animation.disable', () => { calls.push('disable'); return {}; });
  await enableAnimations(conn);
  await disableAnimations(conn);
  expect(calls).toEqual(['enable', 'disable']);
});

test('setPaused, setPlaybackRate, and seek send ids and values', async () => {
  const calls: Array<[string, any]> = [];
  mock.respond('Animation.setPaused', p => { calls.push(['paused', p]); return {}; });
  mock.respond('Animation.setPlaybackRate', p => { calls.push(['rate', p]); return {}; });
  mock.respond('Animation.seekAnimations', p => { calls.push(['seek', p]); return {}; });
  await setAnimationsPaused(conn, ['a', 'b'], true);
  await setAnimationPlaybackRate(conn, 0.25);
  await seekAnimations(conn, ['a'], 150);
  expect(calls).toEqual([
    ['paused', { animations: ['a', 'b'], paused: true }],
    ['rate', { playbackRate: 0.25 }],
    ['seek', { animations: ['a'], currentTime: 150 }],
  ]);
});

test('animationFromStarted maps the CDP payload', () => {
  const info = animationFromStarted({
    animation: {
      id: '7',
      name: 'pulse',
      type: 'CSSAnimation',
      pausedState: false,
      playbackRate: 1,
      source: { delay: 100, duration: 1200, iterations: 3, backendNodeId: 42 },
    },
  });
  expect(info).toEqual({
    id: '7',
    name: 'pulse',
    type: 'CSSAnimation',
    state: 'running',
    pausedState: false,
    playbackRate: 1,
    duration: 1200,
    delay: 100,
    iterations: 3,
    backendNodeId: 42,
  });
});

test('animationFromStarted falls back to the id and tolerates a bare payload', () => {
  const info = animationFromStarted({ animation: { id: '9' } });
  expect(info.id).toBe('9');
  expect(info.name).toBe('9');
  expect(info.type).toBe('WebAnimation');
  expect(info.state).toBe('running');
});

test('upsertAnimation appends new ids and merges existing ones in place', () => {
  const created: AnimationInfo = { id: '1', name: '1', type: 'WebAnimation', state: 'created' };
  let list = upsertAnimation([], created, 10);
  list = upsertAnimation(list, { id: '2', name: '2', type: 'WebAnimation', state: 'created' }, 10);
  list = upsertAnimation(list, { id: '1', name: 'fade', type: 'CSSAnimation', state: 'running', duration: 300 }, 10);
  expect(list.map(a => a.id)).toEqual(['1', '2']);
  expect(list[0]).toMatchObject({ name: 'fade', state: 'running', duration: 300 });
});

test('upsertAnimation evicts the oldest entries past the cap', () => {
  let list: AnimationInfo[] = [];
  for (let i = 0; i < ANIMATION_CAP + 3; i++) {
    list = upsertAnimation(list, { id: String(i), name: String(i), type: 'WebAnimation', state: 'running' });
  }
  expect(list.length).toBe(ANIMATION_CAP);
  expect(list[0].id).toBe('3');
  expect(list[list.length - 1].id).toBe(String(ANIMATION_CAP + 2));
});

test('markAnimationCanceled flips only the matching id', () => {
  const list: AnimationInfo[] = [
    { id: '1', name: '1', type: 'WebAnimation', state: 'running' },
    { id: '2', name: '2', type: 'WebAnimation', state: 'running' },
  ];
  const next = markAnimationCanceled(list, '2');
  expect(next[0].state).toBe('running');
  expect(next[1].state).toBe('canceled');
});
