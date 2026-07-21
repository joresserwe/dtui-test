#!/usr/bin/env node
import './prod-env.js';
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { discoverEndpoint, probe, realEnv, type Endpoint } from './cdp/discovery.js';
import { closeWslRelays, setWslRelayEnabled } from './cdp/relay.js';
import { listPages, attachPage } from './cdp/targets.js';
import { BrowserSession } from './cdp/browser.js';
import type { ProfileMode } from './browser/launch.js';
import { restoreSnapshot } from './restore.js';
import { loadArchive, type ArchiveData } from './archive.js';
import type { CdpConnection } from './cdp/connection.js';
import { DebugSession } from './engine.js';
import { pruneSessions, sessionRoot } from './persist/session.js';
import { loadConfig } from './config.js';
import { normalizeUrl } from './util/url.js';
import { setLang } from './tui/lib/i18n.js';
import type { ConsoleEntry, NetworkEntry } from './store/types.js';

const HELP = `devtools-tui

Usage:
  devtools-tui [url] [--tui] [--profile temp|default] [--host H] [--port P] [--browser-path PATH]
                                                       interactive TUI (default on a TTY)
  devtools-tui --list [url] [--host H] [--port P]      list page targets (headless)
  devtools-tui [--tab SUBSTRING] [url] [--host H] [--port P] [--no-persist] [--session-root DIR]
                                                       attach and stream (headless)
  devtools-tui --restore DIR [--host H] [--port P]     restore a snapshot into a new tab (headless)
  devtools-tui --archive DIR|FILE.har                  open a snapshot/session dir or a HAR file offline in the viewer (TTY)
  devtools-tui --mcp [--session-root DIR]              MCP server over recorded sessions (stdio, headless)

A bare devtools-tui opens the TUI; when no browser is listening it shows an
interactive picker to launch one. --browser-path PATH (repeatable) adds an
extra browser executable to that picker.

An optional url opens in a new tab once attached (bare hosts get an https://
prefix). --profile temp launches an isolated profile; --profile default uses
your existing one.

Start your browser with --remote-debugging-port=9222 first.
Note: Chrome/Edge 136+ ignore that flag on the default profile;
add --user-data-dir=<separate dir> for those browsers.

Under WSL, Windows browsers are reached through an automatic interop
relay when the port is not directly reachable; --no-wsl-relay disables it.`;

function formatNet(e: NetworkEntry): string {
  const status = e.error ? `FAIL ${e.error}` : String(e.status ?? '?');
  const ms = e.durationMs !== undefined ? `${Math.round(e.durationMs)}ms` : '-';
  return `[net] ${status} ${e.type} ${ms} ${e.url}`;
}

function formatConsole(e: ConsoleEntry): string {
  return `[${e.kind}] ${e.text}`;
}

async function withAltScreen(fn: () => Promise<void>): Promise<void> {
  process.stdout.write('\x1b[?1049h\x1b[H\x1b[?7l');
  try {
    await fn();
  } finally {
    process.stdout.write('\x1b[?7h\x1b[?1049l');
  }
}

async function startHost(getDelegate: () => import('./mcp/host.js').HostDelegate | null): Promise<import('./mcp/host.js').LiveHost | null> {
  if (process.platform === 'win32') return null;
  const { startLiveHost } = await import('./mcp/host.js');
  return startLiveHost(getDelegate).catch(() => null);
}

async function runTui(ep: Endpoint | null, port: number, extraPaths: string[], initialUrl: string | undefined, initialProfile: ProfileMode): Promise<number> {
  const [{ render }, React, { Root }, { pruneSessions, sessionRoot }, { detectBrowsers, realDetectEnv }] = await Promise.all([
    import('ink'),
    import('react'),
    import('./tui/Root.js'),
    import('./persist/session.js'),
    import('./browser/detect.js'),
  ]);
  await pruneSessions(sessionRoot()).catch(() => []);
  let delegate: import('./mcp/host.js').HostDelegate | null = null;
  const liveBridge = { setDelegate: (d: import('./mcp/host.js').HostDelegate | null) => { delegate = d; } };
  const liveHost = await startHost(() => delegate);
  try {
    await withAltScreen(async () => {
      const instance = render(
        React.createElement(Root, {
          initialEndpoint: ep,
          port,
          initialUrl,
          initialProfile,
          detect: () => detectBrowsers(realDetectEnv(extraPaths)),
          appProps: { liveBridge },
        }),
        { exitOnCtrlC: false },
      );
      await instance.waitUntilExit();
    });
  } finally {
    await liveHost?.close().catch(() => {});
    await closeWslRelays();
  }
  return 0;
}

async function attachPageById(ep: Endpoint, targetId: string): Promise<CdpConnection> {
  const target = (await listPages(ep)).find(p => p.id === targetId);
  if (!target) throw new Error(`Target ${targetId} not found`);
  return attachPage(target);
}

const RESTORE_LIMITATION = 'live JS state, WebSocket connections, and server-side state are not restored';

async function runArchive(data: ArchiveData, limitation?: string): Promise<number> {
  const [{ render }, React, { ArchiveApp }] = await Promise.all([
    import('ink'),
    import('react'),
    import('./tui/ArchiveApp.js'),
  ]);
  await withAltScreen(async () => {
    const instance = render(
      React.createElement(ArchiveApp, { data, limitation }),
      { exitOnCtrlC: false },
    );
    await instance.waitUntilExit();
  });
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      list: { type: 'boolean', default: false },
      tab: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      profile: { type: 'string' },
      'no-persist': { type: 'boolean', default: false },
      'session-root': { type: 'string' },
      tui: { type: 'boolean', default: false },
      'browser-path': { type: 'string', multiple: true },
      restore: { type: 'string' },
      archive: { type: 'string' },
      mcp: { type: 'boolean', default: false },
      'no-wsl-relay': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values['no-wsl-relay']) setWslRelayEnabled(false);
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  if (values.mcp) {
    const { runMcpServer } = await import('./mcp/server.js');
    await runMcpServer(values['session-root']);
    return 0;
  }

  const config = loadConfig();
  setLang(config.lang ?? 'ko');
  let port: number;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      console.error(`Invalid --port: ${values.port}`);
      return 1;
    }
  } else if (config.port !== undefined) {
    port = config.port;
  } else {
    port = 9222;
  }
  if (positionals.length > 1) {
    console.error('At most one url may be given.');
    return 1;
  }
  const initialUrl = positionals[0] !== undefined ? normalizeUrl(positionals[0]) : undefined;
  if (values.profile !== undefined && values.profile !== 'temp' && values.profile !== 'default') {
    console.error(`Invalid --profile: ${values.profile}`);
    return 1;
  }
  const initialProfile: ProfileMode = values.profile === 'temp' ? 'tool' : 'existing';
  if (values.archive !== undefined) {
    if (!existsSync(values.archive)) {
      console.error(`No such archive: ${values.archive}`);
      return 1;
    }
    let archiveData: ArchiveData;
    try {
      archiveData = loadArchive(values.archive);
    } catch (e) {
      console.error(`Could not read archive ${values.archive}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      console.error('--archive requires a TTY.');
      return 1;
    }
    return runArchive(archiveData);
  }

  const ep: Endpoint | null = values.host
    ? await probe(values.host, port, fetch)
    : await discoverEndpoint(port, realEnv());

  if (values.restore !== undefined) {
    if (!ep) {
      console.error(`No CDP endpoint found on port ${port}.\n\n${HELP}`);
      return 1;
    }
    const browser = await BrowserSession.connect(ep);
    let data;
    try {
      data = await restoreSnapshot(values.restore, {
        createTab: url => browser.createTab(url),
        attach: id => attachPageById(ep, id),
      });
    } finally {
      browser.close();
    }
    if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
      return runArchive(loadArchive(values.restore), RESTORE_LIMITATION);
    }
    console.log(`restored ${data.meta.url} into a new tab (${RESTORE_LIMITATION})`);
    console.log(`  view history: devtools-tui --archive ${values.restore}`);
    return 0;
  }

  const wantsTui = values.tui || (!values.list && values.tab === undefined && process.stdout.isTTY === true && process.stdin.isTTY === true);
  if (wantsTui) {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      console.error('TUI requires a TTY; use --list/--tab for headless mode.');
      return 1;
    }
    const extraPaths = [...(config.browserPaths ?? []), ...(values['browser-path'] ?? [])];
    return runTui(ep, port, extraPaths, initialUrl, initialProfile);
  }
  if (!ep) {
    console.error(`No CDP endpoint found on port ${port}.\n\n${HELP}`);
    return 1;
  }

  if (values.profile !== undefined) {
    console.error('--profile is ignored in headless mode; it only applies to a launched browser in the TUI.');
  }

  let createdTargetId: string | undefined;
  if (initialUrl) {
    try {
      const browser = await BrowserSession.connect(ep);
      try {
        createdTargetId = await browser.createTab(initialUrl);
      } finally {
        browser.close();
      }
    } catch (e) {
      console.error(`could not open ${initialUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (values.list) {
    const pages = await listPages(ep);
    pages.forEach((p, i) => console.log(`${i}  ${p.title}  ${p.url}`));
    return 0;
  }

  const pages = await listPages(ep);
  const needle = values.tab?.toLowerCase();
  const page = needle
    ? pages.find(p => p.title.toLowerCase().includes(needle) || p.url.toLowerCase().includes(needle))
    : createdTargetId !== undefined
      ? pages.find(p => p.id === createdTargetId) ?? pages[0]
      : pages[0];
  if (!page) {
    console.error(needle ? `No tab matching "${values.tab}".` : 'No page targets available.');
    return 1;
  }

  if (!values['no-persist']) {
    await pruneSessions(values['session-root'] ?? sessionRoot()).catch(() => []);
  }

  const session = await DebugSession.attach(page, {
    persist: !values['no-persist'],
    sessionRoot: values['session-root'],
    browser: ep.browser,
    bodyCapBytes: config.bodyCapBytes,
    harSanitize: config.harSanitize,
    persistSanitize: config.persistSanitize,
  });
  console.log(`attached: ${page.title} (${page.url}) via ${ep.browser}`);

  const { buildHostDelegate } = await import('./mcp/delegate.js');
  const attachedAt = Date.now();
  const delegate = buildHostDelegate({
    sessions: () => [{ session, title: page.title || page.url, fallbackId: page.id, openedAt: attachedAt }],
    activeSession: () => session,
    selection: () => null,
  });
  const liveHost = await startHost(() => delegate);

  session.network.on('finished', e => console.log(formatNet(e)));
  session.network.on('failed', e => console.log(formatNet(e)));
  session.console.on('entry', e => console.log(formatConsole(e)));
  await new Promise<void>(resolve => {
    const onClose = () => {
      console.error('connection closed by browser');
      resolve();
    };
    session.on('close', onClose);
    process.once('SIGINT', () => {
      session.off('close', onClose);
      resolve();
    });
  });
  await liveHost?.close().catch(() => {});
  await session.close();
  await closeWslRelays();
  if (session.sessionDir) console.log(`session saved: ${session.sessionDir}`);
  return 0;
}

main().then(code => process.exit(process.exitCode ?? code), err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
