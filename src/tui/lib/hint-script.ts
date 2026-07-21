export const HINT_ALPHABET = 'asdfghjkl';

export function hintLabels(n: number, alphabet: string): string[] {
  if (n <= 0) return [];
  const chars = alphabet.split('');
  let len = 1;
  while (Math.pow(chars.length, len) < n) len++;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let v = i;
    let label = '';
    for (let p = 0; p < len; p++) {
      label = chars[v % chars.length] + label;
      v = Math.floor(v / chars.length);
    }
    out.push(label);
  }
  return out;
}

export const HINT_CONTAINER_ID = '__dtui_hints';

const CLICKABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'area[href]',
  '[onclick]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

export function buildShowHintsScript(): string {
  return `(() => {
  try {
    const gen = ${hintLabels.toString()};
    const old = window.__dtuiHints;
    if (old) old.cleanup();
    const seen = new Set();
    const els = [];
    for (const el of document.querySelectorAll(${JSON.stringify(CLICKABLE_SELECTOR)})) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      els.push({ el, r });
    }
    const labels = gen(els.length, ${JSON.stringify(HINT_ALPHABET)});
    const wrap = document.createElement('div');
    wrap.id = ${JSON.stringify(HINT_CONTAINER_ID)};
    wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;font:bold 11px monospace;';
    const map = {};
    els.forEach((e, i) => {
      const b = document.createElement('span');
      b.textContent = labels[i];
      b.dataset.label = labels[i];
      b.style.cssText = 'position:fixed;left:' + Math.max(0, e.r.left) + 'px;top:' + Math.max(0, e.r.top) + 'px;background:#ffd76e;color:#302505;border:1px solid #b8860b;border-radius:2px;padding:0 2px;';
      wrap.appendChild(b);
      map[labels[i]] = e.el;
    });
    document.documentElement.appendChild(wrap);
    const drop = () => { wrap.remove(); delete window.__dtuiHints; removeEventListener('pagehide', drop); };
    const timer = setTimeout(drop, 60000);
    addEventListener('pagehide', drop, { once: true });
    window.__dtuiHints = { map, cleanup: () => { clearTimeout(timer); drop(); } };
    return labels;
  } catch (e) {
    return [];
  }
})()`;
}

export function buildFilterHintsScript(prefix: string): string {
  return `(() => {
  const wrap = document.getElementById(${JSON.stringify(HINT_CONTAINER_ID)});
  if (!wrap) return 0;
  let n = 0;
  for (const b of wrap.children) {
    const on = (b.dataset.label || '').indexOf(${JSON.stringify(prefix)}) === 0;
    b.style.display = on ? '' : 'none';
    if (on) n++;
  }
  return n;
})()`;
}

export function buildPickHintScript(label: string): string {
  return `(() => {
  const h = window.__dtuiHints;
  if (!h) return null;
  const el = h.map[${JSON.stringify(label)}] || null;
  h.cleanup();
  return el;
})()`;
}

export function buildClearHintsScript(): string {
  return `(() => { const h = window.__dtuiHints; if (h) h.cleanup(); })()`;
}
