import { useCallback, useEffect, useRef, useState } from 'react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DebugSession } from '../../engine.js';
import type { Endpoint } from '../../cdp/discovery.js';
import { withOverridesCleared } from '../../audit/overrides.js';
import { AuditCanceledError, runAudit as spawnAudit, type AuditRunHandle, type AuditRunOpts, type AuditRunRequest } from '../../audit/runner.js';
import { formatScore, lhrFailing, lhrScoreboard, stripScreenshotAudits } from '../../audit/transform.js';
import { auditFileName, listAudits, loadAudit, loadLatestAudit, loadSessionAudit } from '../../audit/store.js';
import { AUDIT_CATEGORIES, CATEGORY_SHORT, type AuditCategoryId, type AuditPreset, type FailingAudit, type Lhr, type Scoreboard } from '../../audit/types.js';
import type { ToastLevel } from '../lib/toast-manager.js';
import { t } from '../lib/i18n.js';
import type { Attached } from './use-session-manager.js';
import type { Tool } from '../panels/ToolTabs.js';

export type AuditRunnerFn = (req: AuditRunRequest, opts: AuditRunOpts) => AuditRunHandle;

export interface AuditResult {
  lhr: Lhr;
  board: Scoreboard;
  failing: FailingAudit[];
  file?: string;
}

export interface AuditRunning {
  session: DebugSession;
  status: string;
  startedAt: number;
}

export interface AuditToolOpts {
  attached: Attached | null;
  activeTool: Tool;
  notify: (msg: string, level?: ToastLevel) => void;
  whenNotEditing?: (fn: () => void) => void;
  runFn?: AuditRunnerFn;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function buildResult(lhr: Lhr, file?: string): AuditResult {
  return { lhr: stripScreenshotAudits(lhr), board: lhrScoreboard(lhr), failing: lhrFailing(lhr), file };
}

function normalizeCategories(cats: string[] | undefined): AuditCategoryId[] {
  const known = (cats ?? []).filter((c): c is AuditCategoryId => (AUDIT_CATEGORIES as readonly string[]).includes(c));
  return known.length ? known : [...AUDIT_CATEGORIES];
}

export function useAuditTool({ attached, activeTool, notify, whenNotEditing = fn => fn(), runFn }: AuditToolOpts) {
  const [auditPreset, setAuditPreset] = useState<AuditPreset>('mobile');
  const [auditCats, setAuditCats] = useState<AuditCategoryId[]>([...AUDIT_CATEGORIES]);
  const [auditRunning, setAuditRunning] = useState<AuditRunning | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditErr, setAuditErr] = useState<string | undefined>();
  const [auditRuns, setAuditRuns] = useState<string[]>([]);
  const [auditSel, setAuditSel] = useState(0);
  const [auditDetail, setAuditDetail] = useState<FailingAudit | null>(null);
  const [auditDetailScroll, setAuditDetailScroll] = useState(0);

  const guard = useRef(whenNotEditing);
  guard.current = whenNotEditing;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const handleRef = useRef<AuditRunHandle | null>(null);
  const runningRef = useRef<DebugSession | null>(null);
  const memRef = useRef(new WeakMap<DebugSession, AuditResult>());
  const attachedRef = useRef(attached);
  attachedRef.current = attached;
  const presetRef = useRef(auditPreset);
  presetRef.current = auditPreset;
  const catsRef = useRef(auditCats);
  catsRef.current = auditCats;

  useEffect(() => {
    if (activeTool !== 'audit' || !attached) return;
    const session = attached.session;
    setAuditDetail(null);
    setAuditDetailScroll(0);
    setAuditSel(0);
    setAuditErr(undefined);
    try {
      const runs = session.sessionDir ? listAudits(session.sessionDir) : [];
      setAuditRuns(runs);
      const mem = memRef.current.get(session);
      if (mem) {
        setAuditResult(mem);
      } else if (session.sessionDir && runs.length) {
        const latest = loadLatestAudit(session.sessionDir);
        if (latest) {
          const res = buildResult(latest.lhr, join(session.sessionDir, latest.name));
          memRef.current.set(session, res);
          setAuditResult(res);
        } else {
          setAuditResult(null);
          setAuditErr(t('audit.err.loadFailed', { name: runs[0] }));
        }
      } else {
        setAuditResult(null);
      }
    } catch (e) {
      setAuditResult(null);
      setAuditErr(errText(e));
    }
  }, [activeTool, attached?.session]);

  useEffect(() => () => handleRef.current?.cancel(), []);

  const start = useCallback(
    async (target: { session: DebugSession; ep: Endpoint }, opts: { preset?: AuditPreset; categories?: string[] } = {}): Promise<AuditResult> => {
      const session = target.session;
      if (runningRef.current) throw new Error('audit already running');
      const preset = opts.preset ?? presetRef.current;
      const categories = normalizeCategories(opts.categories ?? catsRef.current);
      const outFile = session.sessionDir
        ? join(session.sessionDir, auditFileName())
        : join(tmpdir(), `dtui-${process.pid}-${auditFileName()}`);
      const req: AuditRunRequest = {
        url: session.url,
        port: target.ep.port,
        hostname: target.ep.host,
        preset,
        categories,
        outFile,
      };
      runningRef.current = session;
      guard.current(() => {
        setAuditErr(undefined);
        setAuditRunning({ session, status: t('audit.status.starting'), startedAt: Date.now() });
      });
      try {
        let result: AuditResult | undefined;
        try {
          await withOverridesCleared(session, async () => {
            const handle = (runFn ?? spawnAudit)(req, {
              onStatus: msg => guard.current(() => setAuditRunning(r => (r && r.session === session ? { ...r, status: msg } : r))),
            });
            handleRef.current = handle;
            const lhr = await handle.done;
            result = buildResult(lhr, session.sessionDir ? outFile : undefined);
            memRef.current.set(session, result);
            guard.current(() => {
              if (attachedRef.current?.session === session) {
                setAuditResult(result!);
                setAuditSel(0);
                setAuditRuns(session.sessionDir ? listAudits(session.sessionDir) : []);
              }
            });
          });
        } catch (e) {
          if (result === undefined) throw e;
          notifyRef.current(t('audit.toast.restoreFailed'), 'error');
        }
        return result!;
      } finally {
        handleRef.current = null;
        runningRef.current = null;
        guard.current(() => setAuditRunning(r => (r?.session === session ? null : r)));
      }
    },
    [runFn],
  );

  const startAudit = useCallback(
    (target: Attached) => {
      if (runningRef.current) {
        notifyRef.current(t('audit.toast.alreadyRunning'));
        return;
      }
      void start(target).then(
        res => {
          const lead = res.board.categories.find(c => c.id === 'performance') ?? res.board.categories[0];
          const label = lead ? `${(CATEGORY_SHORT as Record<string, string>)[lead.id] ?? lead.title} ${formatScore(lead.score)}` : '';
          notifyRef.current(t('audit.toast.done', { score: label }), 'success');
        },
        e => {
          if (e instanceof AuditCanceledError) {
            notifyRef.current(t('audit.toast.canceled'));
            return;
          }
          guard.current(() => setAuditErr(errText(e)));
          notifyRef.current(t('audit.toast.failed'), 'error');
        },
      );
    },
    [start],
  );

  const runForMcp = useCallback(
    (session: DebugSession, ep: Endpoint, opts: { preset?: string; categories?: string[] }): Promise<Lhr> => {
      const preset: AuditPreset | undefined = opts.preset === 'desktop' ? 'desktop' : opts.preset === 'mobile' ? 'mobile' : undefined;
      return start({ session, ep }, { preset, categories: opts.categories }).then(res => res.lhr);
    },
    [start],
  );

  const cancelAudit = useCallback(() => {
    handleRef.current?.cancel();
  }, []);

  const latestLhrFor = useCallback((session: DebugSession): Lhr | null => memRef.current.get(session)?.lhr ?? null, []);

  const openStoredRun = useCallback((session: DebugSession, name: string) => {
    if (!session.sessionDir) return;
    try {
      const lhr = loadSessionAudit(session.sessionDir, name);
      if (!lhr) {
        setAuditErr(t('audit.err.loadFailed', { name }));
        return;
      }
      setAuditResult(buildResult(lhr, join(session.sessionDir, name)));
      setAuditSel(0);
      setAuditDetail(null);
      setAuditDetailScroll(0);
      setAuditErr(undefined);
    } catch (e) {
      setAuditErr(errText(e));
    }
  }, []);

  const toggleCategory = useCallback((cat: AuditCategoryId) => {
    setAuditCats(prev => {
      if (prev.includes(cat)) {
        const next = prev.filter(c => c !== cat);
        return next.length ? next : prev;
      }
      return AUDIT_CATEGORIES.filter(c => prev.includes(c) || c === cat);
    });
  }, []);

  const exportHtml = useCallback(
    async (copyFn: (text: string) => Promise<void>): Promise<void> => {
      const res = auditResult;
      if (!res) {
        notifyRef.current(t('audit.toast.noResult'));
        return;
      }
      try {
        const { ReportGenerator } = await import('lighthouse/report/generator/report-generator.js');
        const fullLhr = res.file ? loadAudit(res.file) : res.lhr;
        const html = ReportGenerator.generateReport(fullLhr, 'html') as string;
        const file = res.file
          ? res.file.replace(/\.json$/, '.html')
          : join(tmpdir(), `dtui-${process.pid}-audit-report.html`);
        const { writeFile } = await import('node:fs/promises');
        await writeFile(file, html);
        await copyFn(file).then(
          () => notifyRef.current(t('audit.toast.htmlSavedCopied', { file }), 'success'),
          () => notifyRef.current(t('audit.toast.htmlSaved', { file }), 'success'),
        );
      } catch (e) {
        notifyRef.current(t('audit.toast.exportFailed', { error: errText(e) }), 'error');
      }
    },
    [auditResult],
  );

  return {
    auditPreset,
    setAuditPreset,
    auditCats,
    toggleCategory,
    auditRunning,
    auditResult,
    auditErr,
    setAuditErr,
    auditRuns,
    auditSel,
    setAuditSel,
    auditDetail,
    setAuditDetail,
    auditDetailScroll,
    setAuditDetailScroll,
    startAudit,
    cancelAudit,
    openStoredRun,
    runForMcp,
    latestLhrFor,
    exportHtml,
  };
}

export type AuditTool = ReturnType<typeof useAuditTool>;
