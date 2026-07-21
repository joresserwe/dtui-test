export type AuditPreset = 'mobile' | 'desktop';

export const AUDIT_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type AuditCategoryId = (typeof AUDIT_CATEGORIES)[number];

export const CATEGORY_SHORT: Record<AuditCategoryId, string> = {
  performance: 'Perf',
  accessibility: 'A11y',
  'best-practices': 'BP',
  seo: 'SEO',
};

export interface LhrAuditDetails {
  type?: string;
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
  headings?: Array<{ key?: string | null; label?: string | { formattedDefault?: string }; valueType?: string }>;
  items?: Array<Record<string, unknown>>;
}

export interface LhrAudit {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue?: string;
  numericValue?: number;
  numericUnit?: string;
  details?: LhrAuditDetails;
}

export interface LhrCategory {
  id: string;
  title: string;
  score: number | null;
  auditRefs: Array<{ id: string; weight: number; group?: string }>;
}

export interface Lhr {
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  mainDocumentUrl?: string;
  fetchTime: string;
  lighthouseVersion: string;
  configSettings?: { formFactor?: string; onlyCategories?: string[] | null };
  categories: Record<string, LhrCategory>;
  audits: Record<string, LhrAudit>;
  runWarnings?: string[];
}

export interface CategoryScore {
  id: string;
  title: string;
  score: number | null;
}

export interface LabMetrics {
  lcpMs?: number;
  cls?: number;
  tbtMs?: number;
  fcpMs?: number;
  siMs?: number;
}

export interface Scoreboard {
  url: string;
  fetchTime: string;
  preset: string;
  lighthouseVersion: string;
  categories: CategoryScore[];
  metrics: LabMetrics;
  runWarnings: string[];
}

export interface FailingAudit {
  id: string;
  title: string;
  score: number | null;
  scoreDisplayMode: string;
  categories: string[];
  weight: number;
  displayValue?: string;
  description?: string;
  savingsMs?: number;
  savingsBytes?: number;
}
