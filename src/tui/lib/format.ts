import { homedir } from 'node:os';

export const fmtMs = (ms?: number): string =>
  ms === undefined ? '-' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

export const fmtBytes = (n?: number): string =>
  n === undefined ? '-'
  : n < 1024 ? `${n}B`
  : n < 1_048_576 ? `${(n / 1024).toFixed(1)}kB`
  : `${(n / 1_048_576).toFixed(1)}MB`;

export const fmtRel = (ms: number): string => {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const fmtDateTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

export const fmtClockMs = (ts: number): string => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';

export const isSubseq = (hay: string, needle: string): boolean => {
  let i = 0;
  for (const ch of hay.toLowerCase()) {
    if (ch === needle[i]) i++;
    if (i === needle.length) break;
  }
  return i === needle.length;
};

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd);

export const displayWidth = (s: string): number => {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return w;
};

export const truncateWidth = (s: string, max: number): string => {
  if (displayWidth(s) <= max) return s;
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1;
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
};

const headWidth = (s: string, max: number): string => {
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1;
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return out;
};

const tailWidth = (s: string, max: number): string => {
  let w = 0;
  let out = '';
  for (const ch of [...s].reverse()) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1;
    if (w + cw > max) break;
    out = ch + out;
    w += cw;
  }
  return out;
};

export function abbrevPath(path: string, max = 44, home = homedir()): string {
  const p = home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
  if (displayWidth(p) <= max) return p;
  const slash = p.lastIndexOf('/');
  const tail = slash >= 0 ? p.slice(slash) : p;
  const tailW = displayWidth(tail);
  if (tailW + 1 >= max) return `…${tailWidth(tail, Math.max(1, max - 1))}`;
  return `${headWidth(p, max - 1 - tailW)}…${tail}`;
}

function prettyXml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) return body;
  const out: string[] = [];
  let depth = 0;
  for (const raw of trimmed.replace(/></g, '>\n<').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const closing = line.startsWith('</');
    if (closing) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + line);
    let net = closing ? 1 : 0;
    for (const m of line.matchAll(/<\/?[A-Za-z][^>]*?>/g)) {
      const tag = m[0];
      if (tag.startsWith('</')) net -= 1;
      else if (!tag.endsWith('/>')) net += 1;
    }
    depth = Math.max(0, depth + net);
  }
  return out.join('\n');
}

export function prettyBody(body: string, mimeType = ''): string {
  if (/json/.test(mimeType)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  if (/x-www-form-urlencoded/.test(mimeType)) {
    return [...new URLSearchParams(body)].map(([k, v]) => `${k} = ${v}`).join('\n');
  }
  if (/xml/.test(mimeType)) return prettyXml(body);
  return body;
}

export const statusColor = (e: { error?: string; status?: number }): string =>
  e.error ? 'red' : !e.status ? 'gray' : e.status >= 400 ? 'red' : e.status >= 300 ? 'yellow' : 'green';
