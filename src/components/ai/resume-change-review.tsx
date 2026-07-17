'use client';

import {
  AlertTriangle,
  Check,
  FileClock,
  FileDiff,
  History,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResumeStore } from '@/stores/resume-store';

type ChangeSetStatus =
  | 'proposed'
  | 'validated'
  | 'stale'
  | 'partially_applied'
  | 'applied'
  | 'rejected'
  | 'failed';

interface ResumeChangeOperation {
  id: string;
  operationId: string;
  type: string;
  sectionId: string | null;
  itemId: string | null;
  reason: string;
  evidenceIds: string[];
  jdRequirementIds: string[];
  confidence: number;
  diff: {
    path?: string;
    before?: unknown;
    after?: unknown;
    risk?: 'normal' | 'high';
    warnings?: string[];
  };
  selected: boolean;
  result: 'pending' | 'applied' | 'not_selected' | 'failed';
  errorCode: string | null;
}

interface ResumeChangeSet {
  id: string;
  baseVersionId: string;
  appliedVersionId: string | null;
  status: ChangeSetStatus;
  summary: string;
  warnings: string[];
  provider: string | null;
  modelName: string | null;
  createdAt: string | number | Date;
  operations: ResumeChangeOperation[];
}

interface ResumeVersionSummary {
  id: string;
  versionNumber: number;
  source: 'manual' | 'ai-change-set' | 'restore' | 'import';
  createdAt: string | number | Date;
}

interface ResumeChangeReviewProps {
  resumeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshKey: number;
}

function headers(): Record<string, string> {
  const fingerprint = typeof window !== 'undefined'
    ? localStorage.getItem('jade_fingerprint')
    : null;
  return {
    'Content-Type': 'application/json',
    ...(fingerprint ? { 'x-fingerprint': fingerprint } : {}),
  };
}

function formatDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function displayValue(value: unknown) {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  return JSON.stringify(value, null, 2);
}

function isApplicable(status: ChangeSetStatus) {
  return status === 'validated' || status === 'proposed';
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json() as { error?: string; code?: string };
    return body.error || body.code || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export function ResumeChangeReview({
  resumeId,
  open,
  onOpenChange,
  refreshKey,
}: ResumeChangeReviewProps) {
  const t = useTranslations('ai.resumeChanges');
  const [changeSets, setChangeSets] = useState<ResumeChangeSet[]>([]);
  const [versions, setVersions] = useState<ResumeVersionSummary[]>([]);
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<string>();
  const [selectedOperationIds, setSelectedOperationIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string>();

  const load = useCallback(async () => {
    if (!resumeId) return;
    setIsLoading(true);
    try {
      const requestHeaders = headers();
      const [changeSetResponse, versionResponse] = await Promise.all([
        fetch(`/api/resumes/${resumeId}/change-sets`, { headers: requestHeaders }),
        fetch(`/api/resumes/${resumeId}/versions`, { headers: requestHeaders }),
      ]);
      if (!changeSetResponse.ok) throw new Error(await errorMessage(changeSetResponse));
      if (!versionResponse.ok) throw new Error(await errorMessage(versionResponse));
      const [nextChangeSets, nextVersions] = await Promise.all([
        changeSetResponse.json() as Promise<ResumeChangeSet[]>,
        versionResponse.json() as Promise<ResumeVersionSummary[]>,
      ]);
      setChangeSets(nextChangeSets);
      setVersions(nextVersions);
    } catch (error) {
      toast.error(t('loadFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }, [resumeId, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (selectedChangeSetId && changeSets.some((changeSet) => changeSet.id === selectedChangeSetId)) {
      return;
    }
    const next = changeSets.find((changeSet) => isApplicable(changeSet.status)) || changeSets[0];
    setSelectedChangeSetId(next?.id);
  }, [changeSets, selectedChangeSetId]);

  const activeChangeSet = useMemo(
    () => changeSets.find((changeSet) => changeSet.id === selectedChangeSetId),
    [changeSets, selectedChangeSetId],
  );

  // Concurrent refreshes can replace the change-set object with equivalent data. Key the
  // default selection by semantic operation state so those responses do not undo user choices.
  const operationSelectionSeed = JSON.stringify(activeChangeSet ? {
    id: activeChangeSet.id,
    applicable: isApplicable(activeChangeSet.status),
    operationIds: activeChangeSet.operations
      .filter((operation) => operation.result === 'pending')
      .map((operation) => operation.operationId),
  } : null);

  useEffect(() => {
    const seed = JSON.parse(operationSelectionSeed) as {
      applicable: boolean;
      operationIds: string[];
    } | null;
    if (!seed?.applicable) {
      setSelectedOperationIds(new Set());
      return;
    }
    setSelectedOperationIds(new Set(seed.operationIds));
  }, [operationSelectionSeed]);

  const pendingCount = changeSets.filter((changeSet) => isApplicable(changeSet.status)).length;

  const reloadResume = useCallback(async () => {
    const store = useResumeStore.getState();
    if (store._saveTimeout) clearTimeout(store._saveTimeout);
    const response = await fetch(`/api/resume/${resumeId}`, { headers: headers() });
    if (!response.ok) throw new Error(await errorMessage(response));
    store.setResume(await response.json());
  }, [resumeId]);

  const applySelected = useCallback(async () => {
    if (!activeChangeSet || selectedOperationIds.size === 0) return;
    setIsApplying(true);
    try {
      const response = await fetch(
        `/api/resumes/${resumeId}/change-sets/${activeChangeSet.id}/apply`,
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ operationIds: [...selectedOperationIds] }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      await reloadResume();
      await load();
      toast.success(t('applySuccess'));
    } catch (error) {
      toast.error(t('applyFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsApplying(false);
    }
  }, [activeChangeSet, load, reloadResume, resumeId, selectedOperationIds, t]);

  const restoreVersion = useCallback(async (version: ResumeVersionSummary) => {
    if (!window.confirm(t('restoreConfirm', { version: version.versionNumber }))) return;
    setRestoringVersionId(version.id);
    try {
      const response = await fetch(
        `/api/resumes/${resumeId}/versions/${version.id}/restore`,
        { method: 'POST', headers: headers() },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      await reloadResume();
      await load();
      toast.success(t('restoreSuccess', { version: version.versionNumber }));
    } catch (error) {
      toast.error(t('restoreFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRestoringVersionId(undefined);
    }
  }, [load, reloadResume, resumeId, t]);

  const toggleOperation = (operationId: string) => {
    setSelectedOperationIds((current) => {
      const next = new Set(current);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-7 cursor-pointer gap-1 px-2"
          title={t('trigger')}
          aria-label={t('trigger')}
        >
          <FileDiff className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold leading-4 text-white">
              {pendingCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-center justify-between gap-3">
            <div>
              <SheetTitle>{t('title')}</SheetTitle>
              <SheetDescription>{t('description')}</SheetDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={isLoading}>
              <RefreshCw className={isLoading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </SheetHeader>

        <Tabs defaultValue="changes" className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="mx-4 mt-2">
            <TabsTrigger value="changes">
              <FileDiff />
              {t('changesTab')}
            </TabsTrigger>
            <TabsTrigger value="history">
              <History />
              {t('historyTab')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="changes" className="min-h-0 overflow-y-auto px-4 pb-4">
            {changeSets.length === 0 && !isLoading ? (
              <div className="py-16 text-center text-sm text-zinc-500">{t('empty')}</div>
            ) : (
              <div className="space-y-4 py-3">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {changeSets.map((changeSet) => (
                    <button
                      key={changeSet.id}
                      type="button"
                      className={`min-w-44 rounded-lg border px-3 py-2 text-left transition-colors ${
                        changeSet.id === activeChangeSet?.id
                          ? 'border-brand bg-brand-muted'
                          : 'border-zinc-200 hover:bg-zinc-50'
                      }`}
                      onClick={() => setSelectedChangeSetId(changeSet.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-zinc-800">
                          {changeSet.summary}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {t(`status.${changeSet.status}`)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-400">{formatDate(changeSet.createdAt)}</p>
                    </button>
                  ))}
                </div>

                {activeChangeSet && (
                  <>
                    <div className="rounded-lg border bg-zinc-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-900">{activeChangeSet.summary}</p>
                        <Badge variant="outline">{t(`status.${activeChangeSet.status}`)}</Badge>
                      </div>
                      {(activeChangeSet.provider || activeChangeSet.modelName) && (
                        <p className="mt-1 text-[11px] text-zinc-500">
                          {[activeChangeSet.provider, activeChangeSet.modelName].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {activeChangeSet.warnings.length > 0 && (
                        <div className="mt-2 space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-700">
                          {activeChangeSet.warnings.map((warning) => (
                            <p key={warning} className="flex gap-1.5">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {warning}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {activeChangeSet.operations.map((operation) => {
                        const selectable = isApplicable(activeChangeSet.status) && operation.result === 'pending';
                        const selected = selectedOperationIds.has(operation.operationId);
                        return (
                          <div
                            key={operation.operationId}
                            className={`rounded-xl border p-3 ${
                              operation.diff.risk === 'high' ? 'border-amber-300' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={selected}
                                disabled={!selectable}
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                  selected ? 'border-brand bg-brand text-white' : 'border-zinc-300 bg-white'
                                } disabled:cursor-not-allowed disabled:opacity-40`}
                                onClick={() => toggleOperation(operation.operationId)}
                              >
                                {selected && <Check className="h-3.5 w-3.5" />}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="secondary">{operation.type}</Badge>
                                  <code className="break-all text-[11px] text-zinc-500">
                                    {operation.diff.path || operation.sectionId || operation.operationId}
                                  </code>
                                  {operation.diff.risk === 'high' && (
                                    <Badge variant="destructive">{t('highRisk')}</Badge>
                                  )}
                                </div>
                                <p className="mt-2 text-sm text-zinc-700">{operation.reason}</p>
                                <p className="mt-1 text-[11px] text-zinc-400">
                                  {t('confidence', { value: Math.round(operation.confidence * 100) })}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                              <div className="min-w-0 rounded-lg bg-red-50/70 p-2">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-500">
                                  {t('before')}
                                </p>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-700">
                                  {displayValue(operation.diff.before)}
                                </pre>
                              </div>
                              <div className="min-w-0 rounded-lg bg-emerald-50/70 p-2">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                  {t('after')}
                                </p>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-700">
                                  {displayValue(operation.diff.after)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isApplicable(activeChangeSet.status) ? (
                      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-white/95 py-3 backdrop-blur">
                        <span className="text-xs text-zinc-500">
                          {t('selectedCount', { selected: selectedOperationIds.size, total: activeChangeSet.operations.length })}
                        </span>
                        <Button
                          onClick={() => void applySelected()}
                          disabled={isApplying || selectedOperationIds.size === 0}
                        >
                          {isApplying && <RefreshCw className="animate-spin" />}
                          {t('applySelected')}
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
                        {t('notApplicable')}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="min-h-0 overflow-y-auto px-4 pb-4">
            <div className="space-y-2 py-3">
              {versions.map((version, index) => (
                <div key={version.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100">
                    <FileClock className="h-4 w-4 text-zinc-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t('version', { version: version.versionNumber })}</span>
                      <Badge variant="outline">{t(`source.${version.source}`)}</Badge>
                      {index === 0 && <Badge>{t('current')}</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">{formatDate(version.createdAt)}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === 0 || restoringVersionId !== undefined}
                    onClick={() => void restoreVersion(version)}
                  >
                    {restoringVersionId === version.id
                      ? <RefreshCw className="animate-spin" />
                      : <RotateCcw />}
                    {t('restore')}
                  </Button>
                </div>
              ))}
              {versions.length === 0 && !isLoading && (
                <div className="py-16 text-center text-sm text-zinc-500">{t('noVersions')}</div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
