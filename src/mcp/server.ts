import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { sessionRoot } from '../persist/session.js';
import { JsonlSessionSource, type SessionSource } from './source.js';
import { auditFailing, auditRun, auditSummary, consoleMessages, getRequest, listSessions, listTabs, networkSearch, recorderList, recorderReplay, selectedElement, sessionSummary, takeScreenshot } from './tools.js';

const version = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;

type ToolResult = { content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean };

function guard<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<ToolResult> {
  return async args => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await fn(args)) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
    }
  };
}

const session = z.string().optional().describe('Session id (directory name from list_sessions); defaults to the most recent session');
const limit = (n: number) => z.number().int().positive().optional().describe(`Max rows to return (default ${n}), newest first`);
const consoleSince = z.number().optional().describe('Only rows newer than this ms-epoch timestamp; pass the cursor from a previous response for incremental polling');
const networkSince = z.number().optional().describe('Only requests that completed after this ms-epoch timestamp (still-pending live requests count by start time and are re-sent once they complete); pass the cursor from a previous response for incremental polling. Rows landing out of completion order (e.g. delayed body capture) can rarely be skipped — re-query without since for a guaranteed-complete view');

export function buildServer(source: SessionSource): McpServer {
  const server = new McpServer({ name: 'devtools-tui', version });

  server.registerTool('list_sessions', {
    description: 'List recorded DevTools sessions, newest first, with request/console line counts',
    inputSchema: { limit: limit(10) },
  }, guard(args => listSessions(source, args)));

  server.registerTool('network_search', {
    description: 'Search network requests in a session. Returns {cursor, rows}: compact rows without headers or bodies (use get_request for details) and a cursor for incremental polling via since',
    inputSchema: {
      session,
      url_pattern: z.string().optional().describe('Substring match, or a glob (* and ?) matched against the full URL'),
      method: z.string().optional().describe('HTTP method, case-insensitive'),
      status: z.number().int().optional().describe('Exact HTTP status code'),
      status_class: z.enum(['1xx', '2xx', '3xx', '4xx', '5xx']).optional(),
      mime: z.string().optional().describe('Substring match on the MIME type, e.g. "json"'),
      since: networkSince,
      limit: limit(20),
    },
  }, guard(args => networkSearch(source, args)));

  server.registerTool('get_request', {
    description: 'Get details for one request by id. Sensitive headers are always redacted; bodies are truncated to body_max_bytes',
    inputSchema: {
      session,
      id: z.string().describe('Request id from network_search'),
      include: z.array(z.enum(['headers', 'request_body', 'response_body', 'timing', 'security', 'ws_frames'])).optional()
        .describe('Detail parts to include (default ["headers"]); "security" adds TLS/certificate details, "ws_frames" adds captured WebSocket/SSE frames'),
      body_max_bytes: z.number().int().nonnegative().optional().describe('Byte cap per body (default 2048)'),
    },
  }, guard(args => getRequest(source, args)));

  server.registerTool('console_messages', {
    description: 'Search console messages in a session. Returns {cursor, rows}, newest first; the cursor supports incremental polling via since',
    inputSchema: {
      session,
      level: z.enum(['error', 'warn', 'info', 'log', 'debug']).optional().describe('"error" also matches uncaught exceptions'),
      contains: z.string().optional().describe('Case-insensitive substring match on the message text'),
      since: consoleSince,
      limit: limit(20),
    },
  }, guard(args => consoleMessages(source, args)));

  server.registerTool('session_summary', {
    description: 'Aggregate overview of a session: request totals by status class, failures, console errors, slowest requests. source reports whether data comes from a live TUI or recorded files',
    inputSchema: { session },
  }, guard(args => sessionSummary(source, args)));

  server.registerTool('list_tabs', {
    description: 'List the tabs open in the running devtools-tui TUI (live source only): id, url, title',
    inputSchema: {},
  }, guard(() => listTabs(source)));

  server.registerTool('selected_element', {
    description: 'Structured data for the element currently selected in the running TUI (live source only): selector path, outer HTML, matched CSS rules with overridden flags, key computed styles, box model',
    inputSchema: {
      include: z.array(z.enum(['html', 'rules', 'computed', 'box'])).optional()
        .describe('Parts to include (default: all)'),
    },
  }, guard(args => selectedElement(source, args)));

  const auditCategories = z
    .array(z.enum(['performance', 'accessibility', 'best-practices', 'seo']))
    .optional()
    .describe('Lighthouse categories to include (default: all four)');

  server.registerTool('audit_run', {
    description:
      'Run a Lighthouse audit of a session\'s page in a dedicated browser tab (live TUI only). Long-running (typically 20-90s); progress goes to stderr. Returns category scores plus lab Core Web Vitals; the full result is stored as audit-<stamp>.json in the session dir for audit_summary/audit_failing',
    inputSchema: {
      session,
      preset: z.enum(['mobile', 'desktop']).optional().describe('Throttling/screen preset (default mobile: Lighthouse simulated Slow 4G + mobile screen)'),
      categories: auditCategories,
    },
  }, guard(async (args: { session?: string; preset?: 'mobile' | 'desktop'; categories?: Array<'performance' | 'accessibility' | 'best-practices' | 'seo'> }) => {
    console.error('audit_run: lighthouse audit started…');
    try {
      return await auditRun(source, args);
    } finally {
      console.error('audit_run: finished');
    }
  }));

  server.registerTool('audit_summary', {
    description:
      'Category scores and lab Core Web Vitals (LCP/CLS/TBT/FCP/SI) from the most recent Lighthouse audit of a session (stored audit-*.json; works on recorded sessions too)',
    inputSchema: { session },
  }, guard(args => auditSummary(source, args)));

  server.registerTool('audit_failing', {
    description:
      'Failing audits (score < 1) from the most recent Lighthouse audit, worst first, with fix descriptions and estimated savings. Filter by category',
    inputSchema: {
      session,
      category: z.enum(['performance', 'accessibility', 'best-practices', 'seo']).optional(),
      limit: z.number().int().positive().optional().describe('Max rows to return (default 20), worst first'),
    },
  }, guard(args => auditFailing(source, args)));

  server.registerTool('recorder_list', {
    description: 'List saved input recordings (recorder-replay flows): name, step count, and creation time. Recordings are captured in the TUI and stored globally',
    inputSchema: {},
  }, guard(async () => recorderList()));

  server.registerTool('recorder_replay', {
    description:
      'Replay a saved input recording against the attached TUI page (live TUI only): navigates, clicks, types, and presses keys as trusted input. Returns {ok, steps, failure?}. A recording with a masked password step fails with reason "redacted_input_required" (replay it interactively in the TUI instead)',
    inputSchema: {
      name: z.string().describe('Recording name from recorder_list'),
      timeout_ms: z.number().int().positive().optional().describe('Per-step wait timeout in ms (default 5000)'),
    },
  }, guard((args: { name: string; timeout_ms?: number }) => recorderReplay(source, args)));

  server.registerTool('take_screenshot', {
    description: 'Screenshot from the running TUI session (live source only). target "viewport" captures the page; "element" crops to the currently selected element',
    inputSchema: {
      target: z.enum(['viewport', 'element']).describe('What to capture'),
      session,
    },
  }, async (args: { target: 'viewport' | 'element'; session?: string }): Promise<ToolResult> => {
    try {
      const shot = await takeScreenshot(source, args);
      return { content: [{ type: 'image', data: shot.data, mimeType: shot.mimeType }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] };
    }
  });

  return server;
}

export async function runMcpServer(root?: string): Promise<void> {
  const resolvedRoot = root ?? sessionRoot();
  let source: SessionSource;
  let sourceNote: string;
  const { detectLiveClient, LiveSessionSource } = await import('./live-source.js');
  const client = process.platform === 'win32' ? null : await detectLiveClient();
  if (client) {
    const live = new LiveSessionSource(client);
    source = live;
    sourceNote = `live TUI socket: ${live.path}`;
  } else {
    source = new JsonlSessionSource(resolvedRoot);
    sourceNote = `sessions: ${resolvedRoot}`;
  }
  const server = buildServer(source);
  await server.connect(new StdioServerTransport());
  console.error(`devtools-tui MCP server on stdio (${sourceNote})`);
  await new Promise<void>(resolve => {
    server.server.onclose = resolve;
  });
}
