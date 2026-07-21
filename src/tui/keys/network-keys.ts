import type { Key } from 'ink';
import type { BlockPattern, DebugSession, MapRemoteRule, OverrideRule, ThrottleName } from '../../engine.js';
import { loadConfig } from '../../config.js';
import type { NetworkEntry } from '../../store/types.js';
import { bucketToRange, rangeToBuckets, timelineSpan } from '../lib/timeline.js';
import { buildCurl, buildFetch, buildNodeFetch } from '../lib/curl.js';
import { buildHar, type HarMeta } from '../../persist/har.js';
import { groupKeyOf } from '../lib/net-group.js';
import { formatRequestText, parseRequestText } from '../lib/request-text.js';
import { formatOverrideText, parseOverrideText } from '../lib/override-text.js';
import { formatMapRemoteText, parseMapRemoteText } from '../lib/map-remote-text.js';
import { effectiveConditions, formatConditionsText, isUnthrottled, parseConditionsText } from '../lib/conditions-text.js';
import { applyCacheDisabled, applyThrottle, cycleThrottle, exportSessionHar } from '../lib/session-actions.js';
import { WINDOWS } from '../lib/windows.js';
import type { DetailTab } from '../overlays/DetailOverlay.js';
import type { FollowNav } from '../lib/keys.js';
import type { Attached } from '../hooks/use-session-manager.js';
import type { NetworkTool } from '../hooks/use-network-tool.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';

export interface NetworkKeyCtx {
  net: NetworkTool;
  attached: Attached | null;
  bodyH: number;
  columns: number;
  tlEntries: NetworkEntry[];
  tlNow: number;
  netEntries: NetworkEntry[];
  markedEntries: NetworkEntry[];
  clampedNetSel: number;
  selEntry: NetworkEntry | undefined;
  throttle: ThrottleName;
  cacheDisabled: boolean;
  setThrottleState: (t: ThrottleName) => void;
  setCacheDisabledState: (v: boolean) => void;
  overrideRulesRef: { current: OverrideRule[] };
  overrideSeq: { current: number };
  setOverrideRules: (rules: OverrideRule[]) => void;
  setOverrideManager: (v: boolean) => void;
  blockedPatternsRef: { current: BlockPattern[] };
  setBlockTarget: (entry: NetworkEntry | null) => void;
  setBlockManager: (v: boolean) => void;
  mapRemoteRef: { current: MapRemoteRule[] };
  mapSeq: { current: number };
  setMapRemoteRules: (rules: MapRemoteRule[]) => void;
  setMapManager: (v: boolean) => void;
  setNetDiff: (v: { a: NetworkEntry; b: NetworkEntry } | null) => void;
  setNetDiffScroll: (n: number) => void;
  setDetailEntry: (entry: NetworkEntry | null) => void;
  setDetailTab: (tab: DetailTab) => void;
  setDetailScroll: (scroll: number) => void;
  setDetailOpen: (open: boolean) => void;
  setToast: (msg: string, level?: ToastLevel) => void;
  copyFn: (text: string) => Promise<void>;
  exportHarFn: (session: DebugSession, entries?: NetworkEntry[]) => Promise<string>;
  withEditor: (initial: string, ext?: string) => Promise<string | null>;
  followNav: FollowNav;
}

export interface DetailOpener {
  setDetailEntry: (entry: NetworkEntry | null) => void;
  setDetailTab: (tab: DetailTab) => void;
  setDetailScroll: (scroll: number) => void;
  setDetailOpen: (open: boolean) => void;
}

type SetToast = (msg: string, level?: ToastLevel) => void;

export function openTimelineSelect(net: NetworkTool, tlEntries: NetworkEntry[], tlNow: number, tlWidth: number): void {
  const span = timelineSpan(tlEntries, tlNow);
  net.setTlCursor(net.tlRange && span ? rangeToBuckets(span, tlWidth, net.tlRange)[1] : tlWidth - 1);
  net.setTlAnchor(null);
  net.setTlSelect(true);
}

export function cycleTimeWindow(net: NetworkTool): void {
  net.setWin(w => (w + 1) % WINDOWS.length);
  net.setNetSel(0);
  net.setNetSelId(null);
}

export function clearNetworkLog(net: NetworkTool, session: DebugSession | undefined, setToast: SetToast): void {
  session?.network.clear();
  net.setNetSel(0);
  net.setNetSelId(null);
  net.setNetFollow(true);
  net.setTlAnchor(null);
  net.setTlRange(null);
  net.setMarked(new Set());
  setToast(t('toast.logCleared'), 'success');
}

export function toggleMark(net: NetworkTool, entry: NetworkEntry): void {
  net.setMarked(prev => {
    const next = new Set(prev);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    return next;
  });
}

export function openOverrideManager(
  overrideRulesRef: { current: OverrideRule[] },
  setOverrideManager: (v: boolean) => void,
  setToast: SetToast,
): void {
  if (!overrideRulesRef.current.length) {
    setToast(t('toast.noOverrideRules'));
    return;
  }
  setOverrideManager(true);
}

export function openBlockManager(
  blockedPatternsRef: { current: BlockPattern[] },
  setBlockManager: (v: boolean) => void,
  setToast: SetToast,
): void {
  if (!blockedPatternsRef.current.length) {
    setToast(t('toast.noBlockPatterns'));
    return;
  }
  setBlockManager(true);
}

export function copyEntryCurl(entry: NetworkEntry, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  void copyFn(buildCurl(entry, { redact: loadConfig().copyRedact === true })).then(
    () => setToast(t('toast.curlCopied'), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function copyEntryFetch(entry: NetworkEntry, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  void copyFn(buildFetch(entry, { redact: loadConfig().copyRedact === true })).then(
    () => setToast(t('toast.fetchCopied'), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function copyEntryNodeFetch(entry: NetworkEntry, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  void copyFn(buildNodeFetch(entry, { redact: loadConfig().copyRedact === true })).then(
    () => setToast(t('toast.nodeFetchCopied'), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function copyEntryUrl(entry: NetworkEntry, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  void copyFn(entry.url).then(
    () => setToast(t('toast.urlCopied'), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function copyEntryBody(entry: NetworkEntry, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  if (entry.body === undefined) {
    setToast(t('toast.noResponseBody'));
    return;
  }
  let text = entry.body;
  let keptBase64 = false;
  if (entry.bodyBase64) {
    const decoded = Buffer.from(entry.body, 'base64').toString('utf8');
    if (decoded.includes(String.fromCharCode(0xfffd))) keptBase64 = true;
    else text = decoded;
  }
  const okKey = keptBase64 ? 'toast.bodyCopiedBase64' : entry.bodyTruncated ? 'toast.bodyCopiedTruncated' : 'toast.bodyCopied';
  void copyFn(text).then(
    () => setToast(t(okKey), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function applyNetCopy(choice: string, entry: NetworkEntry, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  if (choice === 'curl') copyEntryCurl(entry, copyFn, setToast);
  else if (choice === 'fetch') copyEntryFetch(entry, copyFn, setToast);
  else if (choice === 'node-fetch') copyEntryNodeFetch(entry, copyFn, setToast);
  else if (choice === 'body') copyEntryBody(entry, copyFn, setToast);
  else if (choice === 'url') copyEntryUrl(entry, copyFn, setToast);
}

function copyAll(
  entries: NetworkEntry[],
  render: (e: NetworkEntry) => string,
  join: string,
  okKey: 'toast.copiedAllUrls' | 'toast.copiedAllCurl' | 'toast.copiedAllFetch',
  copyFn: (text: string) => Promise<void>,
  setToast: SetToast,
): void {
  if (!entries.length) {
    setToast(t('toast.copyNothing'));
    return;
  }
  void copyFn(entries.map(render).join(join)).then(
    () => setToast(t(okKey, { n: entries.length }), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function copyAllHar(entries: NetworkEntry[], meta: HarMeta, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  if (!entries.length) {
    setToast(t('toast.copyNothing'));
    return;
  }
  void copyFn(JSON.stringify(buildHar(entries, meta), null, 2)).then(
    () => setToast(t('toast.copiedAllHar', { n: entries.length }), 'success'),
    () => setToast(t('toast.copyFailed'), 'error'),
  );
}

export function applyNetCopyAll(choice: string, entries: NetworkEntry[], meta: HarMeta, copyFn: (text: string) => Promise<void>, setToast: SetToast): void {
  const redact = loadConfig().copyRedact === true;
  if (choice === 'all-urls') copyAll(entries, e => e.url, '\n', 'toast.copiedAllUrls', copyFn, setToast);
  else if (choice === 'all-curl') copyAll(entries, e => buildCurl(e, { redact }), '\n\n', 'toast.copiedAllCurl', copyFn, setToast);
  else if (choice === 'all-fetch') copyAll(entries, e => buildFetch(e, { redact }), '\n\n', 'toast.copiedAllFetch', copyFn, setToast);
  else if (choice === 'all-har') copyAllHar(entries, meta, copyFn, setToast);
}

export function resendEntry(session: DebugSession, entry: NetworkEntry, setToast: SetToast): void {
  void session.sendRequest({ method: entry.method, url: entry.url, headers: entry.requestHeaders, body: entry.postData }).then(
    () => setToast(t('toast.resent'), 'success'),
    () => setToast(t('toast.resendFailed'), 'error'),
  );
}

export function editAndResendEntry(
  session: DebugSession,
  entry: NetworkEntry,
  withEditor: (initial: string, ext?: string) => Promise<string | null>,
  setToast: SetToast,
): void {
  void (async () => {
    const initial = formatRequestText(entry);
    const edited = await withEditor(initial, 'http');
    if (edited === null) return;
    // Trailing whitespace is insignificant: parseRequestText strips it from the body.
    if (edited.replace(/\s+$/, '') === initial.replace(/\s+$/, '')) {
      setToast(t('toast.resendCanceled'));
      return;
    }
    const req = parseRequestText(edited);
    if (!req) {
      setToast(t('toast.requestParseFailed'), 'error');
      return;
    }
    try {
      await session.sendRequest(req);
      setToast(t('toast.resent'), 'success');
    } catch {
      setToast(t('toast.resendFailed'), 'error');
    }
  })();
}

export function addOverrideForEntry(
  session: DebugSession,
  entry: NetworkEntry,
  withEditor: (initial: string, ext?: string) => Promise<string | null>,
  overrideRulesRef: { current: OverrideRule[] },
  overrideSeq: { current: number },
  setOverrideRules: (rules: OverrideRule[]) => void,
  setToast: SetToast,
): void {
  void (async () => {
    const initial = formatOverrideText(entry);
    const edited = await withEditor(initial, 'txt');
    if (edited === null) return;
    // Trailing whitespace is insignificant: parseOverrideText strips it from the body.
    if (edited.replace(/\s+$/, '') === initial.replace(/\s+$/, '')) {
      setToast(t('toast.overrideCanceled'));
      return;
    }
    const draft = parseOverrideText(edited);
    if (!draft) {
      setToast(t('toast.ruleParseFailed'), 'error');
      return;
    }
    const next = [...overrideRulesRef.current, { ...draft, id: `ov-${overrideSeq.current++}`, enabled: true }];
    setOverrideRules(next);
    try {
      await session.setOverrides(next.filter(r => r.enabled));
      setToast(t('toast.overrideActive'), 'success');
    } catch {
      setToast(t('toast.overrideFailed'), 'error');
    }
  })();
}

export function openDiffForMarked(
  markedEntries: NetworkEntry[],
  setNetDiff: (v: { a: NetworkEntry; b: NetworkEntry } | null) => void,
  setNetDiffScroll: (n: number) => void,
  setToast: SetToast,
): void {
  if (markedEntries.length !== 2) {
    setToast(t('toast.diffNeedTwo'));
    return;
  }
  setNetDiff({ a: markedEntries[0], b: markedEntries[1] });
  setNetDiffScroll(0);
}

export function openMapRemoteManager(
  mapRemoteRef: { current: MapRemoteRule[] },
  setMapManager: (v: boolean) => void,
  setToast: SetToast,
): void {
  if (!mapRemoteRef.current.length) {
    setToast(t('toast.noMapRemoteRules'));
    return;
  }
  setMapManager(true);
}

export function addMapRemoteForEntry(
  session: DebugSession,
  entry: NetworkEntry,
  withEditor: (initial: string, ext?: string) => Promise<string | null>,
  mapRemoteRef: { current: MapRemoteRule[] },
  mapSeq: { current: number },
  setMapRemoteRules: (rules: MapRemoteRule[]) => void,
  setToast: SetToast,
): void {
  void (async () => {
    const edited = await withEditor(formatMapRemoteText(entry.url), 'txt');
    if (edited === null) return;
    const draft = parseMapRemoteText(edited);
    if (!draft) {
      setToast(t('toast.ruleParseFailed'), 'error');
      return;
    }
    if (draft.pattern === entry.url && draft.target === entry.url) {
      setToast(t('toast.mapRemoteCanceled'));
      return;
    }
    const next = [...mapRemoteRef.current, { ...draft, id: `mr-${mapSeq.current++}`, enabled: true }];
    setMapRemoteRules(next);
    try {
      await session.setMapRemote(next.filter(r => r.enabled));
      setToast(t('toast.mapRemoteActive'), 'success');
    } catch {
      setToast(t('toast.mapRemoteFailed'), 'error');
    }
  })();
}

export function editNetworkConditions(
  session: DebugSession,
  withEditor: (initial: string, ext?: string) => Promise<string | null>,
  setThrottleState: (v: ThrottleName) => void,
  setToast: SetToast,
): void {
  void (async () => {
    const initial = formatConditionsText(effectiveConditions(session.throttle, session.customConditions));
    const edited = await withEditor(initial, 'txt');
    if (edited === null) return;
    if (edited.trim() === '' || edited.replace(/\s+$/, '') === initial.replace(/\s+$/, '')) {
      setToast(t('toast.conditionsCanceled'));
      return;
    }
    const parsed = parseConditionsText(edited);
    if (!parsed) {
      setToast(t('toast.conditionsParseFailed'), 'error');
      return;
    }
    try {
      await session.setCustomConditions(isUnthrottled(parsed) ? null : parsed);
      setThrottleState(session.throttle);
      setToast(`throttle:${session.throttle}`);
    } catch {
      setToast(t('toast.conditionsFailed'), 'error');
    }
  })();
}

export function openBlockPicker(net: NetworkTool, entry: NetworkEntry, setBlockTarget: (entry: NetworkEntry | null) => void): void {
  setBlockTarget(entry);
  net.setNetPicker('block');
}

export function openEntryDetail(entry: NetworkEntry, opener: DetailOpener): void {
  opener.setDetailEntry(entry);
  opener.setDetailTab('summary');
  opener.setDetailScroll(0);
  opener.setDetailOpen(true);
}

export function handleNetworkKey(ctx: NetworkKeyCtx, input: string, key: Key): boolean {
  const {
    net,
    attached,
    bodyH,
    columns,
    tlEntries,
    tlNow,
    netEntries,
    markedEntries,
    clampedNetSel,
    selEntry,
    throttle,
    cacheDisabled,
    setThrottleState,
    setCacheDisabledState,
    overrideRulesRef,
    overrideSeq,
    setOverrideRules,
    setOverrideManager,
    blockedPatternsRef,
    setBlockTarget,
    setBlockManager,
    mapRemoteRef,
    mapSeq,
    setMapRemoteRules,
    setMapManager,
    setNetDiff,
    setNetDiffScroll,
    setDetailEntry,
    setDetailTab,
    setDetailScroll,
    setDetailOpen,
    setToast,
    copyFn,
    exportHarFn,
    withEditor,
    followNav,
  } = ctx;
  const {
    setNetSel,
    setNetSelId,
    setNetFollow,
    setNetPicker,
    tlSelect,
    setTlSelect,
    tlCursor,
    setTlCursor,
    tlAnchor,
    setTlAnchor,
    tlRange,
    setTlRange,
    setFilterEditing,
    searchQuery,
    setSearchQuery,
    peek,
    setPeek,
  } = net;
  const page = Math.max(1, Math.floor((bodyH - 3) / 2));
  const tlWidth = Math.max(1, columns - 2);
  if (tlSelect) {
    const clampCol = (i: number) => Math.max(0, Math.min(i, tlWidth - 1));
    const jump = Math.max(1, Math.round(tlWidth / 10));
    const applySelection = () => {
      const span = tlAnchor !== null ? timelineSpan(tlEntries, tlNow) : null;
      if (tlAnchor === null || !span) return;
      const r = bucketToRange(span, tlWidth, tlAnchor, clampCol(tlCursor));
      const label = `time:${((r.start - span.min) / 1000).toFixed(1)}s-${((r.end - span.min) / 1000).toFixed(1)}s`;
      setTlRange({ ...r, label });
      setNetSel(0);
      setNetSelId(null);
      setTlAnchor(null);
      setTlSelect(false);
    };
    if (input === 'h' || key.leftArrow) { setTlCursor(c => clampCol(c - 1)); return true; }
    if (input === 'l' || key.rightArrow) { setTlCursor(c => clampCol(c + 1)); return true; }
    if (input === 'H') { setTlCursor(c => clampCol(c - jump)); return true; }
    if (input === 'L') { setTlCursor(c => clampCol(c + jump)); return true; }
    if (input === '0') { setTlCursor(0); return true; }
    if (input === '$') { setTlCursor(tlWidth - 1); return true; }
    if (input === 'v') {
      if (tlAnchor === null) setTlAnchor(clampCol(tlCursor));
      else applySelection();
      return true;
    }
    if (key.return) {
      applySelection();
      return true;
    }
    if (key.escape) {
      if (tlAnchor !== null) setTlAnchor(null);
      else if (tlRange) setTlRange(null);
      else setTlSelect(false);
      return true;
    }
    if (input === 'z') {
      setTlAnchor(null);
      setTlSelect(false);
      return true;
    }
    return true;
  }
  if (input === 'z') {
    openTimelineSelect(net, tlEntries, tlNow, tlWidth);
    return true;
  }
  if (key.escape && searchQuery) {
    setSearchQuery('');
    setNetSel(0);
    setNetSelId(null);
    setNetFollow(true);
    return true;
  }
  if (key.escape && peek) {
    setPeek(false);
    return true;
  }
  if ((input === 'n' || input === 'N') && searchQuery && netEntries.length) {
    const next = (clampedNetSel + (input === 'n' ? 1 : -1) + netEntries.length) % netEntries.length;
    setNetSel(next);
    setNetSelId(netEntries[next]?.id ?? null);
    setNetFollow(next >= netEntries.length - 1);
    return true;
  }
  if (input === 'K') {
    setPeek(p => !p);
    return true;
  }
  if (followNav(input, key, netEntries.length, clampedNetSel, page, (idx, follow) => {
    setNetSel(idx);
    setNetSelId(netEntries[idx]?.id ?? null);
    setNetFollow(follow);
  })) return true;
  if (input === 'x') {
    setNetPicker('type');
    return true;
  }
  if (input === 's') {
    setNetPicker('sort');
    return true;
  }
  if (input === 'c') {
    setNetPicker('columns');
    return true;
  }
  if (input === 'p' && selEntry) {
    setNetPicker('copy');
    return true;
  }
  if (input === 'D') {
    net.setNetGroup(m => (m === 'domain' ? 'none' : 'domain'));
    net.setCollapsedGroups(new Set());
    net.setNetSelId(null);
    return true;
  }
  if (net.netGroup === 'domain' && (input === 'h' || input === 'l') && selEntry) {
    const key = groupKeyOf(selEntry, 'domain');
    net.setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (input === 'h') next.add(key);
      else next.delete(key);
      return next;
    });
    net.setNetSelId(null);
    return true;
  }
  if (input === '/') {
    setFilterEditing(true);
    return true;
  }
  if (input === 'w') {
    cycleTimeWindow(net);
    return true;
  }
  if (input === 'C') {
    clearNetworkLog(net, attached?.session, setToast);
    return true;
  }
  if (input === 'T' && attached) {
    applyThrottle(attached.session, cycleThrottle(throttle), setThrottleState, setToast);
    return true;
  }
  if (input === 'u' && attached) {
    applyCacheDisabled(attached.session, !cacheDisabled, setCacheDisabledState, setToast);
    return true;
  }
  if (input === 'H' && attached) {
    exportSessionHar(attached.session, exportHarFn, copyFn, setToast, markedEntries.length ? markedEntries : undefined);
    return true;
  }
  if (input === 'v' && selEntry) {
    toggleMark(net, selEntry);
    return true;
  }
  if (input === 'd' && !key.ctrl) {
    openDiffForMarked(markedEntries, setNetDiff, setNetDiffScroll, setToast);
    return true;
  }
  if (input === 'M' && selEntry) {
    if (!attached) {
      setToast(t('toast.noAttachedTab'));
      return true;
    }
    addMapRemoteForEntry(attached.session, selEntry, withEditor, mapRemoteRef, mapSeq, setMapRemoteRules, setToast);
    return true;
  }
  if (key.ctrl && input === 'e') {
    openMapRemoteManager(mapRemoteRef, setMapManager, setToast);
    return true;
  }
  if (input === 'V' && net.marked.size) {
    net.setMarked(new Set());
    setToast(t('toast.marksCleared'));
    return true;
  }
  if (input === 'Y' && selEntry) {
    copyEntryCurl(selEntry, copyFn, setToast);
    return true;
  }
  if (input === 'F' && selEntry) {
    copyEntryFetch(selEntry, copyFn, setToast);
    return true;
  }
  if (input === 'R' && selEntry) {
    if (!attached) {
      setToast(t('toast.noAttachedTab'));
      return true;
    }
    resendEntry(attached.session, selEntry, setToast);
    return true;
  }
  if (input === 'E' && selEntry) {
    if (!attached) {
      setToast(t('toast.noAttachedTab'));
      return true;
    }
    editAndResendEntry(attached.session, selEntry, withEditor, setToast);
    return true;
  }
  if (input === 'O' && selEntry) {
    if (!attached) {
      setToast(t('toast.noAttachedTab'));
      return true;
    }
    addOverrideForEntry(attached.session, selEntry, withEditor, overrideRulesRef, overrideSeq, setOverrideRules, setToast);
    return true;
  }
  if (key.ctrl && input === 'o') {
    openOverrideManager(overrideRulesRef, setOverrideManager, setToast);
    return true;
  }
  if (input === 'B' && selEntry) {
    openBlockPicker(net, selEntry, setBlockTarget);
    return true;
  }
  if (key.ctrl && input === 'b') {
    openBlockManager(blockedPatternsRef, setBlockManager, setToast);
    return true;
  }
  if (key.return && selEntry) {
    openEntryDetail(selEntry, { setDetailEntry, setDetailTab, setDetailScroll, setDetailOpen });
    return true;
  }
  return false;
}
