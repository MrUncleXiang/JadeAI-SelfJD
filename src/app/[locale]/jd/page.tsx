'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  BriefcaseBusiness,
  FileSearch,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

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

type JdStatus = 'draft' | 'parsing' | 'needs_review' | 'confirmed' | 'failed';
type RequirementType = 'responsibility' | 'hard_skill' | 'soft_skill' | 'experience' | 'education' | 'preferred';
type RequirementPriority = 'required' | 'preferred' | 'normal';

interface JdRequirement {
  id?: string;
  requirementType: RequirementType;
  text: string;
  normalizedTerm: string;
  aliases: string[];
  priority: RequirementPriority;
  importance: number;
  sourceLocator: Record<string, unknown>;
  sortOrder?: number;
}

interface JdSource {
  id: string;
  inputType: 'text' | 'pdf' | 'docx' | 'image';
  title: string;
  company: string;
  jobTitle: string;
  location: string;
  contentHash: string;
  normalizedText: string;
  status: JdStatus;
  parserId: string | null;
  errorCode: string | null;
  confirmedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  requirements: JdRequirement[];
  deduplicated?: boolean;
}

interface ReviewDraft {
  sourceId: string;
  title: string;
  company: string;
  jobTitle: string;
  location: string;
  requirements: JdRequirement[];
}

const REQUIREMENT_TYPES: RequirementType[] = [
  'responsibility',
  'hard_skill',
  'soft_skill',
  'experience',
  'education',
  'preferred',
];
const REQUIREMENT_PRIORITIES: RequirementPriority[] = ['required', 'preferred', 'normal'];

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
  const body = await response.json().catch(() => null) as ({ code?: string; message?: string } & T) | null;
  if (!response.ok) throw new Error(body?.code || body?.message || `HTTP_${response.status}`);
  return body as T;
}

function emptyRequirement(): JdRequirement {
  return {
    requirementType: 'hard_skill',
    text: '',
    normalizedTerm: '',
    aliases: [],
    priority: 'normal',
    importance: 0.5,
    sourceLocator: {},
  };
}

function reviewDraft(source: JdSource): ReviewDraft {
  return {
    sourceId: source.id,
    title: source.title,
    company: source.company,
    jobTitle: source.jobTitle,
    location: source.location,
    requirements: source.requirements.map((requirement) => ({ ...requirement })),
  };
}

function statusVariant(status: JdStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'confirmed') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'needs_review') return 'secondary';
  return 'outline';
}

export default function JdPage() {
  const t = useTranslations('jd');
  const [sources, setSources] = useState<JdSource[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === draft?.sourceId) || null,
    [draft?.sourceId, sources],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setSources(await api<JdSource[]>('/api/jd-sources'));
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

  async function createSource() {
    if (!text.trim()) return;
    setIsCreating(true);
    try {
      const source = await api<JdSource>('/api/jd-sources', {
        method: 'POST',
        body: JSON.stringify({ text, title: title || undefined }),
      });
      setTitle('');
      setText('');
      toast.success(source.deduplicated ? t('duplicateFound') : t('created'));
      await load();
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsCreating(false);
    }
  }

  async function extract(source: JdSource) {
    setBusyId(source.id);
    try {
      const updated = await api<JdSource>(`/api/jd-sources/${source.id}/extract`, { method: 'POST' });
      toast.success(t('extracted'));
      await load();
      setDraft(reviewDraft(updated));
    } catch (error) {
      toast.error(t('extractFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function patchRequirement(index: number, patch: Partial<JdRequirement>) {
    setDraft((current) => current ? {
      ...current,
      requirements: current.requirements.map((requirement, requirementIndex) => (
        requirementIndex === index ? { ...requirement, ...patch } : requirement
      )),
    } : current);
  }

  function removeRequirement(index: number) {
    setDraft((current) => current ? {
      ...current,
      requirements: current.requirements.filter((_, requirementIndex) => requirementIndex !== index),
    } : current);
  }

  async function saveReview(confirm = false) {
    if (!draft || draft.requirements.length < 1) {
      toast.error(t('requirementRequired'));
      return;
    }
    setBusyId(draft.sourceId);
    try {
      const saved = await api<JdSource>(`/api/jd-sources/${draft.sourceId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: draft.title,
          company: draft.company,
          jobTitle: draft.jobTitle,
          location: draft.location,
          requirements: draft.requirements.map((requirement) => ({
            id: requirement.id,
            requirementType: requirement.requirementType,
            text: requirement.text,
            normalizedTerm: requirement.normalizedTerm,
            aliases: requirement.aliases.filter(Boolean),
            priority: requirement.priority,
            importance: requirement.importance,
            sourceLocator: requirement.sourceLocator,
          })),
        }),
      });
      const finalSource = confirm
        ? await api<JdSource>(`/api/jd-sources/${draft.sourceId}/confirm`, { method: 'POST' })
        : saved;
      toast.success(confirm ? t('confirmed') : t('saved'));
      setDraft(confirm ? null : reviewDraft(finalSource));
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BriefcaseBusiness className="h-6 w-6 text-brand" />
            {t('title')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5" /> {t('pasteTitle')}
          </CardTitle>
          <CardDescription>{t('pasteDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="jd-title">{t('optionalTitle')}</Label>
            <Input
              id="jd-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={240}
              placeholder={t('titlePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jd-text">{t('jdText')}</Label>
            <Textarea
              id="jd-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={100_000}
              rows={12}
              placeholder={t('textPlaceholder')}
            />
            <p className="text-right text-xs text-muted-foreground">{text.length.toLocaleString()} / 100,000</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('securityNote')}</p>
            <Button onClick={() => void createSource()} disabled={isCreating || !text.trim()}>
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('saveSource')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('savedSources')}</h2>
          <span className="text-sm text-muted-foreground">{t('sourceCount', { count: sources.length })}</span>
        </div>
        {isLoading ? (
          <Card><CardContent className="flex h-28 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
        ) : sources.length === 0 ? (
          <Card><CardContent className="flex h-32 flex-col items-center justify-center text-center">
            <FileSearch className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{t('emptyTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('emptyDescription')}</p>
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {sources.map((source) => (
              <Card key={source.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{source.title}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">
                        {[source.company, source.jobTitle, source.location].filter(Boolean).join(' · ')
                          || source.normalizedText.slice(0, 120)}
                      </CardDescription>
                    </div>
                    <Badge variant={statusVariant(source.status)}>{t(`status.${source.status}`)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{t('requirements', { count: source.requirements.length })}</span>
                    <span>{source.updatedAt ? new Date(source.updatedAt).toLocaleString() : ''}</span>
                    {source.errorCode && <span className="text-destructive">{source.errorCode}</span>}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {source.requirements.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setDraft(reviewDraft(source))}>
                        <PencilLine className="mr-2 h-4 w-4" /> {t('review')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => void extract(source)}
                      disabled={busyId === source.id || source.status === 'parsing'}
                    >
                      {busyId === source.id || source.status === 'parsing'
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Sparkles className="mr-2 h-4 w-4" />}
                      {source.requirements.length > 0 ? t('extractAgain') : t('extract')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('reviewTitle')}</DialogTitle>
            <DialogDescription>{t('reviewDescription')}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {(['title', 'company', 'jobTitle', 'location'] as const).map((field) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`jd-${field}`}>{t(`fields.${field}`)}</Label>
                    <Input
                      id={`jd-${field}`}
                      value={draft[field]}
                      maxLength={240}
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('requirementList')}</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft({
                      ...draft,
                      requirements: [...draft.requirements, emptyRequirement()],
                    })}
                  >
                    <Plus className="mr-2 h-4 w-4" /> {t('addRequirement')}
                  </Button>
                </div>
                {draft.requirements.map((requirement, index) => (
                  <Card key={`${requirement.id || 'new'}-${index}`}>
                    <CardContent className="space-y-3 pt-4">
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <Select
                          value={requirement.requirementType}
                          onValueChange={(value) => patchRequirement(index, { requirementType: value as RequirementType })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{REQUIREMENT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>{t(`types.${type}`)}</SelectItem>
                          ))}</SelectContent>
                        </Select>
                        <Select
                          value={requirement.priority}
                          onValueChange={(value) => patchRequirement(index, { priority: value as RequirementPriority })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{REQUIREMENT_PRIORITIES.map((priority) => (
                            <SelectItem key={priority} value={priority}>{t(`priorities.${priority}`)}</SelectItem>
                          ))}</SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" onClick={() => removeRequirement(index)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <Textarea
                        value={requirement.text}
                        rows={2}
                        maxLength={2_000}
                        placeholder={t('requirementText')}
                        onChange={(event) => patchRequirement(index, { text: event.target.value })}
                      />
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
                        <Input
                          value={requirement.normalizedTerm}
                          maxLength={240}
                          placeholder={t('normalizedTerm')}
                          onChange={(event) => patchRequirement(index, { normalizedTerm: event.target.value })}
                        />
                        <Input
                          value={requirement.aliases.join(', ')}
                          placeholder={t('aliases')}
                          onChange={(event) => patchRequirement(index, {
                            aliases: event.target.value.split(',').map((value) => value.trim()),
                          })}
                        />
                        <Input
                          type="number"
                          min={0}
                          max={1}
                          step={0.1}
                          value={requirement.importance}
                          onChange={(event) => patchRequirement(index, {
                            importance: Math.max(0, Math.min(1, Number(event.target.value) || 0)),
                          })}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDraft(null)}>{t('cancel')}</Button>
            <Button variant="secondary" onClick={() => void saveReview(false)} disabled={busyId === draft?.sourceId}>
              <Save className="mr-2 h-4 w-4" /> {t('saveReview')}
            </Button>
            <Button onClick={() => void saveReview(true)} disabled={busyId === draft?.sourceId}>
              {busyId === draft?.sourceId
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <BadgeCheck className="mr-2 h-4 w-4" />}
              {selectedSource?.status === 'confirmed' ? t('reconfirm') : t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
