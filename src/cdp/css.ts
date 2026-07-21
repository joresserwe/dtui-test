import type { CdpConnection } from './connection.js';
import { isInheritable } from './inheritable.js';

export async function getComputedStyles(conn: CdpConnection, nodeId: number): Promise<Array<[string, string]>> {
  await conn.send('CSS.enable');
  const { computedStyle } = await conn.send<{ computedStyle: Array<{ name: string; value: string }> }>(
    'CSS.getComputedStyleForNode', { nodeId });
  return computedStyle.map(p => [p.name, p.value]);
}

export interface StyleRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Declaration {
  name: string;
  value: string;
  important: boolean;
  disabled: boolean;
  parsedOk?: boolean;
  range?: StyleRange;
}

export interface MatchedRule {
  selector: string;
  origin: string;
  properties: Array<[string, string]>;
  declarations?: Declaration[];
  styleSheetId?: string;
  ruleRange?: StyleRange;
  cssText: string;
  inheritedFrom?: string;
  inheritedIndex?: number;
  contexts?: string[];
}

function ruleFromStyle(selector: string, origin: string, style: any): MatchedRule {
  const cssProps: any[] = (style.cssProperties ?? []).filter((p: any) => p.value);
  const properties = cssProps.map((p: any) => [p.name, p.value] as [string, string]);
  const ranged = new Set(cssProps.filter((p: any) => p.range).map((p: any) => p.name));
  const declarations: Declaration[] = cssProps.filter((p: any) => p.range || !ranged.has(p.name)).map((p: any) => ({
    name: p.name,
    value: p.value,
    important: !!p.important,
    disabled: !!p.disabled,
    ...(p.parsedOk === false ? { parsedOk: false } : {}),
    ...(p.range ? { range: p.range } : {}),
  }));
  return {
    selector,
    origin,
    properties,
    declarations,
    cssText: style.cssText ?? properties.map(([k, v]: [string, string]) => `${k}: ${v}`).join('; '),
    ...(style.styleSheetId && style.range
      ? { styleSheetId: style.styleSheetId, ruleRange: style.range }
      : {}),
  };
}

export interface RuleContexts {
  layers?: Array<{ text?: string }>;
  containerQueries?: Array<{ text?: string; name?: string }>;
  scopes?: Array<{ text?: string }>;
}

// CDP lists layers/containerQueries/scopes innermost-first.
export function ruleContextLabels(rule: RuleContexts): string[] {
  const out: string[] = [];
  for (const l of [...(rule.layers ?? [])].reverse()) out.push(l.text ? `@layer ${l.text}` : '@layer');
  for (const c of [...(rule.containerQueries ?? [])].reverse()) {
    out.push(`@container${c.name ? ` ${c.name}` : ''}${c.text ? ` ${c.text}` : ''}`);
  }
  for (const s of [...(rule.scopes ?? [])].reverse()) out.push(s.text ? `@scope ${s.text}` : '@scope');
  return out;
}

function ruleFromMatch(m: any): MatchedRule {
  const base = ruleFromStyle(m.rule.selectorList.text, m.rule.origin, m.rule.style);
  const contexts = ruleContextLabels(m.rule);
  return contexts.length ? { ...base, contexts } : base;
}

function inheritableOnly(rule: MatchedRule): MatchedRule | null {
  const properties = rule.properties.filter(([name]) => isInheritable(name));
  const declarations = (rule.declarations ?? []).filter(d => isInheritable(d.name));
  if (!properties.length && !declarations.length) return null;
  return { ...rule, properties, declarations };
}

export async function getMatchedRules(conn: CdpConnection, nodeId: number, ancestors: string[] = []): Promise<MatchedRule[]> {
  await conn.send('CSS.enable');
  const { matchedCSSRules, inlineStyle, inherited } = await conn.send<{ matchedCSSRules: any[]; inlineStyle?: any; inherited?: any[] }>(
    'CSS.getMatchedStylesForNode', { nodeId });
  const rules = (matchedCSSRules ?? []).map(m => ruleFromMatch(m));
  if (inlineStyle) rules.push(ruleFromStyle('element.style', 'inline', inlineStyle));
  (inherited ?? []).forEach((entry: any, i: number) => {
    const from = ancestors[i] ?? `ancestor ${i + 1}`;
    const group = (entry.matchedCSSRules ?? []).map((m: any) => ruleFromMatch(m));
    if (entry.inlineStyle) group.push(ruleFromStyle('element.style', 'inline', entry.inlineStyle));
    for (const r of group) {
      const kept = inheritableOnly(r);
      if (kept) rules.push({ ...kept, inheritedFrom: from, inheritedIndex: i });
    }
  });
  return rules;
}

export async function setStyleText(conn: CdpConnection, styleSheetId: string, range: StyleRange, text: string): Promise<void> {
  await conn.send('CSS.setStyleTexts', { edits: [{ styleSheetId, range, text }] });
}

export async function createStyleSheet(conn: CdpConnection, frameId: string): Promise<string> {
  const { styleSheetId } = await conn.send<{ styleSheetId: string }>('CSS.createStyleSheet', { frameId });
  return styleSheetId;
}

export async function addRule(conn: CdpConnection, styleSheetId: string, ruleText: string): Promise<void> {
  await conn.send('CSS.addRule', {
    styleSheetId,
    ruleText,
    location: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
  });
}

export interface PlatformFont {
  family: string;
  glyphs: number;
  custom: boolean;
}

export async function getPlatformFonts(conn: CdpConnection, nodeId: number): Promise<PlatformFont[]> {
  await conn.send('CSS.enable');
  const { fonts } = await conn.send<{ fonts?: Array<{ familyName: string; glyphCount?: number; isCustomFont?: boolean }> }>(
    'CSS.getPlatformFontsForNode', { nodeId });
  return (fonts ?? []).map(f => ({ family: f.familyName, glyphs: f.glyphCount ?? 0, custom: !!f.isCustomFont }));
}

export interface MediaQueryView {
  text: string;
  source: string;
}

export async function getMediaQueries(conn: CdpConnection): Promise<MediaQueryView[]> {
  await conn.send('CSS.enable');
  const { medias } = await conn.send<{ medias?: Array<{ text?: string; source?: string }> }>('CSS.getMediaQueries');
  return (medias ?? []).map(m => ({ text: m.text ?? '', source: m.source ?? '' }));
}

export async function forcePseudoState(conn: CdpConnection, nodeId: number, classes: string[]): Promise<void> {
  await conn.send('CSS.enable');
  await conn.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
}
