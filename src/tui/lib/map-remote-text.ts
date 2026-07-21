export interface MapRemoteDraft {
  pattern: string;
  target: string;
}

const template = (pattern: string, target: string): string =>
  ['# map remote — MATCH is a url glob (* wildcards), TO is the replacement url (* reuses captures in order)', `MATCH ${pattern}`, `TO ${target}`, ''].join('\n');

export const formatMapRemoteText = (url: string): string => template(url, url);

export const formatMapRemoteRuleText = (rule: MapRemoteDraft): string => template(rule.pattern, rule.target);

export function parseMapRemoteText(text: string): MapRemoteDraft | null {
  let pattern: string | undefined;
  let target: string | undefined;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(MATCH|TO)\s+(\S+)$/i.exec(line);
    if (!m) return null;
    if (m[1].toUpperCase() === 'MATCH') pattern = m[2];
    else target = m[2];
  }
  return pattern && target ? { pattern, target } : null;
}
