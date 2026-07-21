const NON_AUTHORITY_SCHEMES = ['about:', 'data:', 'chrome:', 'file:', 'view-source:'];

export function normalizeUrl(raw: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return raw;
  if (NON_AUTHORITY_SCHEMES.some(s => raw.toLowerCase().startsWith(s))) return raw;
  return `https://${raw}`;
}
