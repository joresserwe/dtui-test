import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Endpoint } from '../../cdp/discovery.js';
import { activatePage, listPages, type PageTarget } from '../../cdp/targets.js';
import type { BlockPattern, DebugSession, MapRemoteRule, NetworkConditions, OverrideRule, ThrottleName } from '../../engine.js';
import { emptyDebugState, type DebugPersistState } from '../../store/debugger.js';
import type { BrowserSession } from '../../cdp/browser.js';
import { epKey, type MultiTabs } from '../lib/multi-tabs.js';
import { loadConfig } from '../../config.js';
import { registerQuit } from '../lib/session-context.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t as msg } from '../lib/i18n.js';

export interface Attached {
  session: DebugSession;
  target: PageTarget;
  ep: Endpoint;
}

export type SessionKey = string;

export const sessionKey = (ep: Endpoint, targetId: string): SessionKey => `${epKey(ep)}#${targetId}`;

export type SessionStatus = 'live' | 'reconnecting' | 'closing';

export interface SessionEntry {
  key: SessionKey;
  ep: Endpoint;
  target: PageTarget;
  session: DebugSession;
  status: SessionStatus;
  attempt: number;
  throttle: ThrottleName;
  cacheDisabled: boolean;
  customConditions: NetworkConditions | null;
  overrides: OverrideRule[];
  blocked: BlockPattern[];
  mapRemote: MapRemoteRule[];
  debug: DebugPersistState;
  openedAt: number;
  lastViewedAt: number;
}

export const DEFAULT_SESSION_CAP = 8;

export type EntryPatch = Partial<Pick<SessionEntry, 'throttle' | 'cacheDisabled' | 'customConditions' | 'overrides' | 'blocked' | 'mapRemote' | 'debug'>>;

export interface SessionManagerOpts {
  ep: Endpoint;
  tabs: MultiTabs;
  browsers?: Map<string, BrowserSession | null>;
  initialUrl?: string;
  attachFn: (t: PageTarget, ep: Endpoint) => Promise<DebugSession>;
  browserFor: (e: Endpoint) => BrowserSession | null;
  reconnectBaseMs: number;
  setToast: (msg: string, level?: ToastLevel) => void;
  whenNotEditing: (fn: () => void) => void;
  onViewSwitch: (from: SessionKey | null, to: SessionKey | null) => void;
  onSessionEnd?: (key: SessionKey) => void;
  exit: () => void;
}

export interface SessionManager {
  attached: Attached | null;
  attachedRef: React.MutableRefObject<Attached | null>;
  active: SessionEntry | null;
  sessions: () => SessionEntry[];
  reconnecting: number;
  openSession: (t: PageTarget, ep: Endpoint) => Promise<void>;
  openUrl: (url: string, ep: Endpoint, opts?: { incognito?: boolean }) => Promise<void>;
  switchTo: (key: SessionKey) => void;
  switchBy: (delta: number) => void;
  closeSession: (key: SessionKey) => Promise<boolean>;
  patchEntry: (key: SessionKey, patch: EntryPatch) => void;
  quit: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(r => {
    const timer = setTimeout(r, ms);
    timer.unref?.();
  });
}

async function replayEmulation(prev: DebugSession, next: DebugSession): Promise<void> {
  if (prev.deviceOverride) {
    await next.setDeviceOverride(prev.deviceOverride).catch(() => {});
    if (prev.landscape) await next.rotateDevice().catch(() => {});
  }
  if (prev.touchEnabled !== next.touchEnabled) await next.setTouchEmulation(prev.touchEnabled).catch(() => {});
  if (prev.cpuRate !== 1) await next.setCpuThrottling(prev.cpuRate).catch(() => {});
  if (prev.colorScheme) await next.setColorScheme(prev.colorScheme).catch(() => {});
  if (prev.contrast) await next.setContrast(prev.contrast).catch(() => {});
  if (prev.reducedMotion) await next.setReducedMotion(true).catch(() => {});
  if (prev.forcedColors) await next.setForcedColors(true).catch(() => {});
  if (prev.printMedia) await next.setPrintMedia(true).catch(() => {});
  if (prev.autoDarkMode) await next.setAutoDarkMode(true).catch(() => {});
  if (prev.visionDeficiency !== 'none') await next.setVisionDeficiency(prev.visionDeficiency).catch(() => {});
  if (prev.geoOverride) await next.setGeoOverride(prev.geoOverride).catch(() => {});
  if (prev.timezone) await next.setTimezone(prev.timezone).catch(() => {});
  if (prev.userAgentOverride) await next.setUserAgentOverride(prev.userAgentOverride).catch(() => {});
  if (prev.locale) await next.setLocale(prev.locale).catch(() => {});
  if (prev.idleOverride) await next.setIdleOverride(prev.idleOverride).catch(() => {});
  if (prev.sensorOverride) await next.setSensorOverride(prev.sensorOverride).catch(() => {});
  if (prev.paintFlashing) await next.setPaintFlashing(true).catch(() => {});
  if (prev.webauthnEnabled) await next.setWebAuthn(true).catch(() => {});
}

export function useSessionManager(opts: SessionManagerOpts): SessionManager {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const mapRef = useRef(new Map<SessionKey, SessionEntry>());
  const [, bumpState] = useReducer((n: number) => n + 1, 0);
  const [activeKey, setActiveKey] = useState<SessionKey | null>(null);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const attachingRef = useRef(false);
  const quittingRef = useRef(false);
  const inFlightAttachRef = useRef<Promise<void> | null>(null);

  const setActive = useCallback((key: SessionKey | null) => {
    const prev = activeKeyRef.current;
    activeKeyRef.current = key;
    setActiveKey(key);
    const entry = key !== null ? mapRef.current.get(key) : undefined;
    if (entry) entry.lastViewedAt = Date.now();
    if (prev !== key) optsRef.current.onViewSwitch(prev, key);
  }, []);

  const fallbackActive = useCallback(() => {
    const candidates = [...mapRef.current.values()].filter(e => e.status !== 'closing');
    const next = candidates.sort((a, b) => b.lastViewedAt - a.lastViewedAt)[0] ?? null;
    setActive(next?.key ?? null);
  }, [setActive]);

  const applyEntryState = useCallback(async (entry: SessionEntry, session: DebugSession, prevSession?: DebugSession): Promise<void> => {
    // Snapshot before the awaits: entry.session is already the new session, so a
    // render during this window can run tool effects that patch entry.debug from
    // the new session's still-empty store.
    const dbg = entry.debug;
    const cfg = loadConfig();
    session.clearOnNav = cfg.clearOnNav ?? false;
    session.harSanitize = cfg.harSanitize ?? true;
    session.persistSanitize = cfg.persistSanitize ?? false;
    if (cfg.networkCap !== undefined) session.network.setCap(cfg.networkCap);
    if (entry.throttle === 'custom' && entry.customConditions) {
      const applied = await session.setCustomConditions(entry.customConditions).then(() => true, () => false);
      if (!applied) {
        entry.throttle = 'off';
        entry.customConditions = null;
      }
    } else if (entry.throttle !== 'off') {
      entry.throttle = await session.setThrottle(entry.throttle).then(() => entry.throttle, () => 'off' as ThrottleName);
    }
    if (entry.cacheDisabled) {
      entry.cacheDisabled = await session.setCacheDisabled(true).then(() => true, () => false);
    }
    const overrides = entry.overrides.filter(r => r.enabled);
    if (overrides.length) await session.setOverrides(overrides).catch(() => {});
    const blocked = entry.blocked.filter(p => p.enabled).map(p => p.pattern);
    if (blocked.length) await session.setBlocked(blocked).catch(() => {});
    const mapRemote = entry.mapRemote.filter(r => r.enabled);
    if (mapRemote.length) await session.setMapRemote(mapRemote).catch(() => {});
    if (dbg.enabled) {
      await session.enableDebugger().catch(() => {});
      if (dbg.pauseOnExceptions !== 'none') {
        await session.setPauseOnExceptions(dbg.pauseOnExceptions).catch(() => {});
      }
      for (const bp of dbg.breakpoints) {
        const spec = bp.kind && bp.kind !== 'line' && bp.condition !== undefined ? { kind: bp.kind, text: bp.condition } : undefined;
        await session.setBreakpointByUrl(bp.url, bp.line, spec).catch(() => {});
      }
      if (dbg.blackboxed.length) await session.setBlackboxedUrls(dbg.blackboxed).catch(() => {});
      for (const url of dbg.xhrBreakpoints) await session.addXhrBreakpoint(url).catch(() => {});
      for (const name of dbg.eventBreakpoints) await session.setEventBreakpoint(name, true).catch(() => {});
      for (const d of dbg.domBreakpoints) {
        await session
          .querySelector(d.selector)
          .then(nodeId => (nodeId === null ? undefined : session.setDomBreakpoint(nodeId, d.type, d.selector)))
          .catch(() => {});
      }
    }
    if (prevSession) await replayEmulation(prevSession, session);
  }, []);

  // Reconnection runs in a plain closure over mapRef, never in a per-session React
  // effect: the handler must survive re-renders and background sessions must not
  // depend on React state captured at registration time.
  const handleSessionClose = useCallback((key: SessionKey, session: DebugSession) => {
    void (async () => {
      const defer = (fn: () => void) => optsRef.current.whenNotEditing(fn);
      const entry = mapRef.current.get(key);
      if (!entry || entry.session !== session || entry.status === 'closing' || quittingRef.current) return;
      const gone = (): boolean => quittingRef.current || entry.status === 'closing' || mapRef.current.get(key) !== entry;
      const finalize = (kind: 'tabClosed' | 'connectionLost') => {
        entry.status = 'closing';
        const saved = !!entry.session.sessionDir;
        void entry.session.close().catch(() => {});
        mapRef.current.delete(key);
        defer(() => {
          if (activeKeyRef.current === key) fallbackActive();
          // Must run after fallbackActive: the fallback switch captures a view
          // snapshot for the dead key, which onSessionEnd then discards.
          optsRef.current.onSessionEnd?.(key);
          const name = entry.target.title || entry.target.url;
          optsRef.current.setToast(
            kind === 'connectionLost'
              ? msg('toast.connectionLost', { name })
              : msg(saved ? 'toast.tabClosedSaved' : 'toast.tabClosed', { name }),
            kind === 'connectionLost' ? 'error' : 'success',
          );
          bumpState();
        });
      };
      for (let i = 1; i <= 5; i++) {
        entry.status = 'reconnecting';
        entry.attempt = i;
        defer(bumpState);
        await sleep(optsRef.current.reconnectBaseMs * 2 ** (i - 1));
        if (gone()) return;
        let pages: PageTarget[];
        try {
          pages = await listPages(entry.ep);
        } catch {
          continue;
        }
        if (gone()) return;
        const target = pages.find(p => p.id === entry.target.id);
        if (!target) {
          finalize('tabClosed');
          return;
        }
        let next: DebugSession;
        try {
          next = await optsRef.current.attachFn(target, entry.ep);
        } catch {
          continue;
        }
        if (gone()) {
          void next.close().catch(() => {});
          return;
        }
        const prevSession = entry.session;
        void prevSession.close().catch(() => {});
        entry.session = next;
        entry.target = target;
        entry.status = 'live';
        entry.attempt = 0;
        next.on('close', () => handleSessionClose(key, next));
        await applyEntryState(entry, next, prevSession);
        defer(() => {
          if (activeKeyRef.current === key) optsRef.current.setToast(msg('toast.reconnected'), 'success');
          bumpState();
        });
        return;
      }
      finalize('connectionLost');
    })();
  }, [applyEntryState, fallbackActive]);

  const switchTo = useCallback((key: SessionKey) => {
    const entry = mapRef.current.get(key);
    if (!entry || entry.status === 'closing' || activeKeyRef.current === key) return;
    setActive(key);
    bumpState();
  }, [setActive]);

  const switchBy = useCallback((delta: number) => {
    const list = [...mapRef.current.values()].filter(e => e.status !== 'closing');
    if (list.length < 2) return;
    const idx = list.findIndex(e => e.key === activeKeyRef.current);
    const next = list[((idx < 0 ? 0 : idx) + delta + list.length) % list.length];
    switchTo(next.key);
  }, [switchTo]);

  const openSession = useCallback(
    async (t: PageTarget, tep: Endpoint) => {
      const key = sessionKey(tep, t.id);
      const existing = mapRef.current.get(key);
      if (existing && existing.status !== 'closing') {
        switchTo(key);
        return;
      }
      if (attachingRef.current) return;
      const cap = loadConfig().sessionCap ?? DEFAULT_SESSION_CAP;
      if (mapRef.current.size >= cap) {
        optsRef.current.setToast(msg('toast.sessionLimit', { n: cap }));
        return;
      }
      attachingRef.current = true;
      const work = (async () => {
        try {
          const session = await optsRef.current.attachFn(t, tep);
          if (quittingRef.current) {
            await session.close().catch(() => {});
            return;
          }
          const cfg = loadConfig();
          const configured = cfg.throttle;
          let throttle: ThrottleName = 'off';
          if (configured && configured !== 'off') {
            throttle = await session.setThrottle(configured).then(() => configured, () => 'off' as ThrottleName);
          }
          let cacheDisabled = false;
          if (cfg.cacheDisabled) {
            cacheDisabled = await session.setCacheDisabled(true).then(() => true, () => false);
          }
          session.clearOnNav = cfg.clearOnNav ?? false;
          session.harSanitize = cfg.harSanitize ?? true;
          session.persistSanitize = cfg.persistSanitize ?? false;
          if (cfg.networkCap !== undefined) session.network.setCap(cfg.networkCap);
          const now = Date.now();
          const entry: SessionEntry = {
            key,
            ep: tep,
            target: t,
            session,
            status: 'live',
            attempt: 0,
            throttle,
            cacheDisabled,
            customConditions: null,
            overrides: [],
            blocked: [],
            mapRemote: [],
            debug: emptyDebugState(),
            openedAt: now,
            lastViewedAt: now,
          };
          mapRef.current.set(key, entry);
          session.on('close', () => handleSessionClose(key, session));
          if (quittingRef.current) {
            mapRef.current.delete(key);
            await session.close().catch(() => {});
            return;
          }
          void activatePage(tep, t.id).catch(() => {});
          setActive(key);
          optsRef.current.setToast(msg('toast.attached', { name: t.title || t.url }), 'success');
          bumpState();
        } catch (e) {
          optsRef.current.setToast(msg('toast.attachFailed', { error: e instanceof Error ? e.message : String(e) }), 'error');
        } finally {
          attachingRef.current = false;
        }
      })();
      inFlightAttachRef.current = work;
      void work.finally(() => {
        if (inFlightAttachRef.current === work) inFlightAttachRef.current = null;
      });
      await work;
    },
    [handleSessionClose, setActive, switchTo],
  );

  const openUrl = useCallback(
    async (url: string, tep: Endpoint, opts?: { incognito?: boolean }) => {
      const { browserFor, tabs, setToast } = optsRef.current;
      const browser = browserFor(tep);
      if (!browser) {
        setToast(msg('toast.noBrowserSession'));
        return;
      }
      try {
        const targetId = await browser.createTab(url, opts);
        await tabs.refresh();
        if (quittingRef.current) return;
        const target = tabs.flat().find(t => t.id === targetId);
        if (target) await openSession(target, tep);
        else setToast(msg('toast.openedUrl', { url }), 'success');
      } catch (e) {
        setToast(msg('toast.openUrlFailed', { url, error: e instanceof Error ? e.message : String(e) }), 'error');
      }
    },
    [openSession],
  );

  const closeSession = useCallback(
    async (key: SessionKey): Promise<boolean> => {
      const entry = mapRef.current.get(key);
      if (!entry || entry.status === 'closing') return false;
      entry.status = 'closing';
      bumpState();
      await entry.session.close().catch(() => {});
      mapRef.current.delete(key);
      if (activeKeyRef.current === key) fallbackActive();
      optsRef.current.onSessionEnd?.(key);
      bumpState();
      return true;
    },
    [fallbackActive],
  );

  const patchEntry = useCallback((key: SessionKey, patch: EntryPatch) => {
    const entry = mapRef.current.get(key);
    if (!entry) return;
    Object.assign(entry, patch);
    bumpState();
  }, []);

  const sessions = useCallback(() => [...mapRef.current.values()], []);

  const quit = useCallback(() => {
    if (quittingRef.current) return;
    quittingRef.current = true;
    void (async () => {
      optsRef.current.tabs.stop();
      const inFlight = inFlightAttachRef.current;
      const all = [...mapRef.current.values()];
      for (const e of all) e.status = 'closing';
      await Promise.allSettled([...all.map(e => e.session.close()), ...(inFlight ? [inFlight] : [])]);
      const browsers = optsRef.current.browsers;
      if (browsers) for (const b of browsers.values()) b?.close();
      optsRef.current.exit();
    })();
  }, []);

  useEffect(() => registerQuit(quit), [quit]);

  const initialUrlRef = useRef(opts.initialUrl);
  useEffect(() => {
    const url = initialUrlRef.current;
    if (!url) return;
    const { ep, browserFor, setToast } = optsRef.current;
    initialUrlRef.current = undefined;
    if (!browserFor(ep)) {
      setToast(msg('toast.noBrowserSession'));
      return;
    }
    void openUrl(url, ep);
  }, [openUrl]);

  const active = (activeKey !== null ? mapRef.current.get(activeKey) : undefined) ?? null;
  const activeSession = active?.session;
  const activeTarget = active?.target;
  const activeEp = active?.ep;
  const attached = useMemo<Attached | null>(
    () => (activeSession && activeTarget && activeEp ? { session: activeSession, target: activeTarget, ep: activeEp } : null),
    [activeSession, activeTarget, activeEp],
  );
  const attachedRef = useRef(attached);
  attachedRef.current = attached;
  const reconnecting = active?.status === 'reconnecting' ? active.attempt : 0;

  return { attached, attachedRef, active, sessions, reconnecting, openSession, openUrl, switchTo, switchBy, closeSession, patchEntry, quit };
}
