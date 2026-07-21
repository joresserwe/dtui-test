import type { NodeMap } from '../../cdp/domtree.js';
import { HIDE_CLASS } from '../../cdp/dom.js';

export function cssEscapeIdent(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = ch.charCodeAt(0);
    if (code === 0) {
      out += '�';
      continue;
    }
    if ((code >= 0x01 && code <= 0x1f) || code === 0x7f
      || (i === 0 && ch >= '0' && ch <= '9')
      || (i === 1 && ch >= '0' && ch <= '9' && value[0] === '-')) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    if (i === 0 && ch === '-' && value.length === 1) {
      out += '\\-';
      continue;
    }
    if (code >= 0x80 || ch === '-' || ch === '_'
      || (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      out += ch;
      continue;
    }
    out += `\\${ch}`;
  }
  return out;
}

export function buildSelectorPath(map: NodeMap, nodeId: number): string {
  const segs: string[] = [];
  let cur: number | undefined = nodeId;
  while (cur !== undefined) {
    const info = map.get(cur);
    if (!info || !info.isElement) break;
    const id = info.attributes.id;
    const cls = (info.attributes.class ?? '')
      .trim()
      .split(/\s+/)
      .filter(c => c && c !== HIDE_CLASS)
      .map(c => `.${cssEscapeIdent(c)}`)
      .join('');
    segs.unshift(`${info.nodeName}${id ? `#${cssEscapeIdent(id)}` : ''}${cls}`);
    if (id) break;
    let p = info.parentId;
    while (p !== undefined && !map.get(p)?.isElement) p = map.get(p)?.parentId;
    cur = p;
  }
  return segs.join(' > ');
}
