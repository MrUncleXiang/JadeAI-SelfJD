'use client';

import { useCallback, useEffect, useState } from 'react';
import { Github, GitPullRequestArrow, Loader2, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface PublicGitHubSource {
  id: string;
  kind: 'github-public';
  fullName: string;
  repositoryUrl: string;
  defaultBranch: string;
  lastRevision: string | null;
  lastImportedAt: string | null;
}

interface PublicGitHubImportResult {
  source: PublicGitHubSource;
  alreadyImported: boolean;
  fetchedBlobs: number;
  factsCreated: number;
  factsReused: number;
}

interface PublicGitHubSourceCardProps {
  onFactsChanged: () => Promise<void>;
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { code?: string } | null;
  return new Error(body?.code || `HTTP_${response.status}`);
}

export function PublicGitHubSourceCard({ onFactsChanged }: PublicGitHubSourceCardProps) {
  const t = useTranslations('knowledge.publicGithub');
  const locale = useLocale();
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [sources, setSources] = useState<PublicGitHubSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);

  const load = useCallback(async (showError = false) => {
    setLoading(true);
    try {
      const response = await fetch('/api/sources/github-public', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw await responseError(response);
      setSources(await response.json() as PublicGitHubSource[]);
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
    void load(false);
  }, [load]);

  async function importSource(url: string, sourceId = 'new') {
    if (!url.trim()) return;
    setImportingId(sourceId);
    try {
      const response = await fetch('/api/sources/github-public', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: url.trim() }),
      });
      if (!response.ok) throw await responseError(response);
      const result = await response.json() as PublicGitHubImportResult;
      toast.success(result.alreadyImported ? t('alreadyImported') : t('importSucceeded'), {
        description: t('importSummary', {
          blobs: result.fetchedBlobs,
          facts: result.factsCreated + result.factsReused,
        }),
      });
      setRepositoryUrl('');
      await Promise.all([load(), onFactsChanged()]);
    } catch (error) {
      toast.error(t('importFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setImportingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Github className="h-5 w-5" />
          {t('title')}
          <Badge variant="secondary">{t('noCredential')}</Badge>
        </CardTitle>
        <CardDescription className="max-w-3xl">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            value={repositoryUrl}
            onChange={(event) => setRepositoryUrl(event.currentTarget.value)}
            placeholder={t('placeholder')}
            autoComplete="off"
            disabled={importingId !== null}
          />
          <Button
            className="sm:shrink-0"
            onClick={() => void importSource(repositoryUrl)}
            disabled={!repositoryUrl.trim() || importingId !== null}
          >
            {importingId === 'new'
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <GitPullRequestArrow className="mr-2 h-4 w-4" />}
            {t('import')}
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-lg border bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-950/40 dark:text-zinc-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('securityNote')}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        ) : sources.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-zinc-500">
            {t('empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{source.fullName}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {t('defaultBranch', { branch: source.defaultBranch })}
                    {' · '}
                    {source.lastRevision
                      ? t('commit', { value: source.lastRevision.slice(0, 12) })
                      : t('notImported')}
                  </div>
                  {source.lastImportedAt && (
                    <div className="mt-1 text-xs text-zinc-500">
                      {t('lastImported', {
                        value: new Date(source.lastImportedAt).toLocaleString(locale),
                      })}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void importSource(source.repositoryUrl, source.id)}
                  disabled={importingId !== null}
                >
                  {importingId === source.id
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <GitPullRequestArrow className="mr-2 h-4 w-4" />}
                  {t('checkUpdates')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
