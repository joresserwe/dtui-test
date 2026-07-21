import React from 'react';
import { Text } from 'ink';
import { COMMAND_LINE_API } from './repl-complete.js';
import { theme } from './theme.js';

export interface Seg { text: string; color?: string; dim?: boolean; bold?: boolean; inverse?: boolean }

const DIM: Partial<Seg> = { dim: true };
const CYAN: Partial<Seg> = { color: 'cyan' };
const YELLOW: Partial<Seg> = { color: 'yellow' };
const GREEN: Partial<Seg> = { color: 'green' };

function push(segs: Seg[], text: string, style: Partial<Seg> = {}): void {
  if (text) segs.push({ text, ...style });
}

export function highlightHtml(line: string): Seg[] {
  const segs: Seg[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (line[i] !== '<') {
      const text = /^[^<]+/.exec(line.slice(i))![0];
      push(segs, text);
      i += text.length;
      continue;
    }
    let open = '<';
    let j = i + 1;
    if (line[j] === '/') { open += '/'; j++; }
    push(segs, open, DIM);
    i = j;
    const name = /^[^\s>\/=]+/.exec(line.slice(i));
    if (name) { push(segs, name[0], CYAN); i += name[0].length; }
    let afterEq = false;
    while (i < n && line[i] !== '>' && !(line[i] === '/' && line[i + 1] === '>')) {
      const c = line[i];
      if (/\s/.test(c)) {
        const ws = /^\s+/.exec(line.slice(i))![0];
        push(segs, ws);
        i += ws.length;
        continue;
      }
      if (c === '=') { push(segs, '=', DIM); afterEq = true; i++; continue; }
      if (c === '"' || c === "'") {
        push(segs, c, DIM);
        i++;
        const end = line.indexOf(c, i);
        if (end === -1) { push(segs, line.slice(i), GREEN); i = n; break; }
        push(segs, line.slice(i, end), GREEN);
        push(segs, c, DIM);
        i = end + 1;
        afterEq = false;
        continue;
      }
      const tok = /^[^\s=>"']+/.exec(line.slice(i))![0];
      push(segs, tok, afterEq ? GREEN : YELLOW);
      i += tok.length;
      afterEq = false;
    }
    if (i < n && line[i] === '/' && line[i + 1] === '>') { push(segs, '/>', DIM); i += 2; }
    else if (i < n && line[i] === '>') { push(segs, '>', DIM); i++; }
  }
  return segs;
}

export function highlightCss(line: string): Seg[] {
  const segs: Seg[] = [];
  const hasBrace = line.includes('{') || line.includes('}');
  let state: 'selector' | 'prop' | 'value' = (!hasBrace && line.includes(':')) ? 'prop' : 'selector';
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (/\s/.test(c)) {
      const ws = /^\s+/.exec(line.slice(i))![0];
      push(segs, ws);
      i += ws.length;
      continue;
    }
    if (c === '{') { push(segs, c, DIM); state = 'prop'; i++; continue; }
    if (c === '}') { push(segs, c, DIM); state = 'selector'; i++; continue; }
    if (c === ';') { push(segs, c, DIM); if (state === 'value') state = 'prop'; i++; continue; }
    if (c === ',') { push(segs, c, DIM); i++; continue; }
    if (c === ':') { push(segs, c, DIM); if (state === 'prop') state = 'value'; i++; continue; }
    const run = /^[^\s{};:,]+/.exec(line.slice(i))![0];
    push(segs, run, state === 'selector' ? CYAN : state === 'prop' ? YELLOW : {});
    i += run.length;
  }
  return segs;
}

export function highlightJson(line: string): Seg[] {
  const segs: Seg[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && line[j] !== '"') { if (line[j] === '\\') j++; j++; }
      const end = j < n ? j + 1 : n;
      const token = line.slice(i, end);
      let k = end;
      while (k < n && /\s/.test(line[k])) k++;
      push(segs, token, line[k] === ':' ? CYAN : GREEN);
      i = end;
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(line.slice(i));
      if (num) { push(segs, num[0], YELLOW); i += num[0].length; continue; }
    }
    if (/^(true|false|null)/.test(line.slice(i))) {
      const kw = /^(true|false|null)/.exec(line.slice(i))![0];
      push(segs, kw, YELLOW);
      i += kw.length;
      continue;
    }
    if ('{}[],:'.includes(c)) { push(segs, c, DIM); i++; continue; }
    const text = /^[^"{}\[\],:tfn0-9-]+/.exec(line.slice(i));
    if (text) { push(segs, text[0]); i += text[0].length; continue; }
    push(segs, c);
    i++;
  }
  return segs;
}

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete',
  'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'let', 'new', 'null', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
]);

const CLI_API_NAMES = new Set(COMMAND_LINE_API);
const ACCENT: Partial<Seg> = { color: theme.accent };
const NUM_RE = /^(?:0[xXbBoO][\da-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)n?/;

export function highlightJs(line: string): Seg[] {
  const segs: Seg[] = [];
  const n = line.length;
  let i = 0;
  let prev = '';
  while (i < n) {
    const c = line[i];
    if (/\s/.test(c)) {
      const ws = /^\s+/.exec(line.slice(i))![0];
      push(segs, ws);
      i += ws.length;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      const end = j < n ? j + 1 : n;
      push(segs, line.slice(i, end), GREEN);
      prev = c;
      i = end;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') {
      push(segs, line.slice(i), DIM);
      break;
    }
    const num = NUM_RE.exec(line.slice(i));
    if (num) {
      push(segs, num[0], YELLOW);
      prev = num[0];
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(line.slice(i));
    if (ident) {
      const word = ident[0];
      const style = prev === '.'
        ? {}
        : JS_KEYWORDS.has(word)
          ? CYAN
          : CLI_API_NAMES.has(word)
            ? ACCENT
            : {};
      push(segs, word, style);
      prev = word;
      i += word.length;
      continue;
    }
    push(segs, c, DIM);
    prev = c;
    i++;
  }
  return segs;
}

export function highlightLabel(label: string): Seg[] {
  const segs: Seg[] = [];
  const first = label.search(/[#.]/);
  if (first === -1) { push(segs, label); return segs; }
  if (first > 0) push(segs, label.slice(0, first));
  for (const tok of label.slice(first).match(/[#.][^#.]*/g) ?? []) {
    push(segs, tok, tok[0] === '#' ? YELLOW : GREEN);
  }
  return segs;
}

export function segsToNodes(segs: Seg[], keyPrefix = 's'): React.ReactNode[] {
  return segs.map((s, i) =>
    React.createElement(Text, { key: `${keyPrefix}-${i}`, color: s.color, dimColor: s.dim, bold: s.bold, inverse: s.inverse }, s.text));
}
