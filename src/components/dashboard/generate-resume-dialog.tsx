'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Loader2, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LanguageSelect } from '@/components/ui/language-select';
import { TEMPLATES } from '@/lib/constants';
import { TemplateThumbnail } from './template-thumbnail';
import { templateLabelsMap } from '@/lib/template-labels';

interface GenerateResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

type GenerateState = 'form' | 'generating' | 'success' | 'error';

export function GenerateResumeDialog({ open, onOpenChange, onCreated }: GenerateResumeDialogProps) {
  const t = useTranslations('generateResume');
  const tGlobal = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [targetRole, setTargetRole] = useState('');
  const [resumeTitle, setResumeTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [template, setTemplate] = useState('classic');
  const [language, setLanguage] = useState(locale);
  const [state, setState] = useState<GenerateState>('form');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    resumeId: string;
    changeSetId: string;
    title: string;
    operationCount: number;
  } | null>(null);

  const handleGenerate = async () => {
    setState('generating');
    setError('');

    try {
      const res = await fetch('/api/resumes/from-knowledge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetRole: targetRole.trim() || undefined,
          title: resumeTitle.trim() || undefined,
          instruction: instruction.trim() || undefined,
          template,
          language: language === 'en' ? 'en' : 'zh',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { code?: string; message?: string };
        throw new Error(data.code === 'NO_APPROVED_FACTS'
          ? t('noApprovedFacts')
          : data.message || data.code || t('error'));
      }

      const data = await res.json() as {
        resumeId: string;
        changeSetId: string;
        title: string;
        operationCount: number;
      };
      setResult(data);
      setState('success');
      onCreated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('error'));
      setState('error');
    }
  };

  const handleOpenResume = () => {
    if (result) {
      onOpenChange(false);
      router.push(`/editor/${result.resumeId}?reviewChanges=1&changeSetId=${encodeURIComponent(result.changeSetId)}`);
    }
  };

  const handleRetry = () => {
    setState('form');
    setError('');
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setState('form');
      setTargetRole('');
      setResumeTitle('');
      setInstruction('');
      setTemplate('classic');
      setLanguage(locale);
      setError('');
      setResult(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4">
          {state === 'form' && (
            <>
              <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 text-sm text-zinc-600 dark:text-zinc-300">
                {t('knowledgeNotice')}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('targetRole')}
                  </label>
                  <Input
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    maxLength={240}
                    placeholder={t('targetRolePlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('resumeTitle')}
                  </label>
                  <Input
                    value={resumeTitle}
                    onChange={(e) => setResumeTitle(e.target.value)}
                    maxLength={200}
                    placeholder={t('resumeTitlePlaceholder')}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t('instruction')}
                </label>
                <Textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  maxLength={2000}
                  placeholder={t('instructionPlaceholder')}
                  rows={4}
                  className="resize-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('language')}
                  </label>
                  <LanguageSelect value={language} onValueChange={setLanguage} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('template')}
                  </label>
                  <Select value={template} onValueChange={setTemplate}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {TEMPLATES.map((tpl) => (
                        <SelectItem key={tpl} value={tpl}>
                          <span className="flex items-center gap-2">
                            <TemplateThumbnail template={tpl} className="h-8 w-6 shrink-0 rounded-sm ring-1 ring-zinc-200/50" />
                            {tGlobal(templateLabelsMap[tpl])}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {state === 'generating' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-brand mb-3" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('generating')}
              </p>
            </div>
          )}

          {state === 'success' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500 mb-3" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('success')}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {t('successDescription', { count: result?.operationCount ?? 0 })}
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <AlertTriangle className="h-8 w-8 text-red-500 mb-3" />
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                {error || t('error')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
          {state === 'form' && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                className="cursor-pointer"
              >
                {t('close')}
              </Button>
              <Button
                onClick={handleGenerate}
                className="cursor-pointer bg-brand hover:bg-brand-hover"
              >
                {t('generate')}
              </Button>
            </>
          )}
          {state === 'success' && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                className="cursor-pointer"
              >
                {t('close')}
              </Button>
              <Button
                onClick={handleOpenResume}
                className="cursor-pointer bg-brand hover:bg-brand-hover"
              >
                {t('openResume')}
              </Button>
            </>
          )}
          {state === 'error' && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                className="cursor-pointer"
              >
                {t('close')}
              </Button>
              <Button
                onClick={handleRetry}
                className="cursor-pointer bg-brand hover:bg-brand-hover"
              >
                {t('generate')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
