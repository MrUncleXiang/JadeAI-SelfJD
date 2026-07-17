import { after, NextResponse, type NextRequest } from 'next/server';

import { loadGitHubAppConfig } from '@/lib/github/config';
import { githubSyncService } from '@/lib/github/sync';
import {
  GITHUB_MAX_WEBHOOK_BYTES,
  GitHubWebhookError,
  handleGitHubWebhook,
} from '@/lib/github/webhook';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const announced = Number(request.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > GITHUB_MAX_WEBHOOK_BYTES) {
      throw new GitHubWebhookError('PAYLOAD_TOO_LARGE', 413);
    }
    const rawBody = Buffer.from(await request.arrayBuffer());
    const result = await handleGitHubWebhook({
      rawBody,
      signature: request.headers.get('x-hub-signature-256'),
      deliveryId: request.headers.get('x-github-delivery'),
      eventType: request.headers.get('x-github-event'),
      webhookSecret: loadGitHubAppConfig().webhookSecret,
    });
    if (result.jobId && result.jobCreated !== false) {
      after(async () => {
        await githubSyncService.runJob(result.jobId!);
      });
    }
    return NextResponse.json(result, { status: 202, headers: { 'x-request-id': requestId } });
  } catch (error) {
    const code = error instanceof GitHubWebhookError ? error.code : 'GITHUB_WEBHOOK_UNAVAILABLE';
    const status = error instanceof GitHubWebhookError ? error.status : 503;
    return NextResponse.json(
      { code, message: 'GitHub webhook could not be accepted.', requestId },
      { status, headers: { 'x-request-id': requestId } },
    );
  }
}
