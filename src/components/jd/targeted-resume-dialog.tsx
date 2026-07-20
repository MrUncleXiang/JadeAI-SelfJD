'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { TemplateThumbnail } from '@/components/dashboard/template-thumbnail';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LanguageSelect } from '@/components/ui/language-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/i18n/routing';
import { TEMPLATES } from '@/lib/constants';
import { templateLabelsMap } from '@/lib/template-labels';

interface TargetJdSource {
  id: string;
  title: string;
  company: string;
  jobTitle: string;
  requirements: Array<unknown>;
}

interface ResumeOption {
  id: string;
  title: string;
  template: string;
  language: string;
  kind?: 'baseline' | 'targeted' | 'general-copy';
}

interface TargetedResumeDialogProps {
  source: TargetJdSource | null;
  onOpenChange: (open: boolean) => void;
}

type GenerateState = 'form' | 'generating' | 'success' | 'error';

const KNOWLEDGE_ONLY = '__knowledge_only__';

export function TargetedResumeDialog({ source, onOpenChange }: TargetedResumeDialogProps) {
  const t = useTranslations('jd.targeted');
  const tGlobal = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [loadingResumes, setLoadingResumes] = useState(false);
  const [baseResumeId, setBaseResumeId] = useState(KNOWLEDGE_ONLY);
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [template, setTemplate] = useState('classic');
  const [language, setLanguage] = useState(locale === 'en' ? 'en' : 'zh');
  const [state, setState] = useState<GenerateState>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    resumeId: string;
    changeSetId: string;
    operationCount: number;
  } | null>(null);

  const selectedBase = useMemo(
    () => resumes.find((resume) => resume.id === baseResumeId) || null,
    [baseResumeId, resumes],
  );

  useEffect(() => {
    if (!source) return;
    setTitle(locale === 'en'
      ? `${source.jobTitle || source.title} Targeted Resume`
      : `${source.jobTitle || source.title}定向简历`);
    setLoadingResumes(true);
    void fetch('/api/resume', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        return response.json() as Promise<ResumeOption[]>;
      })
      .then(setResumes)
      .catch(() => setResumes([]))
      .finally(() => setLoadingResumes(false));
  }, [locale, source]);

  function selectBase(value: string) {
    setBaseResumeId(value);
    const base = resumes.find((resume) => resume.id === value);
    if (base) {
      setTemplate(base.template || 'classic');
      setLanguage(base.language === 'en' ? 'en' : 'zh');
    }
  }

  async function generate() {
    if (!source) return;
    setState('generating');
    setError('');
    try {
      const response = await fetch(`/api/jd-sources/${encodeURIComponent(source.id)}/target-resume`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(baseResumeId !== KNOWLEDGE_ONLY ? { baseResumeId } : {}),
          title: title.trim() || undefined,
          instruction: instruction.trim() || undefined,
          template,
          language: language === 'en' ? 'en' : 'zh',
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        code?: string;
        message?: string;
        resumeId?: string;
        changeSetId?: string;
        operationCount?: number;
      };
      if (!response.ok) {
        const translated = body.code && ['NO_APPROVED_FACTS', 'JD_SOURCE_NOT_CONFIRMED', 'BASE_RESUME_NOT_FOUND']
          .includes(body.code)
          ? t(`errors.${body.code}`)
          : body.message || body.code || t('errors.default');
        throw new Error(translated);
      }
      if (!body.resumeId || !body.changeSetId) throw new Error(t('errors.default'));
      setResult({
        resumeId: body.resumeId,
        changeSetId: body.changeSetId,
        operationCount: body.operationCount || 0,
      });
      setState('success');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.default'));
      setState('error');
    }
  }

  function resetAndClose() {
    onOpenChange(false);
    window.setTimeout(() => {
      setResumes([]);
      setBaseResumeId(KNOWLEDGE_ONLY);
      setTitle('');
      setInstruction('');
      setTemplate('classic');
      setLanguage(locale === 'en' ? 'en' : 'zh');
      setState('form');
      setError('');
      setResult(null);
    }, 200);
  }

  function openReview() {
    if (!result) return;
    onOpenChange(false);
    router.push(`/editor/${result.resumeId}?reviewChanges=1&changeSetId=${encodeURIComponent(result.changeSetId)}`);
  }

  return (
    <Dialog open={Boolean(source)} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pb-0 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto px-6 py-4">
          {state === 'form' && source && (
            <>
              <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 text-sm">
                <p className="font-medium">{source.company || t('unknownCompany')} · {source.jobTitle || source.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('confirmedNotice', { count: source.requirements.length })}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('baseResume')}</label>
                <Select value={baseResumeId} onValueChange={selectBase} disabled={loadingResumes}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loadingResumes ? t('loadingResumes') : t('baseResume')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={KNOWLEDGE_ONLY}>{t('knowledgeOnly')}</SelectItem>
                    {resumes.map((resume) => (
                      <SelectItem key={resume.id} value={resume.id}>
                        {resume.title}{resume.kind === 'targeted' ? ` · ${t('targetedBadge')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedBase ? t('baseCopyNotice') : t('knowledgeOnlyNotice')}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('resumeTitle')}</label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('instruction')}</label>
                <Textarea
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  maxLength={2_000}
                  rows={4}
                  placeholder={t('instructionPlaceholder')}
                  className="resize-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('language')}</label>
                  <LanguageSelect value={language} onValueChange={setLanguage} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('template')}</label>
                  <Select value={template} onValueChange={setTemplate}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {TEMPLATES.map((item) => (
                        <SelectItem key={item} value={item}>
                          <span className="flex items-center gap-2">
                            <TemplateThumbnail
                              template={item}
                              className="h-8 w-6 shrink-0 rounded-sm ring-1 ring-zinc-200/50"
                            />
                            {tGlobal(templateLabelsMap[item])}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                {t('reviewNotice')}
              </div>
            </>
          )}

          {state === 'generating' && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-brand" />
              <p className="text-sm font-medium">{t('generating')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('generatingNotice')}</p>
            </div>
          )}

          {state === 'success' && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="mb-3 h-9 w-9 text-emerald-600" />
              <p className="text-sm font-medium">{t('success')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('successNotice', { count: result?.operationCount || 0 })}
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertTriangle className="mb-3 h-9 w-9 text-destructive" />
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={resetAndClose}>{t('close')}</Button>
          {state === 'form' && <Button onClick={() => void generate()}>{t('generate')}</Button>}
          {state === 'success' && <Button onClick={openReview}>{t('reviewChanges')}</Button>}
          {state === 'error' && <Button onClick={() => setState('form')}>{t('retry')}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
