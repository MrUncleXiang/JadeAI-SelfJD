import { eq, desc, and, lt } from 'drizzle-orm';
import { db } from '../index';
import { chatSessions, chatMessages, resumes } from '../schema';

type MessageData = {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: unknown;
};

async function ownsResume(userId: string, resumeId: string) {
  const rows = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function findSessionsByResumeId(resumeId: string) {
  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.resumeId, resumeId))
    .orderBy(desc(chatSessions.updatedAt));
}

async function findSession(sessionId: string) {
  const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
  return rows[0] ?? null;
}

async function findOwnedSession(userId: string, sessionId: string) {
  const session = await findSession(sessionId);
  if (!session || !await ownsResume(userId, session.resumeId)) return null;
  return session;
}

async function findPaginatedMessages(
  sessionId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 20, 50);
  const fetchCount = limit + 1;

  let rows;
  if (opts.cursor) {
    const cursorDate = new Date(opts.cursor);
    rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, sessionId), lt(chatMessages.createdAt, cursorDate)))
      .orderBy(desc(chatMessages.createdAt))
      .limit(fetchCount);
  } else {
    rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(fetchCount);
  }

  const hasMore = rows.length > limit;
  if (hasMore) rows = rows.slice(0, limit);

  rows.reverse();

  const nextCursor = hasMore && rows.length > 0
    ? (rows[0].createdAt instanceof Date
      ? rows[0].createdAt.toISOString()
      : new Date(rows[0].createdAt as number).toISOString())
    : undefined;

  return { messages: rows, hasMore, nextCursor };
}

async function findSessionWithMessages(sessionId: string) {
  const session = await findSession(sessionId);
  if (!session) return null;
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt);
  return { ...session, messages };
}

async function createSession(data: { resumeId: string; title?: string }) {
  const id = crypto.randomUUID();
  await db.insert(chatSessions).values({
    id,
    resumeId: data.resumeId,
    title: data.title || '新对话',
  });
  return findSessionWithMessages(id);
}

async function addMessage(data: MessageData) {
  const id = crypto.randomUUID();
  await db.insert(chatMessages).values({
    id,
    sessionId: data.sessionId,
    role: data.role,
    content: data.content,
    metadata: data.metadata || {},
  });
  await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, data.sessionId));
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);
  return rows[0];
}

export const chatRepository = {
  async findOwnedSessionsByResumeId(userId: string, resumeId: string) {
    if (!await ownsResume(userId, resumeId)) return [];
    return findSessionsByResumeId(resumeId);
  },

  async findOwnedSession(userId: string, sessionId: string) {
    return findOwnedSession(userId, sessionId);
  },

  async findOwnedPaginatedMessages(
    userId: string,
    sessionId: string,
    opts: { cursor?: string; limit?: number } = {},
  ) {
    const session = await findOwnedSession(userId, sessionId);
    if (!session) return null;
    return findPaginatedMessages(sessionId, opts);
  },

  async createOwnedSession(userId: string, data: { resumeId: string; title?: string }) {
    if (!await ownsResume(userId, data.resumeId)) return null;
    return createSession(data);
  },

  async addOwnedMessage(
    userId: string,
    data: MessageData,
  ) {
    const session = await findOwnedSession(userId, data.sessionId);
    if (!session) return null;
    return addMessage(data);
  },

  async updateOwnedSessionTitle(userId: string, sessionId: string, title: string) {
    const session = await findOwnedSession(userId, sessionId);
    if (!session) return false;
    await db.update(chatSessions).set({ title }).where(eq(chatSessions.id, sessionId));
    return true;
  },

  async deleteOwnedSession(userId: string, sessionId: string) {
    const session = await findOwnedSession(userId, sessionId);
    if (!session) return false;
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    return true;
  },
};
