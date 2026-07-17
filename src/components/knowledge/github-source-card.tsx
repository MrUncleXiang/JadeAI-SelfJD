'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Github,
  GitPullRequestArrow,
  Loader2,
  LockKeyhole,
  Settings2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
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

type ConnectionStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'error';
type SyncJobStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'cancelled';

interface StoredRepository {
  id: string;
  externalRepositoryId: string;
  fullName: string;
  defaultBranch: string;
  selected: boolean;
  lastHeadSha: string | null;
  lastSyncedAt: string | null;
}

interface SyncJob {
  id: string;
  sourceRepositoryId: string | null;
  status: SyncJobStatus;
  errorCode: string | null;
  nextAttemptAt?: string | null;
}

interface GitHubConnection {
  id: string;
  status: ConnectionStatus;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  installation: {
    accountLogin: string;
    accountType: 'user' | 'organization';
    repositorySelection: 'all' | 'selected';
    suspendedAt: string | null;
  } | null;
  repositories: StoredRepository[];
  recentJobs: SyncJob[];
}

interface LiveRepository {
  id: string;
  name?: string;
  fullName: string;
  private?: boolean;
  defaultBranch: string;
  archived?: boolean;
  disabled?: boolean;
  selected: boolean;
}

interface SyncStart {
  jobId: string;
  status: SyncJobStatus;
}

interface GitHubSourceCardProps {
  onFactsChanged: () => Promise<void>;
}

async function githubApi<T>(url: string, init?: RequestInit): Promise<T> {
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

function badgeVariant(status: ConnectionStatus | SyncJobStatus) {
  if (status === 'active' || status === 'succeeded') return 'default' as const;
  if (status === 'error' || status === 'revoked' || status === 'failed' || status === 'cancelled') {
    return 'destructive' as const;
  }
  return 'secondary' as const;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function GitHubSourceCard({ onFactsChanged }: GitHubSourceCardProps) {
  const t = useTranslations('knowledge.github');
  const locale = useLocale();
  const [connections, setConnections] = useState<GitHubConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [pickerConnectionId, setPickerConnectionId] = useState<string | null>(null);
  const [liveRepositories, setLiveRepositories] = useState<LiveRepository[]>([]);
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<Set<string>>(new Set());
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [savingRepositories, setSavingRepositories] = useState(false);
  const [syncingRepositoryId, setSyncingRepositoryId] = useState<string | null>(null);

  const loadConnections = useCallback(async (showError = true) => {
    setLoading(true);
    try {
      setConnections(await githubApi<GitHubConnection[]>('/api/github/connections'));
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
    void loadConnections(false);
    const current = new URL(window.location.href);
    const result = current.searchParams.get('github');
    if (!result) return;
    if (result === 'connected') toast.success(t('connected'));
    else if (result === 'cancelled') toast.info(t('cancelled'));
    else toast.error(t('connectionFailed'), { description: result.toUpperCase() });
    current.searchParams.delete('github');
    window.history.replaceState(window.history.state, '', current);
  }, [loadConnections, t]);

  const selectedKey = useMemo(
    () => [...selectedRepositoryIds].sort().join(','),
    [selectedRepositoryIds],
  );
  const originalSelectedKey = useMemo(
    () => liveRepositories.filter((repository) => repository.selected).map((repository) => repository.id).sort().join(','),
    [liveRepositories],
  );

  async function connect() {
    setConnecting(true);
    try {
      const result = await githubApi<{ installationUrl: string }>('/api/github/connect', {
        method: 'POST',
        body: JSON.stringify({ returnPath: `/${locale}/knowledge` }),
      });
      window.location.assign(result.installationUrl);
    } catch (error) {
      toast.error(t('connectionFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
      setConnecting(false);
    }
  }

  async function openRepositoryPicker(connectionId: string) {
    setPickerConnectionId(connectionId);
    setLiveRepositories([]);
    setSelectedRepositoryIds(new Set());
    setLoadingRepositories(true);
    try {
      const repositories = await githubApi<LiveRepository[]>(
        `/api/github/repositories?connectionId=${encodeURIComponent(connectionId)}`,
      );
      setLiveRepositories(repositories);
      setSelectedRepositoryIds(new Set(
        repositories
          .filter((repository) => repository.selected && !repository.archived && !repository.disabled)
          .map((repository) => repository.id),
      ));
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoadingRepositories(false);
    }
  }

  function toggleRepository(repository: LiveRepository) {
    if (repository.archived || repository.disabled) return;
    setSelectedRepositoryIds((current) => {
      const next = new Set(current);
      if (next.has(repository.id)) next.delete(repository.id);
      else next.add(repository.id);
      return next;
    });
  }

  async function saveRepositories() {
    if (!pickerConnectionId) return;
    setSavingRepositories(true);
    try {
      await githubApi<StoredRepository[]>('/api/github/repositories', {
        method: 'PUT',
        body: JSON.stringify({
          connectionId: pickerConnectionId,
          repositoryIds: [...selectedRepositoryIds],
        }),
      });
      toast.success(t('selectionSaved'));
      setPickerConnectionId(null);
      await loadConnections();
    } catch (error) {
      toast.error(t('requestFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingRepositories(false);
    }
  }

  async function pollSyncJob(jobId: string): Promise<SyncJob> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const job = await githubApi<SyncJob>(`/api/github/sync-jobs/${encodeURIComponent(jobId)}`);
      if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
      await wait(1_500);
    }
    throw new Error('SYNC_STATUS_TIMEOUT');
  }

  async function sync(repository: StoredRepository) {
    setSyncingRepositoryId(repository.id);
    try {
      const started = await githubApi<SyncStart>(
        `/api/github/repositories/${encodeURIComponent(repository.id)}/sync`,
        { method: 'POST' },
      );
      const job = started.status === 'succeeded'
        ? await githubApi<SyncJob>(`/api/github/sync-jobs/${encodeURIComponent(started.jobId)}`)
        : await pollSyncJob(started.jobId);
      if (job.status !== 'succeeded') throw new Error(job.errorCode || `SYNC_${job.status.toUpperCase()}`);
      toast.success(t('syncSucceeded', { repository: repository.fullName }));
      await Promise.all([loadConnections(), onFactsChanged()]);
    } catch (error) {
      toast.error(t('syncFailed', { repository: repository.fullName }), {
        description: error instanceof Error ? error.message : undefined,
      });
      await loadConnections(false);
    } finally {
      setSyncingRepositoryId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              {t('title')}
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl">{t('description')}</CardDescription>
          </div>
          <Button onClick={() => void connect()} disabled={connecting}>
            {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Github className="mr-2 h-4 w-4" />}
            {connections.some((connection) => connection.status === 'active') ? t('addAccount') : t('connect')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-950/40 dark:text-zinc-400">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t('securityNote')}</p>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-zinc-500">
              {t('empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => (
                <div key={connection.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {connection.installation?.accountLogin || t('pendingAccount')}
                        </span>
                        <Badge variant={badgeVariant(connection.status)}>
                          {t(`connectionStatus.${connection.status}`)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {connection.lastSyncedAt
                          ? t('lastSynced', { value: new Date(connection.lastSyncedAt).toLocaleString(locale) })
                          : t('neverSynced')}
                      </p>
                      {connection.lastErrorCode && (
                        <p className="mt-1 font-mono text-xs text-red-600 dark:text-red-400">
                          {connection.lastErrorCode}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void openRepositoryPicker(connection.id)}
                      disabled={connection.status !== 'active'}
                    >
                      <Settings2 className="mr-2 h-4 w-4" />
                      {t('manageRepositories')}
                    </Button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {connection.repositories.filter((repository) => repository.selected).length === 0 ? (
                      <p className="text-sm text-zinc-500">{t('noSelectedRepositories')}</p>
                    ) : connection.repositories.filter((repository) => repository.selected).map((repository) => {
                      const latestJob = connection.recentJobs.find(
                        (job) => job.sourceRepositoryId === repository.id,
                      );
                      const isSyncing = syncingRepositoryId === repository.id;
                      return (
                        <div
                          key={repository.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-950/40"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{repository.fullName}</span>
                              {latestJob && (
                                <Badge variant={badgeVariant(latestJob.status)}>
                                  {t(`jobStatus.${latestJob.status}`)}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-zinc-500">
                              {repository.lastHeadSha
                                ? t('commit', { value: repository.lastHeadSha.slice(0, 12) })
                                : t('notImported')}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void sync(repository)}
                            disabled={syncingRepositoryId !== null || connection.status !== 'active'}
                          >
                            {isSyncing
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              : <GitPullRequestArrow className="mr-2 h-4 w-4" />}
                            {repository.lastHeadSha ? t('checkUpdates') : t('initialSync')}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pickerConnectionId !== null}
        onOpenChange={(open) => {
          if (!open && !savingRepositories) setPickerConnectionId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('repositoryDialogTitle')}</DialogTitle>
            <DialogDescription>{t('repositoryDialogDescription')}</DialogDescription>
          </DialogHeader>
          {loadingRepositories ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
          ) : liveRepositories.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-zinc-500">
              {t('noAccessibleRepositories')}
            </div>
          ) : (
            <div className="space-y-2">
              {liveRepositories.map((repository) => {
                const disabled = Boolean(repository.archived || repository.disabled);
                return (
                  <label
                    key={repository.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-950/40'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRepositoryIds.has(repository.id)}
                      disabled={disabled}
                      onChange={() => toggleRepository(repository)}
                      className="mt-1 h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="truncate">{repository.fullName}</span>
                        {repository.private && <Badge variant="outline">{t('private')}</Badge>}
                        {repository.archived && <Badge variant="secondary">{t('archived')}</Badge>}
                        {repository.disabled && <Badge variant="destructive">{t('disabled')}</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {t('defaultBranch', { branch: repository.defaultBranch })}
                      </p>
                    </div>
                    {selectedRepositoryIds.has(repository.id) && !disabled && (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerConnectionId(null)} disabled={savingRepositories}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void saveRepositories()}
              disabled={loadingRepositories || savingRepositories || selectedKey === originalSelectedKey}
            >
              {savingRepositories && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveSelection', { count: selectedRepositoryIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
