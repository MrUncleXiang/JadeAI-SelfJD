'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileCheck2, FolderUp, Loader2, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface UploadSource {
  id: string;
  kind: 'uploaded-workresume';
  name: string;
  lastRevision: string | null;
  lastImportedAt: string | null;
}

interface UploadResult {
  source: UploadSource;
  alreadyImported: boolean;
  uploadedFiles: number;
  ignoredFiles: number;
  factsCreated: number;
  factsReused: number;
}

interface WorkResumeUploadCardProps {
  onFactsChanged: () => Promise<void>;
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { code?: string } | null;
  return new Error(body?.code || `HTTP_${response.status}`);
}

function browserPath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

export function WorkResumeUploadCard({ onFactsChanged }: WorkResumeUploadCardProps) {
  const t = useTranslations('knowledge.upload');
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<UploadSource | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '');
    inputRef.current?.setAttribute('directory', '');
  }, []);

  const loadStatus = useCallback(async (showError = false) => {
    setLoading(true);
    try {
      const response = await fetch('/api/sources/workresume-upload', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw await responseError(response);
      const body = await response.json() as { source: UploadSource | null };
      setSource(body.source);
    } catch (error) {
      if (showError) {
        toast.error(t('requestFailed'), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus(false);
  }, [loadStatus]);

  function selectFiles(selected: FileList | null) {
    setFiles(selected ? Array.from(selected) : []);
  }

  async function upload() {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const paths = files.map(browserPath);
      const firstPath = paths[0] || '';
      const sourceName = firstPath.includes('/') ? firstPath.split('/')[0] : t('defaultSourceName');
      const form = new FormData();
      form.set('schemaVersion', '1');
      form.set('sourceName', sourceName);
      files.forEach((file, index) => {
        form.append('paths', paths[index]);
        form.append('files', file, file.name);
      });
      const response = await fetch('/api/sources/workresume-upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      if (!response.ok) throw await responseError(response);
      const result = await response.json() as UploadResult;
      toast.success(result.alreadyImported ? t('alreadyImported') : t('importSucceeded'), {
        description: t('importSummary', {
          files: result.uploadedFiles,
          facts: result.factsCreated + result.factsReused,
        }),
      });
      setFiles([]);
      await Promise.all([loadStatus(), onFactsChanged()]);
    } catch (error) {
      toast.error(t('importFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FolderUp className="h-5 w-5" />
            {t('title')}
            <Badge variant="secondary">{t('recommended')}</Badge>
          </CardTitle>
          <CardDescription className="mt-2 max-w-3xl">{t('description')}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept=".json,.md,.txt,.yaml,.yml"
            onClick={(event) => { event.currentTarget.value = ''; }}
            onChange={(event) => selectFiles(event.currentTarget.files)}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
            <FolderUp className="mr-2 h-4 w-4" />
            {t('chooseDirectory')}
          </Button>
          <Button onClick={() => void upload()} disabled={files.length === 0 || uploading}>
            {uploading
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <FileCheck2 className="mr-2 h-4 w-4" />}
            {t('import')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-950/40 dark:text-zinc-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('securityNote')}</p>
        </div>

        {files.length > 0 && (
          <div className="rounded-lg border border-dashed px-4 py-3 text-sm">
            {t('selectedFiles', { count: files.length })}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        ) : source ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
            <div>
              <div className="font-medium">{source.name}</div>
              <div className="mt-1 font-mono text-xs text-zinc-500">
                {source.lastRevision ? source.lastRevision.slice(0, 12) : t('notImported')}
              </div>
            </div>
            <div className="text-xs text-zinc-500">
              {source.lastImportedAt
                ? t('lastImported', { value: new Date(source.lastImportedAt).toLocaleString(locale) })
                : t('notImported')}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-zinc-500">
            {t('empty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
