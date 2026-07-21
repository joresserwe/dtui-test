import type { CdpConnection } from './connection.js';

export interface AppManifest {
  url: string;
  raw: string | null;
  errors: string[];
}

export interface FrameNode {
  id: string;
  url: string;
  origin: string;
  depth: number;
  secureContext: string;
  crossOriginIsolated: string;
}

export interface IsolationStatus {
  coep?: string;
  coepReportOnly?: string;
  coop?: string;
  coopReportOnly?: string;
}

export type FrameNodeView = FrameNode & IsolationStatus;

export interface OriginTrialToken {
  status: string;
  origin?: string;
  expiry?: number;
}

export interface OriginTrialView {
  name: string;
  status: string;
  tokens: OriginTrialToken[];
}

export async function getAppManifest(conn: CdpConnection): Promise<AppManifest> {
  const res = await conn.send<{ url?: string; data?: string; errors?: Array<{ message?: string }> }>('Page.getAppManifest');
  return {
    url: res.url ?? '',
    raw: res.data && res.data.length ? res.data : null,
    errors: (res.errors ?? []).map(e => e.message ?? '').filter(Boolean),
  };
}

export async function getInstallabilityErrors(conn: CdpConnection): Promise<string[]> {
  const res = await conn.send<{ installabilityErrors?: Array<{ errorId?: string; errorArguments?: Array<{ name: string; value: string }> }> }>(
    'Page.getInstallabilityErrors');
  return (res.installabilityErrors ?? []).map(e => {
    const id = e.errorId ?? 'unknown';
    const args = (e.errorArguments ?? []).map(a => `${a.name}: ${a.value}`).join(', ');
    return args ? `${id} (${args})` : id;
  });
}

function flattenFrames(node: any, depth: number, out: FrameNode[]): void {
  const f = node?.frame;
  if (f) {
    out.push({
      id: f.id ?? '',
      url: f.url ?? '',
      origin: f.securityOrigin ?? '',
      depth,
      secureContext: f.secureContextType ?? '',
      crossOriginIsolated: f.crossOriginIsolatedContextType ?? '',
    });
  }
  for (const child of node?.childFrames ?? []) flattenFrames(child, depth + 1, out);
}

export async function getFrameTree(conn: CdpConnection): Promise<FrameNode[]> {
  const { frameTree } = await conn.send<{ frameTree: unknown }>('Page.getFrameTree');
  const out: FrameNode[] = [];
  flattenFrames(frameTree, 0, out);
  return out;
}

export async function getSecurityIsolationStatus(conn: CdpConnection, frameId?: string): Promise<IsolationStatus> {
  const { status } = await conn.send<{ status?: { coep?: { value?: string; reportOnlyValue?: string }; coop?: { value?: string; reportOnlyValue?: string } } }>(
    'Network.getSecurityIsolationStatus', frameId ? { frameId } : {});
  return {
    coep: status?.coep?.value,
    coepReportOnly: status?.coep?.reportOnlyValue,
    coop: status?.coop?.value,
    coopReportOnly: status?.coop?.reportOnlyValue,
  };
}

export async function getOriginTrials(conn: CdpConnection, frameId: string): Promise<OriginTrialView[]> {
  const { originTrials } = await conn.send<{ originTrials?: Array<{ trialName?: string; status?: string; tokensWithStatus?: Array<{ status?: string; parsedToken?: { origin?: string; expiryTime?: number } }> }> }>(
    'Page.getOriginTrials', { frameId });
  return (originTrials ?? []).map(tr => ({
    name: tr.trialName ?? '',
    status: tr.status ?? '',
    tokens: (tr.tokensWithStatus ?? []).map(tk => ({
      status: tk.status ?? '',
      ...(tk.parsedToken?.origin ? { origin: tk.parsedToken.origin } : {}),
      ...(tk.parsedToken?.expiryTime !== undefined ? { expiry: tk.parsedToken.expiryTime } : {}),
    })),
  }));
}
