const VAR_RE = /var\(\s*(--[^\s,)]+)/g;

export interface VarResolution {
  name: string;
  value?: string;
}

interface ParsedVar {
  name: string;
  fallback?: string;
}

export function varRefs(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(VAR_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function parseTopLevelVars(value: string): ParsedVar[] {
  const out: ParsedVar[] = [];
  let i = 0;
  while (i < value.length) {
    const idx = value.indexOf('var(', i);
    if (idx < 0) break;
    let j = idx + 4;
    while (j < value.length && /\s/.test(value[j])) j++;
    let name = '';
    while (j < value.length && !/[\s,)]/.test(value[j])) name += value[j++];
    while (j < value.length && /\s/.test(value[j])) j++;
    let fallback: string | undefined;
    if (value[j] === ',') {
      j++;
      const start = j;
      let depth = 1;
      while (j < value.length && depth > 0) {
        if (value[j] === '(') depth++;
        else if (value[j] === ')' && --depth === 0) break;
        j++;
      }
      fallback = value.slice(start, j).trim();
      i = j + 1;
    } else {
      i = value[j] === ')' ? j + 1 : Math.max(j, idx + 4);
    }
    if (name.startsWith('--')) out.push({ name, fallback });
  }
  return out;
}

function resolveFallback(fallback: string, computed: Array<[string, string]>): string | undefined {
  if (fallback.includes('var(')) {
    const inner = parseTopLevelVars(fallback)[0];
    if (inner) {
      const found = computed.find(([k]) => k === inner.name)?.[1].trim();
      if (found) return found;
      return inner.fallback ? resolveFallback(inner.fallback, computed) : undefined;
    }
  }
  return fallback || undefined;
}

export function resolveVars(value: string, computed: Array<[string, string]>): VarResolution[] {
  const seen = new Set<string>();
  const out: VarResolution[] = [];
  for (const ref of parseTopLevelVars(value)) {
    if (seen.has(ref.name)) continue;
    seen.add(ref.name);
    const found = computed.find(([k]) => k === ref.name)?.[1].trim();
    if (found) out.push({ name: ref.name, value: found });
    else {
      const fb = ref.fallback ? resolveFallback(ref.fallback, computed) : undefined;
      out.push(fb ? { name: ref.name, value: fb } : { name: ref.name });
    }
  }
  return out;
}
