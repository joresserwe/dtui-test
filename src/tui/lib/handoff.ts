import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BoxModel } from '../../cdp/dom.js';
import type { MatchedRule } from '../../cdp/css.js';
import { computeOverridden, ruleDecls } from './style-edit.js';
import { INTERESTING_STYLES } from './session-context.js';

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clipFromQuad(quad: number[] | undefined, offset: { x: number; y: number } = { x: 0, y: 0 }): Clip | null {
  if (!quad || quad.length < 8) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]].map(v => v + offset.x);
  const ys = [quad[1], quad[3], quad[5], quad[7]].map(v => v + offset.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return { x, y, width: Math.max(1, Math.ceil(maxX) - x), height: Math.max(1, Math.ceil(maxY) - y) };
}

export interface HandoffDecl {
  name: string;
  value: string;
  important: boolean;
  disabled: boolean;
  overridden: boolean;
}

export interface HandoffRule {
  selector: string;
  origin: string;
  inheritedFrom?: string;
  declarations: HandoffDecl[];
}

export interface HandoffBox {
  width: number;
  height: number;
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
}

export interface SelectedElementData {
  url: string;
  capturedAt: string;
  selectorPath: string;
  outerHTML?: string;
  outerHTMLTruncated?: boolean;
  rules?: HandoffRule[];
  computed?: Array<[string, string]>;
  box?: HandoffBox | null;
  missing: string[];
}

export const OUTER_HTML_CAP = 64 * 1024;

export interface ElementParts {
  url: string;
  capturedAt: string;
  selectorPath: string;
  outerHTML?: string;
  matched?: MatchedRule[];
  computed?: Array<[string, string]>;
  box?: BoxModel | null;
  missing?: string[];
}

export function elementDataFromParts(parts: ElementParts): SelectedElementData {
  const missing = [...(parts.missing ?? [])];
  const data: SelectedElementData = {
    url: parts.url,
    capturedAt: parts.capturedAt,
    selectorPath: parts.selectorPath,
    missing,
  };
  if (parts.outerHTML !== undefined) {
    if (parts.outerHTML.length > OUTER_HTML_CAP) {
      data.outerHTML = parts.outerHTML.slice(0, OUTER_HTML_CAP);
      data.outerHTMLTruncated = true;
    } else {
      data.outerHTML = parts.outerHTML;
    }
  }
  if (parts.matched !== undefined) {
    const overridden = computeOverridden(parts.matched);
    data.rules = parts.matched.map((rule, r) => ({
      selector: rule.selector,
      origin: rule.origin,
      ...(rule.inheritedFrom !== undefined ? { inheritedFrom: rule.inheritedFrom } : {}),
      declarations: ruleDecls(rule).map((d, i) => ({
        name: d.name,
        value: d.value,
        important: d.important,
        disabled: d.disabled,
        overridden: overridden[r][i],
      })),
    }));
  }
  if (parts.computed !== undefined) {
    data.computed = parts.computed.filter(([k]) => INTERESTING_STYLES.includes(k));
  }
  if (parts.box !== undefined) {
    if (parts.box === null) {
      data.box = null;
      missing.push('box');
    } else {
      const { width, height, content, padding, border, margin } = parts.box;
      data.box = { width, height, content, padding, border, margin };
    }
  }
  return data;
}

export interface HandoffSession {
  url: string;
  outerHTML(nodeId: number): Promise<string>;
  computedStyles(nodeId: number): Promise<Array<[string, string]>>;
  matchedRules(nodeId: number): Promise<MatchedRule[]>;
  boxModel(nodeId: number): Promise<BoxModel | null>;
  scrollIntoView(nodeId: number): Promise<void>;
  pageOffset(): Promise<{ x: number; y: number }>;
  screenshot(clip?: Clip): Promise<string | null>;
}

export async function collectElementData(session: HandoffSession, nodeId: number, selectorPath: string, now = new Date()): Promise<SelectedElementData> {
  const missing: string[] = [];
  const part = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch {
      missing.push(name);
      return undefined;
    }
  };
  const [outerHTML, computed, matched, box] = await Promise.all([
    part('outerHTML', () => session.outerHTML(nodeId)),
    part('computed', () => session.computedStyles(nodeId)),
    part('rules', () => session.matchedRules(nodeId)),
    part('box', () => session.boxModel(nodeId)),
  ]);
  return elementDataFromParts({
    url: session.url,
    capturedAt: now.toISOString(),
    selectorPath,
    outerHTML,
    computed,
    matched,
    box,
    missing,
  });
}

function quadBounds(quad: number[]): string {
  const clip = clipFromQuad(quad);
  if (!clip) return '—';
  return `(${clip.x}, ${clip.y}) ${clip.width}×${clip.height}`;
}

export interface HandoffShots {
  element: boolean;
  viewport: boolean;
}

export function buildContextMd(data: SelectedElementData, shots: HandoffShots): string {
  const lines: string[] = ['# Element handoff', ''];
  lines.push(`- url: ${data.url}`);
  lines.push(`- captured: ${data.capturedAt}`);
  lines.push(`- selector: \`${data.selectorPath}\``);
  if (data.missing.length) lines.push(`- missing: ${data.missing.join(', ')}`);
  lines.push('');
  lines.push('## Box model');
  if (data.box) {
    lines.push(`- size: ${data.box.width}×${data.box.height} px`);
    lines.push(`- content: ${quadBounds(data.box.content)}`);
    lines.push(`- padding: ${quadBounds(data.box.padding)}`);
    lines.push(`- border: ${quadBounds(data.box.border)}`);
    lines.push(`- margin: ${quadBounds(data.box.margin)}`);
  } else {
    lines.push('- no box model (element may be display:none or detached)');
  }
  lines.push('');
  lines.push('## Matched CSS rules');
  if (data.rules?.length) {
    data.rules.forEach((rule, i) => {
      const inherited = rule.inheritedFrom !== undefined ? `, inherited from \`${rule.inheritedFrom}\`` : '';
      lines.push(`### ${i + 1}. \`${rule.selector}\` (${rule.origin}${inherited})`);
      for (const d of rule.declarations) {
        const marks = [
          d.important ? '!important' : '',
          d.disabled ? '[disabled]' : '',
          d.overridden ? '[overridden]' : '',
        ].filter(Boolean).join(' ');
        lines.push(`- \`${d.name}: ${d.value}\`${marks ? ` ${marks}` : ''}`);
      }
      lines.push('');
    });
  } else {
    lines.push(data.rules ? '- none' : '- unavailable');
    lines.push('');
  }
  lines.push('## Computed styles (key subset)');
  if (data.computed?.length) {
    for (const [k, v] of data.computed) lines.push(`- ${k}: ${v}`);
  } else {
    lines.push(data.computed ? '- none' : '- unavailable');
  }
  lines.push('');
  lines.push('## Outer HTML');
  if (data.outerHTML !== undefined) {
    lines.push('```html');
    lines.push(data.outerHTML);
    lines.push('```');
    if (data.outerHTMLTruncated) lines.push(`(truncated to ${OUTER_HTML_CAP} chars)`);
  } else {
    lines.push('- unavailable');
  }
  lines.push('');
  lines.push('## Screenshots');
  lines.push(shots.element ? '- element.png — cropped to the element border box' : '- element.png — not captured');
  lines.push(shots.viewport ? '- viewport.png — full viewport for surrounding context' : '- viewport.png — not captured');
  lines.push('');
  return lines.join('\n');
}

export function handoffRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA ?? homedir(), 'devtools-tui', 'handoff');
  }
  const base = env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share');
  return join(base, 'devtools-tui', 'handoff');
}

export function elementSlug(selectorPath: string): string {
  const tail = selectorPath.split('>').pop() ?? '';
  return tail
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export interface HandoffResult {
  dir: string;
  missing: string[];
}

export async function captureElementShot(session: HandoffSession, nodeId: number): Promise<string | null> {
  await session.scrollIntoView(nodeId).catch(() => {});
  const box = await session.boxModel(nodeId).catch(() => null);
  const offset = await session.pageOffset().catch(() => ({ x: 0, y: 0 }));
  const clip = box ? clipFromQuad(box.border, offset) : null;
  return clip ? session.screenshot(clip) : null;
}

export async function writeHandoffBundle(
  session: HandoffSession,
  nodeId: number,
  selectorPath: string,
  root: string = handoffRoot(),
  now = new Date(),
): Promise<HandoffResult> {
  const data = await collectElementData(session, nodeId, selectorPath, now);
  const elementShot = await captureElementShot(session, nodeId);
  const viewportShot = await session.screenshot();
  if (!elementShot) data.missing.push('element.png');
  if (!viewportShot) data.missing.push('viewport.png');
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const slug = elementSlug(selectorPath);
  const base = slug ? `${stamp}-${slug}` : stamp;
  let dir = join(root, base);
  for (let i = 2; existsSync(dir); i++) dir = join(root, `${base}-${i}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'context.md'), buildContextMd(data, { element: !!elementShot, viewport: !!viewportShot }));
  if (elementShot) writeFileSync(join(dir, 'element.png'), Buffer.from(elementShot, 'base64'));
  if (viewportShot) writeFileSync(join(dir, 'viewport.png'), Buffer.from(viewportShot, 'base64'));
  return { dir, missing: data.missing };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function runAgentCmd(cmd: string, dir: string, onError: (msg: string) => void): void {
  try {
    const child = spawn(`${cmd} ${shellQuote(dir)}`, { shell: true, detached: true, stdio: 'ignore' });
    child.on('error', e => onError(e.message));
    child.on('exit', (code, signal) => {
      if (signal) onError(`killed by ${signal}`);
      else if (code !== 0 && code !== null) onError(`exit code ${code}`);
    });
    child.unref();
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
  }
}
