import type { NetworkEntry } from '../../store/types.js';
import type { Seg } from './highlight.js';

export type RegexLiteral = { re: RegExp } | { invalid: true };

export function parseRegexLiteral(body: string): RegexLiteral | null {
  if (body.length < 2 || body[0] !== '/') return null;
  const m = /^\/(.+)\/([a-z]*)$/.exec(body);
  if (!m) return null;
  try {
    const flags = m[2].includes('i') ? m[2] : `${m[2]}i`;
    return { re: new RegExp(m[1], flags) };
  } catch {
    return { invalid: true };
  }
}

export function entryMatches(e: NetworkEntry, query: string): boolean {
  const q = query.toLowerCase();
  const has = (s: string | undefined): boolean => s !== undefined && s.toLowerCase().includes(q);
  if (has(e.url) || has(e.postData)) return true;
  for (const headers of [e.requestHeaders, e.responseHeaders]) {
    for (const [k, v] of Object.entries(headers)) if (has(k) || has(v)) return true;
  }
  if ((e.setCookies ?? []).some(c => has(c))) return true;
  return !e.bodyBase64 && has(e.body);
}

export function searchEntries(entries: NetworkEntry[], query: string): NetworkEntry[] {
  const q = query.trim();
  if (!q) return entries;
  return entries.filter(e => entryMatches(e, q));
}

export function highlightSegs(segs: Seg[], query: string): Seg[] {
  const q = query.trim().toLowerCase();
  if (!q) return segs;
  const full = segs.map(s => s.text).join('').toLowerCase();
  const ranges: Array<[number, number]> = [];
  let at = full.indexOf(q);
  while (at !== -1) {
    ranges.push([at, at + q.length]);
    at = full.indexOf(q, at + q.length);
  }
  if (!ranges.length) return segs;
  const out: Seg[] = [];
  let pos = 0;
  for (const seg of segs) {
    const end = pos + seg.text.length;
    let cur = pos;
    for (const [rs, re] of ranges) {
      const s = Math.max(rs, cur);
      const e = Math.min(re, end);
      if (e <= s) continue;
      if (s > cur) out.push({ ...seg, text: seg.text.slice(cur - pos, s - pos) });
      out.push({ ...seg, text: seg.text.slice(s - pos, e - pos), color: 'cyan', inverse: true });
      cur = e;
    }
    if (cur < end) out.push({ ...seg, text: seg.text.slice(cur - pos) });
    pos = end;
  }
  return out;
}
