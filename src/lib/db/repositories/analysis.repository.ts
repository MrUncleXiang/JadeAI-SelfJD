import { and, eq, desc } from 'drizzle-orm';
import { db } from '../index';
import { jdAnalyses, grammarChecks, resumes } from '../schema';

type CreateJdAnalysisData = {
  resumeId: string;
  jobDescription: string;
  result: unknown;
  overallScore: number;
  atsScore: number;
};

type CreateGrammarCheckData = {
  resumeId: string;
  result: unknown;
  score: number;
  issueCount: number;
};

async function ownsResume(userId: string, resumeId: string) {
  const rows = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function createJdAnalysis(data: CreateJdAnalysisData) {
  const id = crypto.randomUUID();
  await db.insert(jdAnalyses).values({
    id,
    resumeId: data.resumeId,
    jobDescription: data.jobDescription,
    result: data.result,
    overallScore: data.overallScore,
    atsScore: data.atsScore,
  });
  const rows = await db.select().from(jdAnalyses).where(eq(jdAnalyses.id, id)).limit(1);
  return rows[0];
}

async function findJdAnalysesByResumeId(resumeId: string, limit = 20) {
  return db
    .select()
    .from(jdAnalyses)
    .where(eq(jdAnalyses.resumeId, resumeId))
    .orderBy(desc(jdAnalyses.createdAt))
    .limit(limit);
}

async function findJdAnalysisById(id: string) {
  const rows = await db.select().from(jdAnalyses).where(eq(jdAnalyses.id, id)).limit(1);
  return rows[0] ?? null;
}

async function createGrammarCheck(data: CreateGrammarCheckData) {
  const id = crypto.randomUUID();
  await db.insert(grammarChecks).values({
    id,
    resumeId: data.resumeId,
    result: data.result,
    score: data.score,
    issueCount: data.issueCount,
  });
  const rows = await db.select().from(grammarChecks).where(eq(grammarChecks.id, id)).limit(1);
  return rows[0];
}

async function findGrammarChecksByResumeId(resumeId: string, limit = 20) {
  return db
    .select()
    .from(grammarChecks)
    .where(eq(grammarChecks.resumeId, resumeId))
    .orderBy(desc(grammarChecks.createdAt))
    .limit(limit);
}

async function findGrammarCheckById(id: string) {
  const rows = await db.select().from(grammarChecks).where(eq(grammarChecks.id, id)).limit(1);
  return rows[0] ?? null;
}

export const analysisRepository = {
  // ── JD Analysis ──────────────────────────────────────────

  async createOwnedJdAnalysis(userId: string, data: CreateJdAnalysisData) {
    if (!await ownsResume(userId, data.resumeId)) return null;
    return createJdAnalysis(data);
  },

  async findOwnedJdAnalysesByResumeId(userId: string, resumeId: string, limit = 20) {
    if (!await ownsResume(userId, resumeId)) return null;
    return findJdAnalysesByResumeId(resumeId, limit);
  },

  async findOwnedJdAnalysisById(userId: string, id: string, resumeId?: string) {
    const analysis = await findJdAnalysisById(id);
    if (!analysis || (resumeId !== undefined && analysis.resumeId !== resumeId)) return null;
    return await ownsResume(userId, analysis.resumeId) ? analysis : null;
  },

  async deleteOwnedJdAnalysis(userId: string, id: string) {
    const analysis = await this.findOwnedJdAnalysisById(userId, id);
    if (!analysis) return false;
    await db
      .delete(jdAnalyses)
      .where(and(eq(jdAnalyses.id, id), eq(jdAnalyses.resumeId, analysis.resumeId)));
    return true;
  },

  // ── Grammar Check ────────────────────────────────────────

  async createOwnedGrammarCheck(userId: string, data: CreateGrammarCheckData) {
    if (!await ownsResume(userId, data.resumeId)) return null;
    return createGrammarCheck(data);
  },

  async findOwnedGrammarChecksByResumeId(userId: string, resumeId: string, limit = 20) {
    if (!await ownsResume(userId, resumeId)) return null;
    return findGrammarChecksByResumeId(resumeId, limit);
  },

  async findOwnedGrammarCheckById(userId: string, id: string, resumeId?: string) {
    const check = await findGrammarCheckById(id);
    if (!check || (resumeId !== undefined && check.resumeId !== resumeId)) return null;
    return await ownsResume(userId, check.resumeId) ? check : null;
  },

  async deleteOwnedGrammarCheck(userId: string, id: string) {
    const check = await this.findOwnedGrammarCheckById(userId, id);
    if (!check) return false;
    await db
      .delete(grammarChecks)
      .where(and(eq(grammarChecks.id, id), eq(grammarChecks.resumeId, check.resumeId)));
    return true;
  },
};
