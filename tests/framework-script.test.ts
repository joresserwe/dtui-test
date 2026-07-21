import { test, expect, describe } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  buildFrameworkScanScript,
  buildFrameworkHostScript,
  buildFrameworkInspectScript,
  parseFrameworkScan,
  reactNamesMinified,
  FRAMEWORK_HOSTS_KEY,
  FRAMEWORK_INSTANCES_KEY,
  type FrameworkInfo,
  type FrameworkNode,
  type FrameworkScanResult,
} from '../src/tui/lib/framework-script.js';
import { componentRows, filterComponents, componentParentIds } from '../src/tui/panels/ComponentsPanel.js';

interface FakeEl {
  nodeType: number;
  tagName: string;
  id?: string;
  [key: string]: unknown;
}

const el = (tagName: string, id?: string): FakeEl => ({ nodeType: 1, tagName, ...(id ? { id } : {}) });

function runScan(elements: unknown[], globals: Record<string, unknown> = {}, cap?: number): FrameworkScanResult {
  const sandbox: Record<string, unknown> = {
    document: { querySelectorAll: () => elements },
    ...globals,
  };
  sandbox.window = sandbox;
  const raw = runInNewContext(buildFrameworkScanScript(cap), sandbox);
  return parseFrameworkScan(raw);
}

function hostsOf(elements: unknown[], globals: Record<string, unknown> = {}): { scan: FrameworkScanResult; hosts: FakeEl[]; sandbox: Record<string, unknown> } {
  const sandbox: Record<string, unknown> = {
    document: { querySelectorAll: () => elements },
    ...globals,
  };
  sandbox.window = sandbox;
  const raw = runInNewContext(buildFrameworkScanScript(), sandbox);
  return { scan: parseFrameworkScan(raw), hosts: (sandbox[FRAMEWORK_HOSTS_KEY] as FakeEl[]) ?? [], sandbox };
}

describe('react walker', () => {
  test('resolves the stale __reactContainer$ fiber through stateNode.current', () => {
    const App = function App() {};
    const host = el('DIV', 'shell');
    const hostFiber = { tag: 5, type: 'div', stateNode: host, child: null, sibling: null };
    const appFiber = { tag: 0, type: App, child: hostFiber, sibling: null };
    const liveRoot = { tag: 3, type: null, child: appFiber, sibling: null };
    const staleFiber = { tag: 3, type: null, child: null, stateNode: { current: liveRoot } };
    const container = el('DIV', 'root');
    container['__reactContainer$abc123'] = staleFiber;

    const scan = runScan([container, host]);
    expect(scan.errors).toEqual([]);
    expect(scan.frameworks).toHaveLength(1);
    const fw = scan.frameworks[0];
    expect(fw.framework).toBe('react');
    expect(fw.nodes.map(n => n.name)).toEqual(['App']);
    expect(fw.nodes[0].kind).toBe('fn');
    expect(fw.nodes[0].depth).toBe(0);
    expect(fw.nodes[0].parentId).toBeNull();
  });

  test('falls back to fiber.alternate when stateNode.current is absent', () => {
    const App = function App() {};
    const appFiber = { tag: 0, type: App, child: null, sibling: null };
    const altRoot = { tag: 3, type: null, child: appFiber, sibling: null };
    const staleFiber = { tag: 3, type: null, child: null, stateNode: {}, alternate: altRoot };
    const container = el('DIV');
    container['__reactContainer$x'] = staleFiber;

    const scan = runScan([container]);
    expect(scan.frameworks[0].nodes.map(n => n.name)).toEqual(['App']);
  });

  test('climbs from a loose __reactFiber$ key to the HostRoot when no container key exists', () => {
    const Leaf = function Leaf() {};
    const leafFiber = { tag: 0, type: Leaf, child: null, sibling: null, return: null as unknown };
    const root = { tag: 3, type: null, child: leafFiber, sibling: null };
    leafFiber.return = root;
    const hostEl = el('SPAN');
    hostEl['__reactFiber$k'] = leafFiber;

    const scan = runScan([hostEl]);
    expect(scan.frameworks[0].nodes.map(n => n.name)).toEqual(['Leaf']);
  });

  test('name fallback chain: displayName, then name, then host tag, then <anonymous>', () => {
    const Named = function inner() {};
    (Named as { displayName?: string }).displayName = 'FancyName';
    const bare = function bareFn() {};
    const anonWithHost = (0, function () {});
    const anonNoHost = (0, function () {});

    const hostBtn = el('BUTTON', 'go');
    const btnFiber = { tag: 5, type: 'button', stateNode: hostBtn, child: null, sibling: null };
    const f4 = { tag: 0, type: anonNoHost, child: null, sibling: null };
    const f3 = { tag: 0, type: anonWithHost, child: btnFiber, sibling: f4 };
    const f2 = { tag: 0, type: bare, child: null, sibling: f3 };
    const f1 = { tag: 0, type: Named, child: null, sibling: f2 };
    const rootFiber = { tag: 3, type: null, child: f1, sibling: null };
    const container = el('DIV');
    container['__reactContainer$q'] = { tag: 3, type: null, child: null, stateNode: { current: rootFiber } };

    const scan = runScan([container]);
    expect(scan.frameworks[0].nodes.map(n => n.name)).toEqual(['FancyName', 'bareFn', '<button>', '<anonymous>']);
  });

  test('identifies class, forwardref, memo, lazy, and suspense kinds', () => {
    class Box {}
    const fwd = { render: function FancyInput() {} };
    const memoized = { type: function Row() {} };
    const lazyType = { _payload: {} };
    const f5 = { tag: 13, type: null, child: null, sibling: null };
    const f4 = { tag: 16, type: lazyType, child: null, sibling: f5 };
    const f3 = { tag: 14, type: memoized, child: null, sibling: f4 };
    const f2 = { tag: 11, type: fwd, child: null, sibling: f3 };
    const f1 = { tag: 1, type: Box, child: null, sibling: f2 };
    const rootFiber = { tag: 3, type: null, child: f1, sibling: null };
    const container = el('DIV');
    container['__reactContainer$k'] = { tag: 3, type: null, child: null, stateNode: { current: rootFiber } };

    const scan = runScan([container]);
    const nodes = scan.frameworks[0].nodes;
    expect(nodes.map(n => n.kind)).toEqual(['class', 'forwardref', 'memo', 'lazy', 'suspense']);
    expect(nodes.map(n => n.name)).toEqual(['Box', 'ForwardRef(FancyInput)', 'Memo(Row)', '<anonymous>', 'Suspense']);
  });

  test('assigns each component the nearest host element and stashes hosts on window', () => {
    const Outer = function Outer() {};
    const Inner = function Inner() {};
    const NoHost = function NoHost() {};
    const innerHost = el('SPAN', 'inner');
    const innerHostFiber = { tag: 5, type: 'span', stateNode: innerHost, child: null, sibling: null };
    const noHostFiber = { tag: 0, type: NoHost, child: null, sibling: null };
    const innerFiber = { tag: 0, type: Inner, child: innerHostFiber, sibling: noHostFiber };
    const outerFiber = { tag: 0, type: Outer, child: innerFiber, sibling: null };
    const rootFiber = { tag: 3, type: null, child: outerFiber, sibling: null };
    const container = el('DIV');
    container['__reactContainer$h'] = { tag: 3, type: null, child: null, stateNode: { current: rootFiber } };

    const { scan, hosts } = hostsOf([container]);
    const [outer, inner, noHost] = scan.frameworks[0].nodes;
    expect(outer.name).toBe('Outer');
    expect(inner.name).toBe('Inner');
    expect(inner.hostIdx).toBeDefined();
    expect(outer.hostIdx).toBe(inner.hostIdx);
    expect(hosts[inner.hostIdx!]).toBe(innerHost);
    expect(noHost.hostIdx).toBeUndefined();
    expect(inner.depth).toBe(1);
    expect(inner.parentId).toBe(outer.id);
  });

  test('a sibling subtree host does not leak into an ancestor that already has one', () => {
    const A = function A() {};
    const B = function B() {};
    const C = function C() {};
    const host1 = el('HEADER', 'h1');
    const host2 = el('FOOTER', 'h2');
    const host2Fiber = { tag: 5, type: 'footer', stateNode: host2, child: null, sibling: null };
    const cFiber = { tag: 0, type: C, child: host2Fiber, sibling: null };
    const host1Fiber = { tag: 5, type: 'header', stateNode: host1, child: null, sibling: null };
    const bFiber = { tag: 0, type: B, child: host1Fiber, sibling: cFiber };
    const aFiber = { tag: 0, type: A, child: bFiber, sibling: null };
    const rootFiber = { tag: 3, type: null, child: aFiber, sibling: null };
    const container = el('DIV');
    container['__reactContainer$s'] = { tag: 3, type: null, child: null, stateNode: { current: rootFiber } };

    const { scan, hosts } = hostsOf([container]);
    const byName = new Map(scan.frameworks[0].nodes.map(n => [n.name, n]));
    expect(hosts[byName.get('A')!.hostIdx!]).toBe(host1);
    expect(hosts[byName.get('B')!.hostIdx!]).toBe(host1);
    expect(hosts[byName.get('C')!.hostIdx!]).toBe(host2);
  });

  test('reports the renderer version from the devtools hook and truncates at the cap', () => {
    const App = function App() {};
    const mkChain = (n: number) => {
      let next: unknown = null;
      for (let i = 0; i < n; i++) next = { tag: 0, type: App, child: null, sibling: next };
      return next;
    };
    const rootFiber = { tag: 3, type: null, child: mkChain(6), sibling: null };
    const container = el('DIV');
    container['__reactContainer$v'] = { tag: 3, type: null, child: null, stateNode: { current: rootFiber } };
    const renderers = new Map([[1, { version: '18.3.1' }]]);
    const scan = runScan([container], { __REACT_DEVTOOLS_GLOBAL_HOOK__: { renderers } }, 4);
    const fw = scan.frameworks[0];
    expect(fw.version).toBe('18.3.1');
    expect(fw.truncated).toBe(true);
    expect(fw.nodes.length).toBeLessThan(6);
  });
});

describe('vue walker', () => {
  const vueApp = (rootInstance: unknown, opts: { prod?: boolean; version?: string } = {}) => {
    const app: Record<string, unknown> = { version: opts.version ?? '3.5.40' };
    if (opts.prod) app._container = { _vnode: { component: rootInstance } };
    else app._instance = rootInstance;
    return app;
  };

  test('walks the dev path through app._instance', () => {
    const rootInstance = {
      type: { name: 'App' },
      subTree: { type: 'div', el: el('DIV', 'app'), children: [] },
    };
    const container = el('DIV') as FakeEl & { __vue_app__?: unknown };
    container.__vue_app__ = vueApp(rootInstance);
    const scan = runScan([container]);
    expect(scan.frameworks).toHaveLength(1);
    const fw = scan.frameworks[0];
    expect(fw.framework).toBe('vue');
    expect(fw.version).toBe('3.5.40');
    expect(fw.nodes.map(n => n.name)).toEqual(['App']);
  });

  test('prod build without app._instance falls back to _container._vnode.component', () => {
    const child = {
      type: { __name: 'NavBar' },
      subTree: { type: 'nav', el: el('NAV'), children: [] },
    };
    const rootInstance = {
      type: { name: 'App' },
      subTree: { type: 'div', el: el('DIV'), children: [{ component: child }] },
    };
    const container = el('DIV') as FakeEl & { __vue_app__?: unknown };
    container.__vue_app__ = vueApp(rootInstance, { prod: true });
    const scan = runScan([container]);
    const fw = scan.frameworks[0];
    expect(fw.nodes.map(n => n.name)).toEqual(['App', 'NavBar']);
    expect(fw.nodes[1].parentId).toBe(fw.nodes[0].id);
    expect(fw.nodes[1].depth).toBe(1);
  });

  test('recovers anonymous component names from __file and the parent components registry', () => {
    const fromFile = { type: { __file: '/src/components/FooterNote.vue' }, subTree: null };
    const anonDef = {};
    const fromRegistry = { type: anonDef, subTree: null, parent: null as unknown };
    const rootType = { name: 'App', components: { RegisteredRow: anonDef } };
    const rootInstance = {
      type: rootType,
      subTree: { type: 'div', el: el('DIV'), children: [{ component: fromFile }, { component: fromRegistry }] },
    };
    fromRegistry.parent = rootInstance;
    const container = el('DIV') as FakeEl & { __vue_app__?: unknown };
    container.__vue_app__ = vueApp(rootInstance);
    const scan = runScan([container]);
    expect(scan.frameworks[0].nodes.map(n => n.name)).toEqual(['App', 'FooterNote', 'RegisteredRow']);
  });

  test('assigns hosts from vnode elements and keeps text vnodes out of the tree', () => {
    const rowEl = el('LI', 'row');
    const Row = {
      type: { name: 'Row' },
      subTree: { type: 'li', el: rowEl, children: ['text-only'] },
    };
    const rootInstance = {
      type: { name: 'App' },
      subTree: { type: 'ul', el: el('UL'), children: [{ component: Row }] },
    };
    const container = el('DIV') as FakeEl & { __vue_app__?: unknown };
    container.__vue_app__ = vueApp(rootInstance);
    const { scan, hosts } = hostsOf([container]);
    const nodes = scan.frameworks[0].nodes;
    expect(nodes).toHaveLength(2);
    const row = nodes[1];
    expect(row.name).toBe('Row');
    expect(row.hostIdx).toBeDefined();
    expect(hosts[row.hostIdx!]).toBe(rowEl);
  });

  test('deduplicates the same app found on several elements', () => {
    const rootInstance = { type: { name: 'App' }, subTree: null };
    const app = vueApp(rootInstance);
    const a = el('DIV') as FakeEl & { __vue_app__?: unknown };
    const b = el('DIV') as FakeEl & { __vue_app__?: unknown };
    a.__vue_app__ = app;
    b.__vue_app__ = app;
    const scan = runScan([a, b]);
    expect(scan.frameworks[0].nodes).toHaveLength(1);
  });
});

describe('instance stashing', () => {
  test('react component nodes get an instIdx pointing at their fiber', () => {
    const Outer = function Outer() {};
    const Inner = function Inner() {};
    const innerFiber = { tag: 0, type: Inner, child: null, sibling: null };
    const outerFiber = { tag: 0, type: Outer, child: innerFiber, sibling: null };
    const rootFiber = { tag: 3, type: null, child: outerFiber, sibling: null };
    const container = el('DIV');
    container['__reactContainer$i'] = { tag: 3, type: null, child: null, stateNode: { current: rootFiber } };

    const { scan, sandbox } = hostsOf([container]);
    const insts = sandbox[FRAMEWORK_INSTANCES_KEY] as unknown[];
    const [outer, inner] = scan.frameworks[0].nodes;
    expect(outer.instIdx).toBeDefined();
    expect(inner.instIdx).toBeDefined();
    expect(insts[outer.instIdx!]).toBe(outerFiber);
    expect(insts[inner.instIdx!]).toBe(innerFiber);
  });

  test('vue component nodes get an instIdx pointing at their instance', () => {
    const child = { type: { name: 'Row' }, subTree: null };
    const rootInstance = {
      type: { name: 'App' },
      subTree: { type: 'div', el: el('DIV'), children: [{ component: child }] },
    };
    const container = el('DIV') as FakeEl & { __vue_app__?: unknown };
    container.__vue_app__ = { version: '3.5.40', _instance: rootInstance };

    const { scan, sandbox } = hostsOf([container]);
    const insts = sandbox[FRAMEWORK_INSTANCES_KEY] as unknown[];
    const [app, row] = scan.frameworks[0].nodes;
    expect(insts[app.instIdx!]).toBe(rootInstance);
    expect(insts[row.instIdx!]).toBe(child);
  });

  test('parseFrameworkScan keeps a numeric instIdx and drops junk ones', () => {
    const res = parseFrameworkScan({
      frameworks: [{
        framework: 'react',
        nodes: [
          { id: 0, name: 'A', depth: 0, parentId: null, kind: 'fn', instIdx: 3 },
          { id: 1, name: 'B', depth: 0, parentId: null, kind: 'fn', instIdx: 'x' },
        ],
        truncated: false,
      }],
      errors: [],
    });
    expect(res.frameworks[0].nodes[0].instIdx).toBe(3);
    expect(res.frameworks[0].nodes[1].instIdx).toBeUndefined();
  });
});

describe('inspect script', () => {
  function runInspect(framework: 'react' | 'vue', insts: unknown[], idx: number): unknown {
    const sandbox: Record<string, unknown> = {};
    sandbox.window = sandbox;
    sandbox[FRAMEWORK_INSTANCES_KEY] = insts;
    return runInNewContext(buildFrameworkInspectScript(framework, idx), sandbox);
  }

  const liveRootFor = (fiber: { return?: unknown }) => {
    const root: Record<string, unknown> = { tag: 3, stateNode: {} };
    (root.stateNode as Record<string, unknown>).current = root;
    fiber.return = root;
    return root;
  };

  test('a function component reports props and skips empty sections', () => {
    const f: Record<string, unknown> = { tag: 0, memoizedProps: { a: 1 }, memoizedState: null };
    liveRootFor(f);
    expect(runInspect('react', [f], 0)).toEqual({ props: { a: 1 } });
  });

  test('empty props produce an empty section object, not null', () => {
    const f: Record<string, unknown> = { tag: 0, memoizedProps: {}, memoizedState: null };
    liveRootFor(f);
    expect(runInspect('react', [f], 0)).toEqual({});
  });

  test('a stale fiber is re-resolved through its alternate at read time', () => {
    const liveF: Record<string, unknown> = { tag: 0, memoizedProps: { a: 2 } };
    liveRootFor(liveF);
    const staleRoot: Record<string, unknown> = { tag: 3 };
    const staleF: Record<string, unknown> = { tag: 0, memoizedProps: { a: 1 }, alternate: liveF, return: staleRoot };
    staleRoot.stateNode = { current: { tag: 3 } };
    expect(runInspect('react', [staleF], 0)).toEqual({ props: { a: 2 } });
  });

  test('a class component reports instance state, not a hooks list', () => {
    const f: Record<string, unknown> = {
      tag: 1,
      memoizedProps: { p: 1 },
      memoizedState: { count: 2 },
      stateNode: { state: { count: 2 } },
    };
    liveRootFor(f);
    expect(runInspect('react', [f], 0)).toEqual({ props: { p: 1 }, state: { count: 2 } });
  });

  test('hooks are collected from the memoizedState linked list in order', () => {
    const f: Record<string, unknown> = {
      tag: 0,
      memoizedProps: {},
      memoizedState: { memoizedState: 1, next: { memoizedState: 'x', next: null } },
    };
    liveRootFor(f);
    expect(runInspect('react', [f], 0)).toEqual({ hooks: [1, 'x'] });
  });

  test('a detached fiber and a missing index both return null', () => {
    const f: Record<string, unknown> = { tag: 0, memoizedProps: { a: 1 }, return: { tag: 0 } };
    expect(runInspect('react', [f], 0)).toBeNull();
    expect(runInspect('react', [], 5)).toBeNull();
  });

  test('vue reports props, setupState as setup, and data, skipping empty ones', () => {
    const inst = {
      type: {},
      props: { msg: 'hi' },
      setupState: {},
      data: { n: 1 },
      isUnmounted: false,
    };
    expect(runInspect('vue', [inst], 0)).toEqual({ props: { msg: 'hi' }, data: { n: 1 } });
  });

  test('an unmounted vue instance returns null', () => {
    const inst = { type: {}, props: { a: 1 }, isUnmounted: true };
    expect(runInspect('vue', [inst], 0)).toBeNull();
  });
});

describe('host pick script', () => {
  test('returns the stashed element for an index and null when absent', () => {
    const sandbox: Record<string, unknown> = {};
    sandbox.window = sandbox;
    const target = el('SPAN');
    sandbox[FRAMEWORK_HOSTS_KEY] = [null, target];
    expect(runInNewContext(buildFrameworkHostScript(1), sandbox)).toBe(target);
    expect(runInNewContext(buildFrameworkHostScript(7), sandbox)).toBeNull();
    const empty: Record<string, unknown> = {};
    empty.window = empty;
    expect(runInNewContext(buildFrameworkHostScript(0), empty)).toBeNull();
  });
});

describe('parseFrameworkScan', () => {
  test('tolerates garbage and preserves in-page errors', () => {
    expect(parseFrameworkScan(null)).toEqual({ frameworks: [], errors: [] });
    expect(parseFrameworkScan('nope')).toEqual({ frameworks: [], errors: [] });
    expect(parseFrameworkScan({ frameworks: 'x', errors: [1, 'boom'] })).toEqual({ frameworks: [], errors: ['boom'] });
    const res = parseFrameworkScan({
      frameworks: [
        { framework: 'react', version: 18, nodes: [{ id: 0, name: 'App', depth: 0, parentId: null, kind: 'fn' }], truncated: false },
        { framework: 'weird', nodes: [], truncated: false },
      ],
      errors: [],
    });
    expect(res.frameworks).toHaveLength(1);
    expect(res.frameworks[0].version).toBeUndefined();
    expect(res.frameworks[0].nodes[0].name).toBe('App');
  });

  test('drops malformed nodes but keeps valid ones', () => {
    const res = parseFrameworkScan({
      frameworks: [{
        framework: 'vue',
        version: '3.5.40',
        nodes: [
          { id: 0, name: 'App', depth: 0, parentId: null, kind: 'component', hostIdx: 2 },
          { id: 'bad', name: 1, depth: 0, parentId: null, kind: 'component' },
        ],
        truncated: true,
      }],
      errors: [],
    });
    expect(res.frameworks[0].nodes).toHaveLength(1);
    expect(res.frameworks[0].nodes[0].hostIdx).toBe(2);
    expect(res.frameworks[0].truncated).toBe(true);
  });
});

describe('reactNamesMinified', () => {
  const info = (names: string[]): FrameworkInfo => ({
    framework: 'react',
    nodes: names.map((name, id) => ({ id, name, depth: 0, parentId: null, kind: 'fn' as const })),
    truncated: false,
  });
  test('flags a tree whose names are mostly 1-2 chars', () => {
    expect(reactNamesMinified(info(['f', 'p', 'o', 's', 'c', 'i', 'd', 'm']))).toBe(true);
    expect(reactNamesMinified(info(['App', 'Header', 'TodoItem', 'Footer', 'Nav', 'Row']))).toBe(false);
    expect(reactNamesMinified(info(['f', 'p']))).toBe(false);
    expect(reactNamesMinified({ ...info(['f', 'p', 'o', 's', 'c']), framework: 'vue' })).toBe(false);
  });
});

describe('component rows', () => {
  const n = (id: number, depth: number, parentId: number | null, name = `N${id}`): FrameworkNode => ({
    id, name, depth, parentId, kind: 'fn',
  });
  const tree = [n(0, 0, null, 'App'), n(1, 1, 0, 'Nav'), n(2, 2, 1, 'Item'), n(3, 1, 0, 'Body'), n(4, 0, null, 'Modal')];

  test('componentRows hides descendants of collapsed nodes', () => {
    expect(componentRows(tree, new Set()).map(x => x.id)).toEqual([0, 1, 2, 3, 4]);
    expect(componentRows(tree, new Set([1])).map(x => x.id)).toEqual([0, 1, 3, 4]);
    expect(componentRows(tree, new Set([0])).map(x => x.id)).toEqual([0, 4]);
  });

  test('componentParentIds reports nodes that have children', () => {
    const p = componentParentIds(tree);
    expect(p.has(0)).toBe(true);
    expect(p.has(1)).toBe(true);
    expect(p.has(2)).toBe(false);
    expect(p.has(4)).toBe(false);
  });

  test('filterComponents matches names case-insensitively', () => {
    expect(filterComponents(tree, 'nav').map(x => x.id)).toEqual([1]);
    expect(filterComponents(tree, '').map(x => x.id)).toEqual([0, 1, 2, 3, 4]);
    expect(filterComponents(tree, 'zzz')).toEqual([]);
  });
});
