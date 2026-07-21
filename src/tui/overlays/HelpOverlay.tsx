import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth } from '../lib/format.js';
import { theme } from '../lib/theme.js';
import { t } from '../lib/i18n.js';
import type { Tool } from '../panels/ToolTabs.js';

export const HELP_CHROME = 4;
const KEY_COL = 20;

export interface HelpSection {
  title: string;
  tool?: Tool;
  keys: Array<[string, string]>;
}

const sections = (): HelpSection[] => [
  {
    title: t('help.title.global'),
    keys: [
      ['j / k, ↓ / ↑', t('help.global.move')],
      ['gg / G · Ctrl-d / u', t('help.global.jump')],
      ['Enter / Esc', t('help.global.enterEsc')],
      ['Tab / Shift-Tab', t('help.global.cycleTools')],
      ['1 – 8', t('help.global.tools')],
      [',', t('help.global.settings')],
      ['b', t('help.global.tabPicker')],
      ['f', t('help.global.focus')],
      ['[ / ]', t('help.global.sessionCycle')],
      ['.', t('help.global.sessionControl')],
      ['Ctrl-x', t('help.global.sessionClose')],
      ['Ctrl-w', t('help.global.closeTab')],
      ['t / I', t('help.global.newTab')],
      ['r', t('help.global.reload')],
      ['y', t('help.global.copyContext')],
      ['S', t('help.global.snapshot')],
      ['!', t('help.global.notifications')],
      [':', t('help.global.palette')],
      ['?', t('help.global.help')],
      ['q / Ctrl-c', t('help.global.quit')],
    ],
  },
  {
    title: 'Network',
    tool: 'network',
    keys: [
      ['Enter', t('help.network.detail')],
      ['/', t('help.network.filter')],
      ['Ctrl-f · n / N', t('help.network.search')],
      ['x', t('help.network.typePicker')],
      ['s', t('help.network.sortPicker')],
      ['c', t('help.network.columns')],
      ['w', t('help.network.window')],
      ['D', t('help.network.group')],
      ['z', t('help.network.range')],
      ['K', t('help.network.peek')],
      ['T', t('help.network.throttle')],
      ['u', t('help.network.nocache')],
      ['C', t('help.network.clear')],
      ['Y / F', t('help.network.copyAs')],
      ['p', t('help.network.copyMore')],
      ['v / V', t('help.network.mark')],
      ['d', t('help.network.diff')],
      ['H', t('help.network.exportHar')],
      ['R / E', t('help.network.replay')],
      ['O / Ctrl-O', t('help.network.override')],
      ['B / Ctrl-B', t('help.network.block')],
      ['M / Ctrl-E', t('help.network.mapRemote')],
      ['Esc', t('help.network.esc')],
    ],
  },
  {
    title: t('help.title.detail'),
    keys: [
      ['1 – 5, h / l', t('help.detail.tabs')],
      ['j / k · Ctrl-d / u', t('help.detail.scroll')],
      ['y / e', t('help.detail.copyEdit')],
      ['w', t('help.detail.wrap')],
      ['/', t('help.detail.msgFilter')],
      ['q / Esc', t('help.detail.close')],
    ],
  },
  {
    title: 'Elements',
    tool: 'elements',
    keys: [
      ['j / k', t('help.elements.walk')],
      ['h / l', t('help.elements.collapse')],
      ['Enter', t('help.elements.detail')],
      ['/ · n / N', t('help.elements.search')],
      ['I', t('help.elements.inspect')],
      ['f', t('help.elements.hints')],
      ['.', t('help.elements.click')],
      [';', t('help.elements.hover')],
      ['o', t('help.elements.layoutOverlay')],
      ['bs / ba / br', t('help.elements.domBp')],
      ['zR / zM / zz', t('help.elements.zChord')],
      ['H', t('help.elements.hide')],
      ['P', t('help.elements.pin')],
      ['m', t('help.elements.mutations')],
      ['A', t('help.elements.attrs')],
      ['x', t('help.elements.deleteNode')],
      ['D', t('help.elements.duplicate')],
      [':', t('help.elements.overview')],
      [':', t('help.elements.animations')],
      ['ys / yh', t('help.elements.copy')],
      ['yb', t('help.elements.handoff')],
      [`L (${t('help.qual.detail')})`, t('help.elements.listeners')],
      [`j / k (${t('help.qual.detail')})`, t('help.elements.declCursor')],
      [`Space (${t('help.qual.detail')})`, t('help.elements.declToggle')],
      [`i (${t('help.qual.detail')})`, t('help.elements.declEditValue')],
      [`[ ] · { } (${t('help.qual.detail')})`, t('help.elements.declAdjust')],
      [`C (${t('help.qual.detail')})`, t('help.elements.computed')],
      [`, (${t('help.qual.detail')})`, t('help.elements.classes')],
      [`p (${t('help.qual.detail')})`, t('help.elements.pseudo')],
      [`e (${t('help.qual.detail')})`, t('help.elements.editHtml')],
      [`r / c (${t('help.qual.detail')})`, t('help.elements.rule')],
      [`a (${t('help.qual.detail')})`, t('help.elements.declaration')],
      [`+ (${t('help.qual.detail')})`, t('help.elements.addRule')],
      [`Esc (${t('help.qual.detail')})`, t('help.elements.back')],
    ],
  },
  {
    title: 'Console',
    tool: 'console',
    keys: [
      ['i', t('help.console.input')],
      ['↑ / ↓ (i)', t('help.console.history')],
      ['Tab / → (i)', t('help.console.complete')],
      ['', t('help.console.eager')],
      ['Enter', t('help.console.detail')],
      [`⏎ / l · h (${t('help.qual.detail')})`, t('help.console.expand')],
      [`s (${t('help.qual.detail')})`, t('help.console.storeGlobal')],
      [`I (${t('help.qual.detail')})`, t('help.console.reveal')],
      ['Space', t('help.console.stack')],
      ['/', t('help.console.filter')],
      ['x', t('help.console.level')],
      ['E', t('help.console.context')],
      ['T', t('help.console.timestamps')],
      ['C', t('help.console.clear')],
      ['Y', t('help.console.copyAll')],
    ],
  },
  {
    title: 'Storage',
    tool: 'storage',
    keys: [
      ['h / l', t('help.storage.views')],
      ['Enter', t('help.storage.detail')],
      ['(app)', t('help.storage.app')],
      ['(frames)', t('help.storage.frames')],
      ['Enter (idb/cache)', t('help.storage.drill')],
      ['h (idb/cache)', t('help.storage.back')],
      ['/', t('help.storage.filter')],
      ['e / n', t('help.storage.edit')],
      ['e (idb)', t('help.storage.idbEdit')],
      ['a', t('help.storage.attr')],
      ['y', t('help.storage.copy')],
      ['Y (cookies)', t('help.storage.exportCookies')],
      ['d', t('help.storage.delete')],
      ['D (idb/cache)', t('help.storage.clearStore')],
      ['u / B (sw)', t('help.storage.swToggles')],
      ['p / s / S / P (sw)', t('help.storage.swEvents')],
      ['T / r (background)', t('help.storage.background')],
      ['d (pst)', t('help.storage.pstClear')],
      ['X', t('help.storage.clear')],
    ],
  },
  {
    title: 'Sources',
    tool: 'sources',
    keys: [
      ['Enter', t('help.sources.open')],
      ['/', t('help.sources.filter')],
      [`b (${t('help.qual.viewer')})`, t('help.sources.bp')],
      [`B (${t('help.qual.viewer')})`, t('help.sources.condBp')],
      [`L (${t('help.qual.viewer')})`, t('help.sources.logpoint')],
      [`P (${t('help.qual.viewer')})`, t('help.sources.pretty')],
      [`e (${t('help.qual.viewer')})`, t('help.sources.liveEdit')],
      ['m', t('help.sources.map')],
      ['x', t('help.sources.blackbox')],
      ['F', t('help.sources.xhr')],
      ['E', t('help.sources.events')],
      ['X', t('help.sources.exceptions')],
      ['n / s / o', t('help.sources.step')],
      ['c / p', t('help.sources.resumePause')],
      ['j / k (⏸)', t('help.sources.frames')],
      ['w (⏸)', t('help.sources.focus')],
      ['Enter / l · h (⏸)', t('help.sources.expand')],
      ['+ (⏸)', t('help.sources.watch')],
      ['d (⏸)', t('help.sources.watchDel')],
      ['r y S t I (⏸)', t('help.sources.keysNote')],
      ['Esc', t('help.sources.dismiss')],
    ],
  },
  {
    title: 'Components',
    tool: 'components',
    keys: [
      ['r', t('help.components.rescan')],
      ['h / l', t('help.components.fold')],
      ['/', t('help.components.filter')],
      ['H', t('help.components.highlight')],
      ['Enter', t('help.components.reveal')],
      ['i', t('help.components.inspect')],
    ],
  },
  {
    title: 'Audit',
    tool: 'audit',
    keys: [
      ['r', t('help.audit.run')],
      ['m', t('help.audit.preset')],
      ['p / a / B / s', t('help.audit.cats')],
      ['j / k', t('help.audit.move')],
      ['Enter', t('help.audit.detail')],
      ['E', t('help.audit.export')],
      ['h / l', t('help.audit.pastRuns')],
      ['Esc', t('help.audit.cancel')],
    ],
  },
  {
    title: 'Settings',
    tool: 'settings',
    keys: [
      ['h / l', t('help.settings.flip')],
      ['Enter', t('help.settings.edit')],
      ['/', t('help.settings.search')],
      ['Esc', t('help.settings.clear')],
    ],
  },
  {
    title: t('help.title.pickers'),
    keys: [
      [`${t('key.typing')} · j / k`, t('help.picker.move')],
      ['Space / Enter', t('help.picker.toggle')],
      ['Ctrl-x (b)', t('help.picker.closeSession')],
      ['Ctrl-w (b)', t('help.picker.closeTab')],
      [`h / l (${t('help.qual.sort')})`, t('help.picker.sortDir')],
      ['Space / Enter / d (Ctrl-O)', t('help.picker.override')],
      ['Space / d (Ctrl-B)', t('help.picker.block')],
      ['h / l · H / L (z)', t('help.picker.rangeMove')],
      ['0 / $ (z)', t('help.picker.rangeEnds')],
      ['v (z)', t('help.picker.rangeAnchor')],
      ['Enter / Esc (z)', t('help.picker.rangeApply')],
    ],
  },
  {
    title: t('help.title.emulation'),
    keys: [
      ['device', t('help.emu.device')],
      ['cpu', t('help.emu.cpu')],
      ['color', t('help.emu.color')],
      ['vision', t('help.emu.vision')],
      ['geo', t('help.emu.geo')],
      ['contrast', t('help.emu.contrast')],
      ['timezone', t('help.emu.timezone')],
      ['locale', t('help.emu.locale')],
      ['user-agent', t('help.emu.userAgent')],
      ['auto-dark', t('help.emu.autoDark')],
      ['rotate', t('help.emu.rotate')],
      ['idle', t('help.emu.idle')],
      ['orientation', t('help.emu.orientation')],
      ['webauthn', t('help.emu.webauthn')],
      ['reduced-motion', t('help.emu.reducedMotion')],
      ['forced-colors', t('help.emu.forcedColors')],
      ['touch', t('help.emu.touch')],
      ['paint', t('help.emu.paint')],
      ['print', t('help.emu.print')],
    ],
  },
];

export function helpSections(tool?: Tool): HelpSection[] {
  const all = sections();
  const idx = tool ? all.findIndex(s => s.tool === tool) : -1;
  if (idx <= 0) return all;
  return [all[idx], ...all.filter((_, i) => i !== idx)];
}

export type HelpRow =
  | { kind: 'header'; title: string }
  | { kind: 'key'; keys: string; desc: string }
  | { kind: 'blank' };

export function helpRows(tool?: Tool): HelpRow[] {
  const rows: HelpRow[] = [];
  for (const s of helpSections(tool)) {
    if (rows.length) rows.push({ kind: 'blank' });
    rows.push({ kind: 'header', title: s.title });
    for (const [keys, desc] of s.keys) rows.push({ kind: 'key', keys, desc });
  }
  return rows;
}

export interface HelpOverlayProps {
  tool?: Tool;
  scroll?: number;
  height?: number;
  width?: number;
}

function renderRow(row: HelpRow, key: number, inner: number): React.ReactNode {
  if (row.kind === 'blank') return <Text key={key}> </Text>;
  if (row.kind === 'header') {
    const head = `── ${row.title} `;
    return (
      <Text key={key} dimColor wrap="truncate">
        {head + '─'.repeat(Math.max(3, inner - displayWidth(head)))}
      </Text>
    );
  }
  return (
    <Text key={key} wrap="truncate">
      <Text color="cyan">{row.keys}</Text>
      {' '.repeat(Math.max(1, KEY_COL - displayWidth(row.keys)))}
      {row.desc}
    </Text>
  );
}

export function HelpOverlay({ tool, scroll = 0, height = 28, width = 72 }: HelpOverlayProps) {
  const rows = helpRows(tool);
  const budget = Math.max(1, height - HELP_CHROME);
  const inner = Math.max(10, width - 4);
  const max = Math.max(0, rows.length - budget);
  const at = Math.max(0, Math.min(scroll, max));
  const visible = rows.slice(at, at + budget);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width} height={height} backgroundColor={theme.overlayBg}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Keys</Text>
        {rows.length > budget ? <Text dimColor>{`${at + visible.length}/${rows.length}`}</Text> : null}
      </Box>
      {visible.map((row, i) => renderRow(row, i, inner))}
      {Array.from({ length: Math.max(0, budget - visible.length) }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      <Text dimColor wrap="truncate">
        {at < max ? t('help.footer.more') : ''}{t('help.footer.keys')}
      </Text>
    </Box>
  );
}
