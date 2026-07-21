import { useCallback, useRef, useState } from 'react';
import type { DebugSession } from '../../engine.js';
import type { CookieInfo, StorageUsage } from '../../cdp/storage.js';
import type { IdbEntry, IdbStoreMeta } from '../../cdp/indexeddb.js';
import type { CacheEntry, CacheInfo } from '../../cdp/cache-storage.js';
import type { SwRegView } from '../../cdp/service-worker.js';
import type { FrameNodeView } from '../../cdp/page-app.js';
import type { TrustTokenCount } from '../../cdp/storage.js';
import type { AppViewState, BackgroundViewState, BgSub, ConfirmClear, CookieAttrs, SharedStorageViewState, StorageEditing, StorageRow, StorageView } from '../panels/StorageOverlay.js';

const attrsOf = (c: CookieInfo): CookieAttrs => ({
  domain: c.domain, path: c.path, expires: c.expires,
  httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
  ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
  ...(c.partitionKeyObj ? { partitionKeyObj: c.partitionKeyObj } : {}),
});

const cookieRow = (c: CookieInfo): StorageRow => ({ key: c.name, value: c.value, attrs: attrsOf(c) });

export const IDB_PAGE_SIZE = 50;
export const CACHE_PAGE_SIZE = 50;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface StorageToolOpts {
  whenNotEditing?: (fn: () => void) => void;
}

export function useStorageTool({ whenNotEditing = fn => fn() }: StorageToolOpts = {}) {
  const [storageView, setStorageView] = useState<StorageView>('cookies');
  const [cookieRows, setCookieRows] = useState<StorageRow[]>([]);
  const [localRows, setLocalRows] = useState<StorageRow[]>([]);
  const [sessionRows, setSessionRows] = useState<StorageRow[]>([]);
  const [rawCookies, setRawCookies] = useState<CookieInfo[]>([]);
  const [storageSel, setStorageSel] = useState(0);
  const [storageFilter, setStorageFilter] = useState('');
  const [storageFilterEditing, setStorageFilterEditing] = useState(false);
  const [storageEditing, setStorageEditing] = useState<StorageEditing | null>(null);
  const [storageErr, setStorageErr] = useState<string | undefined>();
  const [confirmClear, setConfirmClear] = useState<ConfirmClear>(false);
  const [idbDbs, setIdbDbs] = useState<string[]>([]);
  const [idbStores, setIdbStores] = useState<IdbStoreMeta[]>([]);
  const [idbEntries, setIdbEntries] = useState<IdbEntry[]>([]);
  const [idbDb, setIdbDb] = useState<string | null>(null);
  const [idbStore, setIdbStore] = useState<string | null>(null);
  const [idbHasMore, setIdbHasMore] = useState(false);
  const [caches, setCaches] = useState<CacheInfo[]>([]);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [cacheOpen, setCacheOpen] = useState<CacheInfo | null>(null);
  const [cacheHasMore, setCacheHasMore] = useState(false);
  const [swRegs, setSwRegs] = useState<SwRegView[]>([]);
  const [swForce, setSwForce] = useState(false);
  const [swBypass, setSwBypass] = useState(false);
  const [appData, setAppData] = useState<AppViewState | null>(null);
  const [frames, setFrames] = useState<FrameNodeView[]>([]);
  const [bgSub, setBgSub] = useState<BgSub>('services');
  const [background, setBackground] = useState<BackgroundViewState | null>(null);
  const [shared, setShared] = useState<SharedStorageViewState | null>(null);
  const [trustTokens, setTrustTokens] = useState<TrustTokenCount[]>([]);
  const [quota, setQuota] = useState<StorageUsage | null>(null);
  const clearTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const idbLoading = useRef(false);
  const cacheLoading = useRef(false);
  const guard = useRef(whenNotEditing);
  guard.current = whenNotEditing;
  const pathRef = useRef({ storageView, idbDb, idbStore, cacheOpen, idbEntries, idbHasMore, cacheEntries, cacheHasMore, bgSub });
  pathRef.current = { storageView, idbDb, idbStore, cacheOpen, idbEntries, idbHasMore, cacheEntries, cacheHasMore, bgSub };

  const loadIdbStores = useCallback(async (session: DebugSession, db: string) => {
    setIdbStores([]);
    try {
      const stores = await session.idbStores(db);
      guard.current(() => setIdbStores(stores));
    } catch (e) {
      setStorageErr(`idb: ${errText(e)}`);
    }
  }, []);

  const loadIdbEntries = useCallback(async (session: DebugSession, db: string, store: string) => {
    idbLoading.current = true;
    setIdbEntries([]);
    setIdbHasMore(false);
    try {
      const page = await session.idbEntries(db, store, 0, IDB_PAGE_SIZE);
      guard.current(() => {
        setIdbEntries(page.entries);
        setIdbHasMore(page.hasMore);
      });
    } catch (e) {
      setStorageErr(`idb: ${errText(e)}`);
    } finally {
      idbLoading.current = false;
    }
  }, []);

  const loadMoreIdb = useCallback(async (session: DebugSession) => {
    const { idbDb: db, idbStore: store, idbEntries: loaded, idbHasMore: more } = pathRef.current;
    if (!db || !store || !more || idbLoading.current) return;
    idbLoading.current = true;
    try {
      const page = await session.idbEntries(db, store, loaded.length, IDB_PAGE_SIZE);
      guard.current(() => {
        setIdbEntries([...loaded, ...page.entries]);
        setIdbHasMore(page.hasMore);
      });
    } catch (e) {
      setStorageErr(`idb: ${errText(e)}`);
    } finally {
      idbLoading.current = false;
    }
  }, []);

  const loadCacheEntries = useCallback(async (session: DebugSession, cache: CacheInfo) => {
    cacheLoading.current = true;
    setCacheEntries([]);
    setCacheHasMore(false);
    try {
      const page = await session.cacheEntries(cache.id, 0, CACHE_PAGE_SIZE);
      guard.current(() => {
        setCacheEntries(page.entries);
        setCacheHasMore(page.entries.length < page.total);
      });
    } catch (e) {
      setStorageErr(`cache: ${errText(e)}`);
    } finally {
      cacheLoading.current = false;
    }
  }, []);

  const loadMoreCache = useCallback(async (session: DebugSession) => {
    const { cacheOpen: open, cacheEntries: loaded, cacheHasMore: more } = pathRef.current;
    if (!open || !more || cacheLoading.current) return;
    cacheLoading.current = true;
    try {
      const page = await session.cacheEntries(open.id, loaded.length, CACHE_PAGE_SIZE);
      guard.current(() => {
        const next = [...loaded, ...page.entries];
        setCacheEntries(next);
        setCacheHasMore(next.length < page.total);
      });
    } catch (e) {
      setStorageErr(`cache: ${errText(e)}`);
    } finally {
      cacheLoading.current = false;
    }
  }, []);

  const reloadView = useCallback(async (session: DebugSession, view: StorageView) => {
    try {
      if (view === 'cookies') {
        const cookies = await session.cookies();
        guard.current(() => {
          setRawCookies(cookies);
          setCookieRows(cookies.map(cookieRow));
        });
      } else if (view === 'local' || view === 'session') {
        const items = await session.storageItems(view === 'local');
        const rows = items.map(([key, value]) => ({ key, value }));
        guard.current(() => (view === 'local' ? setLocalRows(rows) : setSessionRows(rows)));
      } else if (view === 'idb') {
        const { idbDb: db, idbStore: store } = pathRef.current;
        if (db && store) await loadIdbEntries(session, db, store);
        else if (db) await loadIdbStores(session, db);
        else {
          const dbs = await session.idbDatabases();
          guard.current(() => setIdbDbs(dbs));
        }
      } else if (view === 'cache') {
        const open = pathRef.current.cacheOpen;
        if (open) await loadCacheEntries(session, open);
        else {
          const list = await session.cacheNames();
          guard.current(() => setCaches(list));
        }
      } else if (view === 'app') {
        const [manifest, installErrors, originTrials] = await Promise.all([
          session.appManifest(),
          session.installabilityErrors().catch(() => []),
          session.originTrials().catch(() => []),
        ]);
        guard.current(() => setAppData({
          manifestUrl: manifest.url,
          manifestRaw: manifest.raw,
          manifestErrors: manifest.errors,
          installErrors,
          originTrials,
        }));
      } else if (view === 'frames') {
        const tree = await session.frameTree();
        const withIso = await Promise.all(tree.map(async f => ({
          ...f,
          ...(await session.securityIsolation(f.id).catch(() => ({}))),
        })));
        guard.current(() => setFrames(withIso));
      } else if (view === 'background') {
        const sub = pathRef.current.bgSub;
        if (sub === 'preload') await session.enablePreloadTracking();
        else if (sub === 'reports') await session.enableReporting();
        guard.current(() => setBackground({
          sub,
          recording: session.bgRecording,
          events: session.bgEvents(),
          ruleSets: session.preloadRuleSets(),
          attempts: session.preloadAttempts(),
          reports: session.reportingReports(),
          endpoints: session.reportingEndpoints(),
        }));
      } else if (view === 'shared') {
        await session.enableSharedStorageTracking();
        const data = await session.sharedStorageData();
        guard.current(() => setShared(data));
      } else if (view === 'pst') {
        const tokens = await session.trustTokens();
        guard.current(() => setTrustTokens(tokens));
      } else {
        await session.enableServiceWorkers();
        guard.current(() => {
          setSwRegs(session.swRegistrations());
          setSwForce(session.swForceUpdate);
          setSwBypass(session.swBypass);
        });
      }
    } catch (e) {
      setStorageErr(errText(e));
    }
  }, [loadIdbEntries, loadIdbStores, loadCacheEntries]);

  const loadStorage = useCallback(async (session: DebugSession) => {
    setStorageErr(undefined);
    try {
      const cookies = await session.cookies();
      guard.current(() => {
        setRawCookies(cookies);
        setCookieRows(cookies.map(cookieRow));
      });
    } catch (e) {
      setStorageErr(`cookies: ${errText(e)}`);
    }
    try {
      const local = await session.storageItems(true);
      guard.current(() => setLocalRows(local.map(([key, value]) => ({ key, value }))));
    } catch (e) {
      setStorageErr(`local: ${errText(e)}`);
    }
    try {
      const sess = await session.storageItems(false);
      guard.current(() => setSessionRows(sess.map(([key, value]) => ({ key, value }))));
    } catch (e) {
      setStorageErr(`session: ${errText(e)}`);
    }
    try {
      const usage = await session.storageUsage();
      guard.current(() => setQuota(usage));
    } catch {
      guard.current(() => setQuota(null));
    }
    const view = pathRef.current.storageView;
    if (view !== 'cookies' && view !== 'local' && view !== 'session') await reloadView(session, view);
  }, [reloadView]);

  const resetNichePaths = useCallback(() => {
    setIdbDb(null);
    setIdbStore(null);
    setIdbStores([]);
    setIdbEntries([]);
    setIdbHasMore(false);
    setCacheOpen(null);
    setCacheEntries([]);
    setCacheHasMore(false);
  }, []);

  return {
    storageView,
    setStorageView,
    cookieRows,
    localRows,
    sessionRows,
    rawCookies,
    storageSel,
    setStorageSel,
    storageFilter,
    setStorageFilter,
    storageFilterEditing,
    setStorageFilterEditing,
    storageEditing,
    setStorageEditing,
    storageErr,
    setStorageErr,
    confirmClear,
    setConfirmClear,
    clearTimer,
    idbDbs,
    idbStores,
    idbEntries,
    idbDb,
    setIdbDb,
    idbStore,
    setIdbStore,
    idbHasMore,
    caches,
    cacheEntries,
    cacheOpen,
    setCacheOpen,
    cacheHasMore,
    swRegs,
    swForce,
    setSwForce,
    swBypass,
    setSwBypass,
    appData,
    frames,
    bgSub,
    setBgSub,
    background,
    setBackground,
    shared,
    trustTokens,
    quota,
    loadIdbStores,
    loadIdbEntries,
    loadMoreIdb,
    loadCacheEntries,
    loadMoreCache,
    resetNichePaths,
    loadStorage,
    reloadView,
  };
}

export type StorageTool = ReturnType<typeof useStorageTool>;
