import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockCdp } from './helpers/mock-cdp.js';
import { listPages } from '../src/cdp/targets.js';
import { DebugSession, REDACTED_INPUT_REQUIRED, type ReplayProgress } from '../src/engine.js';
import { REC_BINDING } from '../src/tui/lib/recorder-script.js';
import { waitUntil } from './helpers/wait-for.js';
import type { Step } from '../src/store/recording.js';

let mock: MockCdp;
let root: string;

beforeEach(async () => {
  mock = await MockCdp.start();
  root = await mkdtemp(join(tmpdir(), 'dtui-rec-eng-'));
});
afterEach(async () => { await mock.close(); });

async function attach() {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  return DebugSession.attach(page, { sessionRoot: root, persist: false, browser: 'MockChrome/1.0' });
}

function bindingCall(step: object) {
  mock.emitEvent('Runtime.bindingCalled', { name: REC_BINDING, payload: JSON.stringify(step) });
}

describe('recording lifecycle', () => {
  test('start installs a binding + persistent script and captures a goto seed', async () => {
    const sent: Record<string, unknown>[] = [];
    mock.respond('Runtime.addBinding', p => { sent.push({ m: 'addBinding', ...p }); return {}; });
    mock.respond('Page.addScriptToEvaluateOnNewDocument', p => { sent.push({ m: 'addScript', ...p }); return { identifier: 'scr-1' }; });
    mock.respond('Runtime.evaluate', () => ({ result: {} }));
    const session = await attach();
    await session.startRecording();
    expect(session.isRecording).toBe(true);
    expect(sent.some(s => s.m === 'addBinding' && s.name === REC_BINDING)).toBe(true);
    expect(sent.some(s => s.m === 'addScript' && typeof s.source === 'string')).toBe(true);
    expect(session.recordingStepCount).toBe(1);
    await session.close();
  });

  test('bindingCalled events append parsed steps and emit rec-step', async () => {
    mock.respond('Runtime.addBinding', () => ({}));
    mock.respond('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'scr-1' }));
    mock.respond('Runtime.evaluate', () => ({ result: {} }));
    const session = await attach();
    let ticks = 0;
    session.on('rec-step', () => { ticks++; });
    await session.startRecording();
    bindingCall({ kind: 'click', selector: '#go' });
    bindingCall({ kind: 'input', selector: '#q', value: 'hi' });
    bindingCall({ kind: 'bogus' });
    await waitUntil(() => session.recordingStepCount === 3);
    expect(session.recordingStepCount).toBe(3);
    expect(ticks).toBeGreaterThanOrEqual(3);
    await session.close();
  });

  test('a top-frame navigation records a nav barrier while recording', async () => {
    mock.respond('Runtime.addBinding', () => ({}));
    mock.respond('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'scr-1' }));
    mock.respond('Runtime.evaluate', () => ({ result: {} }));
    const session = await attach();
    await session.startRecording();
    mock.emitEvent('Page.frameNavigated', { frame: { id: 'f1', url: 'https://mock.test/next' } });
    await waitUntil(() => session.recordingStepCount === 2);
    const steps = await session.stopRecording();
    expect(steps.map(s => s.kind)).toEqual(['goto', 'nav']);
    expect(steps[1]).toEqual({ kind: 'nav', url: 'https://mock.test/next' });
    await session.close();
  });

  test('stop releases the binding, the persistent script, and the in-page listeners', async () => {
    const calls: string[] = [];
    mock.respond('Runtime.addBinding', () => { calls.push('addBinding'); return {}; });
    mock.respond('Runtime.removeBinding', () => { calls.push('removeBinding'); return {}; });
    mock.respond('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'scr-9' }));
    mock.respond('Page.removeScriptToEvaluateOnNewDocument', p => { calls.push(`removeScript:${p.identifier}`); return {}; });
    mock.respond('Runtime.evaluate', p => { if (String(p.expression).includes('__dtuiRecStop')) calls.push('stopScript'); return { result: {} }; });
    const session = await attach();
    await session.startRecording();
    bindingCall({ kind: 'click', selector: '#go' });
    await waitUntil(() => session.recordingStepCount === 2);
    const steps = await session.stopRecording();
    expect(steps.map(s => s.kind)).toEqual(['goto', 'click']);
    expect(session.isRecording).toBe(false);
    expect(calls).toContain('stopScript');
    expect(calls).toContain('removeScript:scr-9');
    expect(calls).toContain('removeBinding');
    bindingCall({ kind: 'click', selector: '#late' });
    await new Promise(r => setTimeout(r, 30));
    expect(session.recordingStepCount).toBe(0);
    await session.close();
  });
});

describe('replay executor', () => {
  function mockReplayTargets(calls: Record<string, unknown>[]) {
    mock.respond('Runtime.evaluate', (p: { expression: string }) => {
      calls.push({ m: 'evaluate', expression: p.expression });
      if (p.expression.startsWith('!!document.querySelector')) return { result: { value: true } };
      if (p.expression.startsWith('document.querySelector')) return { result: { objectId: 'obj-1' } };
      return { result: { value: null } };
    });
    mock.respond('DOM.requestNode', () => ({ nodeId: 42 }));
    mock.respond('DOM.scrollIntoViewIfNeeded', () => ({}));
    mock.respond('DOM.getBoxModel', () => ({ model: { content: [10, 20, 30, 20, 30, 40, 10, 40], width: 20, height: 20 } }));
    mock.respond('Runtime.releaseObjectGroup', () => ({}));
    mock.respond('Input.dispatchMouseEvent', (p: object) => { calls.push({ m: 'mouse', ...p }); return {}; });
    mock.respond('Input.insertText', (p: object) => { calls.push({ m: 'insertText', ...p }); return {}; });
    mock.respond('Input.dispatchKeyEvent', (p: object) => { calls.push({ m: 'key', ...p }); return {}; });
    mock.respond('Page.navigate', (p: object) => { calls.push({ m: 'navigate', ...p }); return {}; });
  }

  test('click resolves the selector and synthesizes a trusted mouse click at the box center', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    const fail = await session.replayRecording([{ kind: 'click', selector: '#go' }]);
    expect(fail).toBeNull();
    const mouse = calls.filter(c => c.m === 'mouse');
    expect(mouse).toHaveLength(2);
    expect(mouse[0]).toMatchObject({ type: 'mousePressed', x: 20, y: 30 });
    await session.close();
  });

  test('input clears, inserts text, then dispatches change', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    const fail = await session.replayRecording([{ kind: 'input', selector: '#q', value: 'hello' }]);
    expect(fail).toBeNull();
    expect(calls.find(c => c.m === 'insertText')).toMatchObject({ text: 'hello' });
    const focusIdx = calls.findIndex(c => c.m === 'mouse');
    const insertIdx = calls.findIndex(c => c.m === 'insertText');
    expect(focusIdx).toBeGreaterThanOrEqual(0);
    expect(focusIdx).toBeLessThan(insertIdx);
    const evals = calls.filter(c => c.m === 'evaluate').map(c => String(c.expression));
    expect(evals.some(e => e.includes("Event('input'"))).toBe(true);
    expect(evals.some(e => e.includes("Event('change'"))).toBe(true);
    await session.close();
  });

  test('key maps Enter to a rawKeyDown/char/keyUp triple with vk 13', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    await session.replayRecording([{ kind: 'key', selector: null, key: 'Enter' }]);
    const keys = calls.filter(c => c.m === 'key');
    expect(keys.map(k => k.type)).toEqual(['rawKeyDown', 'char', 'keyUp']);
    expect(keys[0]).toMatchObject({ windowsVirtualKeyCode: 13, text: '\r' });
    await session.close();
  });

  test('select sets value and fires change via evaluate', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    await session.replayRecording([{ kind: 'select', selector: '#s', value: 'b' }]);
    const evals = calls.filter(c => c.m === 'evaluate').map(c => String(c.expression));
    expect(evals.some(e => e.includes('el.value="b"') || e.includes("el.value='b'") || e.includes('"b"'))).toBe(true);
    await session.close();
  });

  test('a missing selector fails with the step index and reason', async () => {
    const calls: Record<string, unknown>[] = [];
    mock.respond('Runtime.evaluate', () => ({ result: { value: false } }));
    void calls;
    const session = await attach();
    const fail = await session.replayRecording([{ kind: 'click', selector: '#nope' }], { stepTimeoutMs: 120 });
    expect(fail).toMatchObject({ stepIndex: 0, kind: 'click', selector: '#nope' });
    expect(fail?.reason).toContain('#nope');
    await session.close();
  });

  test('a redacted input with no resolver returns redacted_input_required', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    const step: Step = { kind: 'input', selector: '#pw', redacted: true };
    const fail = await session.replayRecording([step]);
    expect(fail?.reason).toBe(REDACTED_INPUT_REQUIRED);
    await session.close();
  });

  test('a redacted input uses the resolver when provided', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    const step: Step = { kind: 'input', selector: '#pw', redacted: true };
    const fail = await session.replayRecording([step], { resolveRedacted: async () => 's3cret' });
    expect(fail).toBeNull();
    expect(calls.find(c => c.m === 'insertText')).toMatchObject({ text: 's3cret' });
    await session.close();
  });

  test('emits replay-progress per step', async () => {
    const calls: Record<string, unknown>[] = [];
    mockReplayTargets(calls);
    const session = await attach();
    const seen: ReplayProgress[] = [];
    session.on('replay-progress', (p: ReplayProgress) => seen.push(p));
    await session.replayRecording([
      { kind: 'click', selector: '#a' },
      { kind: 'key', selector: null, key: 'Tab' },
    ]);
    expect(seen.filter(p => !p.failure).map(p => p.index)).toEqual([0, 1]);
    expect(seen[0].total).toBe(2);
    await session.close();
  });
});
