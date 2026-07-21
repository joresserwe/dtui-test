import type { ConsoleArg, ConsolePreview, ConsolePreviewProp } from './types.js';

export interface ConsoleObjectProp { name: string; value?: ConsoleArg }

const PREVIEW_CAP = 120;

const cap = (s: string): string => (s.length > PREVIEW_CAP ? `${s.slice(0, PREVIEW_CAP - 1)}…` : s);

const firstLine = (s: string): string => s.trim().split('\n')[0];

function toPreviewProp(raw: any): ConsolePreviewProp {
  const p: ConsolePreviewProp = { name: raw.name, type: raw.type };
  if (raw.subtype !== undefined) p.subtype = raw.subtype;
  if (raw.value !== undefined) p.value = raw.value;
  if (raw.valuePreview) p.valuePreview = toPreview(raw.valuePreview);
  return p;
}

function toPreview(raw: any): ConsolePreview {
  const p: ConsolePreview = { type: raw.type };
  if (raw.subtype !== undefined) p.subtype = raw.subtype;
  if (raw.description !== undefined) p.description = raw.description;
  if (raw.overflow) p.overflow = true;
  if (Array.isArray(raw.properties)) p.properties = raw.properties.map(toPreviewProp);
  if (Array.isArray(raw.entries)) {
    p.entries = raw.entries.map((e: any) => ({
      ...(e.key ? { key: toPreview(e.key) } : {}),
      value: toPreview(e.value),
    }));
  }
  return p;
}

export function toConsoleArg(raw: any): ConsoleArg {
  const arg: ConsoleArg = { type: raw.type };
  if (raw.subtype !== undefined) arg.subtype = raw.subtype;
  if (raw.value !== undefined) arg.value = raw.value;
  if (raw.unserializableValue !== undefined) arg.unserializableValue = raw.unserializableValue;
  if (raw.description !== undefined) arg.description = raw.description;
  if (raw.objectId !== undefined) arg.objectId = raw.objectId;
  if (raw.preview) arg.preview = toPreview(raw.preview);
  return arg;
}

function previewPropValue(p: ConsolePreviewProp, depth: number): string {
  // Nesting stops one level down: deeper objects fall back to CDP's own
  // pre-rendered value string ("Object", "Array(2)", …).
  if (p.valuePreview && depth < 1) return formatPreview(p.valuePreview, depth + 1);
  if (p.type === 'string') return JSON.stringify(p.value ?? '');
  if (p.type === 'function') return 'ƒ';
  return p.value ?? p.type;
}

export function formatPreview(pre: ConsolePreview, depth = 0): string {
  if (pre.type === 'string') return JSON.stringify(pre.description ?? '');
  if (pre.type !== 'object') return pre.description ?? pre.type;
  const overflow = pre.overflow ? ['…'] : [];
  if (pre.subtype === 'array' || pre.subtype === 'typedarray') {
    const items = (pre.properties ?? []).map(p => previewPropValue(p, depth));
    return `[${[...items, ...overflow].join(', ')}]`;
  }
  if (pre.entries) {
    const items = pre.entries.map(en =>
      en.key ? `${formatPreview(en.key, depth + 1)} => ${formatPreview(en.value, depth + 1)}` : formatPreview(en.value, depth + 1));
    const head = pre.description ? `${pre.description} ` : '';
    return `${head}{${[...items, ...overflow].join(', ')}}`;
  }
  const head = pre.description && pre.description !== 'Object' ? `${pre.description} ` : '';
  const items = (pre.properties ?? []).map(p => `${p.name}: ${previewPropValue(p, depth)}`);
  return `${head}{${[...items, ...overflow].join(', ')}}`;
}

export function formatArg(arg: ConsoleArg): string {
  // A preview without a type is malformed; genuine CDP previews always set it.
  if (arg.preview?.type) return cap(formatPreview(arg.preview));
  if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  if (arg.unserializableValue !== undefined) return arg.unserializableValue;
  if (arg.type === 'function' && arg.description) return cap(firstLine(arg.description));
  return arg.description ?? arg.type;
}

export function inlineArg(arg: ConsoleArg): string {
  if (typeof arg.value === 'string' && !arg.preview) return JSON.stringify(arg.value);
  return formatArg(arg);
}

const argNumber = (arg: ConsoleArg): number =>
  arg.value !== undefined ? Number(arg.value)
  : arg.unserializableValue !== undefined ? Number(arg.unserializableValue)
  : NaN;

function specifierValue(kind: string, arg: ConsoleArg): string {
  if (kind === 's') return typeof arg.value === 'string' ? arg.value : formatArg(arg);
  if (kind === 'd' || kind === 'i') {
    const n = argNumber(arg);
    return Number.isNaN(n) ? 'NaN' : String(Math.trunc(n));
  }
  if (kind === 'f') {
    const n = argNumber(arg);
    return String(n);
  }
  if (kind === 'j') return arg.value !== undefined ? JSON.stringify(arg.value) : formatArg(arg);
  return formatArg(arg); // %o / %O
}

const SPECIFIER = /%[sdifoOjc%]/;

export function formatConsoleArgs(args: ConsoleArg[]): string {
  if (!args.length) return '';
  const [first, ...rest] = args;
  if (first.type !== 'string' || typeof first.value !== 'string' || !SPECIFIER.test(first.value) || !rest.length) {
    return args.map(formatArg).join(' ');
  }
  const fmt = first.value;
  let out = '';
  let next = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c === '%' && i + 1 < fmt.length) {
      const kind = fmt[i + 1];
      if (kind === '%') {
        out += '%';
        i += 2;
        continue;
      }
      if ('sdifoOjc'.includes(kind) && next < rest.length) {
        const arg = rest[next++];
        // %c takes a CSS style string; it renders nothing in a terminal.
        if (kind !== 'c') out += specifierValue(kind, arg);
        i += 2;
        continue;
      }
    }
    out += c;
    i++;
  }
  return [out, ...rest.slice(next).map(formatArg)].join(' ');
}
