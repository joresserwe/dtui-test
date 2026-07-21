import { EventEmitter } from 'node:events';
import { RingBuffer } from './ring.js';
import { header } from '../util/headers.js';
import type { NetworkEntry, RequestInitiator, SecurityDetails, WsFrame } from './types.js';

export const WS_FRAME_CAP = 500;
const WS_PAYLOAD_CAP = 2048;
const SAN_CAP = 20;

function pickSecurityDetails(sd: any): SecurityDetails | undefined {
  if (!sd) return undefined;
  return {
    protocol: sd.protocol ?? '',
    ...(sd.keyExchange ? { keyExchange: sd.keyExchange } : {}),
    ...(sd.keyExchangeGroup ? { keyExchangeGroup: sd.keyExchangeGroup } : {}),
    cipher: sd.cipher ?? '',
    subjectName: sd.subjectName ?? '',
    issuer: sd.issuer ?? '',
    validFrom: sd.validFrom ?? 0,
    validTo: sd.validTo ?? 0,
    sanList: (sd.sanList ?? []).slice(0, SAN_CAP),
  };
}

const capPayload = (s: string): string => (s.length > WS_PAYLOAD_CAP ? s.slice(0, WS_PAYLOAD_CAP) : s);

function pickInitiator(init: any): RequestInitiator | undefined {
  if (!init) return undefined;
  const stack = (init.stack?.callFrames ?? []).slice(0, 2).map((f: any) => ({
    functionName: f.functionName ?? '',
    url: f.url ?? '',
    lineNumber: f.lineNumber ?? 0,
  }));
  return { type: init.type, url: init.url, lineNumber: init.lineNumber, ...(stack.length ? { stack } : {}) };
}

const GQL_NAMED = /\b(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/;
const GQL_ANON = /^\s*(query|mutation|subscription)\b/;

function gqlOp(op: any): { name: string; type?: string } | undefined {
  if (!op || typeof op !== 'object') return undefined;
  const query = typeof op.query === 'string' ? op.query : undefined;
  const named = query ? GQL_NAMED.exec(query) : null;
  const anon = !named && query ? GQL_ANON.exec(query) : null;
  const type = named?.[1] ?? anon?.[1];
  if (typeof op.operationName === 'string' && op.operationName) return { name: op.operationName, type };
  if (named) return { name: named[2], type };
  if (anon) return { name: anon[1], type: anon[1] };
  return undefined;
}

function detectGraphql(entry: NetworkEntry): void {
  const post = entry.postData;
  if (!post) return;
  let gqlPath = false;
  try {
    gqlPath = new URL(entry.url).pathname.endsWith('/graphql');
  } catch {}
  if (!gqlPath) {
    const ct = header(entry.requestHeaders, 'content-type');
    if (!/application\/json/i.test(ct) || !post.includes('"query"')) return;
  }
  try {
    const parsed = JSON.parse(post);
    const ops = Array.isArray(parsed) ? parsed : [parsed];
    const first = gqlOp(ops[0]);
    if (!first) return;
    entry.gqlOperation = ops.length > 1 ? `${first.name}+${ops.length - 1}` : first.name;
    if (first.type === 'query' || first.type === 'mutation' || first.type === 'subscription') entry.gqlType = first.type;
  } catch {}
}

function collectSetCookies(entry: NetworkEntry, headers: Record<string, string> | undefined): void {
  const raw = header(headers ?? {}, 'set-cookie');
  if (!raw) return;
  const list = (entry.setCookies ??= []);
  for (const line of raw.split('\n')) {
    const value = line.trim();
    if (value && !list.includes(value)) list.push(value);
  }
}

export class NetworkStore extends EventEmitter {
  private ring: RingBuffer<NetworkEntry>;
  private byId = new Map<string, NetworkEntry>();
  private monoStart = new Map<string, number>();

  constructor(cap = 1000) {
    super();
    this.ring = new RingBuffer<NetworkEntry>(cap, evicted => {
      if (this.byId.get(evicted.id) === evicted) {
        this.byId.delete(evicted.id);
        this.monoStart.delete(evicted.id);
      }
    });
  }

  handleEvent(method: string, params: any): void {
    switch (method) {
      case 'Network.requestWillBeSent': {
        if (params.redirectResponse) {
          const prior = this.byId.get(params.requestId);
          if (prior) {
            prior.status = params.redirectResponse.status;
            prior.statusText = params.redirectResponse.statusText;
            prior.mimeType = params.redirectResponse.mimeType;
            prior.timing = params.redirectResponse.timing;
            Object.assign(prior.responseHeaders, params.redirectResponse.headers ?? {});
            collectSetCookies(prior, params.redirectResponse.headers);
            const start = this.monoStart.get(params.requestId);
            if (start !== undefined) prior.durationMs = (params.timestamp - start) * 1000;
            this.emit('update', prior);
            this.emit('finished', prior);
          }
        }
        const entry: NetworkEntry = {
          id: params.requestId,
          url: params.request.url,
          method: params.request.method,
          type: params.type ?? 'Other',
          requestHeaders: { ...(params.request.headers ?? {}) },
          responseHeaders: {},
          postData: params.request.postData,
          startTs: Math.round(params.wallTime * 1000),
          priority: params.request.initialPriority,
          referrerPolicy: params.request.referrerPolicy,
          initiator: pickInitiator(params.initiator),
        };
        detectGraphql(entry);
        this.byId.set(entry.id, entry);
        this.monoStart.set(entry.id, params.timestamp);
        this.ring.push(entry);
        this.emit('update', entry);
        break;
      }
      case 'Network.requestWillBeSentExtraInfo': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        Object.assign(entry.requestHeaders, params.headers ?? {});
        const blocked = (params.associatedCookies ?? [])
          .filter((c: any) => c.blockedReasons?.length)
          .map((c: any) => ({ name: c.cookie?.name ?? '', reasons: c.blockedReasons }));
        if (blocked.length) entry.blockedRequestCookies = blocked;
        this.emit('update', entry);
        break;
      }
      case 'Network.responseReceived': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        const r = params.response;
        entry.status = r.status;
        entry.statusText = r.statusText;
        entry.mimeType = r.mimeType;
        entry.timing = r.timing;
        if (r.remoteIPAddress) entry.remoteAddress = r.remotePort !== undefined ? `${r.remoteIPAddress}:${r.remotePort}` : r.remoteIPAddress;
        if (r.protocol) entry.protocol = r.protocol;
        if (r.fromServiceWorker) entry.fromCache = 'sw';
        else if (r.fromDiskCache || r.fromPrefetchCache) entry.fromCache = 'disk';
        if (r.securityState) entry.securityState = r.securityState;
        const sec = pickSecurityDetails(r.securityDetails);
        if (sec) entry.securityDetails = sec;
        const start = this.monoStart.get(params.requestId);
        if (start !== undefined && r.timing) entry.queueingMs = Math.max(0, (r.timing.requestTime - start) * 1000);
        Object.assign(entry.responseHeaders, r.headers ?? {});
        collectSetCookies(entry, r.headers);
        this.emit('update', entry);
        break;
      }
      case 'Network.responseReceivedExtraInfo': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        Object.assign(entry.responseHeaders, params.headers ?? {});
        collectSetCookies(entry, params.headers);
        const blocked = (params.blockedCookies ?? [])
          .filter((b: any) => b.blockedReasons?.length)
          .map((b: any) => ({ cookieLine: b.cookieLine ?? '', reasons: b.blockedReasons }));
        if (blocked.length) entry.blockedResponseCookies = blocked;
        this.emit('update', entry);
        break;
      }
      case 'Network.loadingFinished': {
        const entry = this.finish(params.requestId, params.timestamp);
        if (!entry) return;
        entry.encodedBytes = params.encodedDataLength;
        this.emit('update', entry);
        this.emit('finished', entry);
        break;
      }
      case 'Network.loadingFailed': {
        const entry = this.finish(params.requestId, params.timestamp);
        if (!entry) return;
        entry.error = params.canceled ? 'canceled' : params.errorText;
        if (params.blockedReason) entry.blockedReason = params.blockedReason;
        if (params.corsErrorStatus?.corsError) {
          entry.corsError = params.corsErrorStatus.corsError;
          if (params.corsErrorStatus.failedParameter) entry.corsFailedParameter = params.corsErrorStatus.failedParameter;
        }
        this.emit('update', entry);
        this.emit('failed', entry);
        break;
      }
      case 'Network.resourceChangedPriority': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        entry.priority = params.newPriority;
        this.emit('update', entry);
        break;
      }
      case 'Network.requestServedFromCache': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        entry.fromCache = 'memory';
        this.emit('update', entry);
        break;
      }
      case 'Network.dataReceived': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        entry.decodedBytes = (entry.decodedBytes ?? 0) + (params.dataLength ?? 0);
        this.emit('update', entry);
        break;
      }
      case 'Network.webSocketCreated': {
        const entry: NetworkEntry = {
          id: params.requestId,
          url: params.url,
          method: 'GET',
          type: 'WebSocket',
          requestHeaders: {},
          responseHeaders: {},
          startTs: Date.now(),
          initiator: pickInitiator(params.initiator),
          wsFrames: [],
        };
        this.byId.set(entry.id, entry);
        this.ring.push(entry);
        this.emit('update', entry);
        break;
      }
      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        this.pushFrame(entry, {
          dir: method === 'Network.webSocketFrameSent' ? 'sent' : 'received',
          opcode: params.response?.opcode ?? 1,
          payload: capPayload(params.response?.payloadData ?? ''),
          ts: Date.now(),
        });
        break;
      }
      case 'Network.webSocketFrameError': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        this.pushFrame(entry, { dir: 'error', opcode: 0, payload: capPayload(params.errorMessage ?? ''), ts: Date.now() });
        break;
      }
      case 'Network.webSocketClosed': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        entry.durationMs = Date.now() - entry.startTs;
        this.emit('update', entry);
        this.emit('finished', entry);
        break;
      }
      case 'Network.eventSourceMessageReceived': {
        const entry = this.byId.get(params.requestId);
        if (!entry) return;
        this.pushFrame(entry, { dir: 'received', opcode: 1, payload: capPayload(params.data ?? ''), ts: Date.now() });
        break;
      }
    }
  }

  private pushFrame(entry: NetworkEntry, frame: WsFrame): void {
    const frames = (entry.wsFrames ??= []);
    frames.push(frame);
    if (frames.length > WS_FRAME_CAP) {
      const excess = frames.length - WS_FRAME_CAP;
      frames.splice(0, excess);
      entry.wsFramesDropped = (entry.wsFramesDropped ?? 0) + excess;
    }
    this.emit('update', entry);
  }

  setBody(id: string, body: string, base64: boolean, truncated: boolean): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    entry.body = body;
    entry.bodyBase64 = base64;
    entry.bodyTruncated = truncated;
    this.emit('update', entry);
  }

  markOverridden(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    entry.overridden = true;
    this.emit('update', entry);
  }

  markRemapped(id: string, to: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    entry.remappedTo = to;
    this.emit('update', entry);
  }

  markBodyTruncated(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    entry.bodyTruncated = true;
    this.emit('update', entry);
  }

  clear(): void {
    this.ring.clear();
    this.byId.clear();
    this.monoStart.clear();
    this.emit('update');
  }

  entries(): NetworkEntry[] {
    return this.ring.items();
  }

  get size(): number {
    return this.ring.size;
  }

  get dropped(): number {
    return this.ring.dropped;
  }

  get cap(): number {
    return this.ring.cap;
  }

  setCap(n: number): void {
    this.ring.setCap(n);
  }

  private finish(id: string, timestamp: number): NetworkEntry | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    const start = this.monoStart.get(id);
    if (start !== undefined) entry.durationMs = (timestamp - start) * 1000;
    return entry;
  }

}
