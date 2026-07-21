import type { CdpConnection } from './connection.js';
import type { PauseState } from '../store/debugger.js';

export interface RawLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

export async function enable(conn: CdpConnection): Promise<void> {
  await conn.send('Debugger.enable', {});
}

export async function getScriptSource(conn: CdpConnection, scriptId: string): Promise<string> {
  const { scriptSource } = await conn.send<{ scriptSource: string }>('Debugger.getScriptSource', { scriptId });
  return scriptSource;
}

export async function setBreakpointByUrl(
  conn: CdpConnection,
  url: string,
  lineNumber: number,
  condition?: string,
): Promise<{ breakpointId: string; locations: RawLocation[] }> {
  const res = await conn.send<{ breakpointId: string; locations?: RawLocation[] }>(
    'Debugger.setBreakpointByUrl', { url, lineNumber, columnNumber: 0, ...(condition ? { condition } : {}) });
  return { breakpointId: res.breakpointId, locations: res.locations ?? [] };
}

export async function setBlackboxPatterns(conn: CdpConnection, patterns: string[]): Promise<void> {
  await conn.send('Debugger.setBlackboxPatterns', { patterns });
}

export async function removeBreakpoint(conn: CdpConnection, breakpointId: string): Promise<void> {
  await conn.send('Debugger.removeBreakpoint', { breakpointId });
}

export async function setPauseOnExceptions(conn: CdpConnection, state: PauseState): Promise<void> {
  await conn.send('Debugger.setPauseOnExceptions', { state });
}

export async function stepOver(conn: CdpConnection): Promise<void> {
  await conn.send('Debugger.stepOver');
}

export async function stepInto(conn: CdpConnection): Promise<void> {
  await conn.send('Debugger.stepInto');
}

export async function stepOut(conn: CdpConnection): Promise<void> {
  await conn.send('Debugger.stepOut');
}

export async function resume(conn: CdpConnection): Promise<void> {
  await conn.send('Debugger.resume');
}

export async function pause(conn: CdpConnection): Promise<void> {
  await conn.send('Debugger.pause');
}

export interface SetScriptSourceResult {
  status: string;
  exceptionDetails?: unknown;
}

export async function setScriptSource(
  conn: CdpConnection,
  scriptId: string,
  scriptSource: string,
  dryRun = false,
): Promise<SetScriptSourceResult> {
  const res = await conn.send<{ status?: string; exceptionDetails?: unknown }>('Debugger.setScriptSource', {
    scriptId,
    scriptSource,
    dryRun,
  });
  return {
    status: res.status ?? 'Ok',
    ...(res.exceptionDetails !== undefined ? { exceptionDetails: res.exceptionDetails } : {}),
  };
}

export async function evaluateOnCallFrame(
  conn: CdpConnection,
  callFrameId: string,
  expression: string,
  objectGroup?: string,
): Promise<{ result?: unknown; exceptionDetails?: unknown }> {
  return conn.send<{ result?: unknown; exceptionDetails?: unknown }>('Debugger.evaluateOnCallFrame', {
    callFrameId,
    expression,
    generatePreview: true,
    ...(objectGroup !== undefined ? { objectGroup } : {}),
  });
}
