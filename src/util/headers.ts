export const header = (headers: Record<string, string>, name: string): string =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1] ?? '';
