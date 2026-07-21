export const REDACTED = '[redacted]';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

export const isSensitiveHeader = (name: string): boolean => SENSITIVE_HEADERS.has(name.toLowerCase());

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) out[name] = isSensitiveHeader(name) ? REDACTED : value;
  return out;
}
