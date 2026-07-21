export interface RequestDraft {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function formatRequestText(entry: { method: string; url: string; requestHeaders?: Record<string, string>; postData?: string }): string {
  const lines = [`${entry.method} ${entry.url}`];
  for (const [name, value] of Object.entries(entry.requestHeaders ?? {})) lines.push(`${name}: ${value}`);
  if (entry.postData !== undefined) lines.push('', entry.postData);
  return `${lines.join('\n')}\n`;
}

export function parseRequestText(text: string): RequestDraft | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const first = lines[i]?.trim().match(/^(\S+)\s+(\S+)$/);
  if (!first) return null;
  i++;
  const headers: Record<string, string> = {};
  for (; i < lines.length && lines[i].trim() !== ''; i++) {
    const colon = lines[i].indexOf(':');
    if (colon <= 0) return null;
    headers[lines[i].slice(0, colon).trim()] = lines[i].slice(colon + 1).trim();
  }
  const body = lines.slice(i + 1).join('\n').replace(/\s+$/, '');
  return { method: first[1].toUpperCase(), url: first[2], headers, ...(body ? { body } : {}) };
}
