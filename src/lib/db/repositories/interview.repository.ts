import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  interviewMessages,
  interviewReports,
  interviewRounds,
  interviewSessions,
  resumes,
} from '../schema';
import type {
  DimensionScore,
  ImprovementItem,
  InterviewerConfig,
  InterviewMessageMetadata,
  InterviewMessageRole,
  InterviewRoundStatus,
  InterviewSessionStatus,
  RoundEvaluation,
  RoundSummary,
} from '@/types/interview';

async function ownsResume(userId: string, resumeId: string) {
  const rows = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function findOwnedSessionRow(userId: string, sessionId: string) {
  const rows = await db
    .select()
    .from(interviewSessions)
    .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function findOwnedRoundRow(userId: string, sessionId: string, roundId: string) {
  if (!await findOwnedSessionRow(userId, sessionId)) return null;
  const rows = await db
    .select()
    .from(interviewRounds)
    .where(and(eq(interviewRounds.id, roundId), eq(interviewRounds.sessionId, sessionId)))
    .limit(1);
  return rows[0] ?? null;
}

async function findReportRow(sessionId: string) {
  const rows = await db
    .select()
    .from(interviewReports)
    .where(eq(interviewReports.sessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export const interviewRepository = {
  // ── Sessions ────────────────────────────────────────────────────────────────

  async createOwnedSession(userId: string, data: {
    resumeId?: string | null;
    jobDescription: string;
    jobTitle: string;
    selectedInterviewers: InterviewerConfig[];
  }) {
    if (data.resumeId && !await ownsResume(userId, data.resumeId)) return null;

    const id = crypto.randomUUID();
    await db.insert(interviewSessions).values({
      id,
      userId,
      resumeId: data.resumeId ?? null,
      jobDescription: data.jobDescription,
      jobTitle: data.jobTitle,
      selectedInterviewers: data.selectedInterviewers,
    });
    return findOwnedSessionRow(userId, id);
  },

  async findOwnedSession(userId: string, sessionId: string) {
    return findOwnedSessionRow(userId, sessionId);
  },

  async findSessionsByUserId(userId: string) {
    return db
      .select()
      .from(interviewSessions)
      .where(eq(interviewSessions.userId, userId))
      .orderBy(desc(interviewSessions.createdAt));
  },

  async updateOwnedSessionStatus(
    userId: string,
    sessionId: string,
    status: InterviewSessionStatus,
  ) {
    if (!await findOwnedSessionRow(userId, sessionId)) return false;
    await db
      .update(interviewSessions)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.userId, userId)));
    return true;
  },

  async updateOwnedSessionRound(userId: string, sessionId: string, currentRound: number) {
    if (!await findOwnedSessionRow(userId, sessionId)) return false;
    await db
      .update(interviewSessions)
      .set({ currentRound, updatedAt: new Date() })
      .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.userId, userId)));
    return true;
  },

  async deleteOwnedSession(userId: string, sessionId: string) {
    if (!await findOwnedSessionRow(userId, sessionId)) return false;
    await db
      .delete(interviewSessions)
      .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.userId, userId)));
    return true;
  },

  // ── Rounds ──────────────────────────────────────────────────────────────────

  async createOwnedRound(userId: string, data: {
    sessionId: string;
    interviewerType: string;
    interviewerConfig: InterviewerConfig;
    sortOrder: number;
    maxQuestions?: number;
  }) {
    if (!await findOwnedSessionRow(userId, data.sessionId)) return null;

    const id = crypto.randomUUID();
    await db.insert(interviewRounds).values({
      id,
      sessionId: data.sessionId,
      interviewerType: data.interviewerType,
      interviewerConfig: data.interviewerConfig,
      sortOrder: data.sortOrder,
      maxQuestions: data.maxQuestions ?? 10,
    });
    return findOwnedRoundRow(userId, data.sessionId, id);
  },

  async findOwnedRound(userId: string, sessionId: string, roundId: string) {
    return findOwnedRoundRow(userId, sessionId, roundId);
  },

  async findOwnedRoundsBySessionId(userId: string, sessionId: string) {
    if (!await findOwnedSessionRow(userId, sessionId)) return null;
    return db
      .select()
      .from(interviewRounds)
      .where(eq(interviewRounds.sessionId, sessionId))
      .orderBy(interviewRounds.sortOrder);
  },

  async updateOwnedRoundStatus(
    userId: string,
    sessionId: string,
    roundId: string,
    status: InterviewRoundStatus,
  ) {
    if (!await findOwnedRoundRow(userId, sessionId, roundId)) return false;
    await db
      .update(interviewRounds)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(interviewRounds.id, roundId), eq(interviewRounds.sessionId, sessionId)));
    return true;
  },

  async incrementOwnedQuestionCount(userId: string, sessionId: string, roundId: string) {
    if (!await findOwnedRoundRow(userId, sessionId, roundId)) return false;
    await db
      .update(interviewRounds)
      .set({
        questionCount: sql`${interviewRounds.questionCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(interviewRounds.id, roundId), eq(interviewRounds.sessionId, sessionId)));
    return true;
  },

  async setOwnedRoundSummary(
    userId: string,
    sessionId: string,
    roundId: string,
    summary: RoundSummary,
  ) {
    if (!await findOwnedRoundRow(userId, sessionId, roundId)) return false;
    await db
      .update(interviewRounds)
      .set({ summary, updatedAt: new Date() })
      .where(and(eq(interviewRounds.id, roundId), eq(interviewRounds.sessionId, sessionId)));
    return true;
  },

  // ── Messages ────────────────────────────────────────────────────────────────

  async addOwnedMessage(userId: string, sessionId: string, data: {
    roundId: string;
    role: InterviewMessageRole;
    content: string;
    metadata?: InterviewMessageMetadata;
  }) {
    if (!await findOwnedRoundRow(userId, sessionId, data.roundId)) return null;

    const id = crypto.randomUUID();
    await db.insert(interviewMessages).values({
      id,
      roundId: data.roundId,
      role: data.role,
      content: data.content,
      metadata: data.metadata ?? {},
    });
    const rows = await db
      .select()
      .from(interviewMessages)
      .where(and(eq(interviewMessages.id, id), eq(interviewMessages.roundId, data.roundId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async findOwnedMessagesByRoundId(userId: string, sessionId: string, roundId: string) {
    if (!await findOwnedRoundRow(userId, sessionId, roundId)) return null;
    return db
      .select()
      .from(interviewMessages)
      .where(eq(interviewMessages.roundId, roundId))
      .orderBy(interviewMessages.createdAt);
  },

  async findOwnedAllMessagesBySessionId(userId: string, sessionId: string) {
    const rounds = await this.findOwnedRoundsBySessionId(userId, sessionId);
    if (!rounds) return null;

    return Promise.all(
      rounds.map(async (round: typeof rounds[number]) => {
        const messages = await this.findOwnedMessagesByRoundId(userId, sessionId, round.id);
        return { round, messages: messages ?? [] };
      }),
    );
  },

  async updateOwnedMessageMetadata(
    userId: string,
    sessionId: string,
    messageId: string,
    metadata: InterviewMessageMetadata,
  ) {
    const rows = await db
      .select({ roundId: interviewMessages.roundId })
      .from(interviewMessages)
      .where(eq(interviewMessages.id, messageId))
      .limit(1);
    const roundId = rows[0]?.roundId;
    if (!roundId || !await findOwnedRoundRow(userId, sessionId, roundId)) return false;

    await db
      .update(interviewMessages)
      .set({ metadata })
      .where(and(eq(interviewMessages.id, messageId), eq(interviewMessages.roundId, roundId)));
    return true;
  },

  // ── Reports ─────────────────────────────────────────────────────────────────

  async createOwnedReport(userId: string, data: {
    sessionId: string;
    overallScore: number;
    dimensionScores: DimensionScore[];
    roundEvaluations: RoundEvaluation[];
    overallFeedback: string;
    improvementPlan: ImprovementItem[];
  }) {
    if (!await findOwnedSessionRow(userId, data.sessionId)) return null;

    const id = crypto.randomUUID();
    await db.insert(interviewReports).values({
      id,
      sessionId: data.sessionId,
      overallScore: data.overallScore,
      dimensionScores: data.dimensionScores,
      roundEvaluations: data.roundEvaluations,
      overallFeedback: data.overallFeedback,
      improvementPlan: data.improvementPlan,
    });
    return this.findOwnedReportBySessionId(userId, data.sessionId);
  },

  async findOwnedReportBySessionId(userId: string, sessionId: string) {
    if (!await findOwnedSessionRow(userId, sessionId)) return null;
    return findReportRow(sessionId);
  },

  async findReportsByUserId(userId: string) {
    const sessions = await db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.status, 'completed')));
    if (sessions.length === 0) return [];

    const results = await Promise.all(
      sessions.map(async (session: typeof sessions[number]) => {
        const report = await findReportRow(session.id);
        return report ? { report, session } : null;
      }),
    );
    return results.filter((result): result is NonNullable<typeof result> => result !== null);
  },
};
