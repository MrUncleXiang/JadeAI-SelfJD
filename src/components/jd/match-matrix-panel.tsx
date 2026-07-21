'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitCompareArrows,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface JdMatchReportView {
  jdSourceId: string;
  generatedAt: string;
  summary: {
    total: number;
    strong: number;
    partial: number;
    gap: number;
    conflict: number;
    requiredGaps: number;
  };
  rows: Array<{
    requirementId: string;
    requirementType: string;
    priority: string;
    text: string;
    normalizedTerm: string;
    level: 'strong' | 'partial' | 'gap' | 'conflict';
    score: number;
    supportingFacts: Array<{
      factId: string;
      title: string;
      factType: string;
      score: number;
      reasons: string[];
    }>;
    conflictClaims: string[];
    rationale: string;
  }>;
  gaps: Array<{
    requirementId: string;
    text: string;
    priority: string;
    requirementType: string;
  }>;
  conflicts: Array<{
    requirementId: string;
    text: string;
    forbiddenClaim: string;
  }>;
  recommendedFactIds: string[];
}

interface MatchMatrixPanelProps {
  sourceId: string | null;
  sourceTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function safeT(t: (key: string) => string, key: string): string {
  try {
    return t(key);
  } catch {
    return key;
  }
}

function levelVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (level === 'strong') return 'default';
  if (level === 'partial') return 'secondary';
  if (level === 'conflict') return 'destructive';
  return 'outline';
}

export function MatchMatrixPanel({
  sourceId,
  sourceTitle,
  open,
  onOpenChange,
}: MatchMatrixPanelProps) {
  const t = useTranslations('jd.match');
  const tTypes = useTranslations('jd.types');
  const tPriorities = useTranslations('jd.priorities');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<JdMatchReportView | null>(null);
  const [error, setError] = useState('');

  async function runMatch() {
    if (!sourceId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/jd-sources/${sourceId}/match`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = typeof body.code === 'string' ? body.code : 'REQUEST_FAILED';
        const message = code === 'NO_APPROVED_FACTS'
          ? t('errors.NO_APPROVED_FACTS')
          : code === 'JD_SOURCE_NOT_CONFIRMED'
            ? t('errors.JD_SOURCE_NOT_CONFIRMED')
            : t('errors.default');
        setError(message);
        toast.error(message);
        return;
      }
      setReport(body as JdMatchReportView);
      toast.success(t('success'));
    } catch {
      setError(t('errors.default'));
      toast.error(t('errors.default'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReport(null);
          setError('');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <div className="border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5" />
              {t('title')}
            </DialogTitle>
            <DialogDescription>
              {sourceTitle ? t('descriptionWithTitle', { title: sourceTitle }) : t('description')}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4" style={{ maxHeight: 'calc(90vh - 8rem)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t('hint')}</p>
            <Button onClick={() => void runMatch()} disabled={!sourceId || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitCompareArrows className="mr-2 h-4 w-4" />}
              {report ? t('rerun') : t('run')}
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {report && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label={t('summary.strong')} value={report.summary.strong} icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} />
                <SummaryCard label={t('summary.partial')} value={report.summary.partial} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
                <SummaryCard label={t('summary.gap')} value={report.summary.gap} icon={<XCircle className="h-4 w-4 text-zinc-500" />} />
                <SummaryCard label={t('summary.conflict')} value={report.summary.conflict} icon={<ShieldAlert className="h-4 w-4 text-red-600" />} />
                <SummaryCard label={t('summary.requiredGaps')} value={report.summary.requiredGaps} icon={<XCircle className="h-4 w-4 text-red-500" />} />
              </div>

              <div className="space-y-3">
                {report.rows.map((row) => (
                  <div key={row.requirementId} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={levelVariant(row.level)}>{t(`levels.${row.level}`)}</Badge>
                          <Badge variant="outline">
                            {safeT(tPriorities, row.priority)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {safeT(tTypes, row.requirementType)}
                            {row.normalizedTerm ? ` · ${row.normalizedTerm}` : ''}
                          </span>
                        </div>
                        <p className="text-sm font-medium leading-snug">{row.text}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{row.rationale}</p>
                        {row.conflictClaims[0] ? (
                          <p className="text-xs text-destructive">
                            {t('forbidden', { claim: row.conflictClaims[0] })}
                          </p>
                        ) : null}
                      </div>
                      <div className="w-full max-w-xs rounded-md bg-muted/40 px-3 py-2 sm:w-56">
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t('columns.facts')}
                        </p>
                        {row.supportingFacts.length === 0 ? (
                          <p className="text-xs text-muted-foreground">—</p>
                        ) : (
                          <ul className="space-y-1">
                            {row.supportingFacts.slice(0, 3).map((fact) => (
                              <li key={fact.factId} className="text-xs leading-snug">
                                <span className="font-medium">{fact.title}</span>
                                <span className="text-muted-foreground"> · {fact.score}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {report.gaps.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="font-medium">{t('gapTitle', { count: report.gaps.length })}</p>
                  <p className="mt-1 text-muted-foreground">{t('gapHint')}</p>
                </div>
              )}
            </>
          )}

          {!report && !loading && !error && (
            <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {t('empty')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
