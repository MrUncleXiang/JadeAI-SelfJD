import { after, NextRequest } from 'next/server';

import { authFailureResponse, resolveActor } from '@/lib/auth/api';
import { getRequestMetadata, hasTrustedOrigin } from '@/lib/auth/http';
import { githubErrorResponse, noStoreJson } from '@/lib/github/api';
import { githubSyncService } from '@/lib/github/sync';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const metadata = getRequestMetadata(request);
  if (!hasTrustedOrigin(request)) return authFailureResponse('UNTRUSTED_ORIGIN', metadata.requestId);
  try {
    const { actor } = await resolveActor(request, metadata);
    if (!actor) return authFailureResponse('UNAUTHORIZED', metadata.requestId);
    const { repositoryId } = await params;
    const enqueued = await githubSyncService.enqueueRepository(actor, repositoryId, 'manual');
    if (enqueued.job.status === 'queued') {
      after(async () => {
        await githubSyncService.runJob(enqueued.job.id);
      });
    }
    return noStoreJson({
      jobId: enqueued.job.id,
      status: enqueued.job.status,
      created: enqueued.created,
      requeued: enqueued.requeued,
    }, metadata.requestId, 202);
  } catch (error) {
    return githubErrorResponse(error, metadata.requestId);
  }
}
