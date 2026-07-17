import { githubSyncService } from '../src/lib/github/sync';

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const result = await githubSyncService.runScheduledCycle({
  repositoryLimit: positiveInteger(process.env.GITHUB_RECONCILE_REPOSITORY_LIMIT, 100),
  jobLimit: positiveInteger(process.env.GITHUB_RECONCILE_JOB_LIMIT, 100),
});

process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.errors.length > 0 || result.jobsFailed > 0) process.exitCode = 1;
