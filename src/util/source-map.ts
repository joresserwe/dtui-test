export interface SourceMapData {
  sources: string[];
  sourcesContent?: (string | null)[];
  sourceRoot?: string;
  mappings: number[][][];
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHAR_VALUES = new Map([...BASE64].map((c, i) => [c, i]));

export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = CHAR_VALUES.get(ch);
    if (digit === undefined) throw new Error(`invalid VLQ character: ${ch}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

export function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  for (const line of mappings.split(';')) {
    const segs: number[][] = [];
    let genCol = 0;
    for (const raw of line.split(',')) {
      if (!raw) continue;
      const fields = decodeVlq(raw);
      genCol += fields[0];
      if (fields.length >= 4) {
        srcIdx += fields[1];
        srcLine += fields[2];
        srcCol += fields[3];
        segs.push([genCol, srcIdx, srcLine, srcCol]);
      } else {
        segs.push([genCol]);
      }
    }
    lines.push(segs);
  }
  return lines;
}

export function parseSourceMap(json: string): SourceMapData {
  const raw = JSON.parse(json) as {
    sources?: string[];
    sourcesContent?: (string | null)[];
    sourceRoot?: string;
    mappings?: string;
  };
  return {
    sources: raw.sources ?? [],
    ...(raw.sourcesContent ? { sourcesContent: raw.sourcesContent } : {}),
    ...(raw.sourceRoot ? { sourceRoot: raw.sourceRoot } : {}),
    mappings: decodeMappings(raw.mappings ?? ''),
  };
}

export function resolveSourceMapUrl(scriptUrl: string, sourceMapURL: string): string {
  if (sourceMapURL.startsWith('data:')) return sourceMapURL;
  try {
    return new URL(sourceMapURL, scriptUrl).href;
  } catch {
    return sourceMapURL;
  }
}

export function originalPositionFor(
  map: SourceMapData,
  line: number,
  column: number,
): { source: string; line: number; column: number } | null {
  const segs = map.mappings[line];
  if (!segs?.length) return null;
  let best: number[] | null = null;
  for (const seg of segs) {
    if (seg[0] > column) break;
    if (seg.length >= 4) best = seg;
  }
  if (!best) best = segs.find(s => s.length >= 4) ?? null;
  if (!best) return null;
  const source = map.sources[best[1]];
  if (source === undefined) return null;
  return { source, line: best[2], column: best[3] };
}

export type FetchText = (url: string) => Promise<string>;

export const fetchText: FetchText = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

function dataUrlText(url: string): string {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('malformed data: URL');
  const meta = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (/;base64$/i.test(meta) || /;base64;/i.test(meta + ';')) return Buffer.from(body, 'base64').toString('utf8');
  return decodeURIComponent(body);
}

export async function loadSourceMap(scriptUrl: string, sourceMapURL: string, fetchFn: FetchText = fetchText): Promise<SourceMapData> {
  if (sourceMapURL.startsWith('data:')) return parseSourceMap(dataUrlText(sourceMapURL));
  return parseSourceMap(await fetchFn(resolveSourceMapUrl(scriptUrl, sourceMapURL)));
}

export function resolveSourceUrl(mapUrl: string, source: string, sourceRoot?: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
  const joined = sourceRoot ? sourceRoot.replace(/\/?$/, '/') + source : source;
  try {
    return new URL(joined, mapUrl).href;
  } catch {
    return joined;
  }
}
