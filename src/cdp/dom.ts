import type { CdpConnection } from './connection.js';

export interface BoxModel {
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

async function documentRoot(conn: CdpConnection): Promise<number> {
  const { root } = await conn.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
  return root.nodeId;
}

export async function querySelector(conn: CdpConnection, selector: string): Promise<number | null> {
  const root = await documentRoot(conn);
  const { nodeId } = await conn.send<{ nodeId: number }>('DOM.querySelector', { nodeId: root, selector });
  return nodeId === 0 ? null : nodeId;
}

export async function getOuterHTML(conn: CdpConnection, nodeId: number): Promise<string> {
  const { outerHTML } = await conn.send<{ outerHTML: string }>('DOM.getOuterHTML', { nodeId });
  return outerHTML;
}

export async function setOuterHTML(conn: CdpConnection, nodeId: number, html: string): Promise<void> {
  await conn.send('DOM.setOuterHTML', { nodeId, outerHTML: html });
}

export async function setAttributesAsText(conn: CdpConnection, nodeId: number, text: string): Promise<void> {
  await conn.send('DOM.setAttributesAsText', { nodeId, text });
}

export async function setAttributeValue(conn: CdpConnection, nodeId: number, name: string, value: string): Promise<void> {
  await conn.send('DOM.setAttributeValue', { nodeId, name, value });
}

export async function removeAttribute(conn: CdpConnection, nodeId: number, name: string): Promise<void> {
  await conn.send('DOM.removeAttribute', { nodeId, name });
}

export const HIDE_CLASS = '__devtools-tui-hide__';

export function toggleClassToken(classAttr: string | undefined, token: string): { value: string; on: boolean } {
  const classes = (classAttr ?? '').split(/\s+/).filter(Boolean);
  const idx = classes.indexOf(token);
  const on = idx < 0;
  if (on) classes.push(token);
  else classes.splice(idx, 1);
  return { value: classes.join(' '), on };
}

export function stripHideClass(label: string): string {
  return label.replace(`.${HIDE_CLASS}`, '');
}

export async function getAttributes(conn: CdpConnection, nodeId: number): Promise<Record<string, string>> {
  const { attributes } = await conn.send<{ attributes?: string[] }>('DOM.getAttributes', { nodeId });
  const list = attributes ?? [];
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < list.length; i += 2) out[list[i]] = list[i + 1];
  return out;
}

export async function removeNode(conn: CdpConnection, nodeId: number): Promise<void> {
  await conn.send('DOM.removeNode', { nodeId });
}

export async function copyTo(conn: CdpConnection, nodeId: number, targetNodeId: number, insertBeforeNodeId?: number): Promise<number> {
  const { nodeId: newId } = await conn.send<{ nodeId: number }>('DOM.copyTo', {
    nodeId,
    targetNodeId,
    ...(insertBeforeNodeId !== undefined ? { insertBeforeNodeId } : {}),
  });
  return newId;
}

export async function getBoxModel(conn: CdpConnection, nodeId: number): Promise<BoxModel | null> {
  try {
    const { model } = await conn.send<{ model: BoxModel }>('DOM.getBoxModel', { nodeId });
    return model;
  } catch {
    return null;
  }
}

const HIGHLIGHT_CONFIG = {
  showInfo: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
};

export async function highlightNode(conn: CdpConnection, nodeId: number): Promise<void> {
  await conn.send('Overlay.enable');
  await conn.send('Overlay.highlightNode', { highlightConfig: HIGHLIGHT_CONFIG, nodeId });
}

export async function hideHighlight(conn: CdpConnection): Promise<void> {
  await conn.send('Overlay.hideHighlight');
}

export async function enableDomMutations(conn: CdpConnection): Promise<void> {
  await conn.send('DOM.enable');
}

export interface DomSearch {
  searchId: string;
  resultCount: number;
}

// DOM.getDocument invalidates every nodeId the agent handed out earlier, so it
// must not run before a search against an already-loaded tree; it is only a
// fallback for when no document has been requested yet.
export async function performSearch(conn: CdpConnection, query: string): Promise<DomSearch> {
  const params = { query, includeUserAgentShadowDOM: false };
  try {
    return await conn.send<DomSearch>('DOM.performSearch', params);
  } catch {
    await documentRoot(conn);
    return conn.send<DomSearch>('DOM.performSearch', params);
  }
}

export async function getSearchResults(conn: CdpConnection, searchId: string, fromIndex: number, toIndex: number): Promise<number[]> {
  const { nodeIds } = await conn.send<{ nodeIds?: number[] }>('DOM.getSearchResults', { searchId, fromIndex, toIndex });
  return nodeIds ?? [];
}

export async function discardSearchResults(conn: CdpConnection, searchId: string): Promise<void> {
  await conn.send('DOM.discardSearchResults', { searchId });
}

export async function setInspectMode(conn: CdpConnection, on: boolean): Promise<void> {
  await conn.send('DOM.enable');
  await conn.send('Overlay.enable');
  await conn.send('Overlay.setInspectMode', {
    mode: on ? 'searchForNode' : 'none',
    highlightConfig: HIGHLIGHT_CONFIG,
  });
}

export async function requestChildNodes(conn: CdpConnection, nodeId: number, depth = 1): Promise<void> {
  await conn.send('DOM.requestChildNodes', { nodeId, depth });
}

export async function scrollIntoViewIfNeeded(conn: CdpConnection, nodeId: number): Promise<void> {
  await conn.send('DOM.scrollIntoViewIfNeeded', { nodeId });
}

export async function requestNode(conn: CdpConnection, objectId: string): Promise<number | null> {
  const { nodeId } = await conn.send<{ nodeId: number }>('DOM.requestNode', { objectId });
  return nodeId === 0 ? null : nodeId;
}

export async function requestNodeEnsured(conn: CdpConnection, objectId: string): Promise<number | null> {
  try {
    const nodeId = await requestNode(conn, objectId);
    if (nodeId !== null) return nodeId;
  } catch {}
  await documentRoot(conn);
  return requestNode(conn, objectId);
}

export async function pushNodeByBackendId(conn: CdpConnection, backendNodeId: number): Promise<number | null> {
  const { nodeIds } = await conn.send<{ nodeIds?: number[] }>('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] });
  const id = nodeIds?.[0] ?? 0;
  return id === 0 ? null : id;
}

const LAYOUT_LINE_COLOR = { r: 127, g: 32, b: 210, a: 0.8 };
const LAYOUT_GAP_COLOR = { r: 127, g: 32, b: 210, a: 0.3 };

const GRID_OVERLAY_CONFIG = {
  showGridExtensionLines: true,
  rowLineColor: LAYOUT_LINE_COLOR,
  columnLineColor: LAYOUT_LINE_COLOR,
  rowLineDash: true,
  columnLineDash: true,
  rowGapColor: LAYOUT_GAP_COLOR,
  columnGapColor: LAYOUT_GAP_COLOR,
};

const FLEX_OVERLAY_CONFIG = {
  containerBorder: { color: LAYOUT_LINE_COLOR, pattern: 'dashed' },
  itemSeparator: { color: LAYOUT_LINE_COLOR, pattern: 'dotted' },
};

export async function setShowGridOverlays(conn: CdpConnection, nodeIds: number[]): Promise<void> {
  await conn.send('Overlay.enable');
  await conn.send('Overlay.setShowGridOverlays', {
    gridNodeHighlightConfigs: nodeIds.map(nodeId => ({ nodeId, gridHighlightConfig: GRID_OVERLAY_CONFIG })),
  });
}

export async function setShowFlexOverlays(conn: CdpConnection, nodeIds: number[]): Promise<void> {
  await conn.send('Overlay.enable');
  await conn.send('Overlay.setShowFlexOverlays', {
    flexNodeHighlightConfigs: nodeIds.map(nodeId => ({ nodeId, flexContainerHighlightConfig: FLEX_OVERLAY_CONFIG })),
  });
}

export interface EventListenerView {
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  scriptId?: string;
  lineNumber?: number;
  columnNumber?: number;
  handler?: string;
}

export async function getEventListeners(conn: CdpConnection, nodeId: number): Promise<EventListenerView[]> {
  const { object } = await conn.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { nodeId, objectGroup: 'dtui-listeners' });
  const objectId = object?.objectId;
  if (!objectId) return [];
  try {
    const { listeners } = await conn.send<{ listeners?: Array<Record<string, any>> }>('DOMDebugger.getEventListeners', { objectId });
    return (listeners ?? []).map(l => ({
      type: String(l.type ?? ''),
      useCapture: !!l.useCapture,
      passive: !!l.passive,
      once: !!l.once,
      scriptId: l.scriptId,
      lineNumber: l.lineNumber,
      columnNumber: l.columnNumber,
      handler: typeof l.handler?.description === 'string' ? l.handler.description.split('\n')[0] : undefined,
    }));
  } finally {
    void conn.send('Runtime.releaseObjectGroup', { objectGroup: 'dtui-listeners' }).catch(() => {});
  }
}

// Feeds the command-line API's $0 in Runtime.evaluate.
export async function setInspectedNode(conn: CdpConnection, nodeId: number): Promise<void> {
  await conn.send('DOM.setInspectedNode', { nodeId });
}

export type DomBreakpointType = 'subtree-modified' | 'attribute-modified' | 'node-removed';

export async function setDOMBreakpoint(conn: CdpConnection, nodeId: number, type: DomBreakpointType): Promise<void> {
  await conn.send('DOMDebugger.setDOMBreakpoint', { nodeId, type });
}

export async function removeDOMBreakpoint(conn: CdpConnection, nodeId: number, type: DomBreakpointType): Promise<void> {
  await conn.send('DOMDebugger.removeDOMBreakpoint', { nodeId, type });
}

export async function setXHRBreakpoint(conn: CdpConnection, url: string): Promise<void> {
  await conn.send('DOMDebugger.setXHRBreakpoint', { url });
}

export async function removeXHRBreakpoint(conn: CdpConnection, url: string): Promise<void> {
  await conn.send('DOMDebugger.removeXHRBreakpoint', { url });
}

export async function setEventListenerBreakpoint(conn: CdpConnection, eventName: string): Promise<void> {
  await conn.send('DOMDebugger.setEventListenerBreakpoint', { eventName });
}

export async function removeEventListenerBreakpoint(conn: CdpConnection, eventName: string): Promise<void> {
  await conn.send('DOMDebugger.removeEventListenerBreakpoint', { eventName });
}
