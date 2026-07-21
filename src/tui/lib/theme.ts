export const theme = {
  accent: '#b48cff',
  key: '#56d1e0',
  ok: '#86e08f',
  warn: '#f0c26b',
  err: '#ff7a93',
  muted: '#8b93a7',
  faint: '#555e72',
  badgeFg: '#11141c',
  overlayBg: '#11141c',
} as const;

export const METHOD_COLORS: Record<string, string> = {
  GET: theme.key,
  POST: theme.ok,
  PUT: theme.warn,
  PATCH: theme.accent,
  DELETE: theme.err,
};

export const methodColor = (m: string): string => METHOD_COLORS[m.toUpperCase()] ?? theme.muted;
