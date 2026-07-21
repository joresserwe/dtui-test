import type { Tool } from '../panels/ToolTabs.js';
import { t, tEn, type MessageKey } from './i18n.js';
import { isSubseq } from './format.js';

export interface CommandCtx {
  tool: Tool;
  attached: boolean;
  hasActive: boolean;
  multiSession: boolean;
  hasSelEntry: boolean;
  hasMarkedPair: boolean;
  hasSelConEntry: boolean;
  hasStorageRow: boolean;
  hasElSel: boolean;
  recording: boolean;
  hasRecordings: boolean;
  openTabPicker(): void;
  openNewTab(incognito: boolean): void;
  switchSession(dir: -1 | 1): void;
  closeActiveSession(): void;
  closeActiveTab(): void;
  focusBrowser(): void;
  reloadPage(): void;
  takeSnapshot(): void;
  copyContext(): void;
  openSessionControl(): void;
  openNotifications(): void;
  openHelp(): void;
  setTool(tool: Tool): void;
  netFilter(): void;
  netSearch(): void;
  netTypePicker(): void;
  netSortPicker(): void;
  netColumnPicker(): void;
  netTimeline(): void;
  netWindow(): void;
  netClear(): void;
  netThrottle(): void;
  netCache(): void;
  netHar(): void;
  netOverrideManager(): void;
  netBlockManager(): void;
  netConditions(): void;
  netDiffPair(): void;
  netAddMapRemote(): void;
  netMapManager(): void;
  netCopyCurl(): void;
  netCopyFetch(): void;
  netCopyNodeFetch(): void;
  netCopyUrl(): void;
  netCopyBody(): void;
  netGroup(): void;
  netResend(): void;
  netEditResend(): void;
  netAddOverride(): void;
  netBlock(): void;
  netDetail(): void;
  netPeek(): void;
  conFilter(): void;
  conInput(): void;
  conLevelPicker(): void;
  conClear(): void;
  conCopyAll(): void;
  conDetail(): void;
  storageFilter(): void;
  storageDetail(): void;
  storageCopy(): void;
  elDuplicate(): void;
  elCssOverview(): void;
  elAnimations(): void;
  emuDevice(): void;
  emuCpu(): void;
  emuColor(): void;
  emuVision(): void;
  emuGeo(): void;
  emuContrast(): void;
  emuTimezone(): void;
  emuReducedMotion(): void;
  emuForcedColors(): void;
  emuTouch(): void;
  emuPaint(): void;
  emuPrint(): void;
  emuUserAgent(): void;
  emuLocale(): void;
  emuAutoDark(): void;
  emuRotate(): void;
  emuIdle(): void;
  emuOrientation(): void;
  emuWebauthn(): void;
  recStart(): void;
  recStop(): void;
  recReplay(): void;
  recManager(): void;
}

export interface Command {
  id: string;
  label: MessageKey;
  keyLabel: string;
  when(ctx: CommandCtx): boolean;
  run(ctx: CommandCtx): void;
}

const always = () => true;
const active = (ctx: CommandCtx) => ctx.hasActive;
const attached = (ctx: CommandCtx) => ctx.attached;
const network = (ctx: CommandCtx) => ctx.tool === 'network' && ctx.attached;
const networkEntry = (ctx: CommandCtx) => network(ctx) && ctx.hasSelEntry;
const consoleTool = (ctx: CommandCtx) => ctx.tool === 'console' && ctx.attached;
const consoleEntry = (ctx: CommandCtx) => consoleTool(ctx) && ctx.hasSelConEntry;
const storageTool = (ctx: CommandCtx) => ctx.tool === 'storage' && ctx.attached;
const storageEntry = (ctx: CommandCtx) => storageTool(ctx) && ctx.hasStorageRow;
const elementsTool = (ctx: CommandCtx) => ctx.tool === 'elements' && ctx.attached;

const toolCommand = (tool: Tool, label: MessageKey, keyLabel: string): Command => ({
  id: `tool.${tool}`,
  label,
  keyLabel,
  when: ctx => ctx.tool !== tool,
  run: ctx => ctx.setTool(tool),
});

export const COMMANDS: Command[] = [
  { id: 'tabPicker', label: 'cmd.tabPicker', keyLabel: 'b', when: always, run: ctx => ctx.openTabPicker() },
  { id: 'newTab', label: 'cmd.newTab', keyLabel: 't', when: always, run: ctx => ctx.openNewTab(false) },
  { id: 'incognitoTab', label: 'cmd.incognitoTab', keyLabel: 'I', when: always, run: ctx => ctx.openNewTab(true) },
  { id: 'nextSession', label: 'cmd.nextSession', keyLabel: ']', when: ctx => ctx.multiSession, run: ctx => ctx.switchSession(1) },
  { id: 'prevSession', label: 'cmd.prevSession', keyLabel: '[', when: ctx => ctx.multiSession, run: ctx => ctx.switchSession(-1) },
  { id: 'closeSession', label: 'cmd.closeSession', keyLabel: '^X', when: active, run: ctx => ctx.closeActiveSession() },
  { id: 'closeTab', label: 'cmd.closeTab', keyLabel: '^W', when: active, run: ctx => ctx.closeActiveTab() },
  { id: 'focusBrowser', label: 'cmd.focusBrowser', keyLabel: 'f', when: attached, run: ctx => ctx.focusBrowser() },
  { id: 'reload', label: 'cmd.reload', keyLabel: 'r', when: attached, run: ctx => ctx.reloadPage() },
  { id: 'snapshot', label: 'cmd.snapshot', keyLabel: 'S', when: attached, run: ctx => ctx.takeSnapshot() },
  { id: 'copyContext', label: 'cmd.copyContext', keyLabel: 'y', when: attached, run: ctx => ctx.copyContext() },
  { id: 'sessionControl', label: 'cmd.sessionControl', keyLabel: '.', when: active, run: ctx => ctx.openSessionControl() },
  { id: 'notifications', label: 'cmd.notifications', keyLabel: '!', when: always, run: ctx => ctx.openNotifications() },
  { id: 'help', label: 'cmd.help', keyLabel: '?', when: always, run: ctx => ctx.openHelp() },
  toolCommand('network', 'cmd.toolNetwork', '1'),
  toolCommand('console', 'cmd.toolConsole', '2'),
  toolCommand('elements', 'cmd.toolElements', '3'),
  toolCommand('storage', 'cmd.toolStorage', '4'),
  toolCommand('settings', 'cmd.toolSettings', ','),
  { id: 'net.filter', label: 'cmd.netFilter', keyLabel: '/', when: network, run: ctx => ctx.netFilter() },
  { id: 'net.search', label: 'cmd.netSearch', keyLabel: '^F', when: network, run: ctx => ctx.netSearch() },
  { id: 'net.typePicker', label: 'cmd.netTypePicker', keyLabel: 'x', when: network, run: ctx => ctx.netTypePicker() },
  { id: 'net.sortPicker', label: 'cmd.netSortPicker', keyLabel: 's', when: network, run: ctx => ctx.netSortPicker() },
  { id: 'net.columnPicker', label: 'cmd.netColumnPicker', keyLabel: 'c', when: network, run: ctx => ctx.netColumnPicker() },
  { id: 'net.range', label: 'cmd.netRange', keyLabel: 'z', when: network, run: ctx => ctx.netTimeline() },
  { id: 'net.window', label: 'cmd.netWindow', keyLabel: 'w', when: network, run: ctx => ctx.netWindow() },
  { id: 'net.group', label: 'cmd.netGroup', keyLabel: 'D', when: network, run: ctx => ctx.netGroup() },
  { id: 'net.clear', label: 'cmd.netClear', keyLabel: 'C', when: network, run: ctx => ctx.netClear() },
  { id: 'net.throttle', label: 'cmd.netThrottle', keyLabel: 'T', when: network, run: ctx => ctx.netThrottle() },
  { id: 'net.cache', label: 'cmd.netCache', keyLabel: 'u', when: network, run: ctx => ctx.netCache() },
  { id: 'net.har', label: 'cmd.netHar', keyLabel: 'H', when: network, run: ctx => ctx.netHar() },
  { id: 'net.overrideManager', label: 'cmd.netOverrideManager', keyLabel: '^O', when: network, run: ctx => ctx.netOverrideManager() },
  { id: 'net.blockManager', label: 'cmd.netBlockManager', keyLabel: '^B', when: network, run: ctx => ctx.netBlockManager() },
  { id: 'net.conditions', label: 'cmd.netConditions', keyLabel: '', when: network, run: ctx => ctx.netConditions() },
  { id: 'net.diff', label: 'cmd.netDiff', keyLabel: 'd', when: ctx => network(ctx) && ctx.hasMarkedPair, run: ctx => ctx.netDiffPair() },
  { id: 'net.addMapRemote', label: 'cmd.netAddMapRemote', keyLabel: 'M', when: networkEntry, run: ctx => ctx.netAddMapRemote() },
  { id: 'net.mapManager', label: 'cmd.netMapManager', keyLabel: '^E', when: network, run: ctx => ctx.netMapManager() },
  { id: 'net.detail', label: 'cmd.netDetail', keyLabel: '⏎', when: networkEntry, run: ctx => ctx.netDetail() },
  { id: 'net.copyCurl', label: 'cmd.netCopyCurl', keyLabel: 'Y', when: networkEntry, run: ctx => ctx.netCopyCurl() },
  { id: 'net.copyFetch', label: 'cmd.netCopyFetch', keyLabel: 'F', when: networkEntry, run: ctx => ctx.netCopyFetch() },
  { id: 'net.copyNodeFetch', label: 'cmd.netCopyNodeFetch', keyLabel: 'p', when: networkEntry, run: ctx => ctx.netCopyNodeFetch() },
  { id: 'net.copyUrl', label: 'cmd.netCopyUrl', keyLabel: 'p', when: networkEntry, run: ctx => ctx.netCopyUrl() },
  { id: 'net.copyBody', label: 'cmd.netCopyBody', keyLabel: 'p', when: networkEntry, run: ctx => ctx.netCopyBody() },
  { id: 'net.resend', label: 'cmd.netResend', keyLabel: 'R', when: networkEntry, run: ctx => ctx.netResend() },
  { id: 'net.editResend', label: 'cmd.netEditResend', keyLabel: 'E', when: networkEntry, run: ctx => ctx.netEditResend() },
  { id: 'net.addOverride', label: 'cmd.netAddOverride', keyLabel: 'O', when: networkEntry, run: ctx => ctx.netAddOverride() },
  { id: 'net.block', label: 'cmd.netBlock', keyLabel: 'B', when: networkEntry, run: ctx => ctx.netBlock() },
  { id: 'net.peek', label: 'cmd.netPeek', keyLabel: 'K', when: networkEntry, run: ctx => ctx.netPeek() },
  { id: 'con.filter', label: 'cmd.conFilter', keyLabel: '/', when: consoleTool, run: ctx => ctx.conFilter() },
  { id: 'con.eval', label: 'cmd.conEval', keyLabel: 'i', when: consoleTool, run: ctx => ctx.conInput() },
  { id: 'con.levelPicker', label: 'cmd.conLevelPicker', keyLabel: 'x', when: consoleTool, run: ctx => ctx.conLevelPicker() },
  { id: 'con.clear', label: 'cmd.conClear', keyLabel: 'C', when: consoleTool, run: ctx => ctx.conClear() },
  { id: 'con.copyAll', label: 'cmd.conCopyAll', keyLabel: 'Y', when: consoleEntry, run: ctx => ctx.conCopyAll() },
  { id: 'con.detail', label: 'cmd.conDetail', keyLabel: '⏎', when: consoleEntry, run: ctx => ctx.conDetail() },
  { id: 'storage.filter', label: 'cmd.storageFilter', keyLabel: '/', when: storageTool, run: ctx => ctx.storageFilter() },
  { id: 'storage.detail', label: 'cmd.storageDetail', keyLabel: '⏎', when: storageEntry, run: ctx => ctx.storageDetail() },
  { id: 'storage.copy', label: 'cmd.storageCopy', keyLabel: 'y', when: storageEntry, run: ctx => ctx.storageCopy() },
  { id: 'el.duplicate', label: 'cmd.elDuplicate', keyLabel: 'D', when: ctx => elementsTool(ctx) && ctx.hasElSel, run: ctx => ctx.elDuplicate() },
  { id: 'el.cssOverview', label: 'cmd.elCssOverview', keyLabel: '', when: elementsTool, run: ctx => ctx.elCssOverview() },
  { id: 'el.animations', label: 'cmd.elAnimations', keyLabel: '', when: elementsTool, run: ctx => ctx.elAnimations() },
  { id: 'emu.device', label: 'cmd.emuDevice', keyLabel: '', when: attached, run: ctx => ctx.emuDevice() },
  { id: 'emu.cpu', label: 'cmd.emuCpu', keyLabel: '', when: attached, run: ctx => ctx.emuCpu() },
  { id: 'emu.color', label: 'cmd.emuColor', keyLabel: '', when: attached, run: ctx => ctx.emuColor() },
  { id: 'emu.vision', label: 'cmd.emuVision', keyLabel: '', when: attached, run: ctx => ctx.emuVision() },
  { id: 'emu.geo', label: 'cmd.emuGeo', keyLabel: '', when: attached, run: ctx => ctx.emuGeo() },
  { id: 'emu.contrast', label: 'cmd.emuContrast', keyLabel: '', when: attached, run: ctx => ctx.emuContrast() },
  { id: 'emu.timezone', label: 'cmd.emuTimezone', keyLabel: '', when: attached, run: ctx => ctx.emuTimezone() },
  { id: 'emu.reducedMotion', label: 'cmd.emuReducedMotion', keyLabel: '', when: attached, run: ctx => ctx.emuReducedMotion() },
  { id: 'emu.forcedColors', label: 'cmd.emuForcedColors', keyLabel: '', when: attached, run: ctx => ctx.emuForcedColors() },
  { id: 'emu.touch', label: 'cmd.emuTouch', keyLabel: '', when: attached, run: ctx => ctx.emuTouch() },
  { id: 'emu.paint', label: 'cmd.emuPaint', keyLabel: '', when: attached, run: ctx => ctx.emuPaint() },
  { id: 'emu.print', label: 'cmd.emuPrint', keyLabel: '', when: attached, run: ctx => ctx.emuPrint() },
  { id: 'emu.userAgent', label: 'cmd.emuUserAgent', keyLabel: '', when: attached, run: ctx => ctx.emuUserAgent() },
  { id: 'emu.locale', label: 'cmd.emuLocale', keyLabel: '', when: attached, run: ctx => ctx.emuLocale() },
  { id: 'emu.autoDark', label: 'cmd.emuAutoDark', keyLabel: '', when: attached, run: ctx => ctx.emuAutoDark() },
  { id: 'emu.rotate', label: 'cmd.emuRotate', keyLabel: '', when: attached, run: ctx => ctx.emuRotate() },
  { id: 'emu.idle', label: 'cmd.emuIdle', keyLabel: '', when: attached, run: ctx => ctx.emuIdle() },
  { id: 'emu.orientation', label: 'cmd.emuOrientation', keyLabel: '', when: attached, run: ctx => ctx.emuOrientation() },
  { id: 'emu.webauthn', label: 'cmd.webauthn', keyLabel: '', when: attached, run: ctx => ctx.emuWebauthn() },
  { id: 'rec.start', label: 'cmd.recStart', keyLabel: '', when: ctx => ctx.attached && !ctx.recording, run: ctx => ctx.recStart() },
  { id: 'rec.stop', label: 'cmd.recStop', keyLabel: '', when: ctx => ctx.recording, run: ctx => ctx.recStop() },
  { id: 'rec.replay', label: 'cmd.recReplay', keyLabel: '', when: ctx => ctx.attached && ctx.hasRecordings, run: ctx => ctx.recReplay() },
  { id: 'rec.manager', label: 'cmd.recManager', keyLabel: '', when: attached, run: ctx => ctx.recManager() },
];

export function availableCommands(ctx: CommandCtx): Command[] {
  return COMMANDS.filter(c => c.when(ctx));
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter(c => isSubseq(`${t(c.label)} ${tEn(c.label)}`, needle));
}
