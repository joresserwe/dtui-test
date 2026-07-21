export const AUDIT_CHILD_SCRIPT = String.raw`
const req = JSON.parse(process.env.DTUI_AUDIT_REQ ?? '{}');
const send = (obj, then) => process.stdout.write(JSON.stringify(obj) + '\n', then);
const fail = e => {
  const msg =
    e && typeof e === 'object' && 'friendlyMessage' in e && e.friendlyMessage
      ? String(e.friendlyMessage)
      : e instanceof Error
        ? e.message
        : String(e);
  send({ type: 'error', message: msg }, () => process.exit(1));
};
try {
  const { default: lighthouse } = await import(req.lighthouseUrl);
  const { default: log } = await import(req.loggerUrl);
  log.events.addListener('status', ([, msg]) => send({ type: 'status', message: String(msg) }));
  const flags = {
    port: req.port,
    hostname: req.hostname,
    output: 'json',
    logLevel: 'info',
    onlyCategories: req.categories,
    disableStorageReset: true,
  };
  const config = req.preset === 'desktop' ? (await import(req.desktopConfigUrl)).default : undefined;
  const result = await lighthouse(req.url, flags, config);
  if (!result) throw new Error('lighthouse returned no result');
  const { writeFileSync, mkdirSync, renameSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(req.outFile), { recursive: true });
  const tmpFile = req.outFile + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(result.lhr));
  renameSync(tmpFile, req.outFile);
  send({ type: 'done', outFile: req.outFile }, () => process.exit(0));
} catch (e) {
  fail(e);
}
`;
