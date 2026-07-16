import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import { db, dbReady } from '../index';
import { chatMessages, chatSessions, resumeSections, resumes, users } from '../schema';
import { chatRepository } from './chat.repository';
import { resumeRepository } from './resume.repository';

const suffix = crypto.randomUUID();
const userA = `tenant-a-${suffix}`;
const userB = `tenant-b-${suffix}`;
const resumeA = `resume-a-${suffix}`;
const resumeB = `resume-b-${suffix}`;
const sectionB = `section-b-${suffix}`;
const sessionA = `session-a-${suffix}`;
const sessionB = `session-b-${suffix}`;

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

  it('does not expose or mutate another user chat session', async () => {
    await expect(chatRepository.findOwnedSession(userA, sessionA)).resolves.toMatchObject({
      id: sessionA,
      resumeId: resumeA,
    });
    await expect(chatRepository.findOwnedSession(userA, sessionB)).resolves.toBeNull();

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
    await expect(chatRepository.findSession(sessionB)).resolves.not.toBeNull();
  });
});
