'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  FileImage,
  FileSearch,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { TargetedResumeDialog } from '@/components/jd/targeted-resume-dialog';
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
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';

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
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  normalizedText: string;
  status: JdStatus;
  parserId: string | null;
  errorCode: string | null;
  lastRequestId: string | null;
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

class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body && !isFormData ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as ({
    code?: string;
    message?: string;
    requestId?: string;
  } & T) | null;
  if (!response.ok) {
    throw new ApiRequestError(
      body?.code || `HTTP_${response.status}`,
      body?.message || body?.code || `HTTP_${response.status}`,
      body?.requestId,
    );
  }
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
  const {
    llmBindings,
    llmError,
    llmLoaded,
    llmLoading,
    llmProfiles,
    hydrate,
  } = useSettingsStore();
  const { openModal, setSettingsTab } = useUIStore();
  const [sources, setSources] = useState<JdSource[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [imageTitle, setImageTitle] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [targetSource, setTargetSource] = useState<JdSource | null>(null);

  const visionProfile = useMemo(
    () => llmProfiles.find((profile) => profile.id === llmBindings.vision) || null,
    [llmBindings, llmProfiles],
  );
  const visionReady = visionProfile?.status === 'active' && visionProfile.capabilities.vision;
  const visionProbeError = visionProfile?.capabilities.errors?.vision
    || visionProfile?.capabilities.errors?.reachable
    || null;

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === draft?.sourceId) || null,
    [draft?.sourceId, sources],
  );
  const recentImageSources = useMemo(
    () => sources.filter((source) => source.inputType === 'image').slice(0, 6),
    [sources],
  );
  const hasRecentImageParsing = useMemo(
    () => sources.some((source) => source.inputType === 'image' && source.status === 'parsing'),
    [sources],
  );

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      setSources(await api<JdSource[]>('/api/jd-sources'));
    } catch (error) {
      if (!silent) {
        toast.error(t('requestFailed'), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!llmLoaded) void hydrate();
  }, [hydrate, llmLoaded]);

  useEffect(() => {
    if (!isUploadingImage && !hasRecentImageParsing) return;
    const timer = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(timer);
  }, [hasRecentImageParsing, isUploadingImage, load]);

  function openVisionSettings() {
    setSettingsTab('ai');
    openModal('settings');
  }

  function imageErrorMessage(code: string, fallback?: string) {
    let description: string;
    switch (code) {
      case 'LLM_PROFILE_REQUIRED':
      case 'LLM_VISION_REQUIRED':
        description = t('errors.visionRequired');
        break;
      case 'LLM_PROFILE_INVALID':
        description = t('errors.profileInvalid');
        break;
      case 'LLM_AUTH_FAILED':
        description = t('errors.authFailed');
        break;
      case 'LLM_MODEL_NOT_FOUND':
        description = t('errors.modelNotFound');
        break;
      case 'LLM_RATE_LIMITED':
        description = t('errors.rateLimited');
        break;
      case 'LLM_VISION_TIMEOUT':
        description = t('errors.timeout');
        break;
      case 'LLM_VISION_UNSUPPORTED':
        description = t('errors.visionUnsupported');
        break;
      case 'LLM_OUTBOUND_BLOCKED':
        description = t('errors.outboundBlocked');
        break;
      case 'JD_EXTRACTION_INVALID':
        description = t('errors.invalidResponse');
        break;
      case 'LLM_PROVIDER_ERROR':
        description = t('errors.providerError');
        break;
      default:
        description = fallback || code || t('requestFailed');
    }
    return description;
  }

  function imageErrorDescription(error: unknown) {
    const code = error instanceof ApiRequestError ? error.code : '';
    const description = imageErrorMessage(code, error instanceof Error ? error.message : undefined);
    return error instanceof ApiRequestError && error.requestId
      ? `${description} · ${t('requestId')}: ${error.requestId}`
      : description;
  }

  function persistentImageErrorDescription(source: JdSource) {
    const description = imageErrorMessage(source.errorCode || '', source.errorCode || undefined);
    return source.lastRequestId
      ? `${description} · ${t('requestId')}: ${source.lastRequestId}`
      : description;
  }

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

  async function uploadImageSource() {
    if (!imageFile) return;
    setIsUploadingImage(true);
    try {
      const body = new FormData();
      body.set('file', imageFile);
      if (imageTitle.trim()) body.set('title', imageTitle.trim());
      const source = await api<JdSource>('/api/jd-sources/image', {
        method: 'POST',
        body,
      });
      setImageTitle('');
      setImageFile(null);
      setImageInputKey((value) => value + 1);
      toast.success(source.deduplicated ? t('duplicateFound') : t('imageExtracted'));
      await load();
      if (source.requirements.length > 0) setDraft(reviewDraft(source));
    } catch (error) {
      await load(true);
      const persisted = error instanceof ApiRequestError
        && (error.code.startsWith('LLM_') || error.code === 'JD_EXTRACTION_INVALID');
      toast.error(t('imageUploadFailed'), {
        description: persisted
          ? `${imageErrorDescription(error)} · ${t('failurePersisted')}`
          : imageErrorDescription(error),
      });
    } finally {
      setIsUploadingImage(false);
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

      <Card className="border-brand/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileImage className="h-5 w-5 text-brand" /> {t('imageTitle')}
          </CardTitle>
          <CardDescription>{t('imageDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
            visionReady
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20'
              : 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20'
          }`}>
            <div className="flex min-w-0 items-start gap-2.5">
              {visionReady
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {llmLoading && !llmLoaded
                    ? t('visionStatusLoading')
                    : visionReady
                      ? t('visionStatusReady', { name: visionProfile.name })
                      : visionProfile
                        ? t('visionStatusUnavailable', { name: visionProfile.name })
                        : t('visionStatusUnbound')}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {llmError
                    ? t('visionStatusLoadFailed')
                    : visionProfile
                      ? `${visionProfile.modelName} · ${t(`profileStatus.${visionProfile.status}`)}${visionProbeError ? ` · ${visionProbeError}` : ''}`
                      : t('visionStatusHint')}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={openVisionSettings}>
              <Settings2 className="mr-2 h-4 w-4" />
              {t('configureVision')}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1.3fr]">
            <div className="space-y-2">
              <Label htmlFor="jd-image-title">{t('optionalTitle')}</Label>
              <Input
                id="jd-image-title"
                value={imageTitle}
                onChange={(event) => setImageTitle(event.target.value)}
                maxLength={240}
                placeholder={t('titlePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jd-image">{t('imageFile')}</Label>
              <Input
                key={imageInputKey}
                id="jd-image"
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={(event) => setImageFile(event.target.files?.[0] || null)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              <p>{t('imageLimits')}</p>
              {imageFile && (
                <p className="mt-1 truncate font-medium text-foreground">
                  {imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(2)} MiB
                </p>
              )}
            </div>
            <Button
              onClick={() => void uploadImageSource()}
              disabled={!imageFile || isUploadingImage || !visionReady}
            >
              {isUploadingImage
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Upload className="mr-2 h-4 w-4" />}
              {t('uploadAndExtract')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('imagePrivacyNote')}</p>
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{t('imageHistoryTitle')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('imageHistoryDescription')}</p>
              </div>
              {(isUploadingImage || hasRecentImageParsing) && (
                <Badge variant="outline" className="gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('status.parsing')}
                </Badge>
              )}
            </div>
            {recentImageSources.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                {t('imageHistoryEmpty')}
              </p>
            ) : (
              <div className="divide-y rounded-md border bg-background">
                {recentImageSources.map((source) => (
                  <div key={source.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        {source.status === 'parsing' ? (
                          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" />
                        ) : source.status === 'failed' ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{source.title}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[source.originalFilename, source.updatedAt
                              ? new Date(source.updatedAt).toLocaleString()
                              : null].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </div>
                      <Badge variant={statusVariant(source.status)} className="shrink-0">
                        {t(`status.${source.status}`)}
                      </Badge>
                    </div>
                    {source.status === 'parsing' && (
                      <p className="pl-6 text-xs text-muted-foreground">{t('parsingPersistent')}</p>
                    )}
                    {source.status === 'failed' && (
                      <div className="space-y-1 pl-6">
                        <p className="break-words text-xs text-destructive">
                          {persistentImageErrorDescription(source)}
                        </p>
                        <p className="text-xs text-muted-foreground">{t('imageRetryHint')}</p>
                      </div>
                    )}
                    {source.status === 'needs_review' && source.requirements.length > 0 && (
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => setDraft(reviewDraft(source))}>
                          <PencilLine className="mr-2 h-4 w-4" /> {t('reviewResult')}
                        </Button>
                      </div>
                    )}
                    {source.status !== 'failed' && source.lastRequestId && (
                      <p className="break-all pl-6 text-[11px] text-muted-foreground">
                        {t('requestId')}: {source.lastRequestId}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <CardTitle className="truncate text-base">{source.title}</CardTitle>
                        <Badge variant="outline">{t(`inputTypes.${source.inputType}`)}</Badge>
                      </div>
                      <CardDescription className="mt-1 line-clamp-2">
                        {[source.company, source.jobTitle, source.location].filter(Boolean).join(' · ')
                          || source.normalizedText.slice(0, 120)}
                      </CardDescription>
                      {source.originalFilename && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">{source.originalFilename}</p>
                      )}
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
                    {source.status === 'confirmed' && (
                      <Button size="sm" onClick={() => setTargetSource(source)}>
                        <Sparkles className="mr-2 h-4 w-4" /> {t('generateTargeted')}
                      </Button>
                    )}
                    {source.requirements.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setDraft(reviewDraft(source))}>
                        <PencilLine className="mr-2 h-4 w-4" /> {t('review')}
                      </Button>
                    )}
                    {source.inputType === 'text' && (
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
                    )}
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

      <TargetedResumeDialog
        source={targetSource}
        onOpenChange={(open) => { if (!open) setTargetSource(null); }}
      />
    </div>
  );
}
