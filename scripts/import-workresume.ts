import { dbReady } from '../src/lib/db';
import { careerRepository } from '../src/lib/db/repositories/career.repository';
import {
  parseWorkResumeV2,
  readWorkResumeGitMetadata,
  toCareerSnapshotImport,
  WorkResumeImportError,
} from '../src/lib/career/workresume-v2';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const root = argument('--root');
  const userId = argument('--user-id');
  if (!root || !userId) {
    console.error(JSON.stringify({ ok: false, errorCode: 'ROOT_AND_USER_ID_REQUIRED' }));
    process.exitCode = 2;
    return;
  }
  try {
    await dbReady;
    const parsed = await parseWorkResumeV2(root);
    const metadata = await readWorkResumeGitMetadata(
      root,
      parsed.documents.map((document) => document.path),
    );
    const result = await careerRepository.importSnapshotOwned(
      toCareerSnapshotImport(userId, parsed, metadata),
    );
    console.log(JSON.stringify({
      ok: true,
      commitSha: metadata.commitSha,
      aggregateHash: parsed.aggregateHash,
      alreadyImported: result.alreadyImported,
      documentsCreated: result.documentsCreated,
      factsCreated: result.factsCreated,
      factsReused: result.factsReused,
      evidenceCreated: result.evidenceCreated,
      claimsCreated: result.claimsCreated,
    }, null, 2));
  } catch (error) {
    const errorCode = error instanceof WorkResumeImportError
      ? error.code
      : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'IMPORT_FAILED';
    console.error(JSON.stringify({ ok: false, errorCode }));
    process.exitCode = 1;
  }
}

void main();
