import type { Key } from 'ink';
import {
  BG_SUBS,
  cookieExportText,
  filterStorageRows,
  formatCookieAttrs,
  isBaseView,
  storageViewRows,
  type StorageRow,
  type StorageView,
} from '../panels/StorageOverlay.js';
import type { Line } from '../overlays/DetailOverlay.js';
import { storageCopyText } from '../overlays/StorageDetailOverlay.js';
import { describeCacheBody } from '../../cdp/cache-storage.js';
import type { ListNav } from '../lib/keys.js';
import type { Attached } from '../hooks/use-session-manager.js';
import type { StorageTool } from '../hooks/use-storage-tool.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';

const VIEW_ORDER: StorageView[] = ['cookies', 'local', 'session', 'idb', 'cache', 'sw', 'app', 'frames', 'background', 'shared', 'pst'];

const SW_PUSH_DEFAULT = '{"title":"Test","body":"Test push"}';
const SW_SYNC_DEFAULT = 'test-tag';

type SetToast = (msg: string, level?: ToastLevel) => void;

export interface StorageKeyCtx {
  storage: StorageTool;
  attached: Attached | null;
  bodyH: number;
  listNav: ListNav;
  copyFn: (text: string) => Promise<void>;
  setToast: SetToast;
  setStorageDetail: (d: { row: StorageRow; view: StorageView } | null) => void;
  setStorageDetailScroll: (n: number) => void;
  withEditor: (initial: string, ext?: string, opts?: { readonly?: boolean }) => Promise<string | null>;
}

const copyText = (text: string, copyFn: (t: string) => Promise<void>, setToast: SetToast): void => {
  void copyFn(text).then(
    () => setToast(t('toast.copied'), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
};

const contentTypeOf = (headers: Array<[string, string]>): string =>
  headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';

export function handleStorageKey(ctx: StorageKeyCtx, input: string, key: Key): boolean {
  const { storage, attached, bodyH, listNav, copyFn, setToast, setStorageDetail, setStorageDetailScroll, withEditor } = ctx;
  const {
    storageView,
    setStorageView,
    rawCookies,
    storageSel,
    setStorageSel,
    storageFilter,
    setStorageFilter,
    setStorageFilterEditing,
    setStorageEditing,
    setStorageErr,
    confirmClear,
    setConfirmClear,
    clearTimer,
    idbDb,
    setIdbDb,
    idbStore,
    setIdbStore,
    idbStores,
    cacheOpen,
    setCacheOpen,
    caches,
    cacheEntries,
    swForce,
    setSwForce,
    swBypass,
    setSwBypass,
    swRegs,
    bgSub,
    setBgSub,
    setBackground,
    trustTokens,
    loadIdbStores,
    loadIdbEntries,
    loadMoreIdb,
    loadCacheEntries,
    loadMoreCache,
    resetNichePaths,
    loadStorage,
    reloadView,
  } = storage;
  const base = isBaseView(storageView);
  const idbDepth = storageView === 'idb' ? (idbStore ? 2 : idbDb ? 1 : 0) : 0;
  const cacheDepth = storageView === 'cache' ? (cacheOpen ? 1 : 0) : 0;
  const depth = idbDepth + cacheDepth;
  const rows = filterStorageRows(storageViewRows(storage), storageFilter);
  const row = rows[Math.min(storageSel, Math.max(0, rows.length - 1))];
  const page = Math.max(1, Math.floor((bodyH - 6) / 2));

  const goUp = (): void => {
    if (storageView === 'idb') {
      if (idbStore) setIdbStore(null);
      else setIdbDb(null);
    } else if (storageView === 'cache') {
      setCacheOpen(null);
    }
    setStorageSel(0);
  };

  const arm = (kind: 'store' | 'cache' | true, run: () => void): void => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (confirmClear === kind) {
      setConfirmClear(false);
      run();
    } else {
      setConfirmClear(kind);
      clearTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      clearTimer.current.unref?.();
    }
  };

  const fail = (e: unknown): void => setStorageErr(e instanceof Error ? e.message : String(e));

  if (key.escape) {
    const hadState = !!(storage.storageEditing || confirmClear || storage.storageErr || storageFilter);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setStorageEditing(null);
    setConfirmClear(false);
    setStorageErr(undefined);
    if (storageFilter) {
      setStorageFilter('');
      setStorageSel(0);
    }
    if (!hadState && depth > 0) goUp();
    return true;
  }
  if (input === 'l') {
    if (depth > 0) return true;
    setStorageView(v => VIEW_ORDER[(VIEW_ORDER.indexOf(v) + 1) % VIEW_ORDER.length]);
    setStorageSel(0);
    return true;
  }
  if (input === 'h') {
    if (depth > 0) {
      goUp();
      return true;
    }
    setStorageView(v => VIEW_ORDER[(VIEW_ORDER.indexOf(v) + VIEW_ORDER.length - 1) % VIEW_ORDER.length]);
    setStorageSel(0);
    return true;
  }
  if (input === '/') {
    setStorageFilterEditing(true);
    return true;
  }
  if (key.return) {
    if (!row) return true;
    if (base) {
      setStorageDetail({ row, view: storageView });
      setStorageDetailScroll(0);
      return true;
    }
    if (storageView === 'idb' && attached) {
      if (idbDepth === 0) {
        setIdbDb(row.key);
        setIdbStore(null);
        setStorageSel(0);
        if (storageFilter) setStorageFilter('');
        void loadIdbStores(attached.session, row.key);
      } else if (idbDepth === 1) {
        setIdbStore(row.key);
        setStorageSel(0);
        if (storageFilter) setStorageFilter('');
        void loadIdbEntries(attached.session, idbDb!, row.key);
      } else {
        setStorageDetail({ row, view: 'idb' });
        setStorageDetailScroll(0);
      }
      return true;
    }
    if (storageView === 'cache' && attached) {
      if (cacheDepth === 0) {
        const cache = caches.find(c => c.name === row.key);
        if (!cache) return true;
        setCacheOpen(cache);
        setStorageSel(0);
        if (storageFilter) setStorageFilter('');
        void loadCacheEntries(attached.session, cache);
      } else {
        const entry = cacheEntries.find(e => e.url === row.key);
        if (!entry || !cacheOpen) return true;
        void (async () => {
          try {
            const body = await attached.session.cachedResponseBody(cacheOpen.id, entry.url, entry.reqHeaders);
            const { text, bytes } = describeCacheBody(body, contentTypeOf(entry.headers));
            setStorageDetail({
              row: {
                ...row,
                value: text ?? t('storage.cache.binary', { n: bytes }),
                ...(text === null ? { note: t('storage.cache.binaryNote') } : {}),
              },
              view: 'cache',
            });
            setStorageDetailScroll(0);
          } catch (e) {
            fail(e);
          }
        })();
      }
      return true;
    }
    if (storageView === 'app' || storageView === 'frames' || storageView === 'background' || storageView === 'shared') {
      if (row.value) {
        setStorageDetail({ row, view: storageView });
        setStorageDetailScroll(0);
      }
      return true;
    }
    return true;
  }
  if (listNav(input, key, rows.length, setStorageSel, page)) {
    if (attached && (storageSel + page >= rows.length || input === 'G')) {
      if (idbDepth === 2 && storage.idbHasMore) void loadMoreIdb(attached.session);
      else if (cacheDepth === 1 && storage.cacheHasMore) void loadMoreCache(attached.session);
    }
    return true;
  }
  if (input === 'y') {
    if (row) copyText(base ? row.value : row.value || row.key, copyFn, setToast);
    return true;
  }
  if (input === 'Y') {
    if (storageView === 'cookies' && rawCookies.length) {
      void copyFn(cookieExportText(rawCookies)).then(
        () => setToast(t('toast.cookiesExported', { n: rawCookies.length }), 'success'),
        () => setToast(t('toast.copyFailed'), 'error'),
      );
    }
    return true;
  }
  if (input === 'u' && storageView === 'sw') {
    if (attached) {
      const next = !swForce;
      void attached.session.setSwForceUpdate(next).then(() => setSwForce(next), fail);
    }
    return true;
  }
  if (input === 'B' && storageView === 'sw') {
    if (attached) {
      const next = !swBypass;
      void attached.session.setSwBypass(next).then(() => setSwBypass(next), fail);
    }
    return true;
  }
  if (storageView === 'sw' && (input === 'p' || input === 's' || input === 'S' || input === 'P')) {
    const reg = swRegs.find(r => r.scope === row?.key);
    if (!reg) {
      setStorageErr(t('storage.sw.noReg'));
      return true;
    }
    if (input === 'p') setStorageEditing({ key: t('storage.sw.pushLabel'), value: SW_PUSH_DEFAULT, sw: { kind: 'push', reg, lastChance: false } });
    else if (input === 'P') setStorageEditing({ key: t('storage.sw.periodicLabel'), value: SW_SYNC_DEFAULT, sw: { kind: 'periodicSync', reg, lastChance: false } });
    else setStorageEditing({ key: t('storage.sw.syncLabel'), value: SW_SYNC_DEFAULT, sw: { kind: 'sync', reg, lastChance: input === 'S' } });
    return true;
  }
  if (storageView === 'background') {
    if (input === 'T') {
      setBgSub(s => BG_SUBS[(BG_SUBS.indexOf(s) + 1) % BG_SUBS.length]);
      setStorageSel(0);
      return true;
    }
    if (input === 'r' && bgSub === 'services' && attached) {
      const session = attached.session;
      const next = !session.bgRecording;
      void session.setBgRecording(next).then(
        () => setBackground(prev => (prev ? { ...prev, recording: next, events: session.bgEvents() } : prev)),
        fail,
      );
      return true;
    }
  }
  if (input === 'd' && storageView === 'pst' && attached && row) {
    const tok = trustTokens.find(tk => tk.issuerOrigin === row.key);
    if (tok) {
      void (async () => {
        try {
          await attached.session.clearTrustTokens(tok.issuerOrigin);
          await reloadView(attached.session, 'pst');
        } catch (e) {
          fail(e);
        }
      })();
    }
    return true;
  }
  if (input === 'e') {
    if (base) {
      if (row) setStorageEditing({ key: row.key, value: row.value, isNew: false });
      return true;
    }
    if (idbDepth === 2 && attached && row && idbDb && idbStore) {
      if (row.note) {
        setStorageErr(t('storage.idb.editShallow'));
        return true;
      }
      const meta = idbStores.find(s => s.name === idbStore);
      if (!meta?.keyPath && !row.idbKey) {
        setStorageErr(t('storage.idb.keyUnsupported'));
        return true;
      }
      void (async () => {
        const edited = await withEditor(row.value, 'json');
        if (edited === null || edited.trim() === row.value.trim()) return;
        try {
          JSON.parse(edited);
        } catch {
          setStorageErr(t('storage.idb.editParse'));
          return;
        }
        try {
          await attached.session.idbPutEntry(idbDb, idbStore, row.idbKey ?? null, edited.trim());
          await loadIdbEntries(attached.session, idbDb, idbStore);
        } catch (e) {
          fail(e);
        }
      })();
      return true;
    }
    return true;
  }
  if (input === 'a') {
    if (storageView === 'cookies' && row?.attrs) setStorageEditing({ key: row.key, value: formatCookieAttrs(row.attrs), attrs: true });
    return true;
  }
  if (input === 'n') {
    if (base) setStorageEditing({ key: '(new)', value: '', isNew: true });
    return true;
  }
  if (input === 'd' && attached && row) {
    if (base) {
      void (async () => {
        try {
          if (storageView === 'cookies') {
            if (row.attrs) await attached.session.deleteCookie({ name: row.key, domain: row.attrs.domain, path: row.attrs.path, ...(row.attrs.partitionKeyObj ? { partitionKey: row.attrs.partitionKeyObj } : {}) });
          } else {
            await attached.session.removeStorageItem(storageView === 'local', row.key);
          }
          await reloadView(attached.session, storageView);
        } catch (e) {
          fail(e);
        }
      })();
      return true;
    }
    if (idbDepth === 2 && idbDb && idbStore) {
      if (!row.idbKey) {
        setStorageErr(t('storage.idb.keyUnsupported'));
        return true;
      }
      const rangeKey = row.idbKey;
      void (async () => {
        try {
          await attached.session.idbDeleteEntry(idbDb, idbStore, rangeKey);
          await loadIdbEntries(attached.session, idbDb, idbStore);
        } catch (e) {
          fail(e);
        }
      })();
      return true;
    }
    if (cacheDepth === 1 && cacheOpen) {
      void (async () => {
        try {
          await attached.session.deleteCacheEntry(cacheOpen.id, row.key);
          await loadCacheEntries(attached.session, cacheOpen);
        } catch (e) {
          fail(e);
        }
      })();
      return true;
    }
    return true;
  }
  if (input === 'D' && attached) {
    if (idbDepth === 2 && idbDb && idbStore) {
      arm('store', () => {
        void (async () => {
          try {
            await attached.session.idbClearStore(idbDb, idbStore);
            await loadIdbEntries(attached.session, idbDb, idbStore);
          } catch (e) {
            fail(e);
          }
        })();
      });
      return true;
    }
    if (storageView === 'cache' && cacheDepth === 0 && row) {
      const cache = caches.find(c => c.name === row.key);
      if (!cache) return true;
      arm('cache', () => {
        void (async () => {
          try {
            await attached.session.deleteCache(cache.id);
            setStorageSel(0);
            await reloadView(attached.session, 'cache');
          } catch (e) {
            fail(e);
          }
        })();
      });
      return true;
    }
    return true;
  }
  if (input === 'X') {
    arm(true, () => {
      if (!attached) return;
      void (async () => {
        try {
          await attached.session.clearSiteData();
          resetNichePaths();
          setStorageSel(0);
          await loadStorage(attached.session);
        } catch (e) {
          fail(e);
        }
      })();
    });
    return true;
  }
  return false;
}

export interface StorageDetailKeyCtx {
  row: StorageRow;
  lines: Line[];
  maxScroll: number;
  pageH: number;
  gPending: { current: boolean };
  setStorageDetail: (d: { row: StorageRow; view: StorageView } | null) => void;
  setStorageDetailScroll: React.Dispatch<React.SetStateAction<number>>;
  copyFn: (text: string) => Promise<void>;
  setToast: SetToast;
  withEditor: (initial: string, ext?: string, opts?: { readonly?: boolean }) => Promise<string | null>;
}

export function handleStorageDetailKey(ctx: StorageDetailKeyCtx, input: string, key: Key): boolean {
  const { row, lines, maxScroll, pageH, gPending, setStorageDetail, setStorageDetailScroll, copyFn, setToast, withEditor } = ctx;
  if (key.escape || input === 'q') {
    setStorageDetail(null);
    setStorageDetailScroll(0);
    return true;
  }
  if (input === 'y') {
    copyText(row.value, copyFn, setToast);
    return true;
  }
  if (input === 'e') {
    void withEditor(storageCopyText(row), 'txt', { readonly: true });
    return true;
  }
  const page = Math.max(1, Math.floor(pageH / 2));
  if (key.downArrow || input === 'j') setStorageDetailScroll(s => Math.min(s + 1, maxScroll));
  else if (key.upArrow || input === 'k') setStorageDetailScroll(s => Math.max(0, s - 1));
  else if (key.ctrl && input === 'd') setStorageDetailScroll(s => Math.min(s + page, maxScroll));
  else if (key.ctrl && input === 'u') setStorageDetailScroll(s => Math.max(0, s - page));
  else if (input === 'G') setStorageDetailScroll(maxScroll);
  else if (input === 'g') {
    if (gPending.current) {
      gPending.current = false;
      setStorageDetailScroll(0);
    } else {
      gPending.current = true;
    }
  }
  return true;
}
