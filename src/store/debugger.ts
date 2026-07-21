import { EventEmitter } from 'node:events';

export type PauseState = 'none' | 'uncaught' | 'all';

export interface ScriptInfo {
  scriptId: string;
  url: string;
  endLine: number;
  sourceMapURL?: string;
}

export interface ScopeView {
  type: string;
  name?: string;
  objectId?: string;
  description?: string;
}

export interface FrameView {
  callFrameId: string;
  functionName: string;
  scriptId: string;
  url: string;
  line: number;
  column: number;
  scopes: ScopeView[];
}

export interface PausedView {
  reason: string;
  frames: FrameView[];
  hitBreakpoints: string[];
  exceptionText?: string;
  detail?: string;
}

export type BreakpointKind = 'line' | 'condition' | 'logpoint';

export type DomBreakpointType = 'subtree-modified' | 'attribute-modified' | 'node-removed';

export interface BreakpointView {
  id: string;
  url: string;
  line: number;
  kind: BreakpointKind;
  condition?: string;
  resolved?: { scriptId: string; line: number };
}

export interface BreakpointSpec {
  url: string;
  line: number;
  kind?: BreakpointKind;
  condition?: string;
}

export interface DomBreakpointView {
  nodeId: number;
  selector: string;
  type: DomBreakpointType;
}

export interface DomBreakpointSpec {
  selector: string;
  type: DomBreakpointType;
}

export interface DebugPersistState {
  enabled: boolean;
  pauseOnExceptions: PauseState;
  breakpoints: BreakpointSpec[];
  blackboxed: string[];
  xhrBreakpoints: string[];
  eventBreakpoints: string[];
  domBreakpoints: DomBreakpointSpec[];
}

export const emptyDebugState = (): DebugPersistState => ({
  enabled: false,
  pauseOnExceptions: 'none',
  breakpoints: [],
  blackboxed: [],
  xhrBreakpoints: [],
  eventBreakpoints: [],
  domBreakpoints: [],
});

export function logpointCondition(template: string): string {
  let out = '';
  let rest = template;
  for (;;) {
    const m = /\{([^{}]+)\}/.exec(rest);
    const literal = m ? rest.slice(0, m.index) : rest;
    out += literal.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    if (!m) break;
    out += `\${${m[1]}}`;
    rest = rest.slice(m.index + m[0].length);
  }
  return `console.log(\`${out}\`), false`;
}

function pausedDetail(reason: string, data: any): string | undefined {
  if (!data) return undefined;
  if (reason === 'XHR') return typeof data.url === 'string' ? data.url : undefined;
  if (reason === 'DOM') return typeof data.type === 'string' ? data.type : undefined;
  if (reason === 'EventListener') {
    const name = typeof data.eventName === 'string' ? data.eventName : undefined;
    return name?.replace(/^listener:/, '');
  }
  return undefined;
}

// Observed live: chrome-headless-shell emits paused callFrames with an empty
// `url`, so the frame URL must come from the scriptParsed catalog.
function toFrame(raw: any, urlOf: (scriptId: string) => string | undefined): FrameView {
  const scriptId = raw.location?.scriptId ?? '';
  return {
    callFrameId: raw.callFrameId,
    functionName: raw.functionName ?? '',
    scriptId,
    url: raw.url || urlOf(scriptId) || '',
    line: raw.location?.lineNumber ?? 0,
    column: raw.location?.columnNumber ?? 0,
    scopes: (raw.scopeChain ?? []).map((s: any): ScopeView => ({
      type: s.type,
      ...(s.name !== undefined ? { name: s.name } : {}),
      ...(s.object?.objectId !== undefined ? { objectId: s.object.objectId } : {}),
      ...(s.object?.description !== undefined ? { description: s.object.description } : {}),
    })),
  };
}

export class DebuggerStore extends EventEmitter {
  private scriptMap = new Map<string, ScriptInfo>();
  private bps = new Map<string, BreakpointView>();
  private bbox = new Set<string>();
  private xhrBps: string[] = [];
  private eventBps = new Set<string>();
  private domBps = new Map<string, DomBreakpointView>();
  paused: PausedView | null = null;
  pauseOnExceptions: PauseState = 'none';

  handleEvent(method: string, params: any): void {
    if (method === 'Debugger.scriptParsed') {
      this.scriptMap.set(params.scriptId, {
        scriptId: params.scriptId,
        url: params.url ?? '',
        endLine: params.endLine ?? 0,
        ...(params.sourceMapURL ? { sourceMapURL: params.sourceMapURL } : {}),
      });
      this.emit('update');
    } else if (method === 'Debugger.paused') {
      const reason = params.reason ?? 'other';
      const detail = pausedDetail(reason, params.data);
      this.paused = {
        reason,
        frames: (params.callFrames ?? []).map((f: any) => toFrame(f, id => this.scriptMap.get(id)?.url)),
        hitBreakpoints: params.hitBreakpoints ?? [],
        ...(reason === 'exception' && params.data
          ? { exceptionText: params.data.description ?? params.data.value ?? undefined }
          : {}),
        ...(detail !== undefined ? { detail } : {}),
      };
      this.emit('paused', this.paused);
      this.emit('update');
    } else if (method === 'Debugger.resumed') {
      this.paused = null;
      this.emit('resumed');
      this.emit('update');
    } else if (method === 'Debugger.breakpointResolved') {
      const bp = this.bps.get(params.breakpointId);
      const loc = params.location;
      if (bp && loc) {
        bp.resolved = { scriptId: loc.scriptId, line: loc.lineNumber ?? 0 };
        this.emit('update');
      }
    }
  }

  scripts(): ScriptInfo[] {
    return [...this.scriptMap.values()];
  }

  scriptById(scriptId: string): ScriptInfo | undefined {
    return this.scriptMap.get(scriptId);
  }

  clearScripts(): void {
    const wasPaused = this.paused !== null;
    this.scriptMap.clear();
    this.paused = null;
    this.domBps.clear();
    if (wasPaused) this.emit('resumed');
    this.emit('update');
  }

  addBreakpoint(
    id: string,
    url: string,
    line: number,
    locations: Array<{ scriptId: string; lineNumber: number }>,
    kind: BreakpointKind = 'line',
    condition?: string,
  ): BreakpointView {
    const bp: BreakpointView = {
      id,
      url,
      line,
      kind,
      ...(condition !== undefined ? { condition } : {}),
      ...(locations[0] ? { resolved: { scriptId: locations[0].scriptId, line: locations[0].lineNumber } } : {}),
    };
    this.bps.set(id, bp);
    this.emit('update');
    return bp;
  }

  removeBreakpoint(id: string): void {
    if (this.bps.delete(id)) this.emit('update');
  }

  breakpoints(): BreakpointView[] {
    return [...this.bps.values()];
  }

  breakpointAt(url: string, line: number): BreakpointView | undefined {
    return this.breakpoints().find(bp => bp.url === url && (bp.resolved?.line ?? bp.line) === line);
  }

  breakpointSpecs(): BreakpointSpec[] {
    return this.breakpoints().map(bp => ({
      url: bp.url,
      line: bp.line,
      ...(bp.kind !== 'line' ? { kind: bp.kind } : {}),
      ...(bp.condition !== undefined ? { condition: bp.condition } : {}),
    }));
  }

  setPauseOnExceptions(state: PauseState): void {
    this.pauseOnExceptions = state;
    this.emit('update');
  }

  blackboxedUrls(): string[] {
    return [...this.bbox];
  }

  isBlackboxed(url: string): boolean {
    return this.bbox.has(url);
  }

  setBlackboxedUrls(urls: string[]): void {
    this.bbox = new Set(urls);
    this.emit('update');
  }

  xhrBreakpoints(): string[] {
    return [...this.xhrBps];
  }

  addXhrBreakpoint(url: string): void {
    if (this.xhrBps.includes(url)) return;
    this.xhrBps.push(url);
    this.emit('update');
  }

  removeXhrBreakpoint(url: string): void {
    const idx = this.xhrBps.indexOf(url);
    if (idx < 0) return;
    this.xhrBps.splice(idx, 1);
    this.emit('update');
  }

  eventBreakpoints(): string[] {
    return [...this.eventBps];
  }

  setEventBreakpoint(name: string, on: boolean): void {
    if (on) this.eventBps.add(name);
    else this.eventBps.delete(name);
    this.emit('update');
  }

  domBreakpoints(): DomBreakpointView[] {
    return [...this.domBps.values()];
  }

  domBreakpointsFor(nodeId: number): DomBreakpointType[] {
    return this.domBreakpoints().filter(d => d.nodeId === nodeId).map(d => d.type);
  }

  addDomBreakpoint(view: DomBreakpointView): void {
    this.domBps.set(`${view.nodeId}:${view.type}`, view);
    this.emit('update');
  }

  removeDomBreakpoint(nodeId: number, type: DomBreakpointType): void {
    if (this.domBps.delete(`${nodeId}:${type}`)) this.emit('update');
  }

  persistState(enabled: boolean): DebugPersistState {
    return {
      enabled,
      pauseOnExceptions: this.pauseOnExceptions,
      breakpoints: this.breakpointSpecs(),
      blackboxed: this.blackboxedUrls(),
      xhrBreakpoints: this.xhrBreakpoints(),
      eventBreakpoints: this.eventBreakpoints(),
      domBreakpoints: this.domBreakpoints().map(d => ({ selector: d.selector, type: d.type })),
    };
  }
}
