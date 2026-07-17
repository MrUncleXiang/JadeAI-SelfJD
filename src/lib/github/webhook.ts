import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { dbReady } from '@/lib/db';
import { githubRepository } from '@/lib/db/repositories/github.repository';

import { enqueueKnownGitHubCommit } from './sync';

export const GITHUB_MAX_WEBHOOK_BYTES = 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export class GitHubWebhookError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_SIGNATURE'
      | 'INVALID_HEADERS'
      | 'PAYLOAD_TOO_LARGE'
      | 'INVALID_PAYLOAD',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'GitHubWebhookError';
  }
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function verifyGitHubWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !/^sha256=[0-9a-f]{64}$/i.test(signatureHeader)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function installationId(payload: JsonRecord): string | null {
  return identifier(record(payload.installation)?.id);
}

function repositoryId(payload: JsonRecord): string | null {
  return identifier(record(payload.repository)?.id);
}

function removedRepositoryIds(payload: JsonRecord): string[] {
  if (!Array.isArray(payload.repositories_removed)) return [];
  return payload.repositories_removed.flatMap((value) => {
    const id = identifier(record(value)?.id);
    return id ? [id] : [];
  });
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

export interface GitHubWebhookInput {
  rawBody: Buffer;
  signature: string | null;
  deliveryId: string | null;
  eventType: string | null;
  webhookSecret: string;
}

export async function handleGitHubWebhook(input: GitHubWebhookInput) {
  if (input.rawBody.length > GITHUB_MAX_WEBHOOK_BYTES) {
    throw new GitHubWebhookError('PAYLOAD_TOO_LARGE', 413);
  }
  if (!input.deliveryId
    || !/^[A-Za-z0-9-]{1,128}$/.test(input.deliveryId)
    || !input.eventType
    || !/^[a-z_]{1,64}$/.test(input.eventType)) {
    throw new GitHubWebhookError('INVALID_HEADERS', 400);
  }
  // Signature verification is intentionally performed before JSON parsing or any database write.
  if (!verifyGitHubWebhookSignature(input.rawBody, input.signature, input.webhookSecret)) {
    throw new GitHubWebhookError('INVALID_SIGNATURE', 401);
  }
  let payload: JsonRecord;
  try {
    payload = record(JSON.parse(input.rawBody.toString('utf8'))) || (() => {
      throw new Error('not object');
    })();
  } catch {
    throw new GitHubWebhookError('INVALID_PAYLOAD', 400);
  }
  await dbReady;
  const installation = installationId(payload);
  const repository = repositoryId(payload);
  const ref = typeof payload.ref === 'string' ? payload.ref : null;
  const beforeSha = typeof payload.before === 'string' ? payload.before : null;
  const afterSha = typeof payload.after === 'string' ? payload.after : null;
  const recorded = await githubRepository.recordWebhookDelivery({
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    installationId: installation,
    repositoryExternalId: repository,
    ref,
    beforeSha,
    afterSha,
    payloadHash: sha256(input.rawBody),
  });
  if (recorded.duplicate && ['ignored', 'processed'].includes(recorded.delivery.status)) {
    return {
      accepted: true,
      duplicate: true,
      status: recorded.delivery.status,
      jobId: recorded.delivery.syncJobId,
      jobCreated: false,
    };
  }
  const duplicate = recorded.duplicate;

  if (input.eventType === 'push') {
    if (!installation || !repository || !ref || !afterSha
      || payload.deleted === true
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(afterSha)
      || /^0+$/.test(afterSha)) {
      await githubRepository.attachWebhookJob(input.deliveryId, null, 'ignored');
      return { accepted: true, duplicate, status: 'ignored' as const, jobId: null };
    }
    const selected = await githubRepository.findSelectedRepositoryByInstallation(installation, repository);
    if (!selected || ref !== `refs/heads/${selected.repository.defaultBranch}`) {
      await githubRepository.attachWebhookJob(input.deliveryId, null, 'ignored');
      return { accepted: true, duplicate, status: 'ignored' as const, jobId: null };
    }
    const enqueued = await enqueueKnownGitHubCommit({
      userId: selected.installation.userId,
      sourceConnectionId: selected.installation.sourceConnectionId,
      sourceRepositoryId: selected.repository.id,
      commitSha: afterSha,
      trigger: 'webhook',
      webhookDeliveryId: input.deliveryId,
      requestId: `github-webhook:${input.deliveryId}`,
    });
    await githubRepository.attachWebhookJob(input.deliveryId, enqueued.job.id, 'processed');
    return {
      accepted: true,
      duplicate,
      status: 'processed' as const,
      jobId: enqueued.job.id,
      jobCreated: enqueued.created || enqueued.requeued,
    };
  }

  if (input.eventType === 'installation' && installation) {
    const action = typeof payload.action === 'string' ? payload.action : '';
    if (action === 'suspend') {
      await githubRepository.updateConnectionStatusByInstallation(installation, 'suspended', 'INSTALLATION_SUSPENDED');
    } else if (action === 'deleted') {
      await githubRepository.updateConnectionStatusByInstallation(installation, 'revoked', 'INSTALLATION_REVOKED');
    } else if (['unsuspend', 'new_permissions_accepted', 'created'].includes(action)) {
      await githubRepository.updateConnectionStatusByInstallation(installation, 'active', null);
    }
    await githubRepository.attachWebhookJob(input.deliveryId, null, 'processed');
    return { accepted: true, duplicate, status: 'processed' as const, jobId: null };
  }

  if (input.eventType === 'installation_repositories' && installation) {
    await githubRepository.deselectRepositoriesByInstallation(installation, removedRepositoryIds(payload));
    await githubRepository.attachWebhookJob(input.deliveryId, null, 'processed');
    return { accepted: true, duplicate, status: 'processed' as const, jobId: null };
  }

  if (input.eventType === 'repository' && installation && repository) {
    const action = typeof payload.action === 'string' ? payload.action : '';
    const repositoryPayload = record(payload.repository);
    const fullName = boundedString(repositoryPayload?.full_name, 300);
    const defaultBranch = boundedString(repositoryPayload?.default_branch, 255);
    const archived = repositoryPayload?.archived === true;
    const disabled = repositoryPayload?.disabled === true;
    await githubRepository.updateRepositoryByInstallation({
      installationId: installation,
      externalRepositoryId: repository,
      fullName: fullName || undefined,
      defaultBranch: defaultBranch || undefined,
      deselect: archived || disabled || ['deleted', 'transferred'].includes(action),
    });
    await githubRepository.attachWebhookJob(input.deliveryId, null, 'processed');
    return { accepted: true, duplicate, status: 'processed' as const, jobId: null };
  }

  await githubRepository.attachWebhookJob(input.deliveryId, null, 'ignored');
  return { accepted: true, duplicate, status: 'ignored' as const, jobId: null };
}
