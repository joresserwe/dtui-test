export interface NetworkTiming {
  requestTime: number; dnsStart: number; dnsEnd: number;
  connectStart: number; connectEnd: number; sslStart: number; sslEnd: number;
  sendStart: number; sendEnd: number; receiveHeadersEnd: number;
}
export interface InitiatorFrame { functionName: string; url: string; lineNumber: number }
export interface RequestInitiator {
  type: string; url?: string; lineNumber?: number;
  stack?: InitiatorFrame[];
}
export interface BlockedCookie { name: string; reasons: string[] }
export interface BlockedSetCookie { cookieLine: string; reasons: string[] }
export interface WsFrame {
  dir: 'sent' | 'received' | 'error';
  opcode: number; payload: string; ts: number;
}
// validFrom/validTo are epoch seconds (CDP Network.SecurityDetails).
export interface SecurityDetails {
  protocol: string;
  keyExchange?: string;
  keyExchangeGroup?: string;
  cipher: string;
  subjectName: string;
  issuer: string;
  validFrom: number;
  validTo: number;
  sanList: string[];
}
export interface NetworkEntry {
  id: string; url: string; method: string; type: string;
  status?: number; statusText?: string; mimeType?: string;
  requestHeaders: Record<string, string>; responseHeaders: Record<string, string>;
  postData?: string;
  startTs: number; durationMs?: number;
  encodedBytes?: number; decodedBytes?: number;
  timing?: NetworkTiming; queueingMs?: number;
  body?: string; bodyBase64?: boolean; bodyTruncated?: boolean;
  error?: string;
  blockedReason?: string;
  corsError?: string; corsFailedParameter?: string;
  remoteAddress?: string; protocol?: string; priority?: string; referrerPolicy?: string;
  fromCache?: 'disk' | 'memory' | 'sw';
  overridden?: boolean;
  remappedTo?: string;
  initiator?: RequestInitiator;
  setCookies?: string[];
  blockedRequestCookies?: BlockedCookie[];
  blockedResponseCookies?: BlockedSetCookie[];
  securityState?: string;
  securityDetails?: SecurityDetails;
  wsFrames?: WsFrame[];
  wsFramesDropped?: number;
  gqlOperation?: string;
  gqlType?: 'query' | 'mutation' | 'subscription';
}
// 'input'/'result' are synthesized locally for REPL echo/eval-result rows;
// they never arrive from CDP events.
export type ConsoleKind = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'exception' | 'browser' | 'input' | 'result' | 'timer' | 'trace';
// Lean mirrors of CDP Runtime.ObjectPreview / PropertyPreview / EntryPreview,
// restricted to the fields the console renders.
export interface ConsolePreviewProp {
  name: string; type: string; subtype?: string;
  // CDP pre-stringifies property values; numbers arrive as e.g. "1".
  value?: string;
  valuePreview?: ConsolePreview;
}
export interface ConsolePreviewEntry { key?: ConsolePreview; value: ConsolePreview }
export interface ConsolePreview {
  type: string; subtype?: string; description?: string;
  overflow?: boolean;
  properties?: ConsolePreviewProp[];
  entries?: ConsolePreviewEntry[];
}
// Lean mirror of CDP Runtime.RemoteObject. objectId is a live-session handle;
// it is stripped before JSONL persistence because it cannot outlive the session.
export interface ConsoleArg {
  type: string; subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
  preview?: ConsolePreview;
}
export interface ConsoleEntry {
  id?: number;
  kind: ConsoleKind; text: string; ts: number;
  stack?: string; url?: string; line?: number;
  // Occurrences collapsed into this entry; absent means 1.
  count?: number;
  args?: ConsoleArg[];
  ctxId?: number;
  ctxLabel?: string;
  table?: boolean;
}
export interface ExecutionContextInfo {
  id: number; origin: string; name: string;
  frameId?: string; isDefault: boolean;
}
