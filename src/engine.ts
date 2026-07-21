import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { attachPage, type PageTarget } from './cdp/targets.js';
import type { CdpConnection } from './cdp/connection.js';
import { NetworkStore } from './store/network.js';
import { ConsoleStore, contextTag, persistableConsoleEntry } from './store/console.js';
import { formatArg, toConsoleArg, type ConsoleObjectProp } from './store/console-format.js';
import type { ConsoleArg, ExecutionContextInfo, NetworkEntry } from './store/types.js';
import { createSessionDir, JsonlWriter, sessionRoot } from './persist/session.js';
import { writeHar } from './persist/har.js';
import * as storage from './cdp/storage.js';
import * as indexeddb from './cdp/indexeddb.js';
import * as cacheStorage from './cdp/cache-storage.js';
import { SwStore, enableServiceWorker, setBypassServiceWorker, setForceUpdateOnPageLoad, scopeOrigin, deliverPushMessage, dispatchSyncEvent, dispatchPeriodicSyncEvent, type SwRegView } from './cdp/service-worker.js';
import { BackgroundServiceStore, BACKGROUND_SERVICES, startObserving, stopObserving, setRecording, type BackgroundServiceEvent, type BackgroundServiceName } from './cdp/background-service.js';
import { PreloadStore, enablePreload, disablePreload, type PreloadAttempt, type PreloadRuleSet } from './cdp/preload.js';
import { ReportingStore, enableReportingApi, type ReportingEndpoint, type ReportingReport } from './cdp/reporting.js';
import * as pageApp from './cdp/page-app.js';
import * as dom from './cdp/dom.js';
import * as animation from './cdp/animation.js';
import { contentCenter, synthClick, synthHover, insertText, dispatchKey, REPLAY_KEYS } from './cdp/input.js';
import { buildRecorderScript, buildRecorderStopScript, REC_BINDING } from './tui/lib/recorder-script.js';
import { parseStep, type Step } from './store/recording.js';
import * as css from './cdp/css.js';
import * as domtree from './cdp/domtree.js';
import * as emulation from './cdp/emulation.js';
import * as webauthn from './cdp/webauthn.js';
import * as debuggerCdp from './cdp/debugger.js';
import { DebuggerStore, logpointCondition, type BreakpointKind, type BreakpointView, type DomBreakpointType, type PauseState } from './store/debugger.js';
import { REDACTED, redactHeaders } from './util/redact.js';
import type { BoxModel } from './cdp/dom.js';
import type { MatchedRule } from './cdp/css.js';
import type { VisionDeficiency } from './cdp/emulation.js';

export interface DeviceOverrideState extends emulation.DeviceMetrics {
  label: string;
}

export interface GeoOverrideState extends emulation.GeoOverride {
  label: string;
}

export interface UaOverrideState {
  label: string;
  override: emulation.UserAgentOverride;
}

export interface IdleOverrideState {
  label: string;
  state: emulation.IdleState;
}

export interface SensorOverrideState {
  label: string;
  reading: emulation.OrientationReading;
}

interface MediaState {
  scheme: 'dark' | 'light' | null;
  print: boolean;
  reducedMotion: boolean;
  forcedColors: boolean;
  contrast: 'more' | 'less' | null;
}

export const THROTTLE_PROFILES = {
  off: null,
  fast3g: { offline: false, latency: 150, downloadThroughput: 180_000, uploadThroughput: 84_000 },
  slow3g: { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
} as const;

export type ThrottleName = keyof typeof THROTTLE_PROFILES | 'custom';

export interface NetworkConditions {
  offline: boolean;
  latency: number;
  downloadThroughput: number;
  uploadThroughput: number;
}

export interface OverrideRule {
  id: string;
  pattern: string;
  status: number;
  headers: Array<[string, string]>;
  body: string;
  enabled: boolean;
}

export interface BlockPattern {
  id: string;
  pattern: string;
  enabled: boolean;
}

export function globMatch(pattern: string, url: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`).test(url);
}

export interface MapRemoteRule {
  id: string;
  pattern: string;
  target: string;
  enabled: boolean;
}

export function rewriteUrl(pattern: string, target: string, url: string): string | null {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)').replace(/\?/g, '.');
  const m = new RegExp(`^${source}$`).exec(url);
  if (!m) return null;
  let group = 0;
  return target.replace(/\*/g, () => m[++group] ?? '');
}

export interface BreakpointCondition {
  kind: Exclude<BreakpointKind, 'line'>;
  text: string;
}

export const REDACTED_INPUT_REQUIRED = 'redacted_input_required';

export interface ReplayFailure {
  stepIndex: number;
  kind: Step['kind'];
  selector?: string;
  reason: string;
}

export interface ReplayProgress {
  index: number;
  total: number;
  step: Step;
  failure?: ReplayFailure;
}

export interface ReplayOptions {
  stepTimeoutMs?: number;
  navTimeoutMs?: number;
  altFallback?: boolean;
  resolveRedacted?: (step: Step, index: number) => Promise<string | null>;
}

export function blackboxPattern(url: string): string {
  return `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

export interface EngineOptions {
  sessionRoot?: string;
  bodyCapBytes?: number;
  persist?: boolean;
  browser?: string;
  clearOnNav?: boolean;
  harSanitize?: boolean;
  persistSanitize?: boolean;
}

const TEXT_MIME = /json|xml|html|text|javascript|x-www-form-urlencoded/;

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'cookie', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

function sendableHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (name.startsWith(':') || lower.startsWith('proxy-') || lower.startsWith('sec-') || FORBIDDEN_HEADERS.has(lower)) continue;
    out[name] = value;
  }
  return out;
}

export function sliceUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

export class DebugSession extends EventEmitter {
  readonly network = new NetworkStore();
  readonly console = new ConsoleStore();
  readonly debug = new DebuggerStore();
  readonly sessionDir?: string;
  throttle: ThrottleName = 'off';
  cacheDisabled = false;
  customConditions: NetworkConditions | null = null;
  clearOnNav = false;
  harSanitize = true;
  persistSanitize = false;
  blockedUrls: string[] = [];
  deviceOverride: DeviceOverrideState | null = null;
  cpuRate = 1;
  geoOverride: GeoOverrideState | null = null;
  colorScheme: 'dark' | 'light' | null = null;
  printMedia = false;
  reducedMotion = false;
  forcedColors = false;
  contrast: 'more' | 'less' | null = null;
  visionDeficiency: VisionDeficiency = 'none';
  paintFlashing = false;
  timezone: string | null = null;
  touchEnabled = false;
  userAgentOverride: UaOverrideState | null = null;
  locale: string | null = null;
  autoDarkMode = false;
  landscape = false;
  idleOverride: IdleOverrideState | null = null;
  sensorOverride: SensorOverrideState | null = null;
  webauthnEnabled = false;
  pageTiming: { domContentLoadedMs?: number; loadMs?: number } = {};

  readonly bodyCap: number;
  private browser: string;
  private currentUrl: string;
  private netWriter?: JsonlWriter;
  private consoleWriter?: JsonlWriter;
  private pendingBodies = new Set<Promise<void>>();
  private mainFrameId?: string;
  private navStartMono?: number;
  private navCaptured = false;
  private inspectorSheetId?: string;
  private hideRuleInjected = false;
  private overrides: OverrideRule[] = [];
  private mapRemoteRules: MapRemoteRule[] = [];
  private contexts: ExecutionContextInfo[] = [];
  private fetchEnabled = false;
  private debuggerEnabled = false;
  private tempVarSeq = 1;
  private defaultUserAgent?: string;
  private webauthnId?: string;
  private recording = false;
  private recSteps: Step[] = [];
  private recScriptId?: string;

  private constructor(
    private conn: CdpConnection,
    readonly target: PageTarget,
    opts: EngineOptions,
  ) {
    super();
    this.bodyCap = opts.bodyCapBytes ?? 262_144;
    this.browser = opts.browser ?? 'unknown';
    this.clearOnNav = opts.clearOnNav ?? false;
    this.harSanitize = opts.harSanitize ?? true;
    this.persistSanitize = opts.persistSanitize ?? false;
    this.currentUrl = target.url;
    this.console.ctxLabelFor = id => {
      const c = this.contexts.find(x => x.id === id);
      return c && !c.isDefault ? contextTag(c) : undefined;
    };

    if (opts.persist !== false) {
      const paths = createSessionDir(opts.sessionRoot ?? sessionRoot(), target.url);
      this.sessionDir = paths.dir;
      this.netWriter = new JsonlWriter(paths.networkFile);
      this.consoleWriter = new JsonlWriter(paths.consoleFile);
    }

    conn.on('event', (method: string, params: any) => {
      if (method.startsWith('Network.')) {
        this.network.handleEvent(method, params);
        if (method.startsWith('Network.reportingApi') && this.reporting.handleEvent(method, params)) this.emit('reporting-updated');
        if (
          method === 'Network.requestWillBeSent' &&
          params.type === 'Document' &&
          params.requestId === params.loaderId &&
          !params.redirectResponse &&
          (this.mainFrameId !== undefined ? params.frameId === this.mainFrameId : !this.navCaptured)
        ) {
          this.navStartMono = params.timestamp;
          this.navCaptured = true;
          this.pageTiming = {};
          this.emit('page-timing');
        }
      }
      else if (method === 'Page.domContentEventFired') {
        if (this.navStartMono !== undefined) {
          this.pageTiming = { ...this.pageTiming, domContentLoadedMs: Math.max(0, (params.timestamp - this.navStartMono) * 1000) };
          this.emit('page-timing');
        }
      }
      else if (method === 'Page.loadEventFired') {
        if (this.navStartMono !== undefined) {
          this.pageTiming = { ...this.pageTiming, loadMs: Math.max(0, (params.timestamp - this.navStartMono) * 1000) };
          this.emit('page-timing');
        }
        this.emit('page-load');
      }
      else if (method === 'Runtime.bindingCalled') {
        if (this.recording && params.name === REC_BINDING) this.onRecPayload(params.payload);
      }
      else if (method === 'Runtime.executionContextsCleared') {
        this.debug.clearScripts();
        this.contexts = [];
        this.emit('contexts-cleared');
        this.emit('contexts-changed');
      }
      else if (method === 'Runtime.executionContextCreated') {
        const c = params.context;
        this.contexts.push({ id: c.id, origin: c.origin, name: c.name, frameId: c.auxData?.frameId, isDefault: !!c.auxData?.isDefault });
        this.emit('contexts-changed');
      }
      else if (method === 'Runtime.executionContextDestroyed') {
        const id = params.executionContextId;
        this.contexts = this.contexts.filter(c => c.id !== id);
        this.emit('context-destroyed', id);
        this.emit('contexts-changed');
      }
      else if (method.startsWith('Runtime.') || method === 'Log.entryAdded') this.console.handleEvent(method, params);
      else if (method.startsWith('Debugger.')) this.debug.handleEvent(method, params);
      else if (method === 'Page.frameNavigated' && params.frame && !params.frame.parentId) {
        if (this.recording && params.frame.url !== this.currentUrl) {
          this.recSteps.push({ kind: 'nav', url: params.frame.url });
          this.emit('rec-step');
        }
        this.currentUrl = params.frame.url;
        this.mainFrameId = params.frame.id;
        this.inspectorSheetId = undefined;
        this.hideRuleInjected = false;
        if (this.clearOnNav) this.network.clear();
        this.preload.clear();
        this.reporting.clear();
        this.emit('frame-navigated', params.frame.url);
      }
      else if (method.startsWith('DOMStorage.')) {
        const sid = params.storageId;
        if (sid && sid.securityOrigin === this.origin) this.emit('dom-storage', { local: !!sid.isLocalStorage });
      }
      else if (method.startsWith('ServiceWorker.')) {
        if (this.sw.handleEvent(method, params)) this.emit('sw-updated');
      }
      else if (method.startsWith('BackgroundService.')) {
        if (this.bgServices.handleEvent(method, params)) this.emit('bg-services-updated');
      }
      else if (method.startsWith('Preload.')) {
        if (this.preload.handleEvent(method, params)) this.emit('preload-updated');
      }
      else if (method === 'Storage.sharedStorageAccessed') {
        if (this.sharedStorage.handleEvent(method, params)) this.emit('shared-storage-updated');
      }
      else if (method === 'Fetch.requestPaused') void this.fulfillOrContinue(params);
      else if (method === 'Overlay.inspectNodeRequested') this.emit('inspect-node', params.backendNodeId);
      else if (method.startsWith('Animation.')) this.emit('animation-event', method, params);
      else if (method === 'DOM.setChildNodes') this.emit('dom-child-nodes', { parentId: params.parentId, nodes: params.nodes });
      else if (method === 'DOM.documentUpdated') this.emit('document-updated');
      else if (method.startsWith('DOM.attribute') || method.startsWith('DOM.childNode') || method === 'DOM.characterDataModified') {
        this.emit('dom-mutation', method);
      }
    });
    conn.on('close', () => this.emit('close'));

    this.network.on('finished', (e: NetworkEntry) => {
      const p = this.captureBody(e).finally(() => {
        this.netWriter?.write(this.persistableNet(e));
        this.pendingBodies.delete(p);
      });
      this.pendingBodies.add(p);
    });
    this.network.on('failed', (e: NetworkEntry) => {
      this.netWriter?.write(this.persistableNet(e));
    });
    this.console.on('entry', entry => this.consoleWriter?.write(persistableConsoleEntry(entry)));
  }

  static async attach(target: PageTarget, opts: EngineOptions = {}): Promise<DebugSession> {
    const conn = await attachPage(target);
    return new DebugSession(conn, target, opts);
  }

  async reload(): Promise<void> {
    await this.conn.send('Page.reload');
  }

  async navigate(url: string): Promise<void> {
    await this.conn.send('Page.navigate', { url });
  }

  async sendRequest(req: { method: string; url: string; headers?: Record<string, string>; body?: string }): Promise<void> {
    const init: Record<string, unknown> = {
      method: req.method,
      headers: sendableHeaders(req.headers ?? {}),
      credentials: 'include',
    };
    if (req.body !== undefined && !/^(GET|HEAD)$/i.test(req.method)) init.body = req.body;
    const { exceptionDetails } = await this.conn.send<{ exceptionDetails?: { text?: string } }>(
      'Runtime.evaluate', { expression: `void fetch(${JSON.stringify(req.url)}, ${JSON.stringify(init)})` });
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed');
  }

  private emulateConditions(p: NetworkConditions | null): Promise<unknown> {
    return this.conn.send('Network.emulateNetworkConditions',
      p
        ? { offline: p.offline, latency: p.latency, downloadThroughput: p.downloadThroughput, uploadThroughput: p.uploadThroughput }
        : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  async setThrottle(name: ThrottleName): Promise<void> {
    const p = name === 'custom' ? this.customConditions : THROTTLE_PROFILES[name];
    await this.emulateConditions(p);
    this.throttle = p ? name : 'off';
  }

  async setCustomConditions(c: NetworkConditions | null): Promise<void> {
    await this.emulateConditions(c);
    this.customConditions = c;
    this.throttle = c ? 'custom' : 'off';
  }

  async setCacheDisabled(disabled: boolean): Promise<void> {
    await this.conn.send('Network.setCacheDisabled', { cacheDisabled: disabled });
    this.cacheDisabled = disabled;
  }

  async setBlocked(patterns: string[]): Promise<void> {
    await this.conn.send('Network.setBlockedURLs', { urls: patterns });
    this.blockedUrls = patterns;
  }

  async setDeviceOverride(preset: DeviceOverrideState | null): Promise<void> {
    if (preset) await emulation.setDeviceMetrics(this.conn, preset);
    else await emulation.clearDeviceMetrics(this.conn);
    const touch = preset?.mobile ?? false;
    await emulation.setTouchEmulation(this.conn, touch);
    this.deviceOverride = preset;
    this.landscape = false;
    this.touchEnabled = touch;
  }

  async rotateDevice(): Promise<void> {
    const base = this.deviceOverride;
    if (!base) return;
    const next = !this.landscape;
    await emulation.setDeviceMetrics(this.conn, {
      width: next ? base.height : base.width,
      height: next ? base.width : base.height,
      deviceScaleFactor: base.deviceScaleFactor,
      mobile: base.mobile,
      screenOrientation: next ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
    });
    this.landscape = next;
  }

  async setUserAgentOverride(preset: UaOverrideState | null): Promise<void> {
    if (preset) {
      if (this.defaultUserAgent === undefined) {
        this.defaultUserAgent = String((await this.evalValue('navigator.userAgent')) ?? '');
      }
      await emulation.setUserAgentOverride(this.conn, preset.override);
      this.userAgentOverride = preset;
    } else {
      if (this.defaultUserAgent !== undefined) {
        await emulation.setUserAgentOverride(this.conn, { userAgent: this.defaultUserAgent });
      }
      this.userAgentOverride = null;
    }
  }

  async setLocale(locale: string | null): Promise<void> {
    await emulation.setLocaleOverride(this.conn, locale);
    this.locale = locale;
  }

  async setAutoDarkMode(on: boolean): Promise<void> {
    await emulation.setAutoDarkMode(this.conn, on);
    this.autoDarkMode = on;
  }

  async setIdleOverride(preset: IdleOverrideState | null): Promise<void> {
    if (preset) await emulation.setIdleOverride(this.conn, preset.state);
    else await emulation.clearIdleOverride(this.conn);
    this.idleOverride = preset;
  }

  async setSensorOverride(preset: SensorOverrideState | null): Promise<void> {
    if (preset) await emulation.setSensorOverride(this.conn, preset.reading);
    else await emulation.clearSensorOverride(this.conn);
    this.sensorOverride = preset;
  }

  async setWebAuthn(on: boolean): Promise<void> {
    if (on) {
      await webauthn.enableWebAuthn(this.conn);
      this.webauthnId = await webauthn.addVirtualAuthenticator(this.conn, {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      });
      this.webauthnEnabled = true;
    } else {
      if (this.webauthnId) await webauthn.removeVirtualAuthenticator(this.conn, this.webauthnId);
      await webauthn.disableWebAuthn(this.conn);
      this.webauthnId = undefined;
      this.webauthnEnabled = false;
    }
  }

  async setTouchEmulation(on: boolean): Promise<void> {
    await emulation.setTouchEmulation(this.conn, on);
    this.touchEnabled = on;
  }

  async setTimezone(timezoneId: string | null): Promise<void> {
    await emulation.setTimezoneOverride(this.conn, timezoneId ?? '');
    this.timezone = timezoneId;
  }

  async setCpuThrottling(rate: number): Promise<void> {
    await emulation.setCpuThrottling(this.conn, rate);
    this.cpuRate = rate;
  }

  async setGeoOverride(preset: GeoOverrideState | null): Promise<void> {
    if (preset) await emulation.setGeolocation(this.conn, preset);
    else await emulation.clearGeolocation(this.conn);
    this.geoOverride = preset;
  }

  async setColorScheme(scheme: 'dark' | 'light' | null): Promise<void> {
    await this.applyEmulatedMedia({ ...this.mediaState(), scheme });
    this.colorScheme = scheme;
  }

  async setPrintMedia(on: boolean): Promise<void> {
    await this.applyEmulatedMedia({ ...this.mediaState(), print: on });
    this.printMedia = on;
  }

  async setReducedMotion(on: boolean): Promise<void> {
    await this.applyEmulatedMedia({ ...this.mediaState(), reducedMotion: on });
    this.reducedMotion = on;
  }

  async setForcedColors(on: boolean): Promise<void> {
    await this.applyEmulatedMedia({ ...this.mediaState(), forcedColors: on });
    this.forcedColors = on;
  }

  async setContrast(contrast: 'more' | 'less' | null): Promise<void> {
    await this.applyEmulatedMedia({ ...this.mediaState(), contrast });
    this.contrast = contrast;
  }

  private mediaState(): MediaState {
    return {
      scheme: this.colorScheme,
      print: this.printMedia,
      reducedMotion: this.reducedMotion,
      forcedColors: this.forcedColors,
      contrast: this.contrast,
    };
  }

  private applyEmulatedMedia(s: MediaState): Promise<void> {
    const features: emulation.MediaFeature[] = [];
    if (s.scheme) features.push({ name: 'prefers-color-scheme', value: s.scheme });
    if (s.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
    if (s.forcedColors) features.push({ name: 'forced-colors', value: 'active' });
    if (s.contrast) features.push({ name: 'prefers-contrast', value: s.contrast });
    return emulation.setEmulatedMedia(this.conn, { media: s.print ? 'print' : '', features });
  }

  async setVisionDeficiency(type: VisionDeficiency): Promise<void> {
    await emulation.setVisionDeficiency(this.conn, type);
    this.visionDeficiency = type;
  }

  async setPaintFlashing(on: boolean): Promise<void> {
    await emulation.setPaintFlashing(this.conn, on);
    this.paintFlashing = on;
  }

  async setOverrides(rules: OverrideRule[]): Promise<void> {
    this.overrides = rules;
    await this.syncFetchPatterns();
  }

  async setMapRemote(rules: MapRemoteRule[]): Promise<void> {
    this.mapRemoteRules = rules;
    await this.syncFetchPatterns();
  }

  private async syncFetchPatterns(): Promise<void> {
    const patterns = [
      ...this.overrides.map(r => ({ urlPattern: r.pattern, requestStage: 'Response' })),
      ...this.mapRemoteRules.map(r => ({ urlPattern: r.pattern, requestStage: 'Request' })),
    ];
    if (!patterns.length) {
      if (this.fetchEnabled) {
        this.fetchEnabled = false;
        await this.conn.send('Fetch.disable');
      }
      return;
    }
    // Ordering matters: a sync to zero rules that runs while this send is in
    // flight must observe fetchEnabled, or it would skip Fetch.disable.
    this.fetchEnabled = true;
    await this.conn.send('Fetch.enable', { patterns });
  }

  private async fulfillOrContinue(params: {
    requestId: string;
    networkId?: string;
    request?: { url?: string };
    responseStatusCode?: number;
    responseErrorReason?: string;
  }): Promise<void> {
    const url = params.request?.url ?? '';
    const responseStage = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
    if (!responseStage) {
      try {
        const rule = this.mapRemoteRules.find(r => globMatch(r.pattern, url));
        const target = rule ? rewriteUrl(rule.pattern, rule.target, url) : null;
        if (target !== null && target !== url) {
          await this.conn.send('Fetch.continueRequest', { requestId: params.requestId, url: target });
          if (params.networkId) this.network.markRemapped(params.networkId, target);
          return;
        }
      } catch {}
      await this.conn.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      return;
    }
    try {
      const rule = this.overrides.find(r => globMatch(r.pattern, url));
      if (rule) {
        await this.conn.send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: rule.status,
          responseHeaders: rule.headers.map(([name, value]) => ({ name, value })),
          body: Buffer.from(rule.body, 'utf8').toString('base64'),
        });
        if (params.networkId) this.network.markOverridden(params.networkId);
        return;
      }
    } catch {}
    await this.conn.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
  }

  get origin(): string {
    try {
      return new URL(this.currentUrl).origin;
    } catch {
      return '';
    }
  }

  get url(): string {
    return this.currentUrl;
  }

  cookies(): Promise<storage.CookieInfo[]> {
    return storage.getCookies(this.conn);
  }

  setCookie(name: string, value: string, attrs?: Parameters<typeof storage.setCookie>[4]): Promise<boolean> {
    return storage.setCookie(this.conn, this.currentUrl, name, value, attrs);
  }

  deleteCookie(c: Parameters<typeof storage.deleteCookie>[1]): Promise<void> {
    return storage.deleteCookie(this.conn, c);
  }

  storageItems(local: boolean): Promise<Array<[string, string]>> {
    return storage.getStorageItems(this.conn, this.origin, local);
  }

  setStorageItem(local: boolean, key: string, value: string): Promise<void> {
    return storage.setStorageItem(this.conn, this.origin, local, key, value);
  }

  removeStorageItem(local: boolean, key: string): Promise<void> {
    return storage.removeStorageItem(this.conn, this.origin, local, key);
  }

  clearSiteData(): Promise<void> {
    return storage.clearOrigin(this.conn, this.origin);
  }

  storageUsage(): Promise<storage.StorageUsage> {
    return storage.getUsageAndQuota(this.conn, this.origin);
  }

  idbDatabases(): Promise<string[]> {
    return indexeddb.getDatabaseNames(this.conn, this.origin);
  }

  idbStores(db: string): Promise<indexeddb.IdbStoreMeta[]> {
    return indexeddb.getDatabase(this.conn, this.origin, db);
  }

  idbEntries(db: string, store: string, skip: number, page: number): Promise<indexeddb.IdbPage> {
    return indexeddb.getStoreData(this.conn, this.origin, db, store, skip, page);
  }

  idbDeleteEntry(db: string, store: string, key: indexeddb.IdbKey): Promise<void> {
    return indexeddb.deleteEntry(this.conn, this.origin, db, store, key);
  }

  idbClearStore(db: string, store: string): Promise<void> {
    return indexeddb.clearStore(this.conn, this.origin, db, store);
  }

  idbPutEntry(db: string, store: string, key: indexeddb.IdbKey | null, valueJson: string): Promise<void> {
    return indexeddb.putEntry(this.conn, db, store, key, valueJson);
  }

  cacheNames(): Promise<cacheStorage.CacheInfo[]> {
    return cacheStorage.getCacheNames(this.conn, this.origin);
  }

  cacheEntries(cacheId: string, skip: number, page: number): Promise<cacheStorage.CachePage> {
    return cacheStorage.getCacheEntries(this.conn, cacheId, skip, page);
  }

  cachedResponseBody(cacheId: string, url: string, reqHeaders: Array<[string, string]>): Promise<Buffer> {
    return cacheStorage.getCachedResponseBody(this.conn, cacheId, url, reqHeaders);
  }

  deleteCache(cacheId: string): Promise<void> {
    return cacheStorage.deleteCache(this.conn, cacheId);
  }

  deleteCacheEntry(cacheId: string, url: string): Promise<void> {
    return cacheStorage.deleteCacheEntry(this.conn, cacheId, url);
  }

  readonly sw = new SwStore();
  swForceUpdate = false;
  swBypass = false;

  enableServiceWorkers(): Promise<void> {
    return enableServiceWorker(this.conn);
  }

  swRegistrations(): SwRegView[] {
    return this.sw.registrations();
  }

  async setSwForceUpdate(v: boolean): Promise<void> {
    await setForceUpdateOnPageLoad(this.conn, v);
    this.swForceUpdate = v;
  }

  async setSwBypass(v: boolean): Promise<void> {
    await setBypassServiceWorker(this.conn, v);
    this.swBypass = v;
  }

  swDeliverPush(reg: SwRegView, data: string): Promise<void> {
    return deliverPushMessage(this.conn, scopeOrigin(reg.scope), reg.id, data);
  }

  swDispatchSync(reg: SwRegView, tag: string, lastChance: boolean): Promise<void> {
    return dispatchSyncEvent(this.conn, scopeOrigin(reg.scope), reg.id, tag, lastChance);
  }

  swDispatchPeriodicSync(reg: SwRegView, tag: string): Promise<void> {
    return dispatchPeriodicSyncEvent(this.conn, scopeOrigin(reg.scope), reg.id, tag);
  }

  readonly bgServices = new BackgroundServiceStore();
  bgRecording = false;

  async setBgRecording(on: boolean): Promise<void> {
    for (const service of BACKGROUND_SERVICES) {
      if (on) {
        await startObserving(this.conn, service);
        await setRecording(this.conn, true, service);
      } else {
        await setRecording(this.conn, false, service).catch(() => {});
        await stopObserving(this.conn, service).catch(() => {});
      }
    }
    this.bgRecording = on;
  }

  bgEvents(): BackgroundServiceEvent[] {
    return this.bgServices.list();
  }

  readonly preload = new PreloadStore();
  private preloadEnabled = false;

  async enablePreloadTracking(): Promise<void> {
    if (this.preloadEnabled) return;
    await enablePreload(this.conn);
    this.preloadEnabled = true;
  }

  async disablePreloadTracking(): Promise<void> {
    if (!this.preloadEnabled) return;
    this.preloadEnabled = false;
    await disablePreload(this.conn);
  }

  preloadRuleSets(): PreloadRuleSet[] {
    return this.preload.ruleSetList();
  }

  preloadAttempts(): PreloadAttempt[] {
    return this.preload.attemptList();
  }

  readonly reporting = new ReportingStore();
  private reportingEnabled = false;

  async enableReporting(): Promise<void> {
    if (this.reportingEnabled) return;
    await enableReportingApi(this.conn, true);
    this.reportingEnabled = true;
  }

  async disableReporting(): Promise<void> {
    if (!this.reportingEnabled) return;
    this.reportingEnabled = false;
    await enableReportingApi(this.conn, false).catch(() => {});
  }

  reportingReports(): ReportingReport[] {
    return this.reporting.reportList();
  }

  reportingEndpoints(): ReportingEndpoint[] {
    return this.reporting.endpointList();
  }

  readonly sharedStorage = new storage.SharedStorageStore();
  private sharedTracking = false;

  async enableSharedStorageTracking(): Promise<void> {
    if (this.sharedTracking) return;
    await storage.setSharedStorageTracking(this.conn, true);
    this.sharedTracking = true;
  }

  async disableSharedStorageTracking(): Promise<void> {
    if (!this.sharedTracking) return;
    this.sharedTracking = false;
    await storage.setSharedStorageTracking(this.conn, false).catch(() => {});
  }

  async sharedStorageData(): Promise<{ metadata: storage.SharedStorageMetadata | null; entries: storage.SharedStorageEntry[]; events: storage.SharedStorageAccessEvent[] }> {
    const origin = this.origin;
    const [metadata, entries] = await Promise.all([
      storage.getSharedStorageMetadata(this.conn, origin).catch(() => null),
      storage.getSharedStorageEntries(this.conn, origin).catch(() => []),
    ]);
    return { metadata, entries, events: this.sharedStorage.list() };
  }

  trustTokens(): Promise<storage.TrustTokenCount[]> {
    return storage.getTrustTokens(this.conn);
  }

  clearTrustTokens(issuerOrigin: string): Promise<void> {
    return storage.clearTrustTokens(this.conn, issuerOrigin);
  }

  appManifest(): Promise<pageApp.AppManifest> {
    return pageApp.getAppManifest(this.conn);
  }

  installabilityErrors(): Promise<string[]> {
    return pageApp.getInstallabilityErrors(this.conn);
  }

  frameTree(): Promise<pageApp.FrameNode[]> {
    return pageApp.getFrameTree(this.conn);
  }

  securityIsolation(frameId?: string): Promise<pageApp.IsolationStatus> {
    return pageApp.getSecurityIsolationStatus(this.conn, frameId);
  }

  async originTrials(frameId?: string): Promise<pageApp.OriginTrialView[]> {
    return pageApp.getOriginTrials(this.conn, frameId ?? await this.frameId());
  }

  executionContexts(): ExecutionContextInfo[] {
    return this.contexts.slice();
  }

  async evaluate(expression: string, contextId?: number): Promise<{ result?: ConsoleArg; exceptionDetails?: unknown }> {
    const res = await this.conn.send<{ result?: unknown; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression,
      includeCommandLineAPI: true,
      replMode: true,
      awaitPromise: true,
      generatePreview: true,
      userGesture: true,
      objectGroup: 'console-repl',
      ...(contextId !== undefined ? { contextId } : {}),
    });
    return { result: res.result ? toConsoleArg(res.result) : undefined, exceptionDetails: res.exceptionDetails };
  }

  async releaseReplObjects(): Promise<void> {
    await this.conn.send('Runtime.releaseObjectGroup', { objectGroup: 'console-repl' }).catch(() => {});
  }

  async storeAsGlobal(objectId: string): Promise<string> {
    const res = await this.conn.send<{ result?: { value?: unknown } }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function (start) { let i = start; while (("temp" + i) in globalThis) i++; const name = "temp" + i; globalThis[name] = this; return name; }',
      arguments: [{ value: this.tempVarSeq }],
      returnByValue: true,
    });
    const name = typeof res.result?.value === 'string' ? res.result.value : `temp${this.tempVarSeq}`;
    const n = Number(name.slice('temp'.length));
    if (Number.isFinite(n)) this.tempVarSeq = n + 1;
    return name;
  }

  async evaluateEager(expression: string, contextId?: number): Promise<string | null> {
    try {
      const res = await this.conn.send<{ result?: unknown; exceptionDetails?: unknown }>('Runtime.evaluate', {
        expression,
        throwOnSideEffect: true,
        silent: true,
        timeout: 500,
        objectGroup: 'console-eager',
        generatePreview: true,
        includeCommandLineAPI: true,
        replMode: true,
        ...(contextId !== undefined ? { contextId } : {}),
      });
      if (res.exceptionDetails || !res.result) return null;
      return formatArg(toConsoleArg(res.result));
    } catch {
      return null;
    } finally {
      void this.conn.send('Runtime.releaseObjectGroup', { objectGroup: 'console-eager' }).catch(() => {});
    }
  }

  // throwOnSideEffect keeps completion probes from mutating page state: any
  // getter that could run arbitrary code makes the evaluate throw, which maps
  // to null (no candidates) rather than an error surface.
  async evaluateForCompletion(expression: string, contextId?: number): Promise<Array<{ name: string; type?: string }> | null> {
    try {
      const res = await this.conn.send<{ result?: { objectId?: string }; exceptionDetails?: unknown }>('Runtime.evaluate', {
        expression,
        throwOnSideEffect: true,
        silent: true,
        timeout: 500,
        objectGroup: 'console-completion',
        generatePreview: false,
        includeCommandLineAPI: true,
        replMode: true,
        ...(contextId !== undefined ? { contextId } : {}),
      });
      if (res.exceptionDetails || !res.result?.objectId) return null;
      const { result } = await this.conn.send<{ result?: Array<{ name: string; value?: { type?: string } }> }>(
        'Runtime.getProperties', { objectId: res.result.objectId, ownProperties: false, generatePreview: false });
      return (result ?? []).map(p => ({ name: p.name, type: p.value?.type }));
    } catch {
      return null;
    } finally {
      void this.conn.send('Runtime.releaseObjectGroup', { objectGroup: 'console-completion' }).catch(() => {});
    }
  }

  async globalLexicalScopeNames(): Promise<string[]> {
    try {
      const { names } = await this.conn.send<{ names?: string[] }>('Runtime.globalLexicalScopeNames');
      return names ?? [];
    } catch {
      return [];
    }
  }

  async enableDebugger(): Promise<void> {
    if (this.debuggerEnabled) return;
    await debuggerCdp.enable(this.conn);
    this.debuggerEnabled = true;
  }

  get debuggerActive(): boolean {
    return this.debuggerEnabled;
  }

  getScriptSource(scriptId: string): Promise<string> {
    return debuggerCdp.getScriptSource(this.conn, scriptId);
  }

  setScriptSource(scriptId: string, scriptSource: string, dryRun = false): Promise<debuggerCdp.SetScriptSourceResult> {
    return debuggerCdp.setScriptSource(this.conn, scriptId, scriptSource, dryRun);
  }

  async setBreakpointByUrl(url: string, line: number, spec?: BreakpointCondition): Promise<BreakpointView> {
    const condition = spec ? (spec.kind === 'logpoint' ? logpointCondition(spec.text) : spec.text) : undefined;
    const { breakpointId, locations } = await debuggerCdp.setBreakpointByUrl(this.conn, url, line, condition);
    return this.debug.addBreakpoint(breakpointId, url, line, locations, spec?.kind ?? 'line', spec?.text);
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    await debuggerCdp.removeBreakpoint(this.conn, breakpointId);
    this.debug.removeBreakpoint(breakpointId);
  }

  async setBlackboxedUrls(urls: string[]): Promise<void> {
    await debuggerCdp.setBlackboxPatterns(this.conn, urls.map(blackboxPattern));
    this.debug.setBlackboxedUrls(urls);
  }

  async toggleBlackbox(url: string): Promise<boolean> {
    const cur = this.debug.blackboxedUrls();
    const on = !cur.includes(url);
    await this.setBlackboxedUrls(on ? [...cur, url] : cur.filter(u => u !== url));
    return on;
  }

  async addXhrBreakpoint(url: string): Promise<void> {
    await dom.setXHRBreakpoint(this.conn, url);
    this.debug.addXhrBreakpoint(url);
  }

  async removeXhrBreakpoint(url: string): Promise<void> {
    await dom.removeXHRBreakpoint(this.conn, url);
    this.debug.removeXhrBreakpoint(url);
  }

  async setEventBreakpoint(eventName: string, on: boolean): Promise<void> {
    if (on) await dom.setEventListenerBreakpoint(this.conn, eventName);
    else await dom.removeEventListenerBreakpoint(this.conn, eventName);
    this.debug.setEventBreakpoint(eventName, on);
  }

  async setDomBreakpoint(nodeId: number, type: DomBreakpointType, selector: string): Promise<void> {
    await dom.setDOMBreakpoint(this.conn, nodeId, type);
    this.debug.addDomBreakpoint({ nodeId, selector, type });
  }

  async removeDomBreakpoint(nodeId: number, type: DomBreakpointType): Promise<void> {
    await dom.removeDOMBreakpoint(this.conn, nodeId, type);
    this.debug.removeDomBreakpoint(nodeId, type);
  }

  async setPauseOnExceptions(state: PauseState): Promise<void> {
    await debuggerCdp.setPauseOnExceptions(this.conn, state);
    this.debug.setPauseOnExceptions(state);
  }

  stepOver(): Promise<void> {
    return debuggerCdp.stepOver(this.conn);
  }

  stepInto(): Promise<void> {
    return debuggerCdp.stepInto(this.conn);
  }

  stepOut(): Promise<void> {
    return debuggerCdp.stepOut(this.conn);
  }

  resumeDebugger(): Promise<void> {
    return debuggerCdp.resume(this.conn);
  }

  pauseDebugger(): Promise<void> {
    return debuggerCdp.pause(this.conn);
  }

  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    objectGroup?: string,
  ): Promise<{ result?: ConsoleArg; exceptionDetails?: unknown }> {
    const res = await debuggerCdp.evaluateOnCallFrame(this.conn, callFrameId, expression, objectGroup);
    return { result: res.result ? toConsoleArg(res.result) : undefined, exceptionDetails: res.exceptionDetails };
  }

  async releaseObjectGroup(objectGroup: string): Promise<void> {
    await this.conn.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  }

  setInspectedNode(nodeId: number): Promise<void> {
    return dom.setInspectedNode(this.conn, nodeId);
  }

  async getProperties(objectId: string): Promise<ConsoleObjectProp[]> {
    const { result } = await this.conn.send<{ result?: Array<{ name: string; value?: unknown }> }>(
      'Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true });
    return (result ?? []).filter(p => p.value).map(p => ({ name: p.name, value: toConsoleArg(p.value) }));
  }

  async domHtml(): Promise<string> {
    const doc = await this.conn.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1 });
    const { outerHTML } = await this.conn.send<{ outerHTML: string }>('DOM.getOuterHTML', { nodeId: doc.root.nodeId });
    this.emit('document-updated');
    return outerHTML;
  }

  domTree(depth = -1): Promise<domtree.NodeMap> {
    return domtree.getDomTree(this.conn, depth);
  }

  private async frameId(): Promise<string> {
    if (!this.mainFrameId) {
      const { frameTree } = await this.conn.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
      this.mainFrameId = frameTree.frame.id;
    }
    return this.mainFrameId;
  }

  async addCssRule(selector: string, body: string): Promise<void> {
    if (!this.inspectorSheetId) {
      this.inspectorSheetId = await css.createStyleSheet(this.conn, await this.frameId());
    }
    try {
      await css.addRule(this.conn, this.inspectorSheetId, `${selector} { ${body} }`);
    } catch (err) {
      this.inspectorSheetId = undefined;
      throw err;
    }
  }

  querySelector(selector: string): Promise<number | null> {
    return dom.querySelector(this.conn, selector);
  }

  outerHTML(nodeId: number): Promise<string> {
    return dom.getOuterHTML(this.conn, nodeId);
  }

  setOuterHTML(nodeId: number, html: string): Promise<void> {
    return dom.setOuterHTML(this.conn, nodeId, html);
  }

  boxModel(nodeId: number): Promise<BoxModel | null> {
    return dom.getBoxModel(this.conn, nodeId);
  }

  computedStyles(nodeId: number): Promise<Array<[string, string]>> {
    return css.getComputedStyles(this.conn, nodeId);
  }

  matchedRules(nodeId: number, ancestors?: string[]): Promise<MatchedRule[]> {
    return css.getMatchedRules(this.conn, nodeId, ancestors);
  }

  platformFonts(nodeId: number): Promise<css.PlatformFont[]> {
    return css.getPlatformFonts(this.conn, nodeId);
  }

  editRuleStyle(styleSheetId: string, range: css.StyleRange, text: string): Promise<void> {
    return css.setStyleText(this.conn, styleSheetId, range, text);
  }

  forcePseudoState(nodeId: number, classes: string[]): Promise<void> {
    return css.forcePseudoState(this.conn, nodeId, classes);
  }

  setAttributesAsText(nodeId: number, text: string): Promise<void> {
    return dom.setAttributesAsText(this.conn, nodeId, text);
  }

  getAttributes(nodeId: number): Promise<Record<string, string>> {
    return dom.getAttributes(this.conn, nodeId);
  }

  async setClassAttr(nodeId: number, value: string): Promise<void> {
    if (value) await dom.setAttributeValue(this.conn, nodeId, 'class', value);
    else await dom.removeAttribute(this.conn, nodeId, 'class');
  }

  removeNode(nodeId: number): Promise<void> {
    return dom.removeNode(this.conn, nodeId);
  }

  duplicateNode(nodeId: number, targetNodeId: number, insertBeforeNodeId?: number): Promise<number> {
    return dom.copyTo(this.conn, nodeId, targetNodeId, insertBeforeNodeId);
  }

  mediaQueries(): Promise<css.MediaQueryView[]> {
    return css.getMediaQueries(this.conn);
  }

  enableAnimations(): Promise<void> {
    return animation.enableAnimations(this.conn);
  }

  disableAnimations(): Promise<void> {
    return animation.disableAnimations(this.conn);
  }

  setAnimationsPaused(ids: string[], paused: boolean): Promise<void> {
    return animation.setAnimationsPaused(this.conn, ids, paused);
  }

  setAnimationPlaybackRate(rate: number): Promise<void> {
    return animation.setAnimationPlaybackRate(this.conn, rate);
  }

  seekAnimations(ids: string[], currentTime: number): Promise<void> {
    return animation.seekAnimations(this.conn, ids, currentTime);
  }

  async nodeLabelByBackendId(backendNodeId: number): Promise<string | null> {
    try {
      const { node } = await this.conn.send<{ node?: { nodeName?: string; attributes?: string[] } }>('DOM.describeNode', { backendNodeId });
      return node?.nodeName ? domtree.nodeLabel(node.nodeName, node.attributes) : null;
    } catch {
      return null;
    }
  }

  async toggleNodeVisibility(nodeId: number): Promise<boolean> {
    const attrs = await dom.getAttributes(this.conn, nodeId);
    const { value, on } = dom.toggleClassToken(attrs.class, dom.HIDE_CLASS);
    if (on && !this.hideRuleInjected) {
      await this.addCssRule(`.${dom.HIDE_CLASS}`, 'visibility: hidden !important');
      this.hideRuleInjected = true;
    }
    if (value) await dom.setAttributeValue(this.conn, nodeId, 'class', value);
    else await dom.removeAttribute(this.conn, nodeId, 'class');
    return on;
  }

  highlight(nodeId: number): Promise<void> {
    return dom.highlightNode(this.conn, nodeId);
  }

  hideHighlight(): Promise<void> {
    return dom.hideHighlight(this.conn);
  }

  watchDomMutations(): Promise<void> {
    return dom.enableDomMutations(this.conn);
  }

  performSearch(query: string): Promise<dom.DomSearch> {
    return dom.performSearch(this.conn, query);
  }

  searchResults(searchId: string, fromIndex: number, toIndex: number): Promise<number[]> {
    return dom.getSearchResults(this.conn, searchId, fromIndex, toIndex);
  }

  discardSearch(searchId: string): Promise<void> {
    return dom.discardSearchResults(this.conn, searchId);
  }

  setInspectMode(on: boolean): Promise<void> {
    return dom.setInspectMode(this.conn, on);
  }

  pushNodeByBackendId(backendNodeId: number): Promise<number | null> {
    return dom.pushNodeByBackendId(this.conn, backendNodeId);
  }

  requestNode(objectId: string): Promise<number | null> {
    return dom.requestNode(this.conn, objectId);
  }

  requestNodeEnsured(objectId: string): Promise<number | null> {
    return dom.requestNodeEnsured(this.conn, objectId);
  }

  async frameworkHostObjectId(expression: string): Promise<string | null> {
    const res = await this.conn.send<{ result?: { objectId?: string; subtype?: string } }>('Runtime.evaluate', {
      expression,
      objectGroup: 'framework-inspect',
      silent: true,
    });
    const objectId = res.result?.objectId;
    if (!objectId || res.result?.subtype === 'null') return null;
    return objectId;
  }

  async releaseFrameworkObjects(): Promise<void> {
    await this.conn.send('Runtime.releaseObjectGroup', { objectGroup: 'framework-inspect' }).catch(() => {});
  }

  async frameworkInspect(expression: string): Promise<ConsoleObjectProp[] | null> {
    const res = await this.conn.send<{ result?: { objectId?: string; subtype?: string }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', {
      expression,
      objectGroup: 'framework-inspect',
      silent: true,
      generatePreview: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text ?? 'inspect failed');
    const objectId = res.result?.objectId;
    if (!objectId || res.result?.subtype === 'null') return null;
    return this.getProperties(objectId);
  }

  requestChildNodes(nodeId: number, depth = 1): Promise<void> {
    return dom.requestChildNodes(this.conn, nodeId, depth);
  }

  async clickNode(nodeId: number): Promise<void> {
    await dom.scrollIntoViewIfNeeded(this.conn, nodeId).catch(() => {});
    const center = contentCenter(await dom.getBoxModel(this.conn, nodeId));
    if (!center) throw new Error('node has no box model');
    await synthClick(this.conn, center.x, center.y);
  }

  async hoverNode(nodeId: number): Promise<void> {
    await dom.scrollIntoViewIfNeeded(this.conn, nodeId).catch(() => {});
    const center = contentCenter(await dom.getBoxModel(this.conn, nodeId));
    if (!center) throw new Error('node has no box model');
    await synthHover(this.conn, center.x, center.y);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get recordingStepCount(): number {
    return this.recSteps.length;
  }

  async startRecording(): Promise<void> {
    if (this.recording) return;
    const script = buildRecorderScript();
    await this.conn.send('Runtime.addBinding', { name: REC_BINDING });
    const { identifier } = await this.conn.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: script });
    this.recScriptId = identifier;
    this.recSteps = [{ kind: 'goto', url: this.currentUrl }];
    this.recording = true;
    await this.conn.send('Runtime.evaluate', { expression: script }).catch(() => {});
    this.emit('rec-step');
  }

  async stopRecording(): Promise<Step[]> {
    if (!this.recording) return [];
    this.recording = false;
    const steps = this.recSteps;
    this.recSteps = [];
    await this.conn.send('Runtime.evaluate', { expression: buildRecorderStopScript() }).catch(() => {});
    if (this.recScriptId !== undefined) {
      await this.conn.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.recScriptId }).catch(() => {});
      this.recScriptId = undefined;
    }
    await this.conn.send('Runtime.removeBinding', { name: REC_BINDING }).catch(() => {});
    this.emit('rec-step');
    return steps;
  }

  private onRecPayload(payload: unknown): void {
    if (typeof payload !== 'string') return;
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      return;
    }
    const step = parseStep(raw);
    if (!step) return;
    this.recSteps.push(step);
    this.emit('rec-step');
  }

  async replayRecording(steps: Step[], opts: ReplayOptions = {}): Promise<ReplayFailure | null> {
    const stepTimeout = opts.stepTimeoutMs ?? 5000;
    const navTimeout = opts.navTimeoutMs ?? 10_000;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      this.emit('replay-progress', { index: i, total: steps.length, step } satisfies ReplayProgress);
      try {
        await this.runReplayStep(step, i, stepTimeout, navTimeout, opts);
      } catch (e) {
        const failure: ReplayFailure = {
          stepIndex: i,
          kind: step.kind,
          selector: 'selector' in step ? step.selector ?? undefined : undefined,
          reason: e instanceof Error ? e.message : String(e),
        };
        this.emit('replay-progress', { index: i, total: steps.length, step, failure } satisfies ReplayProgress);
        return failure;
      }
    }
    return null;
  }

  private async runReplayStep(step: Step, index: number, stepTimeout: number, navTimeout: number, opts: ReplayOptions): Promise<void> {
    switch (step.kind) {
      case 'goto':
        await this.navigate(step.url);
        await this.waitForLoad(navTimeout);
        return;
      case 'nav':
        await this.waitForNav(step.url, navTimeout);
        return;
      case 'click': {
        const nodeId = await this.resolveSelector(step.selector, stepTimeout, opts.altFallback && step.alt ? true : false);
        if (nodeId == null) {
          if (opts.altFallback && step.alt) {
            await synthClick(this.conn, step.alt.x, step.alt.y);
            return;
          }
          throw new Error(`selector not found: ${step.selector}`);
        }
        await this.clickNode(nodeId);
        return;
      }
      case 'input': {
        await this.waitForSelector(step.selector, stepTimeout);
        const nodeId = await this.evalNodeId(`document.querySelector(${JSON.stringify(step.selector)})`);
        if (nodeId != null) await this.clickNode(nodeId).catch(() => {});
        await this.evalValue(this.fieldOp(step.selector, `el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))`));
        let text: string | null | undefined = step.value;
        if (step.redacted) {
          text = opts.resolveRedacted ? await opts.resolveRedacted(step, index) : null;
          if (text == null) throw new Error(REDACTED_INPUT_REQUIRED);
        }
        await insertText(this.conn, text ?? '');
        await this.evalValue(this.fieldOp(step.selector, `el.dispatchEvent(new Event('change',{bubbles:true}))`));
        return;
      }
      case 'select':
        await this.waitForSelector(step.selector, stepTimeout);
        await this.evalValue(this.fieldOp(step.selector, `el.value=${JSON.stringify(step.value)};el.dispatchEvent(new Event('change',{bubbles:true}))`));
        return;
      case 'key': {
        const def = REPLAY_KEYS[step.key];
        if (!def) return;
        await dispatchKey(this.conn, def);
        return;
      }
    }
  }

  private fieldOp(selector: string, body: string): string {
    return `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(el){${body};}})()`;
  }

  private async resolveSelector(selector: string, timeoutMs: number, lenient: boolean): Promise<number | null> {
    try {
      await this.waitForSelector(selector, timeoutMs);
    } catch (e) {
      if (lenient) return null;
      throw e;
    }
    return this.evalNodeId(`document.querySelector(${JSON.stringify(selector)})`);
  }

  private async waitForSelector(selector: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ok = await this.evalValue(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false);
      if (ok) return;
      if (Date.now() >= deadline) throw new Error(`selector not found: ${selector}`);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  private waitForLoad(timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        this.off('page-load', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.on('page-load', done);
    });
  }

  private waitForNav(url: string, timeoutMs: number): Promise<void> {
    if (this.currentUrl === url) return Promise.resolve();
    return this.waitForLoad(timeoutMs);
  }

  setGridOverlays(nodeIds: number[]): Promise<void> {
    return dom.setShowGridOverlays(this.conn, nodeIds);
  }

  setFlexOverlays(nodeIds: number[]): Promise<void> {
    return dom.setShowFlexOverlays(this.conn, nodeIds);
  }

  eventListeners(nodeId: number): Promise<dom.EventListenerView[]> {
    return dom.getEventListeners(this.conn, nodeId);
  }

  async evalValue(expression: string): Promise<unknown> {
    const res = await this.conn.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      silent: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text ?? 'evaluate failed');
    return res.result?.value;
  }

  async evalNodeId(expression: string): Promise<number | null> {
    try {
      const res = await this.conn.send<{ result?: { objectId?: string; subtype?: string } }>('Runtime.evaluate', {
        expression,
        objectGroup: 'dtui-nodes',
        silent: true,
      });
      const objectId = res.result?.objectId;
      if (!objectId || res.result?.subtype === 'null') return null;
      return await dom.requestNode(this.conn, objectId);
    } finally {
      void this.conn.send('Runtime.releaseObjectGroup', { objectGroup: 'dtui-nodes' }).catch(() => {});
    }
  }

  async screenshot(clip?: { x: number; y: number; width: number; height: number }): Promise<string | null> {
    try {
      const { data } = await this.conn.send<{ data: string }>(
        'Page.captureScreenshot',
        clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {},
      );
      return data;
    } catch {
      return null;
    }
  }

  scrollIntoView(nodeId: number): Promise<void> {
    return dom.scrollIntoViewIfNeeded(this.conn, nodeId);
  }

  async pageOffset(): Promise<{ x: number; y: number }> {
    const { cssVisualViewport } = await this.conn.send<{ cssVisualViewport?: { pageX?: number; pageY?: number } }>('Page.getLayoutMetrics');
    return { x: cssVisualViewport?.pageX ?? 0, y: cssVisualViewport?.pageY ?? 0 };
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.pendingBodies]);
    await this.netWriter?.close();
    await this.consoleWriter?.close();
    await this.writeHarNow();
    this.conn.close();
  }

  private async writeHarNow(): Promise<void> {
    if (!this.sessionDir) return;
    const file = join(this.sessionDir, 'session.har');
    await writeHar(file, this.network.entries(), { browser: this.browser, bodyCap: this.bodyCap, sanitize: this.harSanitize }).catch(() => {});
  }

  private persistableNet(e: NetworkEntry): NetworkEntry {
    if (!this.persistSanitize) return e;
    const maskCookieLine = (line: string): string => {
      const eq = line.indexOf('=');
      return eq > 0 ? `${line.slice(0, eq)}=${REDACTED}` : REDACTED;
    };
    return {
      ...e,
      requestHeaders: redactHeaders(e.requestHeaders),
      responseHeaders: redactHeaders(e.responseHeaders),
      ...(e.setCookies ? { setCookies: e.setCookies.map(maskCookieLine) } : {}),
      ...(e.blockedResponseCookies
        ? { blockedResponseCookies: e.blockedResponseCookies.map(b => ({ ...b, cookieLine: maskCookieLine(b.cookieLine) })) }
        : {}),
    };
  }

  private async captureBody(e: NetworkEntry): Promise<void> {
    if (!e.mimeType || !TEXT_MIME.test(e.mimeType)) return;
    if ((e.encodedBytes ?? 0) > this.bodyCap) {
      this.network.markBodyTruncated(e.id);
      return;
    }
    try {
      const res = await this.conn.send<{ body: string; base64Encoded: boolean }>(
        'Network.getResponseBody', { requestId: e.id });
      const truncated = Buffer.byteLength(res.body, 'utf8') > this.bodyCap;
      this.network.setBody(e.id, truncated ? sliceUtf8(res.body, this.bodyCap) : res.body, res.base64Encoded, truncated);
    } catch {
      /* body may be evicted by the browser; entry stays body-less */
    }
  }
}
