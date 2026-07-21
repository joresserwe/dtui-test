import type { NetworkEntry } from '../../store/types.js';
import { redactHeaders } from '../../util/redact.js';

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export interface CopyOpts {
  redact?: boolean;
}

export function buildCurl(entry: NetworkEntry, opts: CopyOpts = {}): string {
  const headers = opts.redact ? redactHeaders(entry.requestHeaders) : entry.requestHeaders;
  const parts = [`curl ${shellQuote(entry.url)}`];
  if (entry.method && entry.method !== 'GET') parts.push(`-X ${entry.method}`);
  for (const [name, value] of Object.entries(headers)) {
    parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (entry.postData !== undefined) parts.push(`--data-raw ${shellQuote(entry.postData)}`);
  return parts.join(' \\\n  ');
}

function fetchOptions(entry: NetworkEntry, opts: CopyOpts): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (entry.method && entry.method !== 'GET') options.method = entry.method;
  options.headers = opts.redact ? redactHeaders(entry.requestHeaders) : { ...entry.requestHeaders };
  if (entry.postData !== undefined) options.body = entry.postData;
  return options;
}

export function buildFetch(entry: NetworkEntry, opts: CopyOpts = {}): string {
  return `fetch(${JSON.stringify(entry.url)}, ${JSON.stringify(fetchOptions(entry, opts), null, 2)})`;
}

export function buildNodeFetch(entry: NetworkEntry, opts: CopyOpts = {}): string {
  const options = JSON.stringify(fetchOptions(entry, opts), null, 2);
  return [
    `const res = await fetch(${JSON.stringify(entry.url)}, ${options});`,
    'const body = await res.text();',
    'console.log(res.status, body);',
  ].join('\n');
}
