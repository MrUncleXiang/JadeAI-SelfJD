import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const forbiddenCalls = [
  /resumeRepository\.(?:create|findById|update|delete|duplicate|createSection|updateSection|deleteSection|updateSectionOrder|updateShareSettings|cloneSystemOwnedResume)\s*\(/,
  /chatRepository\.(?:findSession|findSessionsByResumeId|findPaginatedMessages|findSessionWithMessages|createSession|addMessage|updateSessionTitle|deleteSession)\s*\(/,
  /shareRepository\.(?:findByResumeId|findById|create|update|delete|incrementViewCount|findByToken)\s*\(/,
  /analysisRepository\.(?:createJdAnalysis|findJdAnalysesByResumeId|findJdAnalysisById|deleteJdAnalysis|createGrammarCheck|findGrammarChecksByResumeId|findGrammarCheckById|deleteGrammarCheck)\s*\(/,
  /interviewRepository\.(?:createSession|findSession|updateSessionStatus|updateSessionRound|deleteSession|createRound|findRound|findRoundsBySessionId|updateRoundStatus|incrementQuestionCount|setRoundSummary|addMessage|findMessagesByRoundId|findAllMessagesBySessionId|updateMessageMetadata|createReport|findReportBySessionId)\s*\(/,
];

describe('protected API tenant guard', () => {
  it('does not call legacy id-only resource repository methods', () => {
    const root = process.cwd();
    const output = execFileSync('find', ['src/app/api', '-type', 'f', '-name', 'route.ts'], {
      cwd: root,
      encoding: 'utf8',
    });
    const violations: string[] = [];

    for (const route of output.trim().split('\n').filter(Boolean)) {
      const source = readFileSync(join(root, route), 'utf8');
      for (const pattern of forbiddenCalls) {
        if (pattern.test(source)) violations.push(`${relative(root, route)}: ${pattern.source}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
