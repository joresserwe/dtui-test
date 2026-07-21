import { test, expect, describe } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildRecorderScript, buildRecorderStopScript, REC_BINDING, REC_INSTALLED, REC_STOP } from '../src/tui/lib/recorder-script.js';
import { parseStep, type Step } from '../src/store/recording.js';

interface El {
  nodeType: number;
  tagName: string;
  id?: string;
  type?: string;
  value?: string;
  className?: string;
  classList?: string[];
  attrs?: Record<string, string>;
  parentElement?: El | null;
  children?: El[];
  getAttribute(name: string): string | null;
  getRootNode?: () => { host?: El } | null;
}

function el(tagName: string, opts: Partial<El> = {}): El {
  const e: El = {
    nodeType: 1,
    tagName,
    parentElement: null,
    children: [],
    ...opts,
    getAttribute(name: string) {
      if (name === 'name') return this.attrs?.name ?? null;
      if (name === 'data-testid') return this.attrs?.['data-testid'] ?? null;
      return this.attrs?.[name] ?? null;
    },
  };
  return e;
}

interface Harness {
  steps: Step[];
  fire(type: string, ev: Record<string, unknown>): void;
  activeElement: El | null;
  setActive(el: El | null): void;
  stop(): void;
  sandbox: Record<string, unknown>;
}

function install(counts: Record<string, number> = {}): Harness {
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const raw: string[] = [];
  const state = { active: null as El | null };
  const sandbox: Record<string, unknown> = {
    WeakMap,
    Array,
    Math,
    String,
    JSON,
    CSS: { escape: (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) },
    document: {
      querySelectorAll: (sel: string) => ({ length: counts[sel] ?? 1 }),
      get activeElement() { return state.active; },
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type: string, fn: (ev: unknown) => void) => {
    (listeners[type] ??= []).push(fn);
  };
  sandbox.removeEventListener = (type: string, fn: (ev: unknown) => void) => {
    listeners[type] = (listeners[type] ?? []).filter(f => f !== fn);
  };
  sandbox[REC_BINDING] = (payload: string) => raw.push(payload);
  runInNewContext(buildRecorderScript(), sandbox);
  return {
    get steps() {
      return raw.map(r => parseStep(JSON.parse(r))).filter((s): s is Step => s !== null);
    },
    fire(type, ev) {
      const target = ev.target as El | undefined;
      const path = (ev.composedPath as El[] | undefined) ?? (target ? [target] : []);
      const full = { ...ev, type, composedPath: () => path };
      for (const fn of listeners[type] ?? []) fn(full);
    },
    get activeElement() { return state.active; },
    setActive(e) { state.active = e; },
    stop() { runInNewContext(buildRecorderStopScript(), sandbox); },
    sandbox,
  } as Harness;
}

describe('selector priority (D3)', () => {
  test('prefers a unique #id', () => {
    const h = install();
    const target = el('BUTTON', { id: 'go', attrs: { 'data-testid': 't', name: 'n' } });
    h.fire('click', { target, clientX: 10, clientY: 20 });
    expect(h.steps[0]).toEqual({ kind: 'click', selector: '#go', alt: { x: 10, y: 20 } });
  });

  test('falls through to data-testid when id is non-unique', () => {
    const h = install({ '#go': 2 });
    const target = el('BUTTON', { id: 'go', attrs: { 'data-testid': 'submit' } });
    h.fire('click', { target });
    expect(h.steps[0].selector).toBe('[data-testid="submit"]');
  });

  test('falls through to name (tag-qualified) when id and testid fail', () => {
    const h = install({ '#go': 2, '[data-testid="x"]': 3 });
    const target = el('INPUT', { id: 'go', attrs: { 'data-testid': 'x', name: 'email' } });
    h.fire('click', { target });
    expect(h.steps[0].selector).toBe('input[name="email"]');
  });

  test('uses tag+class combo when unique', () => {
    const h = install({ 'button.primary.big': 1 });
    const target = el('BUTTON', { classList: ['primary', 'big'] });
    h.fire('click', { target });
    expect(h.steps[0].selector).toBe('button.primary.big');
  });

  test('falls back to an nth-of-type path, capped and anchored to a unique ancestor id', () => {
    const root = el('DIV', { id: 'root' });
    const ul = el('UL', { parentElement: root });
    const li1 = el('LI', { parentElement: ul });
    const li2 = el('LI', { parentElement: ul });
    ul.children = [li1, li2];
    root.children = [ul];
    const h = install({ '#root': 1 });
    h.fire('click', { target: li2 });
    expect(h.steps[0].selector).toBe('#root > ul > li:nth-of-type(2)');
  });
});

describe('input capture', () => {
  test('emits the final value at change time, not per keystroke', () => {
    const h = install();
    const input = el('INPUT', { id: 'q', type: 'text', value: 'ab' });
    h.fire('input', { target: input });
    input.value = 'abc';
    h.fire('input', { target: input });
    h.fire('change', { target: input });
    expect(h.steps).toEqual([{ kind: 'input', selector: '#q', value: 'abc' }]);
  });

  test('masks a password field: redacted, no value on the wire', () => {
    const h = install();
    const pw = el('INPUT', { id: 'pw', type: 'password', value: 'hunter2' });
    h.fire('input', { target: pw });
    h.fire('change', { target: pw });
    const raw = (h.sandbox[REC_BINDING] as unknown);
    expect(h.steps).toEqual([{ kind: 'input', selector: '#pw', redacted: true }]);
    expect(JSON.stringify(h.steps)).not.toContain('hunter2');
    void raw;
  });

  test('select change emits a select step', () => {
    const h = install();
    const sel = el('SELECT', { id: 's', value: 'b' });
    h.fire('change', { target: sel });
    expect(h.steps).toEqual([{ kind: 'select', selector: '#s', value: 'b' }]);
  });
});

describe('Enter-flush ordering (risk #2)', () => {
  test('flushes the dirty active field before the Enter key step', () => {
    const h = install();
    const input = el('INPUT', { id: 'q', type: 'text', value: 'hi' });
    h.setActive(input);
    h.fire('input', { target: input });
    h.fire('keydown', { target: input, key: 'Enter' });
    expect(h.steps).toEqual([
      { kind: 'input', selector: '#q', value: 'hi' },
      { kind: 'key', selector: '#q', key: 'Enter' },
    ]);
  });

  test('a later change after Enter-flush does not double-emit the input', () => {
    const h = install();
    const input = el('INPUT', { id: 'q', type: 'text', value: 'hi' });
    h.setActive(input);
    h.fire('input', { target: input });
    h.fire('keydown', { target: input, key: 'Enter' });
    h.fire('change', { target: input });
    expect(h.steps.filter(s => s.kind === 'input')).toHaveLength(1);
  });

  test('only Enter/Escape/Tab produce key steps', () => {
    const h = install();
    const input = el('INPUT', { id: 'q', type: 'text' });
    h.setActive(input);
    h.fire('keydown', { target: input, key: 'a' });
    h.fire('keydown', { target: input, key: 'Escape' });
    h.fire('keydown', { target: input, key: 'Tab' });
    expect(h.steps.map(s => (s.kind === 'key' ? s.key : s.kind))).toEqual(['Escape', 'Tab']);
  });
});

describe('shadow DOM host substitution', () => {
  test('records the host when the event originates inside a shadow root', () => {
    const host = el('MY-WIDGET', { id: 'w' });
    const inner = el('BUTTON', { getRootNode: () => ({ host }) });
    const h = install();
    h.fire('click', { target: inner, composedPath: [inner] });
    expect(h.steps[0].selector).toBe('#w');
  });
});

describe('install lifecycle', () => {
  test('double injection is a no-op (guard flag)', () => {
    const h = install();
    expect(h.sandbox[REC_INSTALLED]).toBe(true);
    runInNewContext(buildRecorderScript(), h.sandbox);
    const input = el('INPUT', { id: 'q', type: 'text', value: 'x' });
    h.fire('input', { target: input });
    h.fire('change', { target: input });
    expect(h.steps).toHaveLength(1);
  });

  test('stop removes every listener and clears the flag', () => {
    const h = install();
    h.stop();
    expect(h.sandbox[REC_INSTALLED]).toBe(false);
    expect(h.sandbox[REC_STOP]).toBeUndefined();
    const target = el('BUTTON', { id: 'go' });
    h.fire('click', { target });
    expect(h.steps).toHaveLength(0);
  });
});
