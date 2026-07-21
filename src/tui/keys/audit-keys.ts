import type { Key } from 'ink';
import { basename } from 'node:path';
import type { ListNav } from '../lib/keys.js';
import type { Attached } from '../hooks/use-session-manager.js';
import type { AuditTool } from '../hooks/use-audit-tool.js';
import { auditDetailLines, AUDIT_CHROME, AUDIT_DETAIL_CHROME } from '../panels/AuditPanel.js';
import type { AuditCategoryId } from '../../audit/types.js';

const CATEGORY_KEYS: Record<string, AuditCategoryId> = {
  p: 'performance',
  a: 'accessibility',
  B: 'best-practices',
  s: 'seo',
};

export interface AuditKeyCtx {
  audit: AuditTool;
  attached: Attached | null;
  bodyH: number;
  columns: number;
  listNav: ListNav;
  copyFn: (text: string) => Promise<void>;
}

export function handleAuditDetailKey(ctx: AuditKeyCtx, input: string, key: Key): void {
  const { audit, bodyH, columns, listNav } = ctx;
  const detail = audit.auditDetail;
  if (!detail) return;
  if (key.escape || input === 'q') {
    audit.setAuditDetail(null);
    audit.setAuditDetailScroll(0);
    return;
  }
  const lines = auditDetailLines(detail, audit.auditResult?.lhr, columns);
  const budget = Math.max(1, bodyH - AUDIT_DETAIL_CHROME);
  const maxScroll = Math.max(0, lines.length - budget);
  const page = Math.max(1, Math.floor(budget / 2));
  listNav(input, key, maxScroll + 1, audit.setAuditDetailScroll, page);
}

export function handleAuditKey(ctx: AuditKeyCtx, input: string, key: Key): boolean {
  const { audit, attached, bodyH, listNav, copyFn } = ctx;
  const running = attached ? audit.auditRunning?.session === attached.session : false;

  if (running) {
    if (key.escape) {
      audit.cancelAudit();
      return true;
    }
    return false;
  }

  if (!attached) return false;

  if (input === 'r') {
    audit.startAudit(attached);
    return true;
  }
  if (input === 'm') {
    audit.setAuditPreset(p => (p === 'mobile' ? 'desktop' : 'mobile'));
    return true;
  }
  const cat = CATEGORY_KEYS[input];
  if (cat && !key.ctrl) {
    audit.toggleCategory(cat);
    return true;
  }
  if (input === 'E') {
    void audit.exportHtml(copyFn);
    return true;
  }

  const failing = audit.auditResult?.failing ?? [];
  if (key.return) {
    const sel = Math.min(audit.auditSel, Math.max(0, failing.length - 1));
    const item = failing[sel];
    if (item) {
      audit.setAuditDetail(item);
      audit.setAuditDetailScroll(0);
    }
    return true;
  }

  if ((input === 'h' || input === 'l' || key.leftArrow || key.rightArrow) && attached.session.sessionDir) {
    const runs = audit.auditRuns;
    if (runs.length < 2) return true;
    const file = audit.auditResult?.file;
    const cur = file ? runs.indexOf(basename(file)) : -1;
    const dir = input === 'h' || key.leftArrow ? 1 : -1;
    const next = cur === -1 ? (dir === 1 ? 0 : runs.length - 1) : (cur + dir + runs.length) % runs.length;
    audit.openStoredRun(attached.session, runs[next]);
    return true;
  }

  if (key.escape) {
    if (audit.auditErr) {
      audit.setAuditErr(undefined);
      return true;
    }
    return false;
  }

  const page = Math.max(1, Math.floor((bodyH - AUDIT_CHROME) / 2));
  if (listNav(input, key, failing.length, audit.setAuditSel, page)) return true;

  return false;
}
