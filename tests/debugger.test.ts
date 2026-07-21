import { test, expect, beforeEach, afterEach } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { listPages } from '../src/cdp/targets.js';
import { blackboxPattern, DebugSession } from '../src/engine.js';
import { DebuggerStore, logpointCondition } from '../src/store/debugger.js';

let mock: MockCdp;

beforeEach(async () => {
  mock = await MockCdp.start();
});
afterEach(async () => {
  await mock.close();
});

async function attach() {
  const [page] = await listPages({ host: '127.0.0.1', port: mock.port, browser: 'MockChrome/1.0' });
  return DebugSession.attach(page, { persist: false, browser: 'MockChrome/1.0' });
}

const flush = () => new Promise(r => setTimeout(r, 100));

const PAUSED_PARAMS = {
  reason: 'other',
  hitBreakpoints: ['bp-1'],
  callFrames: [
    {
      callFrameId: 'cf-0',
      functionName: 'calc',
      url: 'https://a.test/app.js',
      location: { scriptId: 'sc-1', lineNumber: 3, columnNumber: 2 },
      scopeChain: [
        { type: 'local', object: { type: 'object', objectId: 'scope-local' } },
        { type: 'global', object: { type: 'object', objectId: 'scope-global', description: 'Window' } },
      ],
    },
    {
      callFrameId: 'cf-1',
      functionName: '',
      url: 'https://a.test/app.js',
      location: { scriptId: 'sc-1', lineNumber: 9, columnNumber: 0 },
      scopeChain: [{ type: 'global', object: { type: 'object', objectId: 'scope-global' } }],
    },
  ],
};

test('DebuggerStore catalogs scripts and snapshots paused/resumed state', () => {
  const store = new DebuggerStore();
  const events: string[] = [];
  store.on('paused', () => events.push('paused'));
  store.on('resumed', () => events.push('resumed'));

  store.handleEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://a.test/app.js', endLine: 42 });
  store.handleEvent('Debugger.scriptParsed', { scriptId: 'sc-2', url: '', endLine: 0 });
  expect(store.scripts()).toHaveLength(2);
  expect(store.scriptById('sc-1')).toMatchObject({ url: 'https://a.test/app.js', endLine: 42 });

  store.handleEvent('Debugger.paused', PAUSED_PARAMS);
  expect(store.paused).toMatchObject({ reason: 'other', hitBreakpoints: ['bp-1'] });
  expect(store.paused!.frames).toHaveLength(2);
  expect(store.paused!.frames[0]).toMatchObject({ functionName: 'calc', scriptId: 'sc-1', line: 3, column: 2 });
  expect(store.paused!.frames[0].scopes[0]).toMatchObject({ type: 'local', objectId: 'scope-local' });

  store.handleEvent('Debugger.resumed', {});
  expect(store.paused).toBeNull();
  expect(events).toEqual(['paused', 'resumed']);
});

test('frames with an empty CallFrame.url take the URL from the script catalog', () => {
  const store = new DebuggerStore();
  store.handleEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://a.test/app.js', endLine: 9 });
  store.handleEvent('Debugger.paused', {
    reason: 'other',
    callFrames: [{ callFrameId: 'cf-0', functionName: 'calc', location: { scriptId: 'sc-1', lineNumber: 2 }, scopeChain: [] }],
  });
  expect(store.paused!.frames[0].url).toBe('https://a.test/app.js');
});

test('DebuggerStore captures the exception text on exception pauses', () => {
  const store = new DebuggerStore();
  store.handleEvent('Debugger.paused', {
    ...PAUSED_PARAMS,
    reason: 'exception',
    data: { type: 'object', subtype: 'error', description: 'Error: boom\n    at t.js:1' },
  });
  expect(store.paused!.exceptionText).toBe('Error: boom\n    at t.js:1');
});

test('breakpoint bookkeeping: add, resolve, lookup by resolved line, remove', () => {
  const store = new DebuggerStore();
  store.addBreakpoint('bp-1', 'https://a.test/app.js', 10, []);
  expect(store.breakpointAt('https://a.test/app.js', 10)).toMatchObject({ id: 'bp-1' });

  store.handleEvent('Debugger.breakpointResolved', {
    breakpointId: 'bp-1',
    location: { scriptId: 'sc-1', lineNumber: 12 },
  });
  expect(store.breakpointAt('https://a.test/app.js', 10)).toBeUndefined();
  expect(store.breakpointAt('https://a.test/app.js', 12)).toMatchObject({ id: 'bp-1' });
  expect(store.breakpointSpecs()).toEqual([{ url: 'https://a.test/app.js', line: 10 }]);

  store.removeBreakpoint('bp-1');
  expect(store.breakpoints()).toEqual([]);
});

test('clearScripts drops the catalog and paused snapshot but keeps breakpoints', () => {
  const store = new DebuggerStore();
  store.handleEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://a.test/app.js', endLine: 1 });
  store.handleEvent('Debugger.paused', PAUSED_PARAMS);
  store.addBreakpoint('bp-1', 'https://a.test/app.js', 10, [{ scriptId: 'sc-1', lineNumber: 10 }]);
  store.clearScripts();
  expect(store.scripts()).toEqual([]);
  expect(store.paused).toBeNull();
  expect(store.breakpoints()).toHaveLength(1);
});

test('clearScripts emits resumed only when it drops a paused snapshot', () => {
  const store = new DebuggerStore();
  const events: string[] = [];
  store.on('resumed', () => events.push('resumed'));
  store.clearScripts();
  expect(events).toEqual([]);
  store.handleEvent('Debugger.paused', PAUSED_PARAMS);
  store.clearScripts();
  expect(events).toEqual(['resumed']);
});

test('the engine routes Debugger events into the store and clears scripts with the contexts', async () => {
  const session = await attach();
  mock.emitEvent('Debugger.scriptParsed', { scriptId: 'sc-1', url: 'https://a.test/app.js', endLine: 9 });
  mock.emitEvent('Debugger.paused', PAUSED_PARAMS);
  await flush();
  expect(session.debug.scripts()).toHaveLength(1);
  expect(session.debug.paused?.frames[0].functionName).toBe('calc');

  mock.emitEvent('Runtime.executionContextsCleared', {});
  await flush();
  expect(session.debug.scripts()).toEqual([]);
  expect(session.debug.paused).toBeNull();
  await session.close();
});

test('enableDebugger sends Debugger.enable once and marks the session active', async () => {
  let enables = 0;
  mock.respond('Debugger.enable', () => {
    enables++;
    return { debuggerId: 'dbg-1' };
  });
  const session = await attach();
  expect(session.debuggerActive).toBe(false);
  await session.enableDebugger();
  await session.enableDebugger();
  expect(enables).toBe(1);
  expect(session.debuggerActive).toBe(true);
  await session.close();
});

test('setBreakpointByUrl records the resolved location and removeBreakpoint drops it', async () => {
  const setCalls: any[] = [];
  const removed: string[] = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    setCalls.push(p);
    return { breakpointId: 'bp-9', locations: [{ scriptId: 'sc-1', lineNumber: p.lineNumber + 2, columnNumber: 0 }] };
  });
  mock.respond('Debugger.removeBreakpoint', p => {
    removed.push(p.breakpointId);
    return {};
  });
  const session = await attach();
  const bp = await session.setBreakpointByUrl('https://a.test/app.js', 10);
  expect(setCalls[0]).toMatchObject({ url: 'https://a.test/app.js', lineNumber: 10, columnNumber: 0 });
  expect(bp).toMatchObject({ id: 'bp-9', line: 10, resolved: { scriptId: 'sc-1', line: 12 } });
  expect(session.debug.breakpointAt('https://a.test/app.js', 12)).toBeDefined();

  await session.removeBreakpoint('bp-9');
  expect(removed).toEqual(['bp-9']);
  expect(session.debug.breakpoints()).toEqual([]);
  await session.close();
});

test('setPauseOnExceptions round-trips through CDP into the store', async () => {
  const states: string[] = [];
  mock.respond('Debugger.setPauseOnExceptions', p => {
    states.push(p.state);
    return {};
  });
  const session = await attach();
  await session.setPauseOnExceptions('uncaught');
  expect(states).toEqual(['uncaught']);
  expect(session.debug.pauseOnExceptions).toBe('uncaught');
  expect(session.debug.persistState(true)).toEqual({
    enabled: true,
    pauseOnExceptions: 'uncaught',
    breakpoints: [],
    blackboxed: [],
    xhrBreakpoints: [],
    eventBreakpoints: [],
    domBreakpoints: [],
  });
  await session.close();
});

test('step, resume, and pause delegates send their Debugger methods', async () => {
  const sent: string[] = [];
  for (const m of ['Debugger.stepOver', 'Debugger.stepInto', 'Debugger.stepOut', 'Debugger.resume', 'Debugger.pause']) {
    mock.respond(m, () => {
      sent.push(m);
      return {};
    });
  }
  const session = await attach();
  await session.stepOver();
  await session.stepInto();
  await session.stepOut();
  await session.resumeDebugger();
  await session.pauseDebugger();
  expect(sent).toEqual(['Debugger.stepOver', 'Debugger.stepInto', 'Debugger.stepOut', 'Debugger.resume', 'Debugger.pause']);
  await session.close();
});

test('evaluateOnCallFrame maps the result into a console arg', async () => {
  mock.respond('Debugger.evaluateOnCallFrame', p => {
    expect(p).toMatchObject({ callFrameId: 'cf-0', expression: 'a + b' });
    return { result: { type: 'number', value: 5, description: '5' } };
  });
  const session = await attach();
  const { result, exceptionDetails } = await session.evaluateOnCallFrame('cf-0', 'a + b');
  expect(exceptionDetails).toBeUndefined();
  expect(result).toMatchObject({ type: 'number', value: 5 });
  await session.close();
});

test('logpointCondition interpolates {expr} groups and escapes template syntax', () => {
  expect(logpointCondition('count {n} of {total}')).toBe('console.log(`count ${n} of ${total}`), false');
  expect(logpointCondition('plain message')).toBe('console.log(`plain message`), false');
  expect(logpointCondition('tick `{x}` \\z')).toBe('console.log(`tick \\`${x}\\` \\\\z`), false');
  expect(logpointCondition('price ${')).toBe('console.log(`price \\${`), false');
});

test('blackboxPattern escapes regex metacharacters and anchors the URL', () => {
  expect(blackboxPattern('https://a.test/app.js?v=1')).toBe('^https://a\\.test/app\\.js\\?v=1$');
  expect('https://a.test/app.js?v=1').toMatch(new RegExp(blackboxPattern('https://a.test/app.js?v=1')));
  expect('https://axtest/appxjs?v=1').not.toMatch(new RegExp(blackboxPattern('https://a.test/app.js?v=1')));
});

test('the store records breakpoint kind and condition and persists them in the specs', () => {
  const store = new DebuggerStore();
  store.addBreakpoint('bp-1', 'https://a.test/app.js', 3, [], 'condition', 'n === 3');
  store.addBreakpoint('bp-2', 'https://a.test/app.js', 7, [], 'logpoint', 'sum {sum}');
  store.addBreakpoint('bp-3', 'https://a.test/app.js', 9, []);
  expect(store.breakpointSpecs()).toEqual([
    { url: 'https://a.test/app.js', line: 3, kind: 'condition', condition: 'n === 3' },
    { url: 'https://a.test/app.js', line: 7, kind: 'logpoint', condition: 'sum {sum}' },
    { url: 'https://a.test/app.js', line: 9 },
  ]);
});

test('paused detail captures the XHR URL, DOM mutation type, and event name', () => {
  const store = new DebuggerStore();
  store.handleEvent('Debugger.paused', { reason: 'XHR', callFrames: [], data: { url: 'https://a.test/api' } });
  expect(store.paused).toMatchObject({ reason: 'XHR', detail: 'https://a.test/api' });
  store.handleEvent('Debugger.paused', { reason: 'DOM', callFrames: [], data: { type: 'subtree-modified', nodeId: 3 } });
  expect(store.paused).toMatchObject({ reason: 'DOM', detail: 'subtree-modified' });
  store.handleEvent('Debugger.paused', { reason: 'EventListener', callFrames: [], data: { eventName: 'listener:click' } });
  expect(store.paused).toMatchObject({ reason: 'EventListener', detail: 'click' });
  store.handleEvent('Debugger.paused', { reason: 'other', callFrames: [] });
  expect(store.paused!.detail).toBeUndefined();
});

test('clearScripts drops DOM breakpoints but keeps blackbox, XHR, and event state', () => {
  const store = new DebuggerStore();
  store.setBlackboxedUrls(['https://a.test/vendor.js']);
  store.addXhrBreakpoint('api');
  store.setEventBreakpoint('click', true);
  store.addDomBreakpoint({ nodeId: 3, selector: '#app', type: 'subtree-modified' });
  store.clearScripts();
  expect(store.domBreakpoints()).toEqual([]);
  expect(store.blackboxedUrls()).toEqual(['https://a.test/vendor.js']);
  expect(store.xhrBreakpoints()).toEqual(['api']);
  expect(store.eventBreakpoints()).toEqual(['click']);
});

test('the persist state carries every breakpoint family', () => {
  const store = new DebuggerStore();
  store.addBreakpoint('bp-1', 'https://a.test/app.js', 3, [], 'condition', 'n === 3');
  store.setBlackboxedUrls(['https://a.test/vendor.js']);
  store.addXhrBreakpoint('api');
  store.setEventBreakpoint('click', true);
  store.addDomBreakpoint({ nodeId: 3, selector: '#app', type: 'attribute-modified' });
  expect(store.persistState(true)).toEqual({
    enabled: true,
    pauseOnExceptions: 'none',
    breakpoints: [{ url: 'https://a.test/app.js', line: 3, kind: 'condition', condition: 'n === 3' }],
    blackboxed: ['https://a.test/vendor.js'],
    xhrBreakpoints: ['api'],
    eventBreakpoints: ['click'],
    domBreakpoints: [{ selector: '#app', type: 'attribute-modified' }],
  });
});

test('setBreakpointByUrl forwards a condition and wraps logpoints', async () => {
  const conditions: Array<string | undefined> = [];
  mock.respond('Debugger.setBreakpointByUrl', p => {
    conditions.push(p.condition);
    return { breakpointId: `bp-${conditions.length}`, locations: [] };
  });
  const session = await attach();
  const cond = await session.setBreakpointByUrl('https://a.test/app.js', 3, { kind: 'condition', text: 'n === 3' });
  const log = await session.setBreakpointByUrl('https://a.test/app.js', 7, { kind: 'logpoint', text: 'sum {sum}' });
  expect(conditions).toEqual(['n === 3', 'console.log(`sum ${sum}`), false']);
  expect(cond).toMatchObject({ kind: 'condition', condition: 'n === 3' });
  expect(log).toMatchObject({ kind: 'logpoint', condition: 'sum {sum}' });
  await session.close();
});

test('toggleBlackbox sends the accumulated escaped patterns and updates the store', async () => {
  const patterns: string[][] = [];
  mock.respond('Debugger.setBlackboxPatterns', p => {
    patterns.push(p.patterns);
    return {};
  });
  const session = await attach();
  expect(await session.toggleBlackbox('https://a.test/vendor.js')).toBe(true);
  expect(await session.toggleBlackbox('https://a.test/lib.js')).toBe(true);
  expect(session.debug.isBlackboxed('https://a.test/vendor.js')).toBe(true);
  expect(await session.toggleBlackbox('https://a.test/vendor.js')).toBe(false);
  expect(patterns).toEqual([
    ['^https://a\\.test/vendor\\.js$'],
    ['^https://a\\.test/vendor\\.js$', '^https://a\\.test/lib\\.js$'],
    ['^https://a\\.test/lib\\.js$'],
  ]);
  expect(session.debug.blackboxedUrls()).toEqual(['https://a.test/lib.js']);
  await session.close();
});

test('XHR, event, and DOM breakpoints round-trip through DOMDebugger into the store', async () => {
  const calls: Array<[string, any]> = [];
  for (const m of [
    'DOMDebugger.setXHRBreakpoint',
    'DOMDebugger.removeXHRBreakpoint',
    'DOMDebugger.setEventListenerBreakpoint',
    'DOMDebugger.removeEventListenerBreakpoint',
    'DOMDebugger.setDOMBreakpoint',
    'DOMDebugger.removeDOMBreakpoint',
  ]) {
    mock.respond(m, p => {
      calls.push([m, p]);
      return {};
    });
  }
  const session = await attach();
  await session.addXhrBreakpoint('api');
  expect(session.debug.xhrBreakpoints()).toEqual(['api']);
  await session.removeXhrBreakpoint('api');
  expect(session.debug.xhrBreakpoints()).toEqual([]);
  await session.setEventBreakpoint('click', true);
  expect(session.debug.eventBreakpoints()).toEqual(['click']);
  await session.setEventBreakpoint('click', false);
  expect(session.debug.eventBreakpoints()).toEqual([]);
  await session.setDomBreakpoint(3, 'subtree-modified', '#app');
  expect(session.debug.domBreakpointsFor(3)).toEqual(['subtree-modified']);
  await session.removeDomBreakpoint(3, 'subtree-modified');
  expect(session.debug.domBreakpoints()).toEqual([]);
  expect(calls).toEqual([
    ['DOMDebugger.setXHRBreakpoint', { url: 'api' }],
    ['DOMDebugger.removeXHRBreakpoint', { url: 'api' }],
    ['DOMDebugger.setEventListenerBreakpoint', { eventName: 'click' }],
    ['DOMDebugger.removeEventListenerBreakpoint', { eventName: 'click' }],
    ['DOMDebugger.setDOMBreakpoint', { nodeId: 3, type: 'subtree-modified' }],
    ['DOMDebugger.removeDOMBreakpoint', { nodeId: 3, type: 'subtree-modified' }],
  ]);
  await session.close();
});

test('scriptParsed records the sourceMapURL when present', () => {
  const store = new DebuggerStore();
  store.handleEvent('Debugger.scriptParsed', {
    scriptId: 'sc-1',
    url: 'https://a.test/app.js',
    endLine: 9,
    sourceMapURL: 'app.js.map',
  });
  store.handleEvent('Debugger.scriptParsed', { scriptId: 'sc-2', url: 'https://a.test/plain.js', endLine: 1, sourceMapURL: '' });
  expect(store.scriptById('sc-1')?.sourceMapURL).toBe('app.js.map');
  expect(store.scriptById('sc-2')?.sourceMapURL).toBeUndefined();
});

test('setScriptSource forwards dryRun and surfaces the status and exception details', async () => {
  const calls: any[] = [];
  mock.respond('Debugger.setScriptSource', p => {
    calls.push(p);
    if (p.dryRun) return { status: 'CompileError', exceptionDetails: { text: 'Unexpected token' } };
    return { status: 'Ok' };
  });
  const session = await attach();
  const dry = await session.setScriptSource('sc-1', 'bad(', true);
  expect(dry.status).toBe('CompileError');
  expect((dry.exceptionDetails as { text?: string })?.text).toBe('Unexpected token');
  const applied = await session.setScriptSource('sc-1', 'ok();');
  expect(applied.status).toBe('Ok');
  expect(calls).toEqual([
    { scriptId: 'sc-1', scriptSource: 'bad(', dryRun: true },
    { scriptId: 'sc-1', scriptSource: 'ok();', dryRun: false },
  ]);
  await session.close();
});

test('setScriptSource without a status field reports Ok', async () => {
  mock.respond('Debugger.setScriptSource', () => ({}));
  const session = await attach();
  const res = await session.setScriptSource('sc-1', 'ok();');
  expect(res.status).toBe('Ok');
  await session.close();
});

test('getScriptSource returns the script body', async () => {
  mock.respond('Debugger.getScriptSource', p => {
    expect(p.scriptId).toBe('sc-1');
    return { scriptSource: 'function calc(a, b) {\n  return a + b;\n}\n' };
  });
  const session = await attach();
  await expect(session.getScriptSource('sc-1')).resolves.toContain('return a + b;');
  await session.close();
});
