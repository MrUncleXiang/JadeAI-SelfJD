'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Database,
  FileText,
  GitCommitHorizontal,
  ListChecks,
  Loader2,
  Merge,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { GitHubPatSourceCard } from '@/components/knowledge/github-pat-source-card';
import { GitHubSourceCard } from '@/components/knowledge/github-source-card';
import { PublicGitHubSourceCard } from '@/components/knowledge/public-github-source-card';
import { WorkResumeUploadCard } from '@/components/knowledge/workresume-upload-card';
import { GenerateResumeDialog } from '@/components/dashboard/generate-resume-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type FactStatus = 'draft' | 'approved' | 'rejected' | 'superseded';
type FactType = 'profile' | 'employment' | 'project' | 'skill' | 'education' | 'certificate' | 'achievement';

interface CareerEvidence {
  id: string;
  commitSha: string;
  path: string;
  locator: string;
  contentHash: string;
  summary: string;
  parserId: string;
  parserVersion: string;
  stale: boolean;
}

interface CareerClaim {
  id: string;
  type: 'allowed' | 'forbidden';
  claim: string;
}

interface CareerFact {
  id: string;
  factType: FactType;
  canonicalKey: string;
  title: string;
  summary: string;
  structuredData: Record<string, unknown>;
  status: FactStatus;
  confidence: number;
  contentHash: string;
  supersedesFactId: string | null;
  supersededByFactId: string | null;
  createdBy: 'import' | 'ai' | 'user';
  approvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  evidence: CareerEvidence[];
  claims: CareerClaim[];
}

const FACT_TYPES: FactType[] = [
  'profile',
  'employment',
  'project',
  'skill',
  'education',
  'certificate',
  'achievement',
];

const FACT_STATUSES: FactStatus[] = ['draft', 'approved', 'rejected', 'superseded'];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(body?.code || `HTTP_${response.status}`);
  }
  return response.json() as Promise<T>;
}

function shortHash(value: string) {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function statusVariant(status: FactStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'approved') return 'default';
  if (status === 'rejected') return 'destructive';
  if (status === 'superseded') return 'outline';
  return 'secondary';
}

function isMergeableFact(fact: Pick<CareerFact, 'status'>) {
  return fact.status === 'draft' || fact.status === 'approved';
}

export default function KnowledgePage() {
  const t = useTranslations('knowledge');
  const [facts, setFacts] = useState<CareerFact[]>([]);
  const [statusFilter, setStatusFilter] = useState<FactStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<FactType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeFactId, setActiveFactId] = useState<string | null>(null);
  const [retainedReviewIds, setRetainedReviewIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [editingFact, setEditingFact] = useState<CareerFact | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editStructuredData, setEditStructuredData] = useState('{}');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeType, setMergeType] = useState<FactType>('project');
  const [mergeTitle, setMergeTitle] = useState('');
  const [mergeSummary, setMergeSummary] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api<CareerFact[]>('/api/career-facts');
      setFacts(result);
      setRetainedReviewIds(new Set());
      setActiveFactId((current) => (
        current && result.some((fact) => fact.id === current)
          ? current
          : result[0]?.id || null
      ));
      setSelectedIds((current) => new Set(
        [...current].filter((id) => result.some((fact) => fact.id === id && isMergeableFact(fact))),
      ));
      setSelectedDraftIds((current) => new Set(
        [...current].filter((id) => result.some((fact) => fact.id === id && fact.status === 'draft')),
      ));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedFacts = useMemo(
    () => facts.filter((fact) => selectedIds.has(fact.id)),
    [facts, selectedIds],
  );
  const draftFacts = useMemo(
    () => facts.filter((fact) => fact.status === 'draft'),
    [facts],
  );
  const selectedDraftFacts = useMemo(
    () => draftFacts.filter((fact) => selectedDraftIds.has(fact.id)),
    [draftFacts, selectedDraftIds],
  );
  const displayedFacts = useMemo(() => {
    const query = searchQuery.normalize('NFKC').trim().toLocaleLowerCase();
    return facts.filter((fact) => {
      if (typeFilter !== 'all' && fact.factType !== typeFilter) return false;
      if (
        statusFilter !== 'all'
        && fact.status !== statusFilter
        && !retainedReviewIds.has(fact.id)
      ) return false;
      if (!query) return true;
      return [fact.title, fact.summary, fact.canonicalKey]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [facts, retainedReviewIds, searchQuery, statusFilter, typeFilter]);
  const displayedDraftFacts = useMemo(
    () => displayedFacts.filter((fact) => fact.status === 'draft'),
    [displayedFacts],
  );
  const activeFact = useMemo(
    () => displayedFacts.find((fact) => fact.id === activeFactId) || displayedFacts[0] || null,
    [activeFactId, displayedFacts],
  );
  const activeAllowedClaims = useMemo(
    () => activeFact?.claims.filter((claim) => claim.type === 'allowed') || [],
    [activeFact],
  );
  const activeForbiddenClaims = useMemo(
    () => activeFact?.claims.filter((claim) => claim.type === 'forbidden') || [],
    [activeFact],
  );
  const draftCountsByType = useMemo(() => Object.fromEntries(
    FACT_TYPES.map((factType) => [
      factType,
      draftFacts.filter((fact) => fact.factType === factType).length,
    ]),
  ) as Record<FactType, number>, [draftFacts]);

  useEffect(() => {
    if (activeFactId && displayedFacts.some((fact) => fact.id === activeFactId)) return;
    setActiveFactId(displayedFacts[0]?.id || null);
  }, [activeFactId, displayedFacts]);

  function toggleSelected(fact: CareerFact) {
    if (!isMergeableFact(fact)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(fact.id)) next.delete(fact.id);
      else next.add(fact.id);
      return next;
    });
  }

  function toggleDraftSelected(fact: CareerFact) {
    if (fact.status !== 'draft') return;
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      if (next.has(fact.id)) next.delete(fact.id);
      else next.add(fact.id);
      return next;
    });
  }

  function toggleAllDrafts() {
    setSelectedDraftIds((current) => (
      draftFacts.length > 0 && draftFacts.every((fact) => current.has(fact.id))
        ? new Set()
        : new Set(draftFacts.map((fact) => fact.id))
    ));
  }

  function toggleDisplayedDrafts() {
    setSelectedDraftIds((current) => (
      displayedDraftFacts.length > 0 && displayedDraftFacts.every((fact) => current.has(fact.id))
        ? new Set([...current].filter((id) => !displayedDraftFacts.some((fact) => fact.id === id)))
        : new Set([...current, ...displayedDraftFacts.map((fact) => fact.id)])
    ));
  }

  function updateStatusFilter(value: FactStatus | 'all') {
    setRetainedReviewIds(new Set());
    setStatusFilter(value);
  }

  function updateTypeFilter(value: FactType | 'all') {
    setRetainedReviewIds(new Set());
    setTypeFilter(value);
  }

  function openEdit(fact: CareerFact) {
    setEditingFact(fact);
    setEditTitle(fact.title);
    setEditSummary(fact.summary);
    setEditStructuredData(JSON.stringify(fact.structuredData, null, 2));
  }

  async function saveEdit() {
    if (!editingFact) return;
    let structuredData: Record<string, unknown>;
    try {
      const parsed = JSON.parse(editStructuredData) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON_OBJECT');
      structuredData = parsed as Record<string, unknown>;
    } catch {
      toast.error(t('invalidStructuredData'));
      return;
    }
    setBusyId(editingFact.id);
    try {
      const updated = await api<CareerFact>(`/api/career-facts/${editingFact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle, summary: editSummary, structuredData }),
      });
      setFacts((current) => (
        current.some((fact) => fact.id === updated.id)
          ? current.map((fact) => fact.id === updated.id ? updated : fact)
          : [updated, ...current]
      ));
      setActiveFactId(updated.id);
      setEditingFact(null);
      toast.success(editingFact.status === 'draft' ? t('factUpdated') : t('newDraftCreated'));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function review(fact: CareerFact, decision: 'approve' | 'reject') {
    setBusyId(fact.id);
    try {
      const updated = await api<CareerFact>(`/api/career-facts/${fact.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setFacts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelectedDraftIds((current) => {
        const next = new Set(current);
        next.delete(updated.id);
        return next;
      });
      setRetainedReviewIds((current) => new Set(current).add(updated.id));
      toast.success(decision === 'approve' ? t('factApproved') : t('factRejected'));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function reviewSelected(decision: 'approve' | 'reject') {
    if (selectedDraftFacts.length < 1) return;
    setBusyId(`batch-${decision}`);
    try {
      const updated = await api<CareerFact[]>('/api/career-facts/review', {
        method: 'POST',
        body: JSON.stringify({
          factIds: selectedDraftFacts.map((fact) => fact.id),
          decision,
        }),
      });
      toast.success(decision === 'approve'
        ? t('batchApproved', { count: selectedDraftFacts.length })
        : t('batchRejected', { count: selectedDraftFacts.length }));
      const updatedById = new Map(updated.map((fact) => [fact.id, fact]));
      setFacts((current) => current.map((fact) => updatedById.get(fact.id) || fact));
      setSelectedDraftIds(new Set());
      setRetainedReviewIds((current) => new Set([
        ...current,
        ...updated.map((fact) => fact.id),
      ]));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  function prepareMerge() {
    if (selectedFacts.length < 2) return;
    const firstType = selectedFacts[0]?.factType || 'project';
    setMergeType(selectedFacts.every((fact) => fact.factType === firstType) ? firstType : 'project');
    setMergeTitle('');
    setMergeSummary('');
    setMergeOpen(true);
  }

  async function mergeFacts() {
    if (selectedFacts.length < 2) return;
    setBusyId('merge');
    try {
      const merged = await api<CareerFact>('/api/career-facts/merge', {
        method: 'POST',
        body: JSON.stringify({
          factIds: selectedFacts.map((fact) => fact.id),
          factType: mergeType,
          title: mergeTitle,
          summary: mergeSummary,
        }),
      });
      setMergeOpen(false);
      setSelectedIds(new Set());
      setFacts((current) => [merged, ...current]);
      setActiveFactId(merged.id);
      toast.success(t('mergeDraftCreated'));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Database className="h-6 w-6" />
            {t('title')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">{t('description')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setGenerateOpen(true)} disabled={busyId !== null}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t('generateFromKnowledge')}
          </Button>
          <Button
            variant="outline"
            onClick={prepareMerge}
            disabled={selectedFacts.length < 2 || busyId !== null}
          >
            <Merge className="mr-2 h-4 w-4" />
            {t('mergeSelected', { count: selectedFacts.length })}
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={isLoading || busyId !== null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </Button>
        </div>
      </div>

      <WorkResumeUploadCard onFactsChanged={load} />

      <PublicGitHubSourceCard onFactsChanged={load} />

      <GitHubPatSourceCard onFactsChanged={load} />

      <GitHubSourceCard onFactsChanged={load} />

      <Card className={draftFacts.length > 0 ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/10' : undefined}>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListChecks className="h-5 w-5 text-amber-600" />
                {t('reviewQueueTitle')}
              </CardTitle>
              <CardDescription className="mt-1">
                {draftFacts.length > 0
                  ? t('reviewQueueDescription', { count: draftFacts.length })
                  : t('reviewQueueEmpty')}
              </CardDescription>
            </div>
            {draftFacts.length > 0 && (
              <Button variant="outline" size="sm" onClick={toggleAllDrafts} disabled={busyId !== null}>
                {draftFacts.every((fact) => selectedDraftIds.has(fact.id))
                  ? t('clearDraftSelection')
                  : t('selectAllDrafts', { count: draftFacts.length })}
              </Button>
            )}
          </div>
        </CardHeader>
        {draftFacts.length > 0 && (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {FACT_TYPES.filter((factType) => draftCountsByType[factType] > 0).map((factType) => (
                <Button
                  key={factType}
                  variant={typeFilter === factType ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => updateTypeFilter(factType)}
                >
                  {t(`type.${factType}`)} · {draftCountsByType[factType]}
                </Button>
              ))}
            </div>
            <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">
                  {t('selectedDrafts', { count: selectedDraftFacts.length })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('stableReviewHint')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void reviewSelected('reject')}
                  disabled={selectedDraftFacts.length < 1 || busyId !== null}
                >
                  {busyId === 'batch-reject'
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                  {t('rejectSelected')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void reviewSelected('approve')}
                  disabled={selectedDraftFacts.length < 1 || busyId !== null}
                >
                  {busyId === 'batch-approve'
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                  {t('approveSelected')}
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('workbenchTitle')}</CardTitle>
          <CardDescription>{t('workbenchDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 md:grid-cols-[minmax(240px,1.4fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)]">
          <div className="space-y-2">
            <Label htmlFor="knowledge-search">{t('searchLabel')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="knowledge-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
                placeholder={t('searchPlaceholder')}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('statusFilter')}</Label>
            <Select value={statusFilter} onValueChange={(value) => updateStatusFilter(value as FactStatus | 'all')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {FACT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{t(`status.${status}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('typeFilter')}</Label>
            <Select value={typeFilter} onValueChange={(value) => updateTypeFilter(value as FactType | 'all')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allTypes')}</SelectItem>
                {FACT_TYPES.map((factType) => (
                  <SelectItem key={factType} value={factType}>{t(`type.${factType}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-zinc-400" /></div>
      ) : facts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Database className="mx-auto mb-4 h-10 w-10 text-zinc-300" />
            <h2 className="font-semibold">{t('emptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-zinc-500">{t('emptyDescription')}</p>
            <p className="mt-4 text-xs text-zinc-400">{t('emptyHint')}</p>
          </CardContent>
        </Card>
      ) : displayedFacts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-zinc-300" />
            <h2 className="font-semibold">{t('filterEmptyTitle')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('filterEmptyDescription')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.9fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">{t('factListTitle')}</CardTitle>
                  <CardDescription>{t('displayedFacts', { shown: displayedFacts.length, total: facts.length })}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {retainedReviewIds.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setRetainedReviewIds(new Set())}>
                      {t('applyFiltersNow')}
                    </Button>
                  )}
                  {displayedDraftFacts.length > 0 && (
                    <Button variant="outline" size="sm" onClick={toggleDisplayedDrafts} disabled={busyId !== null}>
                      {displayedDraftFacts.every((fact) => selectedDraftIds.has(fact.id))
                        ? t('clearVisibleSelection')
                        : t('selectVisibleDrafts', { count: displayedDraftFacts.length })}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[68vh] min-h-[360px] overflow-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="w-12 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={displayedDraftFacts.length > 0 && displayedDraftFacts.every((fact) => selectedDraftIds.has(fact.id))}
                          disabled={displayedDraftFacts.length === 0 || busyId !== null}
                          onChange={toggleDisplayedDrafts}
                          aria-label={t('selectVisibleDrafts', { count: displayedDraftFacts.length })}
                          className="h-4 w-4 rounded border-zinc-300 accent-amber-600"
                        />
                      </th>
                      <th className="min-w-[300px] px-3 py-3 font-medium">{t('factColumn')}</th>
                      <th className="w-28 px-3 py-3 font-medium">{t('typeColumn')}</th>
                      <th className="w-28 px-3 py-3 font-medium">{t('statusColumn')}</th>
                      <th className="w-32 px-3 py-3 font-medium">{t('evidenceColumn')}</th>
                      <th className="w-16 px-3 py-3 text-center font-medium">{t('mergeColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedFacts.map((fact) => {
                      const selectedForReview = selectedDraftIds.has(fact.id);
                      const selectedForMerge = selectedIds.has(fact.id);
                      const isActive = activeFact?.id === fact.id;
                      return (
                        <tr
                          key={fact.id}
                          className={`border-b transition-colors last:border-0 ${
                            isActive
                              ? 'bg-brand/10'
                              : selectedForReview ? 'bg-amber-50/70 dark:bg-amber-950/20' : 'hover:bg-muted/45'
                          }`}
                          onClick={() => setActiveFactId(fact.id)}
                        >
                          <td className="px-3 py-3 align-top" onClick={(event) => event.stopPropagation()}>
                            {fact.status === 'draft' ? (
                              <input
                                type="checkbox"
                                checked={selectedForReview}
                                disabled={busyId !== null}
                                onChange={() => toggleDraftSelected(fact)}
                                aria-label={t('selectFactForReview', { title: fact.title })}
                                className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-amber-600"
                              />
                            ) : <span className="block h-4 w-4" />}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <button type="button" className="block w-full text-left" onClick={() => setActiveFactId(fact.id)}>
                              <span className="block font-medium text-foreground">{fact.title}</span>
                              <span className="mt-1 block line-clamp-1 text-xs leading-5 text-muted-foreground">
                                {fact.summary || t('noSummary')}
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Badge variant="outline">{t(`type.${fact.factType}`)}</Badge>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Badge variant={statusVariant(fact.status)}>{t(`status.${fact.status}`)}</Badge>
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                            <span className="block">{t('evidence', { count: fact.evidence.length })}</span>
                            <span className="mt-1 block">{t('confidence', { value: Math.round(fact.confidence * 100) })}</span>
                          </td>
                          <td className="px-3 py-2 text-center align-top" onClick={(event) => event.stopPropagation()}>
                            {isMergeableFact(fact) && (
                              <Button
                                variant={selectedForMerge ? 'secondary' : 'ghost'}
                                size="icon"
                                onClick={() => toggleSelected(fact)}
                                disabled={busyId !== null}
                                aria-label={selectedForMerge ? t('removeFromMerge') : t('addToMerge')}
                              >
                                <Merge className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {activeFact && (
            <Card className="self-start xl:sticky xl:top-4">
              <CardHeader className="pb-3">
                <div className="mb-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{t(`type.${activeFact.factType}`)}</Badge>
                  <Badge variant={statusVariant(activeFact.status)}>{t(`status.${activeFact.status}`)}</Badge>
                  <Badge variant="outline">{t(`createdBy.${activeFact.createdBy}`)}</Badge>
                </div>
                <CardTitle className="text-lg">{activeFact.title}</CardTitle>
                <CardDescription className="break-all font-mono text-xs">{activeFact.canonicalKey}</CardDescription>
              </CardHeader>
              <CardContent className="max-h-[58vh] space-y-4 overflow-y-auto">
                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                  {activeFact.summary || t('noSummary')}
                </p>

                <details open className="rounded-lg border bg-zinc-50/70 p-3 dark:bg-zinc-950/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{t('evidence', { count: activeFact.evidence.length })}</span>
                    <span>{t('confidence', { value: Math.round(activeFact.confidence * 100) })}</span>
                  </summary>
                  <div className="mt-3 space-y-2">
                    {activeFact.evidence.slice(0, 8).map((evidence) => (
                      <div key={evidence.id} className="rounded-md bg-white p-2 text-xs shadow-sm dark:bg-zinc-900">
                        <div className="flex min-w-0 items-center gap-1.5 font-mono text-zinc-700 dark:text-zinc-200">
                          <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
                          <span className="shrink-0">{shortHash(evidence.commitSha)}</span>
                          <span className="truncate">{evidence.path}</span>
                        </div>
                        <div className="mt-1 break-all text-zinc-500">{evidence.locator}</div>
                        <div className="mt-1 break-all font-mono text-zinc-400">
                          {t('contentHash', { hash: evidence.contentHash })}
                        </div>
                        <div className="mt-1 text-zinc-400">{evidence.parserId}@{evidence.parserVersion}</div>
                      </div>
                    ))}
                    {activeFact.evidence.length > 8 && (
                      <p className="text-xs text-zinc-500">{t('moreEvidence', { count: activeFact.evidence.length - 8 })}</p>
                    )}
                  </div>
                </details>

                {(activeAllowedClaims.length > 0 || activeForbiddenClaims.length > 0) && (
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      {t('claimDetails', { count: activeAllowedClaims.length + activeForbiddenClaims.length })}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" />{t('allowedClaims', { count: activeAllowedClaims.length })}
                        </div>
                        <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {activeAllowedClaims.map((claim) => <li key={claim.id}>• {claim.claim}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                          <Ban className="h-3.5 w-3.5" />{t('forbiddenClaims', { count: activeForbiddenClaims.length })}
                        </div>
                        <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {activeForbiddenClaims.map((claim) => <li key={claim.id}>• {claim.claim}</li>)}
                        </ul>
                      </div>
                    </div>
                  </details>
                )}

                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {t('structuredData')}
                  </summary>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-3 text-[11px] text-zinc-100">
                    {JSON.stringify(activeFact.structuredData, null, 2)}
                  </pre>
                </details>

                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  {isMergeableFact(activeFact) && (
                    <Button
                      variant={selectedIds.has(activeFact.id) ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => toggleSelected(activeFact)}
                      disabled={busyId !== null}
                    >
                      <Merge className="mr-1.5 h-3.5 w-3.5" />
                      {selectedIds.has(activeFact.id) ? t('removeFromMerge') : t('addToMerge')}
                    </Button>
                  )}
                  {activeFact.status !== 'superseded' && (
                    <Button variant="outline" size="sm" onClick={() => openEdit(activeFact)} disabled={busyId !== null}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />{t('edit')}
                    </Button>
                  )}
                  {activeFact.status === 'draft' && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => void review(activeFact, 'reject')} disabled={busyId !== null}>
                        {busyId === activeFact.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                        {t('reject')}
                      </Button>
                      <Button size="sm" onClick={() => void review(activeFact, 'approve')} disabled={busyId !== null}>
                        {busyId === activeFact.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                        {t('approve')}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={editingFact !== null} onOpenChange={(open) => !open && setEditingFact(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>
              {editingFact?.status === 'draft' ? t('editDraftDescription') : t('editVersionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fact-title">{t('factTitle')}</Label>
              <Input id="fact-title" value={editTitle} maxLength={200} onChange={(event) => setEditTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fact-summary">{t('factSummary')}</Label>
              <Textarea id="fact-summary" value={editSummary} rows={6} maxLength={5000} onChange={(event) => setEditSummary(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fact-structured-data">{t('structuredData')}</Label>
              <Textarea
                id="fact-structured-data"
                value={editStructuredData}
                rows={10}
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(event) => setEditStructuredData(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFact(null)}>{t('cancel')}</Button>
            <Button onClick={() => void saveEdit()} disabled={!editTitle.trim() || busyId !== null}>
              {busyId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateResumeDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
      />

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('mergeTitle')}</DialogTitle>
            <DialogDescription>{t('mergeDescription', { count: selectedFacts.length })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('factType')}</Label>
              <Select value={mergeType} onValueChange={(value) => setMergeType(value as FactType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FACT_TYPES.map((factType) => (
                    <SelectItem key={factType} value={factType}>{t(`type.${factType}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-title">{t('factTitle')}</Label>
              <Input id="merge-title" value={mergeTitle} maxLength={200} onChange={(event) => setMergeTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-summary">{t('factSummary')}</Label>
              <Textarea id="merge-summary" value={mergeSummary} rows={5} maxLength={5000} onChange={(event) => setMergeSummary(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>{t('cancel')}</Button>
            <Button onClick={() => void mergeFacts()} disabled={!mergeTitle.trim() || busyId !== null}>
              {busyId === 'merge' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('createMergeDraft')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
