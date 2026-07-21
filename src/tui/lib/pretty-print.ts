export interface PrettyResult {
  lines: string[];
  displayToOriginal: number[];
  originalToDisplay: Map<number, number>;
}

const REGEX_PREV_CHARS = new Set('(,=:[!&|?{};+-*%~^<>'.split(''));
const REGEX_PREV_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'case', 'throw', 'yield', 'await',
]);
const NO_BREAK_AFTER_CLOSE = /^[ \t]*(?:else\b|catch\b|finally\b|while\b|[;,)\].:])/;

interface Frame {
  mode: 'code' | 'template';
  curly: number;
  sub: boolean;
}

export function prettyPrint(source: string): PrettyResult {
  const lines: string[] = [];
  const displayToOriginal: number[] = [];
  const originalToDisplay = new Map<number, number>();
  const stack: Frame[] = [{ mode: 'code', curly: 0, sub: false }];
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'regex' = 'code';
  let regexClass = false;
  let buf = '';
  let bufOrigin = 0;
  let depth = 0;
  let parens = 0;
  const parenSave: number[] = [];
  const braceMark: number[] = [];
  let origLine = 0;
  let prevCh = '';
  let prevWord = '';

  const append = (ch: string) => {
    if (!buf) bufOrigin = origLine;
    buf += ch;
  };
  const endLine = () => {
    const text = buf.trimEnd();
    buf = '';
    if (!text) return;
    if (!originalToDisplay.has(bufOrigin)) originalToDisplay.set(bufOrigin, lines.length);
    displayToOriginal.push(bufOrigin);
    lines.push('  '.repeat(depth) + text);
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') {
      endLine();
      origLine++;
      if (mode === 'line') mode = 'code';
      continue;
    }
    const top = stack[stack.length - 1];
    if (top.mode === 'template' && mode === 'code') {
      if (ch === '\\') {
        append(ch);
        if (i + 1 < source.length && source[i + 1] !== '\n') {
          append(source[++i]);
        }
        continue;
      }
      if (ch === '`') {
        append(ch);
        stack.pop();
        prevCh = ch;
        prevWord = '';
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        append('${');
        i++;
        stack.push({ mode: 'code', curly: 0, sub: true });
        continue;
      }
      append(ch);
      continue;
    }
    if (mode === 'line') {
      append(ch);
      continue;
    }
    if (mode === 'block') {
      append(ch);
      if (ch === '/' && source[i - 1] === '*' && buf.length >= 2) mode = 'code';
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      append(ch);
      if (ch === '\\') {
        if (i + 1 < source.length && source[i + 1] !== '\n') append(source[++i]);
        continue;
      }
      if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"')) {
        mode = 'code';
        prevCh = ch;
        prevWord = '';
      }
      continue;
    }
    if (mode === 'regex') {
      append(ch);
      if (ch === '\\') {
        if (i + 1 < source.length && source[i + 1] !== '\n') append(source[++i]);
        continue;
      }
      if (ch === '[') regexClass = true;
      else if (ch === ']') regexClass = false;
      else if (ch === '/' && !regexClass) {
        mode = 'code';
        prevCh = '/';
        prevWord = '';
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      append('//');
      i++;
      mode = 'line';
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      append('/*');
      i++;
      mode = 'block';
      continue;
    }
    if (ch === "'") {
      append(ch);
      mode = 'single';
      continue;
    }
    if (ch === '"') {
      append(ch);
      mode = 'double';
      continue;
    }
    if (ch === '`') {
      append(ch);
      stack.push({ mode: 'template', curly: 0, sub: false });
      continue;
    }
    if (ch === '/') {
      if (!prevCh || REGEX_PREV_CHARS.has(prevCh) || REGEX_PREV_WORDS.has(prevWord)) {
        append(ch);
        mode = 'regex';
        regexClass = false;
        continue;
      }
      append(ch);
      prevCh = ch;
      prevWord = '';
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (buf) append(ch);
      continue;
    }

    if (top.sub) {
      if (ch === '{') top.curly++;
      else if (ch === '}') {
        if (top.curly === 0) {
          append(ch);
          stack.pop();
          continue;
        }
        top.curly--;
      }
      append(ch);
      if (/\w/.test(ch)) prevWord = /\w/.test(prevCh) ? prevWord + ch : ch;
      else prevWord = '';
      prevCh = ch;
      continue;
    }

    if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);

    if (ch === '{') {
      if (parens > 0) {
        parenSave.push(parens);
        braceMark.push(depth);
        parens = 0;
      }
      append(ch);
      endLine();
      depth++;
      prevCh = ch;
      prevWord = '';
      continue;
    }
    if (ch === '}') {
      endLine();
      depth = Math.max(0, depth - 1);
      if (braceMark.length && braceMark[braceMark.length - 1] === depth) {
        braceMark.pop();
        parens = parenSave.pop() ?? 0;
      }
      append(ch);
      if (!NO_BREAK_AFTER_CLOSE.test(source.slice(i + 1, i + 12))) endLine();
      prevCh = ch;
      prevWord = '';
      continue;
    }
    if (ch === ';') {
      append(ch);
      if (parens === 0) endLine();
      prevCh = ch;
      prevWord = '';
      continue;
    }
    append(ch);
    if (/\w/.test(ch)) prevWord = /\w/.test(prevCh) ? prevWord + ch : ch;
    else prevWord = '';
    prevCh = ch;
  }
  endLine();
  return { lines, displayToOriginal, originalToDisplay };
}

export function displayLineFor(res: PrettyResult, originalLine: number): number {
  const exact = res.originalToDisplay.get(originalLine);
  if (exact !== undefined) return exact;
  for (let i = 0; i < res.displayToOriginal.length; i++) {
    if (res.displayToOriginal[i] >= originalLine) return i;
  }
  return Math.max(0, res.lines.length - 1);
}
