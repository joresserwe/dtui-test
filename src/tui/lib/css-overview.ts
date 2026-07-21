import type { MediaQueryView } from '../../cdp/css.js';

export const CSS_OVERVIEW_ELEMENT_CAP = 5000;
export const CSS_OVERVIEW_TOP = 30;

export interface CountEntry {
  value: string;
  count: number;
}

export interface MediaQueryCount {
  text: string;
  source: string;
  count: number;
}

export interface CssOverviewData {
  elements: number;
  truncated: boolean;
  text: CountEntry[];
  background: CountEntry[];
  border: CountEntry[];
  fonts: CountEntry[];
  medias: MediaQueryCount[];
}

export function buildCssOverviewScript(cap = CSS_OVERVIEW_ELEMENT_CAP, top = CSS_OVERVIEW_TOP): string {
  return `(() => {
  const cap = ${cap};
  const top = ${top};
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const text = new Map(), background = new Map(), border = new Map(), fonts = new Map();
  const all = document.querySelectorAll('*');
  const n = Math.min(all.length, cap);
  for (let i = 0; i < n; i++) {
    const cs = getComputedStyle(all[i]);
    bump(text, cs.color);
    const bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bump(background, bg);
    const seen = new Set();
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs['border' + side + 'Style'] === 'none' || cs['border' + side + 'Width'] === '0px') continue;
      const c = cs['border' + side + 'Color'];
      if (c && !seen.has(c)) { seen.add(c); bump(border, c); }
    }
    if (cs.fontFamily) bump(fonts, cs.fontFamily);
  }
  const pack = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return { elements: n, truncated: all.length > cap, text: pack(text), background: pack(background), border: pack(border), fonts: pack(fonts) };
})()`;
}

function packList(v: unknown): CountEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is [string, unknown] => Array.isArray(e) && typeof e[0] === 'string')
    .map(e => ({ value: e[0], count: Number(e[1]) || 0 }));
}

export function aggregateMediaQueries(medias: MediaQueryView[]): MediaQueryCount[] {
  const out: MediaQueryCount[] = [];
  const byKey = new Map<string, MediaQueryCount>();
  for (const m of medias) {
    const key = `${m.source}\0${m.text}`;
    const existing = byKey.get(key);
    if (existing) existing.count++;
    else {
      const entry = { text: m.text, source: m.source, count: 1 };
      byKey.set(key, entry);
      out.push(entry);
    }
  }
  return out;
}

export function normalizeOverview(raw: unknown, medias: MediaQueryView[]): CssOverviewData {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    elements: Number(obj.elements) || 0,
    truncated: !!obj.truncated,
    text: packList(obj.text),
    background: packList(obj.background),
    border: packList(obj.border),
    fonts: packList(obj.fonts),
    medias: aggregateMediaQueries(medias),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100, lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function rgbToHex(value: string): string | null {
  const v = value.trim();
  const hexLit = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(v);
  if (hexLit) {
    const h = hexLit[1];
    if (h.length <= 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    return `#${h.slice(0, 6)}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (rgb) {
    const hex = (s: string) => Math.min(255, Number(s)).toString(16).padStart(2, '0');
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
  }
  const hsl = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(v);
  if (hsl) return hslToHex(Number(hsl[1]) % 360, Number(hsl[2]), Number(hsl[3]));
  return null;
}
