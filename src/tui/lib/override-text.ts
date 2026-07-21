export interface OverrideDraft {
  pattern: string;
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

const SKIP_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding']);

export function formatOverrideText(entry: { url: string; status?: number; responseHeaders?: Record<string, string>; body?: string; bodyBase64?: boolean }): string {
  const lines = ['# override', `PATTERN ${entry.url}`, `STATUS ${entry.status ?? 200}`];
  for (const [name, value] of Object.entries(entry.responseHeaders ?? {})) {
    if (SKIP_HEADERS.has(name.toLowerCase())) continue;
    for (const part of value.split('\n')) lines.push(`${name}: ${part}`);
  }
  lines.push('', entry.body !== undefined && !entry.bodyBase64 ? entry.body : '');
  return `${lines.join('\n')}\n`;
}

export function formatOverrideRuleText(rule: OverrideDraft): string {
  const lines = ['# override', `PATTERN ${rule.pattern}`, `STATUS ${rule.status}`];
  for (const [name, value] of rule.headers) lines.push(`${name}: ${value}`);
  lines.push('', rule.body);
  return `${lines.join('\n')}\n`;
}

export function parseOverrideText(text: string): OverrideDraft | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++;
  const pat = lines[i]?.trim().match(/^PATTERN\s+(\S+)$/);
  if (!pat) return null;
  i++;
  while (i < lines.length && lines[i].trim().startsWith('#')) i++;
  const st = lines[i]?.trim().match(/^STATUS\s+(\d{3})$/);
  if (!st) return null;
  i++;
  const headers: Array<[string, string]> = [];
  for (; i < lines.length && lines[i].trim() !== ''; i++) {
    if (lines[i].trim().startsWith('#')) continue;
    const colon = lines[i].indexOf(':');
    if (colon <= 0) return null;
    headers.push([lines[i].slice(0, colon).trim(), lines[i].slice(colon + 1).trim()]);
  }
  const body = lines.slice(i + 1).join('\n').replace(/\s+$/, '');
  return { pattern: pat[1], status: Number(st[1]), headers, body };
}
