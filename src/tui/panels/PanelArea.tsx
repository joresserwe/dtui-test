import React from 'react';
import { Box, Text } from 'ink';
import type { ConsoleEntry, NetworkEntry } from '../../store/types.js';
import type { NetColumnId } from '../../config.js';
import type { TimeRange } from '../lib/timeline.js';
import type { Tool } from './ToolTabs.js';
import { PSEUDO_CLASSES, type ElementsTool } from '../hooks/use-elements-tool.js';
import type { StorageTool } from '../hooks/use-storage-tool.js';
import type { SettingsTool } from '../hooks/use-settings-tool.js';
import type { AuditTool } from '../hooks/use-audit-tool.js';
import type { SourcesTool } from '../hooks/use-sources-tool.js';
import type { ComponentsTool } from '../hooks/use-components-tool.js';
import { AuditPanel } from './AuditPanel.js';
import { SourcesPanel, type SourcesViewData } from './SourcesPanel.js';
import { ComponentsPanel } from './ComponentsPanel.js';
import { NetworkPanel, type NetSortDir, type NetSortKey } from './NetworkPanel.js';
import { NetworkSummaryBar } from './NetworkSummaryBar.js';
import type { NetSummary } from '../lib/net-summary.js';
import type { NetGroupRow } from '../lib/net-group.js';
import { ConsolePanel } from './ConsolePanel.js';
import { TimelineOverview, TIMELINE_HEIGHT } from './TimelineOverview.js';
import { PeekOverlay, PEEK_HEIGHT } from '../overlays/PeekOverlay.js';
import { DetailOverlay, type DetailTab, type Line } from '../overlays/DetailOverlay.js';
import { DiffOverlay } from '../overlays/DiffOverlay.js';
import { ConsoleDetailOverlay } from '../overlays/ConsoleDetailOverlay.js';
import { StorageDetailOverlay } from '../overlays/StorageDetailOverlay.js';
import { DomOverlay } from '../overlays/DomOverlay.js';
import { CssOverviewView } from '../overlays/CssOverviewView.js';
import { AnimationsView } from '../overlays/AnimationsView.js';
import { ElementsPanel } from './ElementsPanel.js';
import { Rule } from './Rule.js';
import { StorageOverlay, type StorageRow, type StorageView } from './StorageOverlay.js';
import { SettingsPanel } from './SettingsPanel.js';
import { fuzzyFilter } from '../../settings.js';
import { t } from '../lib/i18n.js';

export interface PanelAreaProps {
  bodyH: number;
  columns: number;
  layout: 'tabs' | 'split';
  activeTool: Tool;
  attached: boolean;
  netView: {
    entries: NetworkEntry[];
    groups?: NetGroupRow[];
    selected: number;
    columns: NetColumnId[];
    sortKey: NetSortKey;
    sortDir: NetSortDir;
    tlEntries: NetworkEntry[];
    tlSelect: boolean;
    tlCursor: number;
    tlAnchor: number | null;
    tlRange: (TimeRange & { label: string }) | null;
    tlNow: number;
    peek: boolean;
    selEntry: NetworkEntry | undefined;
    marked: ReadonlySet<string>;
    summary: NetSummary;
    total: number;
    pageTiming: { domContentLoadedMs?: number; loadMs?: number };
  };
  conView: {
    entries: ConsoleEntry[];
    selected: number;
    expanded: Set<number>;
    input: string | undefined;
    eager: string | undefined;
    showTimestamps: boolean;
    ctxLabels: Map<number, string>;
    ctxLabel: string | undefined;
  };
  detail: {
    open: boolean;
    entry: NetworkEntry | null;
    tab: DetailTab;
    scroll: number;
    lines: Line[];
    highlight: string | undefined;
  };
  netDiff: {
    data: { a: NetworkEntry; b: NetworkEntry } | null;
    scroll: number;
    lines: Line[];
  };
  conDetail: {
    entry: ConsoleEntry | null;
    scroll: number;
    lines: Line[];
    wrap: boolean;
    cursor: number | undefined;
  };
  storageDetail: {
    data: { row: StorageRow; view: StorageView } | null;
    scroll: number;
    lines: Line[];
  };
  el: ElementsTool;
  domBpNodes?: ReadonlySet<number>;
  storage: StorageTool;
  settings: SettingsTool;
  audit: AuditTool;
  src: SourcesTool;
  srcData: SourcesViewData;
  comp: ComponentsTool;
}

export function PanelArea({ bodyH, columns, layout, activeTool, attached, netView, conView, detail, netDiff, conDetail, storageDetail, el, domBpNodes, storage, settings, audit, src, srcData, comp }: PanelAreaProps): React.JSX.Element {
  const placeholder = (label: string) => (
    <Box flexDirection="column" height={bodyH} width={columns} paddingX={1}>
      <Text dimColor>{label}</Text>
      <Text> </Text>
      <Text dimColor>{t('app.placeholder')}</Text>
    </Box>
  );

  const listArea = () => {
    const available = bodyH - 1;
    const split = layout === 'split' && available >= 14;
    const netAreaH = split ? Math.ceil((available - 1) * 0.6) : available;
    const conH = split ? available - 1 - netAreaH : available;
    const tlVisible = activeTool === 'network' && netAreaH - TIMELINE_HEIGHT >= 4;
    const peekVisible = netView.peek && !!netView.selEntry && activeTool === 'network' && netAreaH - PEEK_HEIGHT - (tlVisible ? TIMELINE_HEIGHT : 0) >= 4;
    const netH = netAreaH - (tlVisible ? TIMELINE_HEIGHT : 0) - (peekVisible ? PEEK_HEIGHT : 0);
    const summaryVisible = (split || activeTool === 'network') && attached && netH - 1 >= 3;
    const netListH = netH - (summaryVisible ? 1 : 0);
    const net = (
      <NetworkPanel
        entries={netView.entries}
        groups={netView.groups}
        selected={netView.selected}
        focused={activeTool === 'network'}
        height={netListH}
        width={columns}
        columns={netView.columns}
        sortKey={netView.sortKey}
        sortDir={netView.sortDir}
        marked={netView.marked}
      />
    );
    const con = (
      <ConsolePanel
        entries={conView.entries}
        selected={conView.selected}
        expanded={conView.expanded}
        focused={activeTool === 'console'}
        height={conH}
        width={columns}
        input={conView.input}
        eager={conView.eager}
        showTimestamps={conView.showTimestamps}
        ctxLabels={conView.ctxLabels}
        ctxLabel={conView.ctxLabel}
      />
    );
    return (
      <Box flexDirection="column" height={bodyH} width={columns}>
        {tlVisible ? (
          <TimelineOverview entries={netView.tlEntries} width={columns} active={netView.tlSelect} cursor={netView.tlCursor} anchor={netView.tlAnchor} applied={netView.tlRange} now={netView.tlNow} />
        ) : null}
        {split || activeTool === 'network' ? net : null}
        {peekVisible && netView.selEntry ? <PeekOverlay entry={netView.selEntry} width={columns} /> : null}
        {summaryVisible ? (
          <NetworkSummaryBar
            summary={netView.summary}
            total={netView.total}
            marked={netView.marked.size}
            domContentLoadedMs={netView.pageTiming.domContentLoadedMs}
            loadMs={netView.pageTiming.loadMs}
            width={columns}
          />
        ) : null}
        {split ? <Rule columns={columns} /> : null}
        {split || activeTool === 'console' ? con : null}
        <Rule columns={columns} />
      </Box>
    );
  };

  return detail.open && detail.entry ? (
    <DetailOverlay entry={detail.entry} tab={detail.tab} scroll={detail.scroll} height={bodyH} width={columns} lines={detail.lines} highlight={detail.highlight} />
  ) : netDiff.data ? (
    <DiffOverlay a={netDiff.data.a} b={netDiff.data.b} scroll={netDiff.scroll} height={bodyH} width={columns} lines={netDiff.lines} />
  ) : conDetail.entry ? (
    <ConsoleDetailOverlay entry={conDetail.entry} scroll={conDetail.scroll} height={bodyH} width={columns} lines={conDetail.lines} wrap={conDetail.wrap} cursor={conDetail.cursor} />
  ) : storageDetail.data ? (
    <StorageDetailOverlay row={storageDetail.data.row} view={storageDetail.data.view} scroll={storageDetail.scroll} height={bodyH} width={columns} lines={storageDetail.lines} />
  ) : activeTool === 'network' || activeTool === 'console' ? (
    listArea()
  ) : activeTool === 'elements' ? (
    attached ? (
      el.overviewMode ? (
        <CssOverviewView
          data={el.overviewData}
          loading={el.overviewLoading}
          scroll={el.overviewScroll}
          error={el.domErr}
          height={bodyH}
          width={columns}
        />
      ) : el.animMode ? (
        <AnimationsView
          animations={el.animations}
          selected={el.animSel}
          paused={el.animPaused}
          rate={el.animRate}
          error={el.domErr}
          height={bodyH}
          width={columns}
        />
      ) : el.elSubview && el.domNode ? (
        <DomOverlay
          query={el.domNode.selector}
          node={el.domNode}
          highlighting={el.highlighting}
          watching={el.watching}
          mutationCount={el.mutationCount}
          ruleSelected={el.ruleSelected}
          declSel={el.declSel}
          decl={el.declEdit?.text}
          declReplace={!!el.declEdit?.replaceSpan}
          computedMode={el.computedMode}
          computedFilter={el.computedFilter}
          computedFilterEditing={el.computedFilterEditing}
          computedScroll={el.computedScroll}
          listenersMode={el.listenersMode}
          listeners={el.listenersData}
          listenersScroll={el.listenersScroll}
          classesMode={el.classesMode}
          classes={el.classEntries}
          classesSel={el.classesSel}
          classesInput={el.classesInput}
          pseudo={el.forcedPseudo ? `:${PSEUDO_CLASSES[el.forcedPseudo - 1]}` : undefined}
          error={el.domErr}
          height={bodyH}
          width={columns}
        />
      ) : (
        <ElementsPanel
          map={el.elMap}
          expanded={el.elExpanded}
          selectedId={el.elSelId}
          detail={el.domNode}
          searching={el.elSearching}
          query={el.elQuery}
          searchHits={el.elSearchHits}
          inspecting={el.inspecting}
          hintTyped={el.hintInput?.typed ?? null}
          domBpNodes={domBpNodes}
          overlayCount={el.overlayNodes.size}
          centerSeq={el.centerSeq}
          highlighting={el.highlighting}
          watching={el.watching}
          mutationCount={el.mutationCount}
          error={el.domErr}
          height={bodyH}
          width={columns}
        />
      )
    ) : (
      placeholder('Elements')
    )
  ) : activeTool === 'storage' ? (
    attached ? (
      <StorageOverlay
        view={storage.storageView}
        cookies={storage.cookieRows}
        local={storage.localRows}
        session={storage.sessionRows}
        selected={storage.storageSel}
        filter={storage.storageFilter}
        editing={storage.storageEditing ?? undefined}
        confirmClear={storage.confirmClear}
        error={storage.storageErr}
        idb={{
          db: storage.idbDb,
          store: storage.idbStore,
          dbs: storage.idbDbs,
          stores: storage.idbStores,
          entries: storage.idbEntries,
          hasMore: storage.idbHasMore,
        }}
        cache={{ open: storage.cacheOpen, caches: storage.caches, entries: storage.cacheEntries, hasMore: storage.cacheHasMore }}
        sw={{ regs: storage.swRegs, forceUpdate: storage.swForce, bypass: storage.swBypass }}
        app={storage.appData}
        frames={storage.frames}
        background={storage.background}
        shared={storage.shared}
        trustTokens={storage.trustTokens}
        quota={storage.quota}
        height={bodyH}
        width={columns}
      />
    ) : (
      placeholder('Storage')
    )
  ) : activeTool === 'sources' ? (
    attached ? (
      <SourcesPanel src={src} data={srcData} height={bodyH} width={columns} />
    ) : (
      placeholder('Sources')
    )
  ) : activeTool === 'components' ? (
    attached ? (
      <ComponentsPanel comp={comp} height={bodyH} width={columns} />
    ) : (
      placeholder('Components')
    )
  ) : activeTool === 'audit' ? (
    attached ? (
      <AuditPanel audit={audit} height={bodyH} width={columns} />
    ) : (
      placeholder('Audit')
    )
  ) : (
    <SettingsPanel
      rows={fuzzyFilter(settings.settingsRows, settings.settingsQuery)}
      query={settings.settingsQuery}
      searching={settings.settingsSearching}
      selected={settings.settingsSel}
      editing={settings.settingsEditing ?? undefined}
      error={settings.settingsErr}
      height={bodyH}
      width={columns}
    />
  );
}
