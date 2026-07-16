import { eq, desc, and, lt } from 'drizzle-orm';
import { db } from '../index';
import { chatSessions, chatMessages, resumes } from '../schema';

export const chatRepository = {
  async findSessionsByResumeId(resumeId: string) {
    return db.select().from(chatSessions).where(eq(chatSessions.resumeId, resumeId)).orderBy(desc(chatSessions.updatedAt));
  },

  async findOwnedSessionsByResumeId(userId: string, resumeId: string) {
    const ownedResume = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .limit(1);
    if (!ownedResume[0]) return [];
    return this.findSessionsByResumeId(resumeId);
  },

  async findSession(sessionId: string) {
    const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
    return rows[0] ?? null;
  },

  async findOwnedSession(userId: string, sessionId: string) {
    const session = await this.findSession(sessionId);
    if (!session) return null;
    const ownedResume = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, session.resumeId), eq(resumes.userId, userId)))
      .limit(1);
    return ownedResume[0] ? session : null;
  },

  async findPaginatedMessages(sessionId: string, opts: { cursor?: string; limit?: number } = {}) {
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

    // Reverse to ASC order for display
    rows.reverse();

    const nextCursor = hasMore && rows.length > 0
      ? (rows[0].createdAt instanceof Date ? rows[0].createdAt.toISOString() : new Date(rows[0].createdAt as number).toISOString())
      : undefined;

    return { messages: rows, hasMore, nextCursor };
  },

  async findOwnedPaginatedMessages(
    userId: string,
    sessionId: string,
    opts: { cursor?: string; limit?: number } = {},
  ) {
    const session = await this.findOwnedSession(userId, sessionId);
    if (!session) return null;
    return this.findPaginatedMessages(sessionId, opts);
  },

  async findSessionWithMessages(sessionId: string) {
    const session = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
    if (!session[0]) return null;
    const messages = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);
    return { ...session[0], messages };
  },

  async findOwnedSessionWithMessages(userId: string, sessionId: string) {
    const session = await this.findOwnedSession(userId, sessionId);
    if (!session) return null;
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
    return { ...session, messages };
  },

  async createSession(data: { resumeId: string; title?: string }) {
    const id = crypto.randomUUID();
    await db.insert(chatSessions).values({
      id,
      resumeId: data.resumeId,
      title: data.title || '新对话',
    });
    return this.findSessionWithMessages(id);
  },

  async createOwnedSession(userId: string, data: { resumeId: string; title?: string }) {
    const ownedResume = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, data.resumeId), eq(resumes.userId, userId)))
      .limit(1);
    if (!ownedResume[0]) return null;
    return this.createSession(data);
  },

  async addMessage(data: { sessionId: string; role: 'user' | 'assistant' | 'system'; content: string; metadata?: unknown }) {
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
  },

  async addOwnedMessage(
    userId: string,
    data: { sessionId: string; role: 'user' | 'assistant' | 'system'; content: string; metadata?: unknown },
  ) {
    const session = await this.findOwnedSession(userId, data.sessionId);
    if (!session) return null;
    return this.addMessage(data);
  },

  async updateSessionTitle(sessionId: string, title: string) {
    await db.update(chatSessions).set({ title }).where(eq(chatSessions.id, sessionId));
  },

  async updateOwnedSessionTitle(userId: string, sessionId: string, title: string) {
    const session = await this.findOwnedSession(userId, sessionId);
    if (!session) return false;
    await db.update(chatSessions).set({ title }).where(eq(chatSessions.id, sessionId));
    return true;
  },

  async deleteSession(sessionId: string) {
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
  },

  async deleteOwnedSession(userId: string, sessionId: string) {
    const session = await this.findOwnedSession(userId, sessionId);
    if (!session) return false;
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    return true;
  },
};
