import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recorderList, recorderReplay } from '../src/mcp/tools.js';
import { buildHostDelegate } from '../src/mcp/delegate.js';
import { saveRecording, type Recording } from '../src/store/recording.js';
import type { LiveExtras, SessionSource } from '../src/mcp/source.js';
import type { DebugSession, ReplayFailure } from '../src/engine.js';

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dtui-mcp-rec-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const rec = (name: string, steps: Recording['steps']): Recording => ({ name, createdAt: '2026-07-20T00:00:00.000Z', steps, version: 1 });

function liveSrc(over: Partial<LiveExtras> = {}): SessionSource {
  return {
    kind: 'live',
    listSessions: async () => [],
    readNetwork: async () => [],
    readConsole: async () => [],
    live: {
      listTabs: async () => [],
      selectedElement: async () => ({}) as never,
      screenshot: async () => ({ data: '', mimeType: 'image/png' }),
      ...over,
    },
  };
}

describe('recorder_list', () => {
  test('lists saved recordings with step counts, newest first', () => {
    saveRecording(dir, rec('Login', [{ kind: 'goto', url: 'https://a.test/' }, { kind: 'click', selector: '#go' }]));
    const out = recorderList(dir);
    expect(out).toEqual([{ name: 'Login', steps: 2, createdAt: '2026-07-20T00:00:00.000Z' }]);
  });

  test('empty when no recordings exist', () => {
    expect(recorderList(dir)).toEqual([]);
  });
});

describe('recorder_replay tool', () => {
  test('forwards to the live bridge and returns its result', async () => {
    const src = liveSrc({ recorderReplay: async args => ({ ok: true, steps: 3, ...(args.name === 'Flow' ? {} : {}) }) });
    const res = await recorderReplay(src, { name: 'Flow', timeout_ms: 1000 });
    expect(res).toEqual({ ok: true, steps: 3 });
  });

  test('errors on a files source', async () => {
    const files: SessionSource = { kind: 'files', listSessions: async () => [], readNetwork: async () => [], readConsole: async () => [] };
    await expect(recorderReplay(files, { name: 'Flow' })).rejects.toThrow(/running devtools-tui/);
  });

  test('requires a name', async () => {
    await expect(recorderReplay(liveSrc({ recorderReplay: async () => ({ ok: true, steps: 0 }) }), { name: '' })).rejects.toThrow(/name is required/);
  });
});

describe('host delegate recorderReplay', () => {
  function fakeSession(failure: ReplayFailure | null, capture: { steps?: unknown } = {}): DebugSession {
    return {
      replayRecording: async (steps: unknown) => { capture.steps = steps; return failure; },
    } as unknown as DebugSession;
  }

  test('loads the named recording and replays it against the active session', async () => {
    saveRecording(dir, rec('Checkout', [{ kind: 'goto', url: 'https://a.test/' }, { kind: 'click', selector: '#buy' }]));
    const capture: { steps?: unknown } = {};
    const delegate = buildHostDelegate({
      sessions: () => [],
      activeSession: () => fakeSession(null, capture),
      selection: () => null,
      recordingsDir: () => dir,
    });
    const res = await delegate.recorderReplay!('Checkout');
    expect(res).toEqual({ ok: true, steps: 2, failure: undefined });
    expect(Array.isArray(capture.steps)).toBe(true);
  });

  test('surfaces a replay failure', async () => {
    saveRecording(dir, rec('Broken', [{ kind: 'click', selector: '#nope' }]));
    const delegate = buildHostDelegate({
      sessions: () => [],
      activeSession: () => fakeSession({ stepIndex: 0, kind: 'click', selector: '#nope', reason: 'selector not found: #nope' }),
      selection: () => null,
      recordingsDir: () => dir,
    });
    const res = await delegate.recorderReplay!('Broken');
    expect(res.ok).toBe(false);
    expect(res.failure).toMatchObject({ stepIndex: 0, selector: '#nope' });
  });

  test('errors on an unknown recording name', async () => {
    const delegate = buildHostDelegate({
      sessions: () => [],
      activeSession: () => fakeSession(null),
      selection: () => null,
      recordingsDir: () => dir,
    });
    await expect(delegate.recorderReplay!('ghost')).rejects.toThrow(/unknown recording/);
  });
});
