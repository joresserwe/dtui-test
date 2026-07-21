import { test, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuditCanceledError, lighthouseModuleUrls, runAudit, type AuditRunRequest } from '../src/audit/runner.js';
import { AUDIT_CHILD_SCRIPT } from '../src/audit/child-script.js';
import { makeLhr } from './helpers/lhr-fixture.js';

async function req(): Promise<AuditRunRequest> {
  const dir = await mkdtemp(join(tmpdir(), 'dtui-runner-'));
  return {
    url: 'http://localhost:1/x',
    port: 1,
    preset: 'mobile',
    categories: ['performance'],
    outFile: join(dir, 'audit-2026-07-19T10-00-00.json'),
  };
}

const OK_SCRIPT = `
const req = JSON.parse(process.env.DTUI_AUDIT_REQ ?? '{}');
const send = (obj, then) => process.stdout.write(JSON.stringify(obj) + '\\n', then);
send({ type: 'status', message: 'Connecting to browser' });
send({ type: 'status', message: 'Auditing' });
const { writeFileSync, mkdirSync } = await import('node:fs');
const { dirname } = await import('node:path');
mkdirSync(dirname(req.outFile), { recursive: true });
writeFileSync(req.outFile, process.env.DTUI_TEST_LHR);
send({ type: 'done', outFile: req.outFile }, () => process.exit(0));
`;

test('runAudit streams statuses and resolves the lhr written by the child', async () => {
  const statuses: string[] = [];
  const handle = runAudit(await req(), {
    scriptSource: OK_SCRIPT,
    onStatus: m => statuses.push(m),
    env: { ...process.env, DTUI_TEST_LHR: JSON.stringify(makeLhr()) },
  });
  const lhr = await handle.done;
  expect(lhr.lighthouseVersion).toBe('13.4.0');
  expect(statuses).toEqual(['Connecting to browser', 'Auditing']);
});

test('runAudit rejects with the child-reported error message', async () => {
  const handle = runAudit(await req(), {
    scriptSource: `process.stdout.write(JSON.stringify({ type: 'error', message: 'no browser on port 1' }) + '\\n', () => process.exit(1));`,
  });
  await expect(handle.done).rejects.toThrow('no browser on port 1');
});

test('runAudit rejects with the stderr tail when the child dies silently', async () => {
  const handle = runAudit(await req(), {
    scriptSource: `process.stderr.write('boom from stderr', () => process.exit(3));`,
  });
  await expect(handle.done).rejects.toThrow(/audit child exited \(3\): .*boom from stderr/);
});

test('cancel kills the child and rejects with AuditCanceledError', async () => {
  const handle = runAudit(await req(), {
    scriptSource: `setInterval(() => {}, 1000);`,
  });
  setTimeout(() => handle.cancel(), 100);
  await expect(handle.done).rejects.toBeInstanceOf(AuditCanceledError);
});

test('runAudit times out and kills a hung child', async () => {
  const handle = runAudit(await req(), {
    scriptSource: `setInterval(() => {}, 1000);`,
    timeoutMs: 200,
  });
  await expect(handle.done).rejects.toThrow('audit timed out after 200ms');
});

test('cancel escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const handle = runAudit(await req(), {
    scriptSource: `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
    killGraceMs: 150,
  });
  setTimeout(() => handle.cancel(), 100);
  await expect(handle.done).rejects.toBeInstanceOf(AuditCanceledError);
});

test('the real child script writes the lhr atomically via temp-then-rename', async () => {
  const stubDir = await mkdtemp(join(tmpdir(), 'dtui-lh-stub-'));
  const lhr = makeLhr();
  await writeFile(
    join(stubDir, 'lighthouse.mjs'),
    `export default async function lighthouse(url, flags, config) {
       if (flags.disableStorageReset !== true) throw new Error('storage reset not disabled');
       return { lhr: { ...${JSON.stringify(lhr)}, requestedUrl: url, usedDesktopConfig: config !== undefined } };
     }`,
  );
  await writeFile(
    join(stubDir, 'logger.mjs'),
    `import { EventEmitter } from 'node:events';
     const log = { events: new EventEmitter() };
     export default log;`,
  );
  await writeFile(join(stubDir, 'desktop-config.mjs'), `export default { settings: { formFactor: 'desktop' } };`);
  const request = await req();
  const handle = runAudit(request, {
    scriptSource: AUDIT_CHILD_SCRIPT,
    moduleUrls: {
      lighthouseUrl: pathToFileURL(join(stubDir, 'lighthouse.mjs')).href,
      loggerUrl: pathToFileURL(join(stubDir, 'logger.mjs')).href,
      desktopConfigUrl: pathToFileURL(join(stubDir, 'desktop-config.mjs')).href,
    },
  });
  const result = await handle.done;
  expect(result.requestedUrl).toBe(request.url);
  expect((result as { usedDesktopConfig?: boolean }).usedDesktopConfig).toBe(false);
  expect(existsSync(request.outFile)).toBe(true);
  expect(existsSync(`${request.outFile}.tmp`)).toBe(false);
});

test('lighthouseModuleUrls resolves importable file URLs', async () => {
  const urls = lighthouseModuleUrls();
  expect(urls.lighthouseUrl).toMatch(/^file:.*lighthouse/);
  expect(urls.loggerUrl).toMatch(/^file:.*lighthouse-logger/);
  expect(urls.desktopConfigUrl).toMatch(/desktop-config\.js$/);
  const desktop = (await import(urls.desktopConfigUrl)) as { default: { settings?: { formFactor?: string } } };
  expect(desktop.default.settings?.formFactor).toBe('desktop');
});
