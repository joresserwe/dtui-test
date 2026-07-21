import { basename } from 'node:path';
import type { DebugSession } from '../engine.js';
import type { NetworkEntry } from '../store/types.js';
import { persistableConsoleEntry } from '../store/console.js';
import { urlSlug } from '../persist/session.js';
import { captureElementShot, collectElementData } from '../tui/lib/handoff.js';
import { loadSessionAudit } from '../audit/store.js';
import { listRecordings, loadRecording, recordingsDir } from '../store/recording.js';
import type { Lhr } from '../audit/types.js';
import type { AuditRunParams, RecorderReplayResult } from './source.js';
import type { HostDelegate, StrippedNetworkEntry } from './host.js';

export interface LiveSessionView {
  session: DebugSession;
  title: string;
  fallbackId: string;
  openedAt: number;
}

export interface ElementSelection {
  nodeId: number;
  selector: string;
}

export interface DelegateDeps {
  sessions(): LiveSessionView[];
  activeSession(): DebugSession | null;
  selection(): ElementSelection | null;
  latestLhr?(session: DebugSession): Lhr | null;
  runAudit?(session: DebugSession, opts: { preset?: string; categories?: string[] }): Promise<Lhr>;
  recordingsDir?(): string;
}

export interface LiveBridge {
  setDelegate(d: HostDelegate | null): void;
}

function sessionId(v: LiveSessionView): string {
  return v.session.sessionDir ? basename(v.session.sessionDir) : v.fallbackId;
}

function withoutBodies(e: NetworkEntry): StrippedNetworkEntry {
  const { body, bodyBase64, bodyTruncated, postData, wsFrames, ...rest } = e;
  return rest;
}

export function buildHostDelegate(deps: DelegateDeps): HostDelegate {
  const find = (id: string): LiveSessionView => {
    const v = deps.sessions().find(x => sessionId(x) === id || x.fallbackId === id);
    if (!v) throw new Error(`unknown session: ${id}`);
    return v;
  };
  const active = (): DebugSession => {
    const s = deps.activeSession();
    if (!s) throw new Error('no attached session in the TUI');
    return s;
  };
  const selection = (): ElementSelection => {
    const sel = deps.selection();
    if (!sel) throw new Error('no element selected in the TUI — select a node in the Elements tab');
    return sel;
  };
  return {
    listSessions: () =>
      deps.sessions()
        .slice()
        .sort((a, b) => b.openedAt - a.openedAt)
        .map(v => ({
          id: sessionId(v),
          startedAt: new Date(v.openedAt).toISOString(),
          urlSlug: v.session.sessionDir ? urlSlug(v.session.url || '') : '',
          path: v.session.sessionDir ?? '',
          networkCount: v.session.network.size,
          consoleCount: v.session.console.entries().length,
        })),
    readNetwork: id => find(id).session.network.entries().map(withoutBodies),
    readRequest: (session, id) => find(session).session.network.entries().find(e => e.id === id),
    readConsole: id => find(id).session.console.entries().map(persistableConsoleEntry),
    listTabs: () => deps.sessions().map(v => ({ id: sessionId(v), url: v.session.url, title: v.title })),
    selectedElement: () => {
      const sel = selection();
      return collectElementData(active(), sel.nodeId, sel.selector);
    },
    screenshot: async (target, session) => {
      if (target === 'element') {
        const sel = selection();
        const data = await captureElementShot(active(), sel.nodeId);
        if (!data) throw new Error('element capture failed — the node has no box model (display:none?)');
        return { data, mimeType: 'image/png' };
      }
      const s = session !== undefined ? find(session).session : active();
      const data = await s.screenshot();
      if (!data) throw new Error('screenshot failed');
      return { data, mimeType: 'image/png' };
    },
    readAudit: (session, name) => {
      const v = find(session);
      if (name === undefined) {
        const mem = deps.latestLhr?.(v.session);
        if (mem) return mem;
      }
      if (!v.session.sessionDir) return undefined;
      return loadSessionAudit(v.session.sessionDir, name);
    },
    auditRun: (args: AuditRunParams) => {
      if (!deps.runAudit) throw new Error('audit_run is not available in this mode — use the interactive TUI');
      const target = args.session !== undefined ? find(args.session).session : deps.activeSession();
      if (!target) throw new Error('no attached session in the TUI');
      return deps.runAudit(target, { preset: args.preset, categories: args.categories });
    },
    recorderReplay: async (name: string, timeoutMs?: number): Promise<RecorderReplayResult> => {
      const dir = deps.recordingsDir ? deps.recordingsDir() : recordingsDir();
      const meta = listRecordings(dir).find(m => m.name === name);
      if (!meta) throw new Error(`unknown recording: ${name} (from recorder_list)`);
      const rec = loadRecording(dir, meta.file);
      if (!rec) throw new Error(`recording could not be loaded: ${name}`);
      const failure = await active().replayRecording(rec.steps, { stepTimeoutMs: timeoutMs });
      return {
        ok: failure === null,
        steps: rec.steps.length,
        failure: failure
          ? { stepIndex: failure.stepIndex, kind: failure.kind, selector: failure.selector, reason: failure.reason }
          : undefined,
      };
    },
  };
}
