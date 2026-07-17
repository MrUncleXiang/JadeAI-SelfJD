'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Database,
  FileText,
  GitCommitHorizontal,
  Loader2,
  Merge,
  Pencil,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { GitHubSourceCard } from '@/components/knowledge/github-source-card';
import { WorkResumeUploadCard } from '@/components/knowledge/workresume-upload-card';
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
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingFact, setEditingFact] = useState<CareerFact | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editStructuredData, setEditStructuredData] = useState('{}');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeType, setMergeType] = useState<FactType>('project');
  const [mergeTitle, setMergeTitle] = useState('');
  const [mergeSummary, setMergeSummary] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const query = params.size > 0 ? `?${params}` : '';
      const result = await api<CareerFact[]>(`/api/career-facts${query}`);
      setFacts(result);
      setSelectedIds((current) => new Set(
        [...current].filter((id) => result.some((fact) => fact.id === id && isMergeableFact(fact))),
      ));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, t, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedFacts = useMemo(
    () => facts.filter((fact) => selectedIds.has(fact.id)),
    [facts, selectedIds],
  );

  function toggleSelected(fact: CareerFact) {
    if (!isMergeableFact(fact)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(fact.id)) next.delete(fact.id);
      else next.add(fact.id);
      return next;
    });
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
      await api<CareerFact>(`/api/career-facts/${editingFact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle, summary: editSummary, structuredData }),
      });
      setEditingFact(null);
      toast.success(editingFact.status === 'draft' ? t('factUpdated') : t('newDraftCreated'));
      await load();
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
      await api<CareerFact>(`/api/career-facts/${fact.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      toast.success(decision === 'approve' ? t('factApproved') : t('factRejected'));
      await load();
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
      await api<CareerFact>('/api/career-facts/merge', {
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
      toast.success(t('mergeDraftCreated'));
      await load();
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

      <GitHubSourceCard onFactsChanged={load} />

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-6">
          <div className="min-w-48 flex-1 space-y-2">
            <Label>{t('statusFilter')}</Label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FactStatus | 'all')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {FACT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{t(`status.${status}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 flex-1 space-y-2">
            <Label>{t('typeFilter')}</Label>
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as FactType | 'all')}>
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
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {facts.map((fact) => {
            const allowedClaims = fact.claims.filter((claim) => claim.type === 'allowed');
            const forbiddenClaims = fact.claims.filter((claim) => claim.type === 'forbidden');
            const isBusy = busyId === fact.id;
            return (
              <Card key={fact.id} className={selectedIds.has(fact.id) ? 'ring-2 ring-brand/60' : undefined}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(fact.id)}
                      disabled={!isMergeableFact(fact) || busyId !== null}
                      onChange={() => toggleSelected(fact)}
                      aria-label={t('selectFact', { title: fact.title })}
                      className="mt-1 h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge variant="outline">{t(`type.${fact.factType}`)}</Badge>
                        <Badge variant={statusVariant(fact.status)}>{t(`status.${fact.status}`)}</Badge>
                        <Badge variant="outline">{t(`createdBy.${fact.createdBy}`)}</Badge>
                      </div>
                      <CardTitle className="text-lg">{fact.title}</CardTitle>
                      <CardDescription className="mt-1 break-all font-mono text-xs">{fact.canonicalKey}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                    {fact.summary || t('noSummary')}
                  </p>

                  <div className="rounded-lg border bg-zinc-50/70 p-3 dark:bg-zinc-950/40">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{t('evidence', { count: fact.evidence.length })}</span>
                      <span>{t('confidence', { value: Math.round(fact.confidence * 100) })}</span>
                    </div>
                    <div className="space-y-2">
                      {fact.evidence.slice(0, 4).map((evidence) => (
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
                      {fact.evidence.length > 4 && (
                        <p className="text-xs text-zinc-500">{t('moreEvidence', { count: fact.evidence.length - 4 })}</p>
                      )}
                    </div>
                  </div>

                  {(allowedClaims.length > 0 || forbiddenClaims.length > 0) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" />{t('allowedClaims', { count: allowedClaims.length })}
                        </div>
                        <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {allowedClaims.slice(0, 3).map((claim) => <li key={claim.id}>• {claim.claim}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                          <Ban className="h-3.5 w-3.5" />{t('forbiddenClaims', { count: forbiddenClaims.length })}
                        </div>
                        <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {forbiddenClaims.slice(0, 3).map((claim) => <li key={claim.id}>• {claim.claim}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                    {fact.status !== 'superseded' && (
                      <Button variant="outline" size="sm" onClick={() => openEdit(fact)} disabled={busyId !== null}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />{t('edit')}
                      </Button>
                    )}
                    {fact.status === 'draft' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => void review(fact, 'reject')} disabled={busyId !== null}>
                          {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                          {t('reject')}
                        </Button>
                        <Button size="sm" onClick={() => void review(fact, 'approve')} disabled={busyId !== null}>
                          {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                          {t('approve')}
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
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
