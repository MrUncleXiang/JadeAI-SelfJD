import {
  parseWorkResumeV2,
  readWorkResumeGitMetadata,
  WorkResumeImportError,
} from '../src/lib/career/workresume-v2';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const root = argument('--root') || process.argv[2];
  if (!root) {
    console.error(JSON.stringify({ ok: false, errorCode: 'ROOT_REQUIRED' }));
    process.exitCode = 2;
    return;
  }
  try {
    const parsed = await parseWorkResumeV2(root);
    const metadata = await readWorkResumeGitMetadata(
      root,
      parsed.documents.map((document) => document.path),
    );
    const evidenceCount = parsed.facts.reduce((total, fact) => total + fact.evidence.length, 0);
    const claimCount = parsed.facts.reduce((total, fact) => total + fact.claims.length, 0);
    console.log(JSON.stringify({
      ok: true,
      parser: `${parsed.parserId}@${parsed.parserVersion}`,
      commitSha: metadata.commitSha,
      treeSha: metadata.treeSha,
      documentCount: parsed.documents.length,
      factCount: parsed.facts.length,
      evidenceCount,
      claimCount,
      aggregateHash: parsed.aggregateHash,
      warningCodes: parsed.warnings,
    }, null, 2));
  } catch (error) {
    const errorCode = error instanceof WorkResumeImportError ? error.code : 'INSPECTION_FAILED';
    console.error(JSON.stringify({ ok: false, errorCode }));
    process.exitCode = 1;
  }
}

void main();
