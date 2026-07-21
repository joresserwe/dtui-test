import type { Declaration, MatchedRule, StyleRange } from '../../cdp/css.js';

export interface DeclRef {
  rule: number;
  decl: number;
}

export interface DeclSpan {
  start: number;
  end: number;
}

export function ruleDecls(rule: Pick<MatchedRule, 'properties' | 'declarations'>): Declaration[] {
  return rule.declarations ?? rule.properties.map(([name, value]) => ({ name, value, important: false, disabled: false }));
}

export function flatDecls(matched: Array<Pick<MatchedRule, 'properties' | 'declarations'>>): DeclRef[] {
  const out: DeclRef[] = [];
  matched.forEach((r, rule) => {
    ruleDecls(r).forEach((_, decl) => out.push({ rule, decl }));
  });
  return out;
}

export function computeOverridden(matched: Array<Pick<MatchedRule, 'properties' | 'declarations' | 'inheritedIndex'>>): boolean[][] {
  const decls = matched.map(ruleDecls);
  const groups = matched.map(r => (r.inheritedIndex === undefined ? -1 : r.inheritedIndex));
  const winner = new Map<string, { rule: number; decl: number; important: boolean; group: number }>();
  decls.forEach((ds, rule) => {
    const group = groups[rule];
    ds.forEach((d, decl) => {
      if (d.disabled || d.parsedOk === false) return;
      const cur = winner.get(d.name);
      if (!cur || group < cur.group || (group === cur.group && (d.important || !cur.important))) {
        winner.set(d.name, { rule, decl, important: d.important, group });
      }
    });
  });
  return decls.map((ds, rule) =>
    ds.map((d, decl) => {
      if (d.disabled || d.parsedOk === false) return false;
      const w = winner.get(d.name);
      return !!w && !(w.rule === rule && w.decl === decl);
    }),
  );
}

function offsetAt(lineStarts: number[], textLength: number, styleRange: StyleRange, line: number, column: number): number | null {
  const rel = line - styleRange.startLine;
  if (rel < 0 || rel >= lineStarts.length) return null;
  const col = rel === 0 ? column - styleRange.startColumn : column;
  if (col < 0) return null;
  const offset = lineStarts[rel] + col;
  if (offset > textLength) return null;
  const lineEnd = rel + 1 < lineStarts.length ? lineStarts[rel + 1] - 1 : textLength;
  if (offset > lineEnd) return null;
  return offset;
}

export function rangeSpan(cssText: string, styleRange: StyleRange, declRange: StyleRange): DeclSpan | null {
  const lineStarts = [0];
  for (let i = 0; i < cssText.length; i++) {
    if (cssText[i] === '\n') lineStarts.push(i + 1);
  }
  const start = offsetAt(lineStarts, cssText.length, styleRange, declRange.startLine, declRange.startColumn);
  const end = offsetAt(lineStarts, cssText.length, styleRange, declRange.endLine, declRange.endColumn);
  if (start === null || end === null || start > end) return null;
  return { start, end };
}

const COMMENT_RE = /^\/\*\s*([\s\S]*?)\s*\*\/\s*;?$/;

export function toggleDeclText(cssText: string, span: DeclSpan, disabled: boolean): string {
  const slice = cssText.slice(span.start, span.end);
  let next: string;
  if (disabled) {
    const m = COMMENT_RE.exec(slice.trim());
    if (!m) return cssText;
    next = m[1];
  } else {
    const body = slice.trim();
    next = `/* ${body.endsWith(';') ? body : `${body};`} */`;
  }
  return cssText.slice(0, span.start) + next + cssText.slice(span.end);
}

export function replaceDeclText(cssText: string, span: DeclSpan, name: string, value: string): string {
  const slice = cssText.slice(span.start, span.end);
  const semi = /;\s*$/.test(slice) ? ';' : '';
  return cssText.slice(0, span.start) + `${name}: ${value}${semi}` + cssText.slice(span.end);
}

const NUMBER_RE = /-?\d*\.?\d+/;
const NON_LENGTH_TOKEN_RE = /#[0-9a-fA-F]+|url\([^)]*\)/g;

export function incrementValue(value: string, delta: number): string | null {
  if (/calc\(/i.test(value)) return null;
  const m = NUMBER_RE.exec(value);
  if (!m) return null;
  for (const tok of value.matchAll(NON_LENGTH_TOKEN_RE)) {
    if (m.index >= tok.index && m.index < tok.index + tok[0].length) return null;
  }
  const next = parseFloat((parseFloat(m[0]) + delta).toFixed(4));
  return value.slice(0, m.index) + String(next) + value.slice(m.index + m[0].length);
}
