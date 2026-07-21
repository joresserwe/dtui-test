export type FrameworkKind = 'fn' | 'class' | 'forwardref' | 'memo' | 'lazy' | 'suspense' | 'component';

export interface FrameworkNode {
  id: number;
  name: string;
  depth: number;
  parentId: number | null;
  kind: FrameworkKind;
  hostIdx?: number;
  instIdx?: number;
}

export interface FrameworkInfo {
  framework: 'react' | 'vue';
  version?: string;
  nodes: FrameworkNode[];
  truncated: boolean;
}

export interface FrameworkScanResult {
  frameworks: FrameworkInfo[];
  errors: string[];
}

export const FRAMEWORK_HOSTS_KEY = '__dtuiFwHosts';
export const FRAMEWORK_INSTANCES_KEY = '__dtuiFwInst';
export const FRAMEWORK_NODE_CAP = 50000;
export const FRAMEWORK_HOOKS_CAP = 100;

export function buildFrameworkScanScript(cap: number = FRAMEWORK_NODE_CAP): string {
  return `(function () {
  var MAXN = ${Math.max(1, Math.floor(cap))};
  var out = { frameworks: [], errors: [] };
  var hosts = [];
  window[${JSON.stringify(FRAMEWORK_HOSTS_KEY)}] = hosts;
  var insts = [];
  window[${JSON.stringify(FRAMEWORK_INSTANCES_KEY)}] = insts;
  var stash = function (el) { hosts.push(el); return hosts.length - 1; };
  var fillHosts = function (anc, el) {
    var hi = -1;
    for (var a = anc.length - 1; a >= 0; a--) {
      if (anc[a].hostIdx !== undefined) break;
      if (hi < 0) hi = stash(el);
      anc[a].hostIdx = hi;
    }
  };
  var finishNames = function (nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].name) continue;
      nodes[i].name = nodes[i].hostIdx !== undefined
        ? '<' + String(hosts[nodes[i].hostIdx].tagName || '?').toLowerCase() + '>'
        : '<anonymous>';
    }
  };

  try {
    var rootFibers = [];
    var rendererVersion = null;
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook && hook.renderers && hook.renderers.size > 0) {
      try {
        hook.renderers.forEach(function (r) { if (r && r.version && !rendererVersion) rendererVersion = r.version; });
        if (typeof hook.getFiberRoots === 'function') {
          hook.renderers.forEach(function (_r, id) {
            try {
              hook.getFiberRoots(id).forEach(function (fr) {
                var cur = fr && fr.current ? fr.current : fr;
                if (cur && rootFibers.indexOf(cur) < 0) rootFibers.push(cur);
              });
            } catch (e) {}
          });
        }
      } catch (e) { out.errors.push('react-hook: ' + (e && e.message)); }
    }
    if (!rootFibers.length) {
      var all = document.querySelectorAll('*');
      var looseFiber = null;
      for (var i = 0; i < all.length; i++) {
        var elKeys = Object.keys(all[i]);
        for (var k = 0; k < elKeys.length; k++) {
          var key = elKeys[k];
          if (key.indexOf('__reactContainer$') === 0 && all[i][key]) {
            /* the container key stores the initial HostRoot fiber; after the
               first commit root.current flips to its alternate, leaving this
               one with child === null — resolve the live fiber through
               stateNode (the FiberRoot).current, then alternate */
            var rf = all[i][key];
            var live = rf;
            if (rf.stateNode && rf.stateNode.current) live = rf.stateNode.current;
            else if (!rf.child && rf.alternate && rf.alternate.child) live = rf.alternate;
            if (rootFibers.indexOf(live) < 0) rootFibers.push(live);
          } else if (!looseFiber && key.indexOf('__reactFiber$') === 0 && all[i][key]) {
            looseFiber = all[i][key];
          }
        }
      }
      if (!rootFibers.length && looseFiber) {
        var up = looseFiber;
        while (up.return) up = up.return;
        rootFibers.push(up);
      }
    }

    if (rootFibers.length) {
      var kindOf = function (tag) {
        switch (tag) {
          case 0: return 'fn';
          case 1: return 'class';
          case 2: return 'fn';
          case 11: return 'forwardref';
          case 13: return 'suspense';
          case 14: return 'memo';
          case 15: return 'memo';
          case 16: return 'lazy';
          default: return null;
        }
      };
      var rawName = function (f) {
        if (f.tag === 13) return 'Suspense';
        var t = f.type;
        if (t == null) return null;
        if (typeof t === 'function') return t.displayName || t.name || null;
        if (typeof t === 'object') {
          if (t.displayName) return t.displayName;
          if (typeof t.render === 'function') {
            var rn = t.render.displayName || t.render.name;
            return rn ? 'ForwardRef(' + rn + ')' : null;
          }
          if (t.type) {
            var inner = rawName({ tag: f.tag, type: t.type });
            return inner ? 'Memo(' + inner + ')' : null;
          }
        }
        return null;
      };
      var nodes = [];
      var truncated = false;
      var count = 0;
      var nextId = 0;
      for (var r = 0; r < rootFibers.length; r++) {
        var stack = [{ f: rootFibers[r], d: 0, parent: null, anc: [] }];
        while (stack.length) {
          if (count >= MAXN) { truncated = true; break; }
          var it = stack.pop();
          var f = it.f;
          count++;
          var kind = kindOf(f.tag);
          var d = it.d;
          var parent = it.parent;
          var anc = it.anc;
          if (kind) {
            var node = { id: nextId++, name: rawName(f), depth: it.d, parentId: it.parent, kind: kind, instIdx: insts.push(f) - 1 };
            nodes.push(node);
            d = it.d + 1;
            parent = node.id;
            anc = it.anc.concat(node);
          } else if (f.tag === 5 && f.stateNode && f.stateNode.nodeType === 1) {
            fillHosts(it.anc, f.stateNode);
          }
          if (f.sibling) stack.push({ f: f.sibling, d: it.d, parent: it.parent, anc: it.anc });
          if (f.child) stack.push({ f: f.child, d: d, parent: parent, anc: anc });
        }
      }
      finishNames(nodes);
      out.frameworks.push({
        framework: 'react',
        version: rendererVersion || (window.React && window.React.version) || null,
        nodes: nodes,
        truncated: truncated,
      });
    }
  } catch (e) { out.errors.push('react: ' + (e && e.message)); }

  try {
    var apps = [];
    var all2 = document.querySelectorAll('*');
    for (var j = 0; j < all2.length; j++) {
      if (all2[j].__vue_app__ && apps.indexOf(all2[j].__vue_app__) < 0) apps.push(all2[j].__vue_app__);
    }
    var vhook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if (!apps.length && vhook && vhook.apps && vhook.apps.length) {
      for (var a = 0; a < vhook.apps.length; a++) {
        var rec = vhook.apps[a];
        var vapp = rec && rec.app ? rec.app : rec;
        if (vapp && apps.indexOf(vapp) < 0) apps.push(vapp);
      }
    }
    if (apps.length) {
      var vnodes = [];
      var vcount = 0;
      var vtrunc = false;
      var vid = 0;
      var nameOf = function (inst) {
        var t = inst.type || {};
        var n = t.name || t.__name;
        if (!n && t.__file) n = String(t.__file).split(/[\\\\\\/]/).pop().replace(/\\.\\w+$/, '');
        if (!n && inst.parent && inst.parent.type && inst.parent.type.components) {
          var reg = inst.parent.type.components;
          for (var k1 in reg) if (reg[k1] === t) { n = k1; break; }
        }
        if (!n && inst.appContext && inst.appContext.components) {
          var reg2 = inst.appContext.components;
          for (var k2 in reg2) if (reg2[k2] === t) { n = k2; break; }
        }
        return n || null;
      };
      var visitVnode;
      var visitInstance = function (inst, depth, parent, anc) {
        if (!inst) return;
        if (vcount >= MAXN) { vtrunc = true; return; }
        vcount++;
        var node = { id: vid++, name: nameOf(inst), depth: depth, parentId: parent, kind: 'component', instIdx: insts.push(inst) - 1 };
        vnodes.push(node);
        if (inst.subTree) visitVnode(inst.subTree, depth + 1, node.id, anc.concat(node));
      };
      visitVnode = function (vn, depth, parent, anc) {
        if (!vn || typeof vn !== 'object') return;
        if (vcount >= MAXN) { vtrunc = true; return; }
        if (vn.component) { visitInstance(vn.component, depth, parent, anc); return; }
        vcount++;
        if (vn.el && vn.el.nodeType === 1) fillHosts(anc, vn.el);
        var kids = vn.children;
        if (Array.isArray(kids)) {
          for (var c = 0; c < kids.length; c++) {
            if (kids[c] && typeof kids[c] === 'object') visitVnode(kids[c], depth, parent, anc);
          }
        }
        if (vn.suspense && vn.suspense.activeBranch) visitVnode(vn.suspense.activeBranch, depth, parent, anc);
      };
      for (var ai = 0; ai < apps.length; ai++) {
        /* prod builds compile app._instance out (dev/devtools-flag only);
           the container's patched root vnode still links to the instance */
        var instRoot = apps[ai]._instance || null;
        if (!instRoot) {
          var cont = apps[ai]._container;
          if (cont && cont._vnode && cont._vnode.component) instRoot = cont._vnode.component;
        }
        if (instRoot) visitInstance(instRoot, 0, null, []);
      }
      finishNames(vnodes);
      out.frameworks.push({
        framework: 'vue',
        version: apps[0].version || null,
        nodes: vnodes,
        truncated: vtrunc,
      });
    }
  } catch (e2) { out.errors.push('vue: ' + (e2 && e2.message)); }

  return out;
})()`;
}

export function buildFrameworkHostScript(hostIdx: number): string {
  return `(window[${JSON.stringify(FRAMEWORK_HOSTS_KEY)}] || [])[${Math.max(0, Math.floor(hostIdx))}] || null`;
}

export function buildFrameworkInspectScript(framework: 'react' | 'vue', instIdx: number): string {
  const pick = `(window[${JSON.stringify(FRAMEWORK_INSTANCES_KEY)}] || [])[${Math.max(0, Math.floor(instIdx))}]`;
  if (framework === 'vue') {
    return `(function () {
  var inst = ${pick};
  if (!inst || typeof inst !== 'object' || !inst.type || inst.isUnmounted) return null;
  var hasKeys = function (o) { if (o == null || typeof o !== 'object') return false; for (var k in o) return true; return false; };
  var out = {};
  if (hasKeys(inst.props)) out.props = inst.props;
  if (hasKeys(inst.setupState)) out.setup = inst.setupState;
  if (hasKeys(inst.data)) out.data = inst.data;
  return out;
})()`;
  }
  return `(function () {
  var f = ${pick};
  if (!f || typeof f.tag !== 'number') return null;
  /* the stashed fiber may be the retired half of React's double buffer;
     re-resolve through HostRoot.current/alternate on every read */
  var top = f;
  while (top.return) top = top.return;
  if (top.tag !== 3) return null;
  var root = top.stateNode;
  if (root && root.current && root.current !== top && f.alternate) f = f.alternate;
  var hasKeys = function (o) { if (o == null || typeof o !== 'object') return false; for (var k in o) return true; return false; };
  var out = {};
  if (hasKeys(f.memoizedProps)) out.props = f.memoizedProps;
  if (f.tag === 1) {
    if (f.stateNode && hasKeys(f.stateNode.state)) out.state = f.stateNode.state;
  } else if (f.memoizedState !== null && f.memoizedState !== undefined) {
    var hooks = [];
    var h = f.memoizedState;
    while (h && typeof h === 'object' && 'memoizedState' in h && 'next' in h && hooks.length < ${FRAMEWORK_HOOKS_CAP}) {
      hooks.push(h.memoizedState);
      h = h.next;
    }
    if (hooks.length) out.hooks = hooks;
  }
  return out;
})()`;
}

const KINDS: ReadonlySet<string> = new Set(['fn', 'class', 'forwardref', 'memo', 'lazy', 'suspense', 'component']);

function parseNode(raw: unknown): FrameworkNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'number' || typeof n.name !== 'string' || typeof n.depth !== 'number') return null;
  if (n.parentId !== null && typeof n.parentId !== 'number') return null;
  if (typeof n.kind !== 'string' || !KINDS.has(n.kind)) return null;
  const node: FrameworkNode = {
    id: n.id,
    name: n.name,
    depth: n.depth,
    parentId: n.parentId as number | null,
    kind: n.kind as FrameworkKind,
  };
  if (typeof n.hostIdx === 'number') node.hostIdx = n.hostIdx;
  if (typeof n.instIdx === 'number') node.instIdx = n.instIdx;
  return node;
}

export function parseFrameworkScan(raw: unknown): FrameworkScanResult {
  const out: FrameworkScanResult = { frameworks: [], errors: [] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.errors)) out.errors = r.errors.filter((e): e is string => typeof e === 'string');
  if (!Array.isArray(r.frameworks)) return out;
  for (const f of r.frameworks) {
    if (!f || typeof f !== 'object') continue;
    const fw = f as Record<string, unknown>;
    if (fw.framework !== 'react' && fw.framework !== 'vue') continue;
    if (!Array.isArray(fw.nodes)) continue;
    const info: FrameworkInfo = {
      framework: fw.framework,
      nodes: fw.nodes.map(parseNode).filter((n): n is FrameworkNode => n !== null),
      truncated: fw.truncated === true,
    };
    if (typeof fw.version === 'string' && fw.version) info.version = fw.version;
    out.frameworks.push(info);
  }
  return out;
}

const MINIFIED_MIN_SAMPLE = 5;

export function reactNamesMinified(info: FrameworkInfo): boolean {
  if (info.framework !== 'react') return false;
  const names = info.nodes.filter(n => !n.name.startsWith('<') && !n.name.startsWith('Memo(') && n.name !== 'Suspense');
  if (names.length < MINIFIED_MIN_SAMPLE) return false;
  const short = names.filter(n => n.name.length <= 2).length;
  return short / names.length >= 0.5;
}
