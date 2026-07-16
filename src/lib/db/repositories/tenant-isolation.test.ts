import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { db, dbReady } from '../index';
import {
  chatMessages,
  chatSessions,
  grammarChecks,
  interviewMessages,
  interviewReports,
  interviewRounds,
  interviewSessions,
  jdAnalyses,
  resumeSections,
  resumeShares,
  resumes,
  users,
} from '../schema';
import { analysisRepository } from './analysis.repository';
import { chatRepository } from './chat.repository';
import { interviewRepository } from './interview.repository';
import { resumeRepository } from './resume.repository';
import { shareRepository } from './share.repository';

const suffix = crypto.randomUUID();
const userA = `tenant-a-${suffix}`;
const userB = `tenant-b-${suffix}`;
const resumeA = `resume-a-${suffix}`;
const resumeB = `resume-b-${suffix}`;
const sectionB = `section-b-${suffix}`;
const sessionA = `session-a-${suffix}`;
const sessionB = `session-b-${suffix}`;
const shareB = `share-b-${suffix}`;
const jdAnalysisB = `jd-analysis-b-${suffix}`;
const grammarCheckB = `grammar-check-b-${suffix}`;
const interviewSessionA = `interview-session-a-${suffix}`;
const interviewSessionB = `interview-session-b-${suffix}`;
const interviewRoundB = `interview-round-b-${suffix}`;
const interviewMessageB = `interview-message-b-${suffix}`;
const interviewReportB = `interview-report-b-${suffix}`;

const interviewer = {
  type: 'technical',
  name: 'Technical Interviewer',
  title: 'Engineer',
  avatar: '',
  bio: '',
  style: 'structured',
  focusAreas: ['security'],
  systemPrompt: 'Ask technical questions',
  personality: 'direct',
};

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    {
      id: userA,
      name: 'Tenant A',
      fingerprint: `fingerprint-a-${suffix}`,
      authType: 'fingerprint',
    },
    {
      id: userB,
      name: 'Tenant B',
      fingerprint: `fingerprint-b-${suffix}`,
      authType: 'fingerprint',
    },
  ]);
  await db.insert(resumes).values([
    { id: resumeA, userId: userA, title: 'A' },
    { id: resumeB, userId: userB, title: 'B' },
  ]);
  await db.insert(resumeSections).values({
    id: sectionB,
    resumeId: resumeB,
    type: 'summary',
    title: 'Summary',
    content: { text: 'tenant-b-secret' },
  });
  await db.insert(chatSessions).values([
    { id: sessionA, resumeId: resumeA, title: 'A chat' },
    { id: sessionB, resumeId: resumeB, title: 'B chat' },
  ]);
  await db.insert(resumeShares).values({
    id: shareB,
    resumeId: resumeB,
    token: `token-${suffix}`,
    label: 'B private share',
    password: 'tenant-b-password-hash',
  });
  await db.insert(jdAnalyses).values({
    id: jdAnalysisB,
    resumeId: resumeB,
    jobDescription: 'Tenant B job description',
    result: { summary: 'tenant-b-analysis' },
    overallScore: 88,
    atsScore: 91,
  });
  await db.insert(grammarChecks).values({
    id: grammarCheckB,
    resumeId: resumeB,
    result: { summary: 'tenant-b-grammar' },
    score: 90,
    issueCount: 1,
  });
  await db.insert(interviewSessions).values([
    {
      id: interviewSessionA,
      userId: userA,
      resumeId: resumeA,
      jobDescription: 'Tenant A JD',
      jobTitle: 'A role',
      selectedInterviewers: [interviewer],
    },
    {
      id: interviewSessionB,
      userId: userB,
      resumeId: resumeB,
      jobDescription: 'Tenant B JD',
      jobTitle: 'B role',
      selectedInterviewers: [interviewer],
    },
  ]);
  await db.insert(interviewRounds).values({
    id: interviewRoundB,
    sessionId: interviewSessionB,
    interviewerType: interviewer.type,
    interviewerConfig: interviewer,
  });
  await db.insert(interviewMessages).values({
    id: interviewMessageB,
    roundId: interviewRoundB,
    role: 'candidate',
    content: 'tenant-b-answer',
    metadata: { marked: false },
  });
  await db.insert(interviewReports).values({
    id: interviewReportB,
    sessionId: interviewSessionB,
    overallScore: 86,
    dimensionScores: [],
    roundEvaluations: [],
    overallFeedback: 'tenant-b-feedback',
    improvementPlan: [],
  });
});

describe('tenant-scoped repositories', () => {
  it('does not return a resume owned by another user', async () => {
    await expect(resumeRepository.findOwnedById(userA, resumeA)).resolves.toMatchObject({
      id: resumeA,
      userId: userA,
    });
    await expect(resumeRepository.findOwnedById(userA, resumeB)).resolves.toBeNull();
  });

  it('does not mutate a section through another user resume', async () => {
    const updated = await resumeRepository.updateSectionOwned(
      userA,
      resumeB,
      sectionB,
      { content: { text: 'stolen' } },
    );

    expect(updated).toBe(false);
    const rows = await db
      .select({ content: resumeSections.content })
      .from(resumeSections)
      .where(eq(resumeSections.id, sectionB))
      .limit(1);
    expect(rows[0]?.content).toEqual({ text: 'tenant-b-secret' });
  });

  it('does not mutate, share, duplicate, or delete another user resume', async () => {
    await expect(
      resumeRepository.updateOwned(userA, resumeB, { title: 'stolen' }),
    ).resolves.toBeNull();
    await expect(
      resumeRepository.createSectionOwned(userA, {
        resumeId: resumeB,
        type: 'summary',
        title: 'Injected',
        sortOrder: 99,
        content: { text: 'cross-tenant write' },
      }),
    ).resolves.toBeNull();
    await expect(
      resumeRepository.deleteSectionOwned(userA, resumeB, sectionB),
    ).resolves.toBe(false);
    await expect(
      resumeRepository.updateSectionOrderOwned(userA, resumeB, [{ id: sectionB, sortOrder: 99 }]),
    ).resolves.toBe(false);
    await expect(
      resumeRepository.updateOwnedShareSettings(userA, resumeB, { isPublic: true }),
    ).resolves.toBe(false);
    await expect(resumeRepository.duplicateOwned(userA, resumeB)).resolves.toBeNull();
    await expect(resumeRepository.deleteOwned(userA, resumeB)).resolves.toBe(false);

    const rows = await db
      .select({ title: resumes.title, isPublic: resumes.isPublic })
      .from(resumes)
      .where(eq(resumes.id, resumeB));
    expect(rows[0]).toEqual({ title: 'B', isPublic: false });
    await expect(
      db.select().from(resumeSections).where(eq(resumeSections.id, sectionB)),
    ).resolves.toHaveLength(1);
  });

  it('does not expose or mutate another user chat session', async () => {
    await expect(chatRepository.findOwnedSession(userA, sessionA)).resolves.toMatchObject({
      id: sessionA,
      resumeId: resumeA,
    });
    await expect(chatRepository.findOwnedSession(userA, sessionB)).resolves.toBeNull();
    await expect(chatRepository.findOwnedSessionsByResumeId(userA, resumeB)).resolves.toEqual([]);
    await expect(
      chatRepository.findOwnedPaginatedMessages(userA, sessionB),
    ).resolves.toBeNull();
    await expect(
      chatRepository.createOwnedSession(userA, { resumeId: resumeB }),
    ).resolves.toBeNull();
    await expect(
      chatRepository.updateOwnedSessionTitle(userA, sessionB, 'stolen'),
    ).resolves.toBe(false);

    const message = await chatRepository.addOwnedMessage(userA, {
      sessionId: sessionB,
      role: 'user',
      content: 'cross-tenant write',
    });
    expect(message).toBeNull();

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionB));
    expect(rows).toHaveLength(0);
    await expect(chatRepository.deleteOwnedSession(userA, sessionB)).resolves.toBe(false);
    await expect(
      db.select().from(chatSessions).where(eq(chatSessions.id, sessionB)),
    ).resolves.toHaveLength(1);
  });

  it('does not expose, create, update, or delete shares through another tenant resume', async () => {
    await expect(shareRepository.findOwnedByResumeId(userA, resumeB)).resolves.toBeNull();
    await expect(shareRepository.findOwnedById(userA, resumeB, shareB)).resolves.toBeNull();
    await expect(shareRepository.createOwned(userA, {
      resumeId: resumeB,
      token: `cross-tenant-token-${suffix}`,
    })).resolves.toBeNull();
    await expect(shareRepository.updateOwned(userA, resumeB, shareB, {
      label: 'stolen',
      isActive: false,
    })).resolves.toBeNull();
    await expect(shareRepository.deleteOwned(userA, resumeB, shareB)).resolves.toBe(false);

    const rows = await db.select().from(resumeShares).where(eq(resumeShares.id, shareB)).limit(1);
    expect(rows[0]).toMatchObject({ label: 'B private share', isActive: true });
  });

  it('does not expose or mutate another tenant analysis history', async () => {
    await expect(
      analysisRepository.createOwnedJdAnalysis(userA, {
        resumeId: resumeB,
        jobDescription: 'cross-tenant JD',
        result: {},
        overallScore: 1,
        atsScore: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      analysisRepository.findOwnedJdAnalysesByResumeId(userA, resumeB),
    ).resolves.toBeNull();
    await expect(
      analysisRepository.findOwnedJdAnalysisById(userA, jdAnalysisB),
    ).resolves.toBeNull();
    await expect(
      analysisRepository.deleteOwnedJdAnalysis(userA, jdAnalysisB),
    ).resolves.toBe(false);
    await expect(
      analysisRepository.findOwnedGrammarChecksByResumeId(userA, resumeB),
    ).resolves.toBeNull();
    await expect(
      analysisRepository.findOwnedGrammarCheckById(userA, grammarCheckB),
    ).resolves.toBeNull();
    await expect(
      analysisRepository.deleteOwnedGrammarCheck(userA, grammarCheckB),
    ).resolves.toBe(false);
    await expect(
      analysisRepository.createOwnedGrammarCheck(userA, {
        resumeId: resumeB,
        result: {},
        score: 1,
        issueCount: 1,
      }),
    ).resolves.toBeNull();

    await expect(
      db.select().from(jdAnalyses).where(eq(jdAnalyses.id, jdAnalysisB)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(grammarChecks).where(eq(grammarChecks.id, grammarCheckB)),
    ).resolves.toHaveLength(1);
  });

  it('does not attach another tenant resume to a new interview', async () => {
    const created = await interviewRepository.createOwnedSession(userA, {
      resumeId: resumeB,
      jobDescription: 'Cross-tenant JD',
      jobTitle: 'Cross-tenant role',
      selectedInterviewers: [interviewer],
    });

    expect(created).toBeNull();
  });

  it('does not expose or mutate another tenant interview descendants', async () => {
    await expect(
      interviewRepository.findOwnedSession(userA, interviewSessionB),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.findOwnedRound(userA, interviewSessionB, interviewRoundB),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.findOwnedRoundsBySessionId(userA, interviewSessionB),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.createOwnedRound(userA, {
        sessionId: interviewSessionB,
        interviewerType: interviewer.type,
        interviewerConfig: interviewer,
        sortOrder: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.updateOwnedSessionStatus(userA, interviewSessionB, 'completed'),
    ).resolves.toBe(false);
    await expect(
      interviewRepository.updateOwnedSessionRound(userA, interviewSessionB, 1),
    ).resolves.toBe(false);
    await expect(
      interviewRepository.updateOwnedRoundStatus(
        userA,
        interviewSessionB,
        interviewRoundB,
        'completed',
      ),
    ).resolves.toBe(false);
    await expect(
      interviewRepository.addOwnedMessage(userA, interviewSessionB, {
        roundId: interviewRoundB,
        role: 'system',
        content: 'cross-tenant write',
      }),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.incrementOwnedQuestionCount(
        userA,
        interviewSessionB,
        interviewRoundB,
      ),
    ).resolves.toBe(false);
    await expect(
      interviewRepository.setOwnedRoundSummary(userA, interviewSessionB, interviewRoundB, {
        score: 1,
        feedback: 'cross-tenant write',
      }),
    ).resolves.toBe(false);
    await expect(
      interviewRepository.findOwnedMessagesByRoundId(
        userA,
        interviewSessionB,
        interviewRoundB,
      ),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.findOwnedAllMessagesBySessionId(userA, interviewSessionB),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.updateOwnedMessageMetadata(
        userA,
        interviewSessionB,
        interviewMessageB,
        { marked: true },
      ),
    ).resolves.toBe(false);
    await expect(
      interviewRepository.findOwnedReportBySessionId(userA, interviewSessionB),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.createOwnedReport(userA, {
        sessionId: interviewSessionB,
        overallScore: 1,
        dimensionScores: [],
        roundEvaluations: [],
        overallFeedback: 'cross-tenant write',
        improvementPlan: [],
      }),
    ).resolves.toBeNull();
    await expect(
      interviewRepository.deleteOwnedSession(userA, interviewSessionB),
    ).resolves.toBe(false);

    const roundRows = await db
      .select({ status: interviewRounds.status })
      .from(interviewRounds)
      .where(eq(interviewRounds.id, interviewRoundB));
    expect(roundRows[0]?.status).toBe('pending');

    const messageRows = await db
      .select({ metadata: interviewMessages.metadata })
      .from(interviewMessages)
      .where(eq(interviewMessages.id, interviewMessageB));
    expect(messageRows[0]?.metadata).toEqual({ marked: false });

    await expect(
      db.select().from(interviewReports).where(eq(interviewReports.id, interviewReportB)),
    ).resolves.toHaveLength(1);
  });
});
