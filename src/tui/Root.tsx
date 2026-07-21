import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, useApp, useInput, type Key } from 'ink';
import { scanEndpoints, type Endpoint } from '../cdp/discovery.js';
import { activatePage, listPages } from '../cdp/targets.js';
import { BrowserSession } from '../cdp/browser.js';
import { epKey, MultiTabs } from './lib/multi-tabs.js';
import { detectBrowsers, type BrowserCandidate } from '../browser/detect.js';
import { launchBrowser, ProfileRestrictedError, type LaunchOptions, type ProfileMode } from '../browser/launch.js';
import { loadConfig } from '../config.js';
import { App, type AppProps } from './App.js';
import { Picker } from './Picker.js';
import { dispatchInput } from './lib/keys.js';
import { t, useLang } from './lib/i18n.js';

export interface RootProps {
  initialEndpoint: Endpoint | null;
  port: number;
  initialUrl?: string;
  initialProfile?: ProfileMode;
  detect?: () => Promise<BrowserCandidate[]>;
  launch?: (c: BrowserCandidate, opts: LaunchOptions) => Promise<Endpoint>;
  makeBrowser?: (ep: Endpoint) => Promise<BrowserSession | null>;
  scan?: (ports: number[]) => Promise<Endpoint[]>;
  appProps?: Partial<AppProps>;
}

interface Attachment {
  endpoints: Endpoint[];
  tabs: MultiTabs;
  browsers: Map<string, BrowserSession | null>;
}

export function Root({ initialEndpoint, port, initialUrl, initialProfile = 'existing', detect, launch, makeBrowser, scan, appProps }: RootProps) {
  const { exit } = useApp();
  useLang();
  const detectFn = detect ?? (() => detectBrowsers());
  const launchFn = launch ?? launchBrowser;
  const makeBrowserFn = makeBrowser ?? ((ep: Endpoint) => BrowserSession.connect(ep).catch(() => null));
  const scanFn = scan ?? ((ports: number[]) => scanEndpoints(ports));

  const [endpoint, setEndpoint] = useState<Endpoint | null>(initialEndpoint);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [candidates, setCandidates] = useState<BrowserCandidate[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [profile, setProfile] = useState<ProfileMode>(initialProfile);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const busyRef = useRef(false);

  useEffect(() => {
    if (initialEndpoint) return;
    let cancelled = false;
    detectFn().then(
      cs => { if (!cancelled) setCandidates(cs); },
      () => { if (!cancelled) setCandidates([]); },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    let created: Attachment | null = null;
    // Consumes Windows' one-shot foreground grant (from spawning chrome.exe) so later
    // /json/activate calls on tab switches only flash the taskbar instead of stealing
    // focus from the terminal.
    void listPages(endpoint)
      .then(pages => (pages[0] ? activatePage(endpoint, pages[0].id) : undefined))
      .catch(() => {});
    void (async () => {
      const ports = [...new Set([endpoint.port, ...(loadConfig().ports ?? [])])];
      const scanned = await scanFn(ports).catch(() => [] as Endpoint[]);
      const byKey = new Map<string, Endpoint>();
      byKey.set(epKey(endpoint), endpoint);
      for (const e of scanned) if (!byKey.has(epKey(e))) byKey.set(epKey(e), e);
      const endpoints = [...byKey.values()];
      const browsers = new Map<string, BrowserSession | null>();
      await Promise.all(endpoints.map(async e => {
        browsers.set(epKey(e), await makeBrowserFn(e));
      }));
      if (cancelled) {
        for (const b of browsers.values()) b?.close();
        return;
      }
      const tabs = new MultiTabs(endpoints, e => {
        const b = browsers.get(epKey(e));
        return b ? (id: string) => b.windowIdFor(id) : undefined;
      });
      tabs.start();
      created = { endpoints, tabs, browsers };
      setAttachment(created);
    })();
    return () => {
      cancelled = true;
      created?.tabs.stop();
      if (created) for (const b of created.browsers.values()) b?.close();
    };
  }, [endpoint]);

  const doLaunch = useCallback(async () => {
    const c = candidates?.[Math.min(selected, Math.max(0, (candidates?.length ?? 1) - 1))];
    if (!c || busyRef.current) return;
    busyRef.current = true;
    setError(undefined);
    try {
      setBusy(t('root.launching', { name: c.name, profile }));
      const ep = await launchFn(c, { port, profile });
      setBusy(undefined);
      setEndpoint(ep);
    } catch (e) {
      if (e instanceof ProfileRestrictedError && profile === 'existing') {
        try {
          setBusy(t('root.retryToolProfile', { name: c.name }));
          const ep = await launchFn(c, { port, profile: 'tool' });
          setBusy(undefined);
          setProfile('tool');
          setEndpoint(ep);
          return;
        } catch (e2) {
          setBusy(undefined);
          setError(e2 instanceof Error ? e2.message : String(e2));
          busyRef.current = false;
          return;
        }
      }
      setBusy(undefined);
      setError(e instanceof Error ? e.message : String(e));
      busyRef.current = false;
    }
  }, [candidates, launchFn, port, profile, selected]);

  const handleKey = (input: string, key: Key) => {
    if ((key.ctrl && input === 'c') || input === 'q') { exit(); return; }
    if (endpoint) return;
    if (!candidates?.length) return;
    if (key.downArrow || input === 'j') setSelected(i => Math.min(i + 1, candidates.length - 1));
    if (key.upArrow || input === 'k') setSelected(i => Math.max(0, i - 1));
    if (input === 'p') setProfile(p => (p === 'existing' ? 'tool' : 'existing'));
    if (key.return) void doLaunch();
  };

  useInput((input, key) => dispatchInput(input, key, handleKey), { isActive: !attachment });

  if (attachment) {
    return (
      <App
        ep={attachment.endpoints[0]}
        tabs={attachment.tabs}
        browsers={attachment.browsers}
        initialUrl={initialUrl}
        {...appProps}
      />
    );
  }
  if (endpoint) {
    return <Text dimColor>{t('root.connecting')}{endpoint.via === 'wsl-relay' ? ` · ${t('root.viaRelay')}` : ''}</Text>;
  }
  if (!candidates) {
    return <Text dimColor>{t('root.scanning')}</Text>;
  }
  return (
    <Picker
      candidates={candidates}
      selected={Math.min(selected, Math.max(0, candidates.length - 1))}
      profile={profile}
      busy={busy}
      error={error}
    />
  );
}
