import type { PageTarget } from '../../cdp/targets.js';
import type { DebugSession } from '../../engine.js';
import type { NetworkEntry } from '../../store/types.js';
import type { SnapshotDeps } from '../../persist/snapshot.js';
import { buildHar } from '../../persist/har.js';

export const INTERESTING_STYLES = ['display', 'position', 'color', 'background-color', 'font-size', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width', 'height'];

export function buildSnapshotDeps(session: DebugSession, browser: string): SnapshotDeps {
  const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  return {
    url: session.url,
    origin: session.origin,
    cookies: () => session.cookies(),
    local: () => session.storageItems(true),
    session: () => session.storageItems(false),
    dom: () => session.domHtml(),
    screenshotBase64: () => session.screenshot(),
    networkHar: () => buildHar(session.network.entries(), { browser, bodyCap: session.bodyCap, sanitize: session.harSanitize }),
    networkJsonl: () => jsonl(session.network.entries()),
    consoleJsonl: () => jsonl(session.console.entries()),
  };
}

export function buildContext(target: PageTarget, session: DebugSession, selected?: NetworkEntry): string {
  const lines = ['# devtools-tui context', `tab: ${target.title} (${target.url})`];
  if (session.sessionDir) lines.push(`session: ${session.sessionDir}`);
  if (selected) {
    lines.push('', '## selected request', `${selected.method} ${selected.url}`);
    lines.push(`status: ${selected.error ?? selected.status ?? 'pending'}  time: ${selected.durationMs !== undefined ? `${Math.round(selected.durationMs)}ms` : '-'}`);
    if (selected.body) lines.push('```', selected.body.slice(0, 500), '```');
  }
  const errors = session.console.entries().filter(e => e.kind === 'error' || e.kind === 'exception').slice(-5);
  if (errors.length) {
    lines.push('', '## recent console errors');
    for (const e of errors) lines.push(`- ${e.text.split('\n')[0]}`);
  }
  return lines.join('\n');
}

let activeQuit: (() => void) | null = null;
let signalsHooked = false;
function ensureSignalFlush(): void {
  if (signalsHooked) return;
  signalsHooked = true;
  const onSignal = (signal: NodeJS.Signals) => {
    process.exitCode = signal === 'SIGTERM' ? 143 : 130;
    const q = activeQuit;
    activeQuit = null;
    q?.();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

export function registerQuit(quit: () => void): () => void {
  activeQuit = quit;
  ensureSignalFlush();
  return () => {
    if (activeQuit === quit) activeQuit = null;
  };
}
