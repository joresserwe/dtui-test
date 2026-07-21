import type { CdpConnection } from './connection.js';

export interface NodeInfo {
  nodeId: number;
  nodeName: string;
  attributes: Record<string, string>;
  parentId?: number;
  childIds: number[];
  label: string;
  isElement: boolean;
  hasUnloadedChildren?: boolean;
}

export type NodeMap = Map<number, NodeInfo>;

function foldAttributes(attrs: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < attrs.length; i += 2) out[attrs[i]] = attrs[i + 1];
  return out;
}

function labelFor(name: string, attrs: Record<string, string>): string {
  const id = attrs.id ? `#${attrs.id}` : '';
  const cls = attrs.class ? '.' + attrs.class.trim().split(/\s+/).join('.') : '';
  return `${name}${id}${cls}`;
}

export function nodeLabel(nodeName: string, attrs: string[] = []): string {
  return labelFor(String(nodeName).toLowerCase(), foldAttributes(attrs));
}

function walkNode(map: NodeMap, node: any, parentId?: number): void {
  const name = String(node.nodeName).toLowerCase();
  const attributes = foldAttributes(node.attributes);
  const children = node.children as any[] | undefined;
  map.set(node.nodeId, {
    nodeId: node.nodeId,
    nodeName: name,
    attributes,
    parentId,
    childIds: (children ?? []).map((c: any) => c.nodeId),
    label: labelFor(name, attributes),
    isElement: node.nodeType === 1,
    hasUnloadedChildren: children === undefined && (node.childNodeCount ?? 0) > 0,
  });
  for (const child of children ?? []) walkNode(map, child, node.nodeId);
}

export async function getDomTree(conn: CdpConnection, depth = -1): Promise<NodeMap> {
  const { root } = await conn.send<{ root: any }>('DOM.getDocument', { depth });
  const map: NodeMap = new Map();
  walkNode(map, root);
  return map;
}

export function applyChildNodes(map: NodeMap, parentId: number, nodes: any[]): NodeMap {
  const parent = map.get(parentId);
  if (!parent) return map;
  const next: NodeMap = new Map(map);
  const drop = (id: number): void => {
    const info = next.get(id);
    if (!info) return;
    next.delete(id);
    for (const c of info.childIds) drop(c);
  };
  for (const c of parent.childIds) drop(c);
  for (const node of nodes) walkNode(next, node, parentId);
  next.set(parentId, { ...parent, childIds: nodes.map((n: any) => n.nodeId), hasUnloadedChildren: false });
  return next;
}

export function mapDepth(map: NodeMap): number {
  let max = 0;
  for (const info of map.values()) {
    let d = 0;
    let p = info.parentId;
    while (p !== undefined) {
      d++;
      p = map.get(p)?.parentId;
    }
    if (d > max) max = d;
  }
  return max;
}

export interface ExpandPlan {
  expandIds: number[];
  loadIds: number[];
  truncated: boolean;
}

export function expandTargets(map: NodeMap, rootId: number, maxDepth: number, maxNodes: number): ExpandPlan {
  const expandIds: number[] = [];
  const loadIds: number[] = [];
  let truncated = false;
  let frontier: number[] = [rootId];
  let seen = 0;
  for (let depth = 0; depth < maxDepth && frontier.length && !truncated; depth++) {
    const nextFrontier: number[] = [];
    for (const id of frontier) {
      const info = map.get(id);
      if (!info) continue;
      if (info.hasUnloadedChildren) {
        loadIds.push(id);
        expandIds.push(id);
        continue;
      }
      const kids = info.childIds.filter(k => map.get(k)?.isElement);
      if (!kids.length) continue;
      expandIds.push(id);
      for (const k of kids) {
        if (++seen > maxNodes) {
          truncated = true;
          break;
        }
        nextFrontier.push(k);
      }
      if (truncated) break;
    }
    frontier = nextFrontier;
  }
  if (!truncated && frontier.some(id => {
    const info = map.get(id);
    return !!info && (info.hasUnloadedChildren || info.childIds.some(k => map.get(k)?.isElement));
  })) truncated = true;
  return { expandIds, loadIds, truncated };
}

export function descendantIds(map: NodeMap, rootId: number): number[] {
  const out: number[] = [];
  const visit = (id: number): void => {
    for (const c of map.get(id)?.childIds ?? []) {
      if (!map.has(c)) continue;
      out.push(c);
      visit(c);
    }
  };
  visit(rootId);
  return out;
}

function elementChildren(map: NodeMap, id: number): number[] {
  return (map.get(id)?.childIds ?? []).filter(k => map.get(k)?.isElement);
}

function elementParent(map: NodeMap, id: number): number | undefined {
  let p = map.get(id)?.parentId;
  while (p !== undefined && !map.get(p)?.isElement) p = map.get(p)?.parentId;
  return p;
}

function elementRoots(map: NodeMap): number[] {
  const roots: number[] = [];
  for (const [id, info] of map) {
    if (info.isElement && elementParent(map, id) === undefined) roots.push(id);
  }
  return roots;
}

export function elementPath(map: NodeMap, id: number): number[] | null {
  const path: number[] = [];
  let cur = id;
  while (true) {
    if (!map.get(cur)?.isElement) return null;
    const parent = elementParent(map, cur);
    const siblings = parent === undefined ? elementRoots(map) : elementChildren(map, parent);
    const idx = siblings.indexOf(cur);
    if (idx < 0) return null;
    path.unshift(idx);
    if (parent === undefined) return path;
    cur = parent;
  }
}

export function resolveElementPath(map: NodeMap, path: number[]): number | null {
  let list = elementRoots(map);
  let cur: number | null = null;
  for (const idx of path) {
    cur = list[idx] ?? null;
    if (cur === null) return null;
    list = elementChildren(map, cur);
  }
  return cur;
}

export function parentOf(map: NodeMap, id: number): number | null {
  const p = map.get(id)?.parentId;
  return p === undefined ? null : p;
}

export function firstChildOf(map: NodeMap, id: number): number | null {
  const kids = map.get(id)?.childIds ?? [];
  const el = kids.find(k => map.get(k)?.isElement);
  return el ?? null;
}

export function siblingOf(map: NodeMap, id: number, dir: 'prev' | 'next'): number | null {
  const parentId = map.get(id)?.parentId;
  if (parentId === undefined) return null;
  const kids = map.get(parentId)?.childIds ?? [];
  const idx = kids.indexOf(id);
  if (idx < 0) return null;
  const step = dir === 'next' ? 1 : -1;
  for (let i = idx + step; i >= 0 && i < kids.length; i += step) {
    if (map.get(kids[i])?.isElement) return kids[i];
  }
  return null;
}
