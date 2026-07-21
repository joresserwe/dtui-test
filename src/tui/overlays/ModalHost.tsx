import React from 'react';
import type { BlockPattern, MapRemoteRule, OverrideRule, ThrottleName } from '../../engine.js';
import type { ConsoleKind, NetworkEntry } from '../../store/types.js';
import type { NetColumnId } from '../../config.js';
import type { Tool } from '../panels/ToolTabs.js';
import type { NetSortDir, NetSortKey, TypeFilter } from '../panels/NetworkPanel.js';
import type { ToastEntry } from '../lib/toast-manager.js';
import type { Command } from '../lib/commands.js';
import { NewTabPrompt } from './NewTabPrompt.js';
import { TextPrompt } from './TextPrompt.js';
import type { RecorderPrompt } from '../hooks/use-recorder-tool.js';
import type { RecordingMeta, Step } from '../../store/recording.js';
import { TabPicker, type PickerSection, type PickerSessionRow } from './TabPicker.js';
import { CommandPalette } from './CommandPalette.js';
import { SelectPicker, type SelectPickerItem } from './SelectPicker.js';
import { deviceItems, cpuItems, colorItems, visionItems, geoItems, contrastItems, timezoneItems, userAgentItems, localeItems, idleItems, orientationItems, type EmuPickerKind } from '../hooks/use-emulation-tool.js';
import { SessionControl } from './SessionControl.js';
import { ToastHistoryOverlay, TOAST_HISTORY_CHROME } from './ToastHistoryOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';
import { truncate } from '../lib/format.js';
import { t, type MessageKey } from '../lib/i18n.js';

const typeItems = (): SelectPickerItem[] => [
  { value: 'all', label: t('picker.item.all'), exclusive: true },
  { value: 'xhr', label: 'xhr' },
  { value: 'js', label: 'js' },
  { value: 'css', label: 'css' },
  { value: 'img', label: 'img' },
  { value: 'ws', label: 'ws' },
  { value: 'doc', label: 'doc' },
  { value: 'font', label: 'font' },
  { value: 'other', label: t('picker.item.other') },
];

const levelItems = (): SelectPickerItem[] => [
  { value: 'all', label: t('picker.item.all'), exclusive: true },
  { value: 'error', label: 'error/exception' },
  { value: 'warn', label: 'warn' },
  { value: 'info', label: 'info' },
  { value: 'log', label: 'log' },
  { value: 'debug', label: 'debug' },
  { value: 'browser', label: 'browser' },
];

const sortItems = (): SelectPickerItem[] => [
  { value: 'arrival', label: t('picker.item.arrival') },
  { value: 'time', label: t('picker.item.time') },
  { value: 'size', label: t('picker.item.size') },
  { value: 'status', label: t('picker.item.status') },
  { value: 'name', label: t('picker.item.name') },
];

const columnItems = (): SelectPickerItem[] => [
  { value: 'status', label: 'status' },
  { value: 'method', label: 'method' },
  { value: 'type', label: 'type' },
  { value: 'time', label: 'time' },
  { value: 'size', label: 'size' },
  { value: 'cookies', label: 'cookies' },
  { value: 'host', label: 'host' },
  { value: 'protocol', label: 'protocol' },
  { value: 'priority', label: 'priority' },
  { value: 'initiator', label: 'initiator' },
  { value: 'set-cookies', label: 'set-cookies' },
  { value: 'remote', label: 'remote' },
  { value: 'waterfall', label: 'waterfall' },
  { value: 'name', label: t('picker.item.colName'), group: 'label' },
  { value: 'url', label: t('picker.item.colUrl'), group: 'label' },
];

const copyItems = (hasBody: boolean, allCount: number, marked: boolean): SelectPickerItem[] => {
  const scope = marked ? t('picker.item.copyScopeMarked') : t('picker.item.copyScopeAll');
  const hint = String(allCount);
  return [
    { value: 'curl', label: t('picker.item.copyCurl') },
    { value: 'fetch', label: t('picker.item.copyFetch') },
    { value: 'node-fetch', label: t('picker.item.copyNodeFetch') },
    { value: 'body', label: t('picker.item.copyBody'), ...(hasBody ? {} : { hint: t('picker.item.copyBodyEmpty') }) },
    { value: 'url', label: t('picker.item.copyUrl') },
    { value: 'all-urls', label: `${scope} · URLs`, hint },
    { value: 'all-curl', label: `${scope} · cURL`, hint },
    { value: 'all-fetch', label: `${scope} · fetch`, hint },
    { value: 'all-har', label: `${scope} · HAR`, hint },
  ];
};

// SelectPicker row overhead in columns: box border+padding (4) + caret/check prefix (4) + label-hint gap (2).
const MANAGER_ROW_CHROME = 10;

export function formatStep(step: Step, i: number): string {
  const n = `${i + 1}.`;
  switch (step.kind) {
    case 'goto':
      return `${n} goto  ${step.url}`;
    case 'nav':
      return `${n} nav  ${step.url}`;
    case 'click':
      return `${n} click  ${step.selector}`;
    case 'input':
      return `${n} input  ${step.selector}  · ${step.redacted ? t('rec.detail.redacted') : step.value ?? ''}`;
    case 'key':
      return `${n} key  ${step.key}${step.selector ? `  ${step.selector}` : ''}`;
    case 'select':
      return `${n} select  ${step.selector} = ${step.value}`;
  }
}

export function domainBlockPattern(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host ? `*://${host}/*` : null;
  } catch {
    return null;
  }
}

export interface ModalHostProps {
  bodyH: number;
  columns: number;
  newTab: { incognito: boolean; value: string } | null;
  picker: {
    open: boolean;
    sections: PickerSection[];
    query: string;
    selected: number;
    attachedId: string | undefined;
    sessions: PickerSessionRow[];
    confirmClose: boolean;
  };
  palette: {
    open: boolean;
    commands: Command[];
    query: string;
    selected: number;
  };
  netPicker: {
    kind: 'type' | 'sort' | 'columns' | 'block' | 'copy' | null;
    typeFilters: TypeFilter[];
    sortKey: NetSortKey;
    netColumns: NetColumnId[];
    blockTarget: NetworkEntry | null;
    copyTarget: NetworkEntry | null;
    copyAllCount: number;
    copyAllMarked: boolean;
    onApplyType: (values: string[]) => void;
    onApplySort: (value: string, dir?: NetSortDir) => void;
    onApplyBlock: (choice: string) => void;
    onApplyColumns: (values: string[]) => void;
    onApplyCopy: (choice: string) => void;
    onCancel: () => void;
    onCancelBlock: () => void;
  };
  conPicker: {
    open: boolean;
    levelFilters: ConsoleKind[];
    onApply: (values: string[]) => void;
    onCancel: () => void;
  };
  conCtxPicker: {
    open: boolean;
    items: SelectPickerItem[];
    initial: string[];
    onPick: (value: string) => void;
    onCancel: () => void;
  };
  emuPicker: {
    kind: EmuPickerKind | null;
    initial: string[];
    onPick: (value: string) => void;
    onCancel: () => void;
  };
  managers: {
    blockOpen: boolean;
    overrideOpen: boolean;
    mapOpen: boolean;
    blockedPatterns: BlockPattern[];
    overrideRules: OverrideRule[];
    mapRemoteRules: MapRemoteRule[];
    onToggleBlock: (id: string) => void;
    onDeleteBlock: (id: string) => void;
    onCloseBlock: () => void;
    onEditOverride: (id: string) => void;
    onToggleOverride: (id: string) => void;
    onDeleteOverride: (id: string) => void;
    onCloseOverride: () => void;
    onEditMap: (id: string) => void;
    onToggleMap: (id: string) => void;
    onDeleteMap: (id: string) => void;
    onCloseMap: () => void;
  };
  recorder: {
    managerOpen: boolean;
    detail: { file: string; name: string; steps: Step[] } | null;
    recordings: RecordingMeta[];
    prompt: RecorderPrompt | null;
    onReplay: (file: string) => void;
    onOpenDetail: (file: string) => void;
    onDetailReplay: () => void;
    onCloseDetail: () => void;
    onRename: (file: string) => void;
    onDelete: (file: string) => void;
    onCloseManager: () => void;
  };
  sessionControl: {
    open: boolean;
    hasActive: boolean;
    title: string;
    throttle: ThrottleName;
    cacheDisabled: boolean;
    selected: number;
  };
  notifications: {
    open: boolean;
    entries: ToastEntry[];
    selected: number;
  };
  help: {
    open: boolean;
    tool: Tool;
    scroll: number;
    height: number;
  };
}

const EMU_PICKERS: Record<EmuPickerKind, { title: MessageKey; items: () => SelectPickerItem[] }> = {
  device: { title: 'picker.title.emuDevice', items: deviceItems },
  cpu: { title: 'picker.title.emuCpu', items: cpuItems },
  color: { title: 'picker.title.emuColor', items: colorItems },
  vision: { title: 'picker.title.emuVision', items: visionItems },
  geo: { title: 'picker.title.emuGeo', items: geoItems },
  contrast: { title: 'picker.title.emuContrast', items: contrastItems },
  timezone: { title: 'picker.title.emuTimezone', items: timezoneItems },
  userAgent: { title: 'picker.title.emuUserAgent', items: userAgentItems },
  locale: { title: 'picker.title.emuLocale', items: localeItems },
  idle: { title: 'picker.title.emuIdle', items: idleItems },
  orientation: { title: 'picker.title.emuOrientation', items: orientationItems },
};

const REC_PROMPTS: Record<RecorderPrompt['kind'], { title: MessageKey; footer: MessageKey; masked: boolean }> = {
  name: { title: 'rec.prompt.name.title', footer: 'rec.prompt.name.footer', masked: false },
  rename: { title: 'rec.prompt.rename.title', footer: 'rec.prompt.rename.footer', masked: false },
  password: { title: 'rec.prompt.password.title', footer: 'rec.prompt.password.footer', masked: true },
};

export function ModalHost({ bodyH, columns, newTab, picker, palette, netPicker, conPicker, conCtxPicker, emuPicker, managers, recorder, sessionControl, notifications, help }: ModalHostProps): React.JSX.Element | null {
  const TYPE_ITEMS = typeItems();
  const LEVEL_ITEMS = levelItems();
  const SORT_ITEMS = sortItems();
  const COLUMN_ITEMS = columnItems();
  const COPY_ITEMS = copyItems(netPicker.copyTarget?.body !== undefined, netPicker.copyAllCount, netPicker.copyAllMarked);
  const managerW = Math.min(columns - 4, 120);
  const blockTarget = netPicker.blockTarget;
  const blockDomain = blockTarget ? domainBlockPattern(blockTarget.url) : null;
  const BLOCK_ITEMS: SelectPickerItem[] = blockTarget
    ? [
        { value: 'url', label: t('picker.item.blockUrl'), hint: truncate(blockTarget.url, 40) },
        ...(blockDomain ? [{ value: 'domain', label: t('picker.item.blockDomain'), hint: blockDomain }] : []),
      ]
    : [];

  return newTab ? (
    <NewTabPrompt value={newTab.value} incognito={newTab.incognito} width={Math.min(columns - 4, 60)} />
  ) : recorder.prompt ? (
    <TextPrompt
      title={t(REC_PROMPTS[recorder.prompt.kind].title)}
      footer={t(REC_PROMPTS[recorder.prompt.kind].footer)}
      masked={REC_PROMPTS[recorder.prompt.kind].masked}
      value={recorder.prompt.value}
      width={Math.min(columns - 4, 60)}
    />
  ) : recorder.detail ? (
    <SelectPicker
      title={t('rec.detail.title', { name: recorder.detail.name })}
      items={recorder.detail.steps.map((step, i) => ({
        value: String(i),
        label: truncate(formatStep(step, i), managerW - MANAGER_ROW_CHROME),
      }))}
      footer={t('rec.detail.footer')}
      width={managerW}
      height={Math.min(bodyH, recorder.detail.steps.length + 4)}
      onPick={recorder.onCloseDetail}
      onKey={ch => {
        if (ch === 'r') recorder.onDetailReplay();
      }}
      onCancel={recorder.onCloseDetail}
    />
  ) : recorder.managerOpen ? (
    <SelectPicker
      title={t('rec.manager.title')}
      items={recorder.recordings.map(r => ({
        value: r.file,
        label: truncate(r.name, managerW - MANAGER_ROW_CHROME - 10),
        hint: t('rec.manager.steps', { n: String(r.stepCount) }),
      }))}
      footer={t('rec.manager.footer')}
      width={managerW}
      hintAlign="right"
      height={Math.min(bodyH, recorder.recordings.length + 4)}
      onPick={recorder.onOpenDetail}
      onKey={(ch, value) => {
        if (!value) return;
        if (ch === 'r') recorder.onReplay(value);
        else if (ch === 'n') recorder.onRename(value);
        else if (ch === 'd') recorder.onDelete(value);
      }}
      onCancel={recorder.onCloseManager}
    />
  ) : picker.open ? (
    <TabPicker
      sections={picker.sections}
      query={picker.query}
      selected={picker.selected}
      attachedId={picker.attachedId}
      sessions={picker.sessions}
      confirmClose={picker.confirmClose}
      height={Math.min(bodyH, 16)}
      width={Math.min(columns - 4, 84)}
    />
  ) : palette.open ? (
    <CommandPalette
      commands={palette.commands}
      query={palette.query}
      selected={palette.selected}
      height={Math.min(bodyH, 18)}
      width={Math.min(columns - 4, 64)}
    />
  ) : netPicker.kind ? (
    <>
      {netPicker.kind === 'type' ? (
        <SelectPicker
          title={t('picker.title.type')}
          items={TYPE_ITEMS}
          multi
          initial={netPicker.typeFilters.length ? netPicker.typeFilters : ['all']}
          height={Math.min(bodyH, TYPE_ITEMS.length + 4)}
          onApply={netPicker.onApplyType}
          onCancel={netPicker.onCancel}
        />
      ) : netPicker.kind === 'sort' ? (
        <SelectPicker
          title={t('picker.title.sort')}
          items={SORT_ITEMS}
          directional
          initial={[netPicker.sortKey]}
          footer={t('picker.footer.sort')}
          height={Math.min(bodyH, SORT_ITEMS.length + 4)}
          onPick={netPicker.onApplySort}
          onCancel={netPicker.onCancel}
        />
      ) : netPicker.kind === 'block' ? (
        <SelectPicker
          title={t('picker.title.block')}
          items={BLOCK_ITEMS}
          height={Math.min(bodyH, BLOCK_ITEMS.length + 4)}
          onPick={netPicker.onApplyBlock}
          onCancel={netPicker.onCancelBlock}
        />
      ) : netPicker.kind === 'copy' ? (
        <SelectPicker
          title={t('picker.title.copy')}
          items={COPY_ITEMS}
          height={Math.min(bodyH, COPY_ITEMS.length + 4)}
          onPick={netPicker.onApplyCopy}
          onCancel={netPicker.onCancel}
        />
      ) : (
        <SelectPicker
          title={t('picker.title.columns')}
          items={COLUMN_ITEMS}
          multi
          initial={netPicker.netColumns}
          height={Math.min(bodyH, COLUMN_ITEMS.length + 4)}
          onApply={netPicker.onApplyColumns}
          onCancel={netPicker.onCancel}
        />
      )}
    </>
  ) : conPicker.open ? (
    <SelectPicker
      title={t('picker.title.level')}
      items={LEVEL_ITEMS}
      multi
      initial={conPicker.levelFilters.length ? conPicker.levelFilters : ['all']}
      height={Math.min(bodyH, LEVEL_ITEMS.length + 4)}
      onApply={conPicker.onApply}
      onCancel={conPicker.onCancel}
    />
  ) : conCtxPicker.open ? (
    <SelectPicker
      title={t('picker.title.ctx')}
      items={conCtxPicker.items}
      initial={conCtxPicker.initial}
      height={Math.min(bodyH, conCtxPicker.items.length + 4)}
      onPick={conCtxPicker.onPick}
      onCancel={conCtxPicker.onCancel}
    />
  ) : emuPicker.kind ? (
    (() => {
      const cfg = EMU_PICKERS[emuPicker.kind];
      const items = cfg.items();
      return (
        <SelectPicker
          title={t(cfg.title)}
          items={items}
          initial={emuPicker.initial}
          height={Math.min(bodyH, items.length + 4)}
          onPick={emuPicker.onPick}
          onCancel={emuPicker.onCancel}
        />
      );
    })()
  ) : managers.blockOpen ? (
    <SelectPicker
      title={t('picker.title.blocked')}
      items={managers.blockedPatterns.map(p => ({
        value: p.id,
        label: truncate(p.pattern, managerW - MANAGER_ROW_CHROME - 3),
        hint: p.enabled ? 'on' : 'off',
      }))}
      footer={t('picker.footer.block')}
      width={managerW}
      hintAlign="right"
      height={Math.min(bodyH, managers.blockedPatterns.length + 4)}
      onPick={managers.onToggleBlock}
      onKey={(ch, value) => {
        if (!value) return;
        if (ch === ' ') managers.onToggleBlock(value);
        else if (ch === 'd') managers.onDeleteBlock(value);
      }}
      onCancel={managers.onCloseBlock}
    />
  ) : managers.overrideOpen ? (
    <SelectPicker
      title={t('picker.title.overrides')}
      items={managers.overrideRules.map(r => ({
        value: r.id,
        label: truncate(r.pattern, managerW - MANAGER_ROW_CHROME - 9),
        hint: `${r.status} · ${r.enabled ? 'on' : 'off'}`,
      }))}
      footer={t('picker.footer.override')}
      width={managerW}
      hintAlign="right"
      height={Math.min(bodyH, managers.overrideRules.length + 4)}
      onPick={managers.onEditOverride}
      onKey={(ch, value) => {
        if (!value) return;
        if (ch === ' ') managers.onToggleOverride(value);
        else if (ch === 'd') managers.onDeleteOverride(value);
      }}
      onCancel={managers.onCloseOverride}
    />
  ) : managers.mapOpen ? (
    <SelectPicker
      title={t('picker.title.mapRemote')}
      items={managers.mapRemoteRules.map(r => ({
        value: r.id,
        label: truncate(`${r.pattern} → ${r.target}`, managerW - MANAGER_ROW_CHROME - 3),
        hint: r.enabled ? 'on' : 'off',
      }))}
      footer={t('picker.footer.override')}
      width={managerW}
      hintAlign="right"
      height={Math.min(bodyH, managers.mapRemoteRules.length + 4)}
      onPick={managers.onEditMap}
      onKey={(ch, value) => {
        if (!value) return;
        if (ch === ' ') managers.onToggleMap(value);
        else if (ch === 'd') managers.onDeleteMap(value);
      }}
      onCancel={managers.onCloseMap}
    />
  ) : sessionControl.open && sessionControl.hasActive ? (
    <SessionControl
      title={sessionControl.title}
      throttle={sessionControl.throttle}
      cacheDisabled={sessionControl.cacheDisabled}
      overrideCount={managers.overrideRules.length}
      blockCount={managers.blockedPatterns.length}
      selected={sessionControl.selected}
      width={Math.min(columns - 4, 62)}
    />
  ) : notifications.open ? (
    <ToastHistoryOverlay
      entries={notifications.entries}
      selected={notifications.selected}
      height={Math.min(bodyH, Math.max(1, notifications.entries.length) + TOAST_HISTORY_CHROME)}
      width={Math.min(columns - 4, 84)}
    />
  ) : help.open ? (
    <HelpOverlay tool={help.tool} scroll={help.scroll} height={help.height} width={Math.min(columns - 4, 78)} />
  ) : null;
}
